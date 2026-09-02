import { assertNever } from "@coldtea/pr-lens-schema";
import { parseOptions, readString } from "../args.js";
import { fetchCanvas, mintCanvas, pushCanvas, rotateCanvas, verifyWriteToken } from "../canvas/api.js";
import {
  ensureRegistryHome,
  findBySource,
  findCanvas,
  isCanvasId,
  mintWriteToken,
  onlyCanvas,
  readRegistry,
  REGISTRY_PATH,
  sourceKey,
  updateRegistry,
  withRegistryLock,
  writeRegistry,
  type CanvasEntry,
  type Registered,
} from "../canvas/registry.js";
import { readGraphDoc } from "../document.js";
import { PrLensCliError, usageError } from "../errors.js";
import { writeJsonFile } from "../io.js";
import type { Terminal } from "../terminal.js";
import { WORKSPACE_DIR } from "../workspace.js";

const DEFAULT_API = "https://prlens.dev";
const API_ENV = "PR_LENS_API_URL";
const DEFAULT_SOURCE = `${WORKSPACE_DIR}/drawn.graph.json`;
const DEFAULT_OUT = `${WORKSPACE_DIR}/graph.json`;

const SUBCOMMANDS = ["push", "pull", "rotate"] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];

const isSubcommand = (value: string): value is Subcommand =>
  SUBCOMMANDS.some((subcommand) => subcommand === value);

export const USAGE = `pr-lens canvas <push | pull | rotate> [options]

Keeps a graph document on the PR Lens app as a canvas: a page anyone with the
link can read, and an SVG a README can embed. The write token lands in
${REGISTRY_PATH}, which git ignores; the edit link carries the same token
in its fragment, so share the view link and keep the edit link to yourself.

  pr-lens canvas push [graph.json]     send the document (default ${DEFAULT_SOURCE})
    --canvas <id|name>                 which canvas (default the one this document
                                       was pushed to before, else a new one)
    --name <name>                      what to call a new canvas (default the document's title)

  pr-lens canvas pull [url|id]         fetch the document (default the checkout's only canvas)
    --canvas <id|name>                 which canvas, when no url or id is given
    -o, --out <file>                   where to write it (default ${DEFAULT_OUT})

  pr-lens canvas rotate                mint a new write token; the old edit link stops working
    --canvas <id|name>                 which canvas (default the checkout's only canvas)

  --api <url>                          the PR Lens app (default $${API_ENV}, else ${DEFAULT_API})`;

const readApi = (value: unknown, env: Record<string, string | undefined>): string => {
  const api = readString(value, "api") ?? env[API_ENV] ?? DEFAULT_API;
  try {
    new URL(api);
  } catch {
    throw usageError(`--api needs a URL, got ${JSON.stringify(api)}`);
  }
  return api.replace(/\/+$/, "");
};

type CanvasRef = { id: string; origin: string | undefined; writeToken: string | undefined };

/** A write token is 128 bits as base64url, the same shape as an id; anything else is not one. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{22}$/;

/**
 * A bare id, or a link a page shows: {app}/c/{id}. An edit link carries the
 * write token in its fragment, and pulling one is how a checkout that never
 * pushed the canvas comes to hold its pen.
 */
const readCanvasRef = (value: string): CanvasRef => {
  if (isCanvasId(value)) return { id: value, origin: undefined, writeToken: undefined };

  const url = (() => {
    try {
      return new URL(value);
    } catch {
      throw usageError(`expected a canvas id or a canvas URL, got ${JSON.stringify(value)}`);
    }
  })();

  const [, c, last, ...deeper] = url.pathname.split("/");
  const id = last?.replace(/\.svg$/, "");
  if (c !== "c" || id === undefined || deeper.length > 0 || !isCanvasId(id))
    throw usageError(`${value} is not a canvas URL`, "expected {app}/c/{id}");

  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
  const writeToken = fragment.get("w") ?? undefined;
  if (writeToken !== undefined && !TOKEN_SHAPE.test(writeToken))
    throw usageError(`${value} carries something after #w= that is not a write token`, "an edit link ends in #w= and 22 characters");
  return { id, origin: url.origin, writeToken };
};

/** The pen for a canvas, or the way to get one. */
const requireWriteToken = ({ id, entry }: Registered): string => {
  if (entry.writeToken !== undefined) return entry.writeToken;
  throw new PrLensCliError(
    "CANVAS_UNREGISTERED",
    `this checkout can read ${id} but holds no write token for it`,
    "pull its edit link, the one with #w= at the end, and the token comes with it",
  );
};

const countDiagrams = (count: number): string => `${count} ${count === 1 ? "diagram" : "diagrams"}`;

const unfinishedRotation = (error: PrLensCliError): PrLensCliError =>
  new PrLensCliError(
    error.code,
    `${error.message}; the rotation is not finished`,
    [error.details, "run pr-lens canvas rotate again to finish it: the new token is kept until the app confirms it"]
      .filter((line) => line !== undefined && line !== "")
      .join("\n"),
  );

/**
 * Finishes a rotation whose answer never arrived. The app takes the same
 * pair again and says "rotated" once the new token is the one on record.
 */
const settleRotation = async (
  api: string,
  { id, entry }: Registered,
  nextToken: string,
  terminal: Terminal,
): Promise<{ registered: Registered; editUrl: string }> => {
  const rotated = await rotateCanvas(api, id, requireWriteToken({ id, entry }), nextToken).catch((error: unknown) => {
    if (error instanceof PrLensCliError) throw unfinishedRotation(error);
    throw error;
  });

  // Only this transition is closed. A different token pending by now belongs
  // to a later rotation, which will close its own.
  await updateRegistry((registry) => {
    const current = registry.canvases[id];
    if (current === undefined || current.nextWriteToken !== nextToken) return;
    registry.canvases[id] = { ...current, writeToken: nextToken, nextWriteToken: undefined };
  }, terminal);

  return {
    registered: { id, entry: { ...entry, writeToken: nextToken, nextWriteToken: undefined } },
    editUrl: rotated.editUrl,
  };
};

const push = async (
  args: readonly string[],
  terminal: Terminal,
  env: Record<string, string | undefined>,
): Promise<void> => {
  const { values, positionals } = parseOptions(args, {
    canvas: { type: "string" },
    name: { type: "string" },
    api: { type: "string" },
  });
  if (positionals.length > 1)
    throw usageError(`push takes one graph document, got ${positionals.length}`);

  const source = positionals[0] ?? DEFAULT_SOURCE;
  const document = await readGraphDoc(source);
  const api = readApi(values.api, env);
  await ensureRegistryHome(terminal);
  const registry = await readRegistry();

  const ref = readString(values.canvas, "canvas");
  const known = ref === undefined ? findBySource(registry, source) : findCanvas(registry, ref);

  const registered: Registered =
    known ??
    // Minted and recorded under one lock: a minted canvas whose token cannot
    // be written down is a canvas lost, so the lock comes first, and a second
    // push of the same file racing this one finds the entry instead of
    // minting its own.
    (await withRegistryLock(async () => {
      const current = await readRegistry();
      const meanwhile = ref === undefined ? findBySource(current, source) : undefined;
      if (meanwhile !== undefined) return meanwhile;

      const minted = await mintCanvas(api);
      const entry: CanvasEntry = {
        name: readString(values.name, "name") ?? document.title,
        source: sourceKey(source),
        writeToken: minted.writeToken,
        rev: minted.rev,
      };
      current.canvases[minted.id] = entry;
      await writeRegistry(current, terminal);
      return { id: minted.id, entry };
    }));

  const pending = registered.entry.nextWriteToken;
  const target =
    pending === undefined ? registered : (await settleRotation(api, registered, pending, terminal)).registered;

  const pushed = await pushCanvas(api, target.id, requireWriteToken(target), target.entry.rev, document);

  await updateRegistry((current) => {
    current.canvases[target.id] = { ...(current.canvases[target.id] ?? target.entry), source: sourceKey(source), rev: pushed.rev };
  }, terminal);

  terminal.out(`✓ ${pushed.viewUrl} — rev ${pushed.rev} · ${countDiagrams(pushed.tiles.length)}`);
  terminal.out(`  edit link, keep it to yourself: ${pushed.editUrl}`);
  terminal.out(`  README embed: ${pushed.embedUrl}`);
};

const pull = async (
  args: readonly string[],
  terminal: Terminal,
  env: Record<string, string | undefined>,
): Promise<void> => {
  const { values, positionals } = parseOptions(args, {
    canvas: { type: "string" },
    out: { type: "string", short: "o" },
    api: { type: "string" },
  });
  if (positionals.length > 1)
    throw usageError(`pull takes one canvas url or id, got ${positionals.length}`);

  const registry = await readRegistry();
  const ref = readString(values.canvas, "canvas");
  const [positional] = positionals;

  const { id, origin, writeToken } =
    positional !== undefined
      ? readCanvasRef(positional)
      : { ...(ref === undefined ? onlyCanvas(registry) : findCanvas(registry, ref)), origin: undefined, writeToken: undefined };

  // A pasted link says where it lives; --api still wins when both are given.
  const explicit = readString(values.api, "api");
  const api = explicit === undefined && origin !== undefined ? origin : readApi(explicit, env);
  const out = readString(values.out, "out") ?? DEFAULT_OUT;

  const fetched = await fetchCanvas(api, id);
  await writeJsonFile(out, fetched.document);

  // An edit link's token is proven before it is written down: an old
  // bookmark from before a rotation must not replace the token that works.
  const proven = writeToken !== undefined && (await verifyWriteToken(api, id, writeToken));

  // Every pull records the revision, and a proven edit link records its
  // token: a checkout that lost canvas.json, or never had it, gets its pen
  // back here.
  await updateRegistry((current) => {
    const entry = current.canvases[id];
    const kept = proven ? writeToken : entry?.writeToken;
    current.canvases[id] = {
      name: entry?.name ?? fetched.document.title,
      source: entry?.source ?? sourceKey(out),
      ...(entry?.nextWriteToken === undefined ? {} : { nextWriteToken: entry.nextWriteToken }),
      ...(kept === undefined ? {} : { writeToken: kept }),
      rev: fetched.rev,
    };
  }, terminal);

  terminal.out(`✓ ${out} — rev ${fetched.rev} of ${fetched.viewUrl}`);
  if (proven) terminal.out(`  the edit link's token is now in ${REGISTRY_PATH}`);
  else if (writeToken !== undefined)
    terminal.err(`  the edit link's token no longer opens ${id}; nothing was recorded for it`);
};

const rotate = async (
  args: readonly string[],
  terminal: Terminal,
  env: Record<string, string | undefined>,
): Promise<void> => {
  const { values, positionals } = parseOptions(args, {
    canvas: { type: "string" },
    api: { type: "string" },
  });
  if (positionals.length > 0)
    throw usageError(`rotate takes no positional arguments, got ${positionals.join(" ")}`);

  const api = readApi(values.api, env);
  await ensureRegistryHome(terminal);
  const registry = await readRegistry();
  const ref = readString(values.canvas, "canvas");
  const { id } = ref === undefined ? onlyCanvas(registry) : findCanvas(registry, ref);

  // The new token is written down before the app hears of it, so nothing
  // that happens on the way back can leave the canvas without a holder. It
  // is chosen under the lock: two rotations at once finish the same one.
  let pending: Registered | undefined;
  await updateRegistry((current) => {
    const entry = current.canvases[id];
    if (entry === undefined) return;
    // No pen, no rotation: a pending token written here would be carried
    // out by the next push once a pen arrives, retiring the very link that
    // brought it.
    requireWriteToken({ id, entry });
    const nextWriteToken = entry.nextWriteToken ?? mintWriteToken();
    pending = { id, entry: { ...entry, nextWriteToken } };
    current.canvases[id] = pending.entry;
  }, terminal);
  if (pending === undefined || pending.entry.nextWriteToken === undefined)
    throw new PrLensCliError("CANVAS_UNREGISTERED", `${id} is no longer in ${REGISTRY_PATH}`);

  const { editUrl } = await settleRotation(api, pending, pending.entry.nextWriteToken, terminal);

  const view = new URL(editUrl);
  view.hash = "";
  terminal.out(`✓ new edit link for ${view.href}: ${editUrl}`);
  terminal.out("  the old edit link no longer works");
};

export const canvasCommand = async (
  args: readonly string[],
  terminal: Terminal,
  env: Record<string, string | undefined>,
): Promise<void> => {
  const [name, ...rest] = args;
  if (name === undefined) throw usageError("canvas needs a subcommand: push, pull or rotate");
  if (!isSubcommand(name)) throw usageError(`unknown canvas subcommand ${JSON.stringify(name)}`);

  switch (name) {
    case "push":
      return push(rest, terminal, env);
    case "pull":
      return pull(rest, terminal, env);
    case "rotate":
      return rotate(rest, terminal, env);
    default:
      return assertNever(name, "Unhandled canvas subcommand");
  }
};

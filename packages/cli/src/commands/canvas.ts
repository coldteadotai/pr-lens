import { assertNever } from "@coldtea/pr-lens-schema";
import { parseOptions, readString } from "../args.js";
import { fetchCanvas, mintCanvas, pushCanvas, rotateCanvas } from "../canvas/api.js";
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

/** A bare id, or the view link a page shows: {api}/c/{id}, fragment and all. */
const readCanvasRef = (value: string): { id: string; origin: string | undefined } => {
  if (isCanvasId(value)) return { id: value, origin: undefined };

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
  return { id, origin: url.origin };
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
): Promise<Registered> => {
  try {
    await rotateCanvas(api, id, entry.writeToken, nextToken);
  } catch (error) {
    if (error instanceof PrLensCliError) throw unfinishedRotation(error);
    throw error;
  }

  const settled = { ...entry, writeToken: nextToken, nextWriteToken: undefined };
  await updateRegistry((registry) => {
    registry.canvases[id] = { ...(registry.canvases[id] ?? entry), writeToken: nextToken, nextWriteToken: undefined };
  }, terminal);
  return { id, entry: settled };
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

  const registered: Registered = await (async () => {
    if (known !== undefined) return known;

    const minted = await mintCanvas(api);
    const entry = {
      name: readString(values.name, "name") ?? document.title,
      source: sourceKey(source),
      writeToken: minted.writeToken,
      rev: minted.rev,
    };
    // Recorded before the first push, so a push that fails can be tried again
    // against the same canvas instead of minting another.
    await updateRegistry((current) => {
      current.canvases[minted.id] = entry;
    }, terminal);
    return { id: minted.id, entry };
  })();

  const pending = registered.entry.nextWriteToken;
  const target = pending === undefined ? registered : await settleRotation(api, registered, pending, terminal);

  const pushed = await pushCanvas(api, target.id, target.entry.writeToken, target.entry.rev, document);

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

  const { id, origin } =
    positional !== undefined
      ? readCanvasRef(positional)
      : { id: (ref === undefined ? onlyCanvas(registry) : findCanvas(registry, ref)).id, origin: undefined };

  // A pasted link says where it lives; --api still wins when both are given.
  const explicit = readString(values.api, "api");
  const api = explicit === undefined && origin !== undefined ? origin : readApi(explicit, env);
  const out = readString(values.out, "out") ?? DEFAULT_OUT;

  const fetched = await fetchCanvas(api, id);
  await writeJsonFile(out, fetched.document);

  if (registry.canvases[id] !== undefined) {
    await updateRegistry((current) => {
      const entry = current.canvases[id];
      if (entry !== undefined) current.canvases[id] = { ...entry, rev: fetched.rev };
    }, terminal);
  }

  terminal.out(`✓ ${out} — rev ${fetched.rev} of ${fetched.viewUrl}`);
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
  const registered = ref === undefined ? onlyCanvas(registry) : findCanvas(registry, ref);
  const { id, entry } = registered;

  // The new token is written down before the app hears of it, so nothing
  // that happens on the way back can leave the canvas without a holder.
  const nextToken = entry.nextWriteToken ?? mintWriteToken();
  await updateRegistry((current) => {
    current.canvases[id] = { ...(current.canvases[id] ?? entry), nextWriteToken: nextToken };
  }, terminal);

  const settled = await settleRotation(api, registered, nextToken, terminal);

  const view = new URL(api);
  view.pathname = `/c/${id}`;
  terminal.out(`✓ new edit link for ${view.href}: ${view.href}#w=${settled.entry.writeToken}`);
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

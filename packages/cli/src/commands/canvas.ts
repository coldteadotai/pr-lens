import { assertNever } from "@coldtea/pr-lens-schema";

import {
  fetchCanvas,
  mintCanvas,
  pushCanvas,
  verifyWriteToken,
} from "../canvas/api.js";
import {
  ensureRegistryHome,
  findBySource,
  findCanvas,
  isCanvasId,
  mintWriteToken,
  selectCanvas,
  isReservedRegistryTarget,
  readRegistry,
  REGISTRY_PATH,
  sourceKey,
  updateRegistry,
  withRegistryLock,
  writeRegistry,
  type CanvasEntry,
  type CanvasRegistry,
  type Registered,
} from "../canvas/registry.js";
import { writeJsonFile } from "../io.js";
import { readGraphDoc } from "../document.js";
import type { Terminal } from "../terminal.js";
import { WORKSPACE_DIR } from "../workspace.js";
import { deleteCommand } from "../canvas/delete.js";
import { parseOptions, readString } from "../args.js";
import { PrLensCliError, usageError } from "../errors.js";
import { DEFAULT_API, API_ENV, readApi, requireSameApi, requireWriteToken, settleRotation, settlePendingRotation } from "../canvas/write.js";

const DEFAULT_SOURCE = `${WORKSPACE_DIR}/drawn.graph.json`;
const DEFAULT_OUT = `${WORKSPACE_DIR}/graph.json`;

const SUBCOMMANDS = ["push", "pull", "rotate", "delete"] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];

const isSubcommand = (value: string): value is Subcommand =>
  SUBCOMMANDS.some((subcommand) => subcommand === value);

export const USAGE = `pr-lens canvas <push | pull | rotate | delete> [options]

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

  pr-lens canvas delete                permanently delete the hosted canvas; keep local graph and SVG files
    --canvas <id|name>                 which canvas (default the checkout's only canvas)

  --api <url>                          the PR Lens app (default $${API_ENV}, else ${DEFAULT_API})`;

type CanvasRef = {
  id: string;
  origin: string | undefined;
  writeToken: string | undefined;
};

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{22}$/;

/** Pulling an edit link is how a checkout that never pushed a canvas gets its token. */
const readCanvasRef = (value: string): CanvasRef => {
  if (isCanvasId(value))
    return { id: value, origin: undefined, writeToken: undefined };

  const url = (() => {
    try {
      return new URL(value);
    } catch {
      throw usageError(
        `expected a canvas id or a canvas URL, got ${JSON.stringify(value)}`,
      );
    }
  })();

  const [, c, last, ...deeper] = url.pathname.split("/");
  const id = last?.replace(/\.svg$/, "");
  if (c !== "c" || id === undefined || deeper.length > 0 || !isCanvasId(id))
    throw usageError(`${value} is not a canvas URL`, "expected {app}/c/{id}");

  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
  const writeToken = fragment.get("w") ?? undefined;
  if (writeToken !== undefined && !TOKEN_SHAPE.test(writeToken))
    throw usageError(
      `${value} carries something after #w= that is not a write token`,
      "an edit link ends in #w= and 22 characters",
    );
  return { id, origin: url.origin, writeToken };
};

const countDiagrams = (count: number): string =>
  `${count} ${count === 1 ? "diagram" : "diagrams"}`;

type Recorded = "imported" | "kept" | "overtaken" | "refused" | "elsewhere";

type PullRecord = {
  api: string;
  id: string;
  /** Undefined for a canvas minted and never pushed to. */
  fetched: { rev: number; title: string } | undefined;
  out: string;
  writeToken: string | undefined;
  /** The stored token when the proof was made; if it changed since, the proof is stale. */
  seenToken: string | undefined;
  proven: boolean;
};

/**
 * Decided under the lock. A token that changes hands drops a pending
 * rotation, which was the old holder's business; the same token keeps it.
 */
const recordPull = (current: CanvasRegistry, pull: PullRecord): Recorded => {
  const entry = current.canvases[pull.id];
  if (entry !== undefined && entry.api !== pull.api) return "elsewhere";

  const untouched = entry?.writeToken === pull.seenToken;
  const imports =
    pull.proven && untouched && pull.writeToken !== entry?.writeToken;

  const kept = imports ? pull.writeToken : entry?.writeToken;
  const pending = imports ? undefined : entry?.pending;

  current.canvases[pull.id] = {
    name: entry?.name ?? pull.fetched?.title ?? pull.id,
    source:
      entry?.source ??
      (pull.fetched === undefined ? DEFAULT_SOURCE : sourceKey(pull.out)),
    api: pull.api,
    ...(pending === undefined ? {} : { pending }),
    ...(kept === undefined ? {} : { writeToken: kept }),
    rev: pull.fetched?.rev ?? entry?.rev ?? 0,
  };

  return imports
    ? "imported"
    : pull.proven && !untouched
      ? "overtaken"
      : pull.writeToken !== undefined && !pull.proven
        ? "refused"
        : "kept";
};

const tellRecorded = (
  recorded: Recorded,
  id: string,
  terminal: Terminal,
): void => {
  switch (recorded) {
    case "imported":
      terminal.out(`  the edit link's token is now in ${REGISTRY_PATH}`);
      return;
    case "refused":
      terminal.err(
        `  the edit link's token no longer opens ${id}; nothing was recorded for it`,
      );
      return;
    case "overtaken":
      terminal.err(
        `  ${REGISTRY_PATH} changed while the edit link was being checked; its token was not recorded`,
      );
      return;
    case "elsewhere":
      terminal.err(
        `  ${id} is registered against another app in ${REGISTRY_PATH}; that entry was left as it is`,
      );
      return;
    case "kept":
      return;
    default:
      return assertNever(recorded, "Unhandled record outcome");
  }
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
    throw usageError(
      `push takes one graph document, got ${positionals.length}`,
    );

  const source = positionals[0] ?? DEFAULT_SOURCE;
  const document = await readGraphDoc(source);
  const api = readApi(values.api, env);
  await ensureRegistryHome(terminal);
  const registry = await readRegistry();

  const ref = readString(values.canvas, "canvas");
  const known =
    ref === undefined
      ? findBySource(registry, source)
      : findCanvas(registry, ref);

  const registered: Registered =
    known ??
    // Under the lock, so a racing push of the same file finds this entry
    // instead of minting its own.
    (await withRegistryLock(async () => {
      const current = await readRegistry();
      const meanwhile =
        ref === undefined ? findBySource(current, source) : undefined;
      if (meanwhile !== undefined) return meanwhile;

      const minted = await mintCanvas(api);
      const entry: CanvasEntry = {
        name: readString(values.name, "name") ?? document.title,
        source: sourceKey(source),
        api,
        writeToken: minted.writeToken,
        rev: minted.rev,
      };
      current.canvases[minted.id] = entry;

      try {
        await writeRegistry(current, terminal);
      } catch (error) {
        // The app hands the token out once; the terminal is the only place left for it.
        if (!(error instanceof PrLensCliError)) throw error;
        throw new PrLensCliError(
          error.code,
          `${error.message}; the canvas was minted and its token is not saved`,
          [
            `keep this edit link, it is the only copy: ${minted.editUrl}`,
            "pull it once the registry can be written, and the token is recorded",
            error.details ?? "",
          ]
            .filter((line) => line !== "")
            .join("\n"),
        );
      }
      return { id: minted.id, entry };
    }));

  const target = await settlePendingRotation(api, registered, terminal);

  const pushed = await pushCanvas(
    api,
    target.id,
    requireWriteToken(target),
    target.entry.rev,
    document,
  );

  await updateRegistry((current) => {
    current.canvases[target.id] = {
      ...(current.canvases[target.id] ?? target.entry),
      source: sourceKey(source),
      rev: pushed.rev,
    };
  }, terminal);

  terminal.out(
    `✓ ${pushed.viewUrl} — rev ${pushed.rev} · ${countDiagrams(pushed.tiles.length)}`,
  );
  terminal.out("  unlisted: anyone you give the link can open it, no sign-in needed");
  terminal.out(`  README embed: ${pushed.embedUrl}`);
  terminal.out("  remove: pr-lens canvas delete");
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
    throw usageError(
      `pull takes one canvas url or id, got ${positionals.length}`,
    );

  const registry = await readRegistry();
  const ref = readString(values.canvas, "canvas");
  const [positional] = positionals;

  const { id, origin, writeToken } =
    positional !== undefined
      ? readCanvasRef(positional)
      : {
          ...selectCanvas(registry, ref),
          origin: undefined,
          writeToken: undefined,
        };

  // A pasted link says where it lives; --api still wins.
  const explicit = readString(values.api, "api");
  const api =
    explicit === undefined && origin !== undefined
      ? origin
      : readApi(explicit, env);
  const out = readString(values.out, "out") ?? DEFAULT_OUT;
  if (await isReservedRegistryTarget(out))
    throw usageError(
      `${out} is where the write tokens live; a document cannot be written there`,
    );

  // Proven before the fetch: an old bookmark must not replace the token
  // that works, and an unpushed canvas has nothing to fetch yet.
  const seenToken = registry.canvases[id]?.writeToken;
  const proven =
    writeToken !== undefined && (await verifyWriteToken(api, id, writeToken));

  const fetched = await fetchCanvas(api, id).catch((error: unknown) => {
    // Minted and never pushed: nothing to show, but a proven token is worth recording.
    if (
      error instanceof PrLensCliError &&
      error.code === "CANVAS_UNKNOWN" &&
      proven
    )
      return undefined;
    throw error;
  });
  if (fetched !== undefined) await writeJsonFile(out, fetched.document);

  const outcome: { recorded: Recorded } = { recorded: "kept" };
  await updateRegistry((current) => {
    outcome.recorded = recordPull(current, {
      api,
      id,
      fetched:
        fetched === undefined
          ? undefined
          : { rev: fetched.rev, title: fetched.document.title },
      out,
      writeToken,
      seenToken,
      proven,
    });
  }, terminal);

  terminal.out(
    fetched === undefined
      ? `✓ ${id} has nothing pushed to it yet`
      : `✓ ${out} — rev ${fetched.rev} of ${fetched.viewUrl}`,
  );
  tellRecorded(outcome.recorded, id, terminal);
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
    throw usageError(
      `rotate takes no positional arguments, got ${positionals.join(" ")}`,
    );

  const api = readApi(values.api, env);
  await ensureRegistryHome(terminal);
  const registry = await readRegistry();
  const ref = readString(values.canvas, "canvas");
  const { id } = selectCanvas(registry, ref);

  // Saved before the request, so a lost answer cannot lose it; chosen under
  // the lock, so two rotations at once finish the same one.
  let pending: Registered | undefined;
  await updateRegistry((current) => {
    const entry = current.canvases[id];
    if (entry === undefined) return;
    // Without a token, a pending rotation would be carried out by whatever
    // token arrives next, retiring the very link that brought it.
    requireSameApi(api, { id, entry });
    requireWriteToken({ id, entry });
    pending = {
      id,
      entry: { ...entry, pending: entry.pending ?? mintWriteToken() },
    };
    current.canvases[id] = pending.entry;
  }, terminal);
  if (pending === undefined || pending.entry.pending === undefined)
    throw new PrLensCliError(
      "CANVAS_UNREGISTERED",
      `${id} is no longer in ${REGISTRY_PATH}`,
    );

  const { editUrl } = await settleRotation(
    api,
    pending,
    pending.entry.pending,
    terminal,
  );

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
  if (name === undefined)
    throw usageError("canvas needs a subcommand: push, pull, rotate or delete");
  if (!isSubcommand(name))
    throw usageError(`unknown canvas subcommand ${JSON.stringify(name)}`);

  switch (name) {
    case "push":
      return push(rest, terminal, env);
    case "pull":
      return pull(rest, terminal, env);
    case "delete":
      return deleteCommand(rest, terminal, env);
    case "rotate":
      return rotate(rest, terminal, env);
    default:
      return assertNever(name, "Unhandled canvas subcommand");
  }
};

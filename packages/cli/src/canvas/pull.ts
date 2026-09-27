import { assertNever } from "@coldtea/pr-lens-schema";

import { writeJsonFile } from "../io.js";
import { readString } from "../args.js";
import type { Terminal } from "../terminal.js";
import { readApi } from "./write.js";
import { PrLensCliError, usageError } from "../errors.js";
import { fetchCanvas, verifyWriteToken, type Fetched } from "./api.js";
import {
  isCanvasId,
  REGISTRY_PATH,
  sourceKey,
  updateRegistry,
  type CanvasRegistry,
} from "./registry.js";

/** Shared by `canvas pull` and by `canvas open` on a canvas this checkout did not push. */

export type CanvasRef = {
  id: string;
  origin: string | undefined;
  writeToken: string | undefined;
};

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{22}$/;

/** Pulling an edit link is how a checkout that never pushed a canvas gets its token. */
export const readCanvasRef = (value: string): CanvasRef => {
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

/** A pasted link says where it lives; --api still wins. */
export const refApi = (
  origin: string | undefined,
  apiFlag: unknown,
  env: Record<string, string | undefined>,
): string => {
  const explicit = readString(apiFlag, "api");
  return explicit === undefined && origin !== undefined
    ? origin
    : readApi(explicit, env);
};

export type Recorded = "imported" | "kept" | "overtaken" | "refused" | "elsewhere";

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
      // No document, so no source a bare push could resolve to.
      (pull.fetched === undefined ? undefined : sourceKey(pull.out)),
    api: pull.api,
    ...(pending === undefined ? {} : { pending }),
    ...(kept === undefined ? {} : { writeToken: kept }),
    rev: pull.fetched?.rev ?? entry?.rev ?? 0,
    ...(entry?.live === undefined ? {} : { live: entry.live }),
  };

  return imports
    ? "imported"
    : pull.proven && !untouched
      ? "overtaken"
      : pull.writeToken !== undefined && !pull.proven
        ? "refused"
        : "kept";
};

export const tellRecorded = (
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

export type Pulled = { fetched: Fetched | undefined; recorded: Recorded };

/** An edit link's token is recorded only once the app accepts it. `token` lets an owner fetch a private canvas. */
export const pullCanvas = async (
  registry: CanvasRegistry,
  pull: { api: string; id: string; writeToken: string | undefined; out: string; token: string | undefined },
  terminal: Terminal,
): Promise<Pulled> => {
  const { api, id, writeToken, out } = pull;

  // Proven before the fetch: an old bookmark must not replace the token
  // that works, and an unpushed canvas has nothing to fetch yet.
  const seenToken = registry.canvases[id]?.writeToken;
  const proven =
    writeToken !== undefined && (await verifyWriteToken(api, id, writeToken));

  const fetched = await fetchCanvas(api, id, pull.token).catch((error: unknown) => {
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

  return { fetched, recorded: outcome.recorded };
};

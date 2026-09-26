import type { experimental_evaluate } from "ai";
import type { ChangedFile, Diff } from "./git.js";

/**
 * Below this probability a file is judged noise — lockfiles, snapshots,
 * generated code — and dropped before the extraction model sees it. The
 * threshold is deliberately low: dropping a real file costs a wrong diagram,
 * keeping a noise file only costs prompt bytes.
 */
const KEEP_THRESHOLD = 0.25;

/** One evaluation call carries this many files; a monorepo sweep needs several. */
const FILES_PER_CALL = 80;

/** Enough of a file's patch for a significance call; the full text is the extractor's job. */
const EXCERPT_BYTES = 1200;

export const TRIAGE_MODEL = "typesafe-ai/jev";

export type TriagedFile = ChangedFile & { probability: number | undefined };

export type Triage = {
  diff: Diff;
  kept: TriagedFile[];
  dropped: TriagedFile[];
  tookMs: number;
  inputTokens: number | undefined;
};

type Segment = { path: string | undefined; text: string };

const HEADER_PATH = /^\+\+\+ b\/(.+)$/m;
const DEV_NULL_HEADER = /^--- a\/(.+)$/m;

/**
 * A unified diff is one string, but every file starts at a `diff --git` line.
 * The path is read from the `+++ b/` header, or the `--- a/` header for a
 * deletion. A segment whose path cannot be read is never dropped: triage must
 * fail toward keeping.
 */
export const splitPatch = (patch: string): Segment[] => {
  const starts: number[] = [];
  const HEADER = /^diff --git .*$/gm;
  for (let match = HEADER.exec(patch); match !== null; match = HEADER.exec(patch))
    starts.push(match.index);

  return starts.map((start, index) => {
    const text = patch.slice(start, starts[index + 1]);
    const path = HEADER_PATH.exec(text)?.[1] ?? DEV_NULL_HEADER.exec(text)?.[1];
    return { path, text };
  });
};

const excerpt = (segment: Segment | undefined): string =>
  segment === undefined ? "(patch unavailable)" : segment.text.slice(0, EXCERPT_BYTES);

const chunk = <T>(items: readonly T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) chunks.push([...items.slice(start, start + size)]);
  return chunks;
};

export type Evaluate = typeof experimental_evaluate;

/**
 * One boolean question per file, all evaluated against the shared diff state
 * in a single round trip per chunk. A chunk whose evaluation fails keeps every
 * file in it: triage is an optimization, never a reason a run dies.
 */
export const triageDiff = async (
  diff: Diff,
  // Loaded on demand: `ai` is a sizeable dependency that only --triage needs,
  // and every other command should not pay its startup cost.
  evaluate?: Evaluate,
): Promise<Triage> => {
  const startedAt = performance.now();
  const judge = evaluate ?? (await import("ai")).experimental_evaluate;
  const segments = new Map(
    splitPatch(diff.patch).flatMap((segment) => (segment.path === undefined ? [] : [[segment.path, segment] as const])),
  );

  const judged: TriagedFile[] = [];
  let inputTokens: number | undefined;

  for (const files of chunk(diff.files, FILES_PER_CALL)) {
    const state = files.map((file) => ({
      path: file.path,
      additions: file.additions,
      deletions: file.deletions,
      patchExcerpt: excerpt(segments.get(file.path)),
    }));

    const questions = Object.fromEntries(
      files.map((file, index) => [
        `f${index}`,
        {
          type: "boolean" as const,
          instructions: `Would a reviewer's architecture or data-flow diagram of this pull request draw "${file.path}"? Source code, configuration that shapes behavior, schemas and migrations are yes. Lockfiles, generated output, snapshots, vendored code, fixtures, and formatting-only churn are no.`,
        },
      ]),
    );

    try {
      const result = await judge({ model: TRIAGE_MODEL, state, questions });
      if (result.usage?.inputTokens !== undefined)
        inputTokens = (inputTokens ?? 0) + result.usage.inputTokens;
      judged.push(
        ...files.map((file, index) => ({
          ...file,
          probability: result.answers[`f${index}`]?.probability,
        })),
      );
    } catch {
      judged.push(...files.map((file) => ({ ...file, probability: undefined })));
    }
  }

  const kept = judged.filter((file) => file.probability === undefined || file.probability >= KEEP_THRESHOLD);
  const dropped = judged.filter((file) => !kept.includes(file));

  // Segments are removed only when they match a dropped path exactly. A rename's
  // numstat path ("old => new") matches no segment, so a rename is never dropped
  // from the patch — triage fails toward keeping.
  const droppedPaths = new Set(dropped.map((file) => file.path));

  const patch =
    dropped.length === 0
      ? diff.patch
      : splitPatch(diff.patch)
          .filter((segment) => segment.path === undefined || !droppedPaths.has(segment.path))
          .map((segment) => segment.text)
          .join("");

  return {
    diff: { ...diff, files: kept.map(({ probability: _, ...file }) => file), patch },
    kept,
    dropped,
    tookMs: Math.round(performance.now() - startedAt),
    inputTokens,
  };
};

/** The blind byte cut, applied after triage instead of before it. */
export const truncatePatch = (diff: Diff, maxPatchBytes: number): Diff => {
  const withinBudget = Buffer.byteLength(diff.patch, "utf8") <= maxPatchBytes;
  return withinBudget
    ? diff
    : {
        ...diff,
        patch: Buffer.from(diff.patch, "utf8").subarray(0, maxPatchBytes).toString("utf8"),
        truncatedAt: maxPatchBytes,
      };
};

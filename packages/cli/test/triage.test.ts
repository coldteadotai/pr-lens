import { describe, expect, it } from "vitest";
import type { Diff } from "../src/git.js";
import { splitPatch, triageDiff, truncatePatch, type Evaluate } from "../src/triage.js";

const segment = (path: string, body: string): string =>
  [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, body, ""].join("\n");

const diffOf = (files: Diff["files"], patch: string): Diff => ({
  files,
  additions: 0,
  deletions: 0,
  patch,
  truncatedAt: undefined,
});

const answering = (probabilities: Record<string, number>): Evaluate =>
  (async ({ state, questions }: { state: unknown; questions: Record<string, unknown> }) => {
    const files = state as { path: string }[];
    return {
      answers: Object.fromEntries(
        Object.keys(questions).map((id) => {
          const file = files[Number(id.slice(1))];
          return [id, { type: "boolean", probability: probabilities[file?.path ?? ""] ?? 1 }];
        }),
      ),
    };
  }) as unknown as Evaluate;

describe("splitPatch", () => {
  it("splits a unified diff into per-file segments with paths", () => {
    const patch = segment("src/a.ts", "+a") + segment("pnpm-lock.yaml", "+b");
    expect(splitPatch(patch).map((s) => s.path)).toEqual(["src/a.ts", "pnpm-lock.yaml"]);
  });

  it("reads a deletion's path from the a-side header", () => {
    const patch = ["diff --git a/gone.ts b/gone.ts", "--- a/gone.ts", "+++ /dev/null", "-x", ""].join("\n");
    expect(splitPatch(patch)[0]?.path).toBe("gone.ts");
  });
});

describe("triageDiff", () => {
  const files = [
    { path: "src/a.ts", additions: 3, deletions: 1 },
    { path: "pnpm-lock.yaml", additions: 900, deletions: 900 },
  ];
  const patch = segment("src/a.ts", "+real") + segment("pnpm-lock.yaml", "+noise");

  it("drops files below the threshold and removes their patch segments", async () => {
    const triaged = await triageDiff(diffOf(files, patch), answering({ "pnpm-lock.yaml": 0.02 }));
    expect(triaged.kept.map((f) => f.path)).toEqual(["src/a.ts"]);
    expect(triaged.dropped.map((f) => f.path)).toEqual(["pnpm-lock.yaml"]);
    expect(triaged.diff.patch).toContain("+real");
    expect(triaged.diff.patch).not.toContain("+noise");
  });

  it("keeps everything when evaluation fails", async () => {
    const failing = (async () => {
      throw new Error("gateway down");
    }) as unknown as Evaluate;
    const triaged = await triageDiff(diffOf(files, patch), failing);
    expect(triaged.kept).toHaveLength(2);
    expect(triaged.diff.patch).toBe(patch);
  });

  it("never removes a segment it cannot match: a dropped rename stays in the patch", async () => {
    const renamed = [{ path: "old.ts => new.ts", additions: 0, deletions: 0 }];
    const renamePatch = segment("new.ts", "+moved");
    const triaged = await triageDiff(diffOf(renamed, renamePatch), answering({ "old.ts => new.ts": 0 }));
    expect(triaged.dropped).toHaveLength(1);
    expect(triaged.diff.patch).toContain("+moved");
  });
});

describe("truncatePatch", () => {
  it("cuts the patch and records where", () => {
    const diff = diffOf([], "0123456789");
    expect(truncatePatch(diff, 4)).toMatchObject({ patch: "0123", truncatedAt: 4 });
    expect(truncatePatch(diff, 100).truncatedAt).toBeUndefined();
  });
});

import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const run = promisify(execFile);

const SCRIPT = new URL("../scripts/comment.sh", import.meta.url).pathname;
const MARKER = "<!-- pr-lens -->";
const HEAD = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const NEWER = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const BOT = "github-actions[bot]";

/**
 * `gh` and `npx` are the only things this script cannot do without, so the
 * test replaces both and reads back what it was asked to do. Everything the
 * script decides — whether to comment at all, which comment is ours, and
 * whether to create or edit — is then exercised rather than grepped for.
 */
const stub = async (bin: string, name: string, body: string): Promise<void> => {
  const path = join(bin, name);
  await writeFile(path, `#!/usr/bin/env bash\n${body}\n`, "utf8");
  await chmod(path, 0o755);
};

type Comment = { id: number; user: { login: string }; body: string };

const post = async (options: {
  currentHead?: string;
  /** What the head becomes after this run has read it once. */
  headAfterFirstRead?: string;
  comments?: Comment[];
}) => {
  const root = await mkdtemp(join(tmpdir(), "pr-lens-comment-"));
  const bin = join(root, "bin");
  const runnerTemp = join(root, "runner");
  await mkdir(bin, { recursive: true });
  await mkdir(join(runnerTemp, "pr-lens", "assets"), { recursive: true });

  const log = join(root, "gh.log");
  const headCalls = join(root, "head-calls");
  await writeFile(headCalls, "", "utf8");
  const comments = join(root, "comments.jsonl");
  await writeFile(comments, (options.comments ?? []).map((c) => JSON.stringify(c)).join("\n"), "utf8");
  await writeFile(log, "", "utf8");

  await stub(
    bin,
    "gh",
    [
      'printf "%s\\n" "$*" >> "${GH_LOG}"',
      'case "$*" in',
      '  *"/pulls/"*)',
      '    asked="$(cat "${STUB_HEAD_CALLS}")x"',
      '    printf "%s" "${asked}" > "${STUB_HEAD_CALLS}"',
      '    if [ -n "${STUB_HEAD_AFTER_FIRST}" ] && [ "${#asked}" -gt 1 ]; then',
      '      printf "%s\\n" "${STUB_HEAD_AFTER_FIRST}"',
      '    else',
      '      printf "%s\\n" "${STUB_CURRENT_HEAD}"',
      '    fi',
      '    ;;',
      '  *--paginate*) cat "${STUB_COMMENTS}" ;;',
      "  *) cat > /dev/null ;;",
      "esac",
    ].join("\n"),
  );

  await stub(
    bin,
    "npx",
    [
      'if [[ "$*" == *--print-marker* ]]; then printf "%s\\n" "<!-- pr-lens -->"; exit 0; fi',
      'out=""; previous=""',
      'for argument in "$@"; do',
      '  if [ "${previous}" = "--out" ]; then out="${argument}"; fi',
      '  previous="${argument}"',
      "done",
      'printf "%s\\n### A change\\n" "<!-- pr-lens -->" > "${out}"',
    ].join("\n"),
  );

  const { stdout } = await run("bash", [SCRIPT], {
    env: {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      RUNNER_TEMP: runnerTemp,
      GITHUB_REPOSITORY: "coldteadotai/pr-lens",
      PR_NUMBER: "42",
      HEAD_SHA: HEAD,
      COMMENT_AUTHOR: BOT,
      CLI_VERSION: "0.1.0",
      ASSETS_URL: "https://raw.githubusercontent.com/coldteadotai/pr-lens/pr-lens/pr/42",
      BRANDING_OFF: "",
      GH_TOKEN: "token",
      GH_LOG: log,
      STUB_CURRENT_HEAD: options.currentHead ?? HEAD,
      STUB_HEAD_AFTER_FIRST: options.headAfterFirstRead ?? "",
      STUB_HEAD_CALLS: headCalls,
      STUB_COMMENTS: comments,
    },
  });

  return { stdout, calls: (await readFile(log, "utf8")).split("\n").filter((line) => line !== "") };
};

test("a run that was overtaken while it drew does not touch the comment", async () => {
  const { stdout, calls } = await post({
    currentHead: NEWER,
    comments: [{ id: 1, user: { login: BOT }, body: `${MARKER}\nolder` }],
  });

  expect(stdout).toContain("has moved on to");
  expect(calls.some((call) => call.includes("PATCH") || call.includes("POST"))).toBe(false);
});

test("a push while this run was composing takes the comment with it", async () => {
  const { stdout, calls } = await post({
    headAfterFirstRead: NEWER,
    comments: [{ id: 1, user: { login: BOT }, body: `${MARKER}\nolder` }],
  });

  expect(stdout).toContain("has moved on to");
  expect(calls.some((call) => call.includes("PATCH") || call.includes("POST"))).toBe(false);
});

test("with no comment of ours yet, one is created", async () => {
  const { calls } = await post({ comments: [] });

  expect(calls.some((call) => call.includes("-X POST repos/coldteadotai/pr-lens/issues/42/comments"))).toBe(true);
  expect(calls.some((call) => call.includes("PATCH"))).toBe(false);
});

test("our own comment is the one that gets edited", async () => {
  const { calls } = await post({
    comments: [
      { id: 7, user: { login: "someone-else" }, body: "unrelated" },
      { id: 9, user: { login: BOT }, body: `${MARKER}\nolder` },
    ],
  });

  expect(calls.some((call) => call.includes("-X PATCH repos/coldteadotai/pr-lens/issues/comments/9"))).toBe(true);
});

test("somebody else's comment carrying our marker is not ours to edit", async () => {
  const { calls } = await post({
    comments: [{ id: 3, user: { login: "drive-by" }, body: `${MARKER}\nhijacked` }],
  });

  expect(calls.some((call) => call.includes("PATCH"))).toBe(false);
  expect(calls.some((call) => call.includes("-X POST repos/coldteadotai/pr-lens/issues/42/comments"))).toBe(true);
});

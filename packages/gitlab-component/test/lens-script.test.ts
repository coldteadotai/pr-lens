import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const run = promisify(execFile);

const SCRIPT = new URL("../scripts/lens.sh", import.meta.url).pathname;
const MARKER = "<!-- pr-lens -->";
const HEAD = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const NEWER = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const BASE = "cccccccccccccccccccccccccccccccccccccccc";
const BOT = "lens-bot";

/**
 * `npx`, `curl` and `git` are the only things the script cannot do without
 * (node runs for real — the script's JSON handling is part of what is under
 * test), so the test replaces those three and reads back what it was asked
 * to do: whether to upload at all, which note is ours, create versus edit.
 */
const stub = async (bin: string, name: string, body: string): Promise<void> => {
  const path = join(bin, name);
  await writeFile(path, `#!/usr/bin/env bash\n${body}\n`, "utf8");
  await chmod(path, 0o755);
};

type Note = { id: number; author: { username: string }; body: string };

const runScript = async (options: {
  env?: Record<string, string>;
  currentHead?: string;
  /** What the head becomes after this run has read it once. */
  headAfterFirstRead?: string;
  notes?: Note[];
}) => {
  const root = await mkdtemp(join(tmpdir(), "pr-lens-gitlab-"));
  const bin = join(root, "bin");
  const work = join(root, "work");
  await mkdir(bin, { recursive: true });
  await mkdir(work, { recursive: true });

  const curlLog = join(root, "curl.log");
  const headCalls = join(root, "head-calls");
  const notes = join(root, "notes.json");
  const posted = join(root, "posted.json");
  await writeFile(curlLog, "", "utf8");
  await writeFile(headCalls, "", "utf8");
  await writeFile(notes, JSON.stringify(options.notes ?? []), "utf8");

  await stub(
    bin,
    "curl",
    [
      'printf "%s\\n" "$*" >> "${STUB_CURL_LOG}"',
      'data=""; previous=""',
      'for argument in "$@"; do',
      '  if [ "${previous}" = "--data" ]; then data="${argument}"; fi',
      '  previous="${argument}"',
      "done",
      'case "$*" in',
      "  *--form*)",
      '    file="$(printf "%s\\n" "$*" | sed -n "s/.*file=@\\([^ ]*\\).*/\\1/p")"',
      '    printf "{\\"full_path\\":\\"/-/project/7/uploads/secret/%s\\"}" "$(basename "${file}")"',
      "    ;;",
      '  *"/user"*) printf "{\\"username\\":\\"%s\\"}" "${STUB_BOT}" ;;',
      '  *"/notes?"*)',
      '    if [[ "$*" == *"page=1"* ]]; then cat "${STUB_NOTES}"; else printf "[]"; fi',
      "    ;;",
      '  *"/notes"*) cp "${data#@}" "${STUB_POSTED}" ;;',
      '  *"/merge_requests/"*)',
      '    asked="$(cat "${STUB_HEAD_CALLS}")x"',
      '    printf "%s" "${asked}" > "${STUB_HEAD_CALLS}"',
      '    if [ -n "${STUB_HEAD_AFTER_FIRST}" ] && [ "${#asked}" -gt 1 ]; then',
      '      printf "{\\"sha\\":\\"%s\\"}" "${STUB_HEAD_AFTER_FIRST}"',
      "    else",
      '      printf "{\\"sha\\":\\"%s\\"}" "${STUB_CURRENT_HEAD}"',
      "    fi",
      "    ;;",
      "esac",
    ].join("\n"),
  );

  await stub(
    bin,
    "npx",
    [
      `if [[ "$*" == *--print-marker* ]]; then printf "%s\\n" "${MARKER}"; exit 0; fi`,
      'out=""; manifest=""; previous=""',
      'for argument in "$@"; do',
      '  if [ "${previous}" = "--out" ]; then out="${argument}"; fi',
      '  if [ "${previous}" = "--manifest" ]; then manifest="${argument}"; fi',
      '  previous="${argument}"',
      "done",
      'case "$*" in',
      '  *" analyze "*) printf "{}" > "${out}" ;;',
      '  *" render "*)',
      '    mkdir -p "${out}"',
      '    printf "{}" > "${out}/drawn.graph.json"',
      '    printf "svg" > "${out}/architecture-light.svg"',
      '    printf "svg" > "${out}/architecture-dark.svg"',
      '    printf "%s" "{\\"assets\\":[{\\"path\\":\\"architecture-light.svg\\"},{\\"path\\":\\"architecture-dark.svg\\"}]}" > "${out}/manifest.json"',
      "    ;;",
      '  *" comment "*)',
      `    { printf "%s\\n" "${MARKER}"; cat "\${manifest}"; } > "\${out}"`,
      "    ;;",
      "esac",
    ].join("\n"),
  );

  await stub(bin, "git", 'if [ -n "${STUB_GIT_MISSING}" ]; then exit 1; fi');

  const result = await run("bash", [SCRIPT], {
    env: {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      HOME: root,
      STUB_CURL_LOG: curlLog,
      STUB_HEAD_CALLS: headCalls,
      STUB_NOTES: notes,
      STUB_POSTED: posted,
      STUB_BOT: BOT,
      STUB_CURRENT_HEAD: options.currentHead ?? HEAD,
      STUB_HEAD_AFTER_FIRST: options.headAfterFirstRead ?? "",
      STUB_GIT_MISSING: "",
      PR_LENS_WORK: work,
      PR_LENS_MODEL_PROVIDER: "gemini",
      PR_LENS_MODEL: "",
      PR_LENS_BASE_URL: "",
      PR_LENS_LENS: "",
      PR_LENS_BRANDING: "true",
      PR_LENS_COMMENT: "true",
      PR_LENS_CLI_VERSION: "0.0.0",
      PR_LENS_API_KEY_VARIABLE: "MODEL_KEY",
      PR_LENS_TOKEN_VARIABLE: "LENS_TOKEN",
      MODEL_KEY: "model-key",
      LENS_TOKEN: "lens-token",
      CI_MERGE_REQUEST_IID: "5",
      CI_MERGE_REQUEST_DIFF_BASE_SHA: BASE,
      CI_COMMIT_SHA: HEAD,
      CI_PROJECT_ID: "7",
      CI_API_V4_URL: "https://gitlab.example.com/api/v4",
      CI_SERVER_URL: "https://gitlab.example.com",
      ...options.env,
    },
  }).catch((error: NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: unknown }) => error);

  const log = await readFile(curlLog, "utf8");
  const body = await readFile(posted, "utf8").catch(() => undefined);
  return { result, log, body };
};

const failed = (result: unknown): result is { code: number; stderr: string } =>
  typeof result === "object" && result !== null && "code" in result;

test("outside a merge request pipeline it explains the rules requirement", async () => {
  const { result } = await runScript({ env: { CI_MERGE_REQUEST_IID: "" } });
  expect(failed(result)).toBe(true);
  if (failed(result)) expect(result.stderr).toContain("merge_request_event");
});

test("a missing model key names the variable to fill", async () => {
  const { result } = await runScript({ env: { MODEL_KEY: "" } });
  expect(failed(result)).toBe(true);
  if (failed(result)) expect(result.stderr).toContain("MODEL_KEY");
});

test("commenting without a token explains why CI_JOB_TOKEN is not enough", async () => {
  const { result } = await runScript({ env: { LENS_TOKEN: "" } });
  expect(failed(result)).toBe(true);
  if (failed(result)) expect(result.stderr).toContain("CI_JOB_TOKEN cannot post notes");
});

test("a first run uploads every render and creates the note", async () => {
  const { result, log, body } = await runScript({});
  expect(failed(result)).toBe(false);

  expect(log.match(/--form/g)).toHaveLength(2);
  expect(log).toContain("-X POST");
  expect(log).not.toContain("-X PUT");

  // The posted body was composed from the patched manifest: absolute
  // attachment URLs, not local paths.
  expect(body).toContain(MARKER);
  expect(body).toContain("https://gitlab.example.com/-/project/7/uploads/secret/architecture-light.svg");
});

test("a second run edits the note it already owns", async () => {
  const { result, log } = await runScript({
    notes: [{ id: 88, author: { username: BOT }, body: `${MARKER}\nold` }],
  });
  expect(failed(result)).toBe(false);
  expect(log).toContain("-X PUT");
  expect(log).toContain("/notes/88");
});

test("somebody else's marker is not ours to edit", async () => {
  const { result, log } = await runScript({
    notes: [{ id: 89, author: { username: "impostor" }, body: `${MARKER}\nnot ours` }],
  });
  expect(failed(result)).toBe(false);
  expect(log).toContain("-X POST");
  expect(log).not.toContain("/notes/89");
});

test("an overtaken run uploads nothing and posts nothing", async () => {
  const { result, log } = await runScript({ currentHead: NEWER });
  expect(failed(result)).toBe(false);
  expect(log).not.toContain("--form");
  expect(log).not.toContain("-X POST");
});

test("a merged results pipeline compares the source head, not the merge-result commit", async () => {
  const mergeResult = "dddddddddddddddddddddddddddddddddddddddd";
  const { result, log } = await runScript({
    env: { CI_COMMIT_SHA: mergeResult, CI_MERGE_REQUEST_SOURCE_BRANCH_SHA: HEAD },
  });

  expect(failed(result)).toBe(false);
  expect(log).toContain("-X POST");
});

test("a run overtaken between the uploads and the write stops at the gate", async () => {
  const { result, log } = await runScript({ headAfterFirstRead: NEWER });
  expect(failed(result)).toBe(false);
  expect(log.match(/--form/g)).toHaveLength(2);
  expect(log).not.toContain("-X POST");
  expect(log).not.toContain("-X PUT");
});

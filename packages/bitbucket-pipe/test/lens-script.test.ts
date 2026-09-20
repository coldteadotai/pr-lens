import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const run = promisify(execFile);

const SCRIPT = new URL("../pipe/lens.sh", import.meta.url).pathname;
const MARKER = "[pr-lens]: #pr-lens";
const HEAD = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HEAD12 = HEAD.slice(0, 12);
const NEWER12 = "bbbbbbbbbbbb";
const BOT_UUID = "{b07b07b0-7b07-b07b-07b0-7b07b07b07b0}";

/**
 * `npx`, `curl` and `git` are the only things the script cannot do without
 * (node runs for real — the JSON handling is under test), so the test
 * replaces those three and reads back what it was asked to do.
 */
const stub = async (bin: string, name: string, body: string): Promise<void> => {
  const path = join(bin, name);
  await writeFile(path, `#!/usr/bin/env bash\n${body}\n`, "utf8");
  await chmod(path, 0o755);
};

// Bitbucket user references carry no username; uuid is the identity.
type Comment = { id: number; user: { uuid: string }; content: { raw: string }; deleted?: boolean };

const runScript = async (options: {
  env?: Record<string, string>;
  currentHead?: string;
  /** What the head becomes after this run has read it once. */
  headAfterFirstRead?: string;
  comments?: Comment[];
  /** How many merge-base calls fail before one succeeds; deepening is the recovery under test. */
  mergeBaseFailures?: number;
  /** The /2.0/user endpoint refuses — a repository access token without the account scope. */
  userFails?: boolean;
  /** The identityless PUT is refused — the marker was somebody else's. */
  putFails?: boolean;
}) => {
  const root = await mkdtemp(join(tmpdir(), "pr-lens-pipe-"));
  const bin = join(root, "bin");
  const work = join(root, "work");
  await mkdir(bin, { recursive: true });
  await mkdir(work, { recursive: true });

  const curlLog = join(root, "curl.log");
  const gitLog = join(root, "git.log");
  const headCalls = join(root, "head-calls");
  const mergeBaseCalls = join(root, "merge-base-calls");
  const comments = join(root, "comments.json");
  const posted = join(root, "posted.json");
  await writeFile(curlLog, "", "utf8");
  await writeFile(gitLog, "", "utf8");
  await writeFile(headCalls, "", "utf8");
  await writeFile(mergeBaseCalls, "", "utf8");
  await writeFile(
    comments,
    JSON.stringify({ values: options.comments ?? [] }),
    "utf8",
  );

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
      '  *--form*) printf "{}" ;;',
      '  *"/2.0/user"*)',
      '    if [ -n "${STUB_USER_FAILS}" ]; then exit 22; fi',
      '    printf "{\\"uuid\\":\\"%s\\"}" "${STUB_BOT_UUID}"',
      "    ;;",
      '  *"/comments?"*) cat "${STUB_COMMENTS}" ;;',
      '  *"/comments"*)',
      '    if [[ "$*" == *"-X PUT"* ]] && [ -n "${STUB_PUT_FAILS}" ]; then exit 22; fi',
      '    cp "${data#@}" "${STUB_POSTED}"',
      "    ;;",
      '  *"/pullrequests/"*)',
      '    asked="$(cat "${STUB_HEAD_CALLS}")x"',
      '    printf "%s" "${asked}" > "${STUB_HEAD_CALLS}"',
      '    if [ -n "${STUB_HEAD_AFTER_FIRST}" ] && [ "${#asked}" -gt 1 ]; then',
      '      printf "{\\"source\\":{\\"commit\\":{\\"hash\\":\\"%s\\"}}}" "${STUB_HEAD_AFTER_FIRST}"',
      "    else",
      '      printf "{\\"source\\":{\\"commit\\":{\\"hash\\":\\"%s\\"}}}" "${STUB_CURRENT_HEAD}"',
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
      '    printf "%s" "{\\"assets\\":[{\\"path\\":\\"architecture-light.svg\\"}]}" > "${out}/manifest.json"',
      "    ;;",
      '  *" comment "*)',
      `    { printf "%s\\n" "${MARKER}"; cat "\${manifest}"; } > "\${out}"`,
      "    ;;",
      "esac",
    ].join("\n"),
  );

  await stub(
    bin,
    "git",
    [
      'printf "%s\\n" "$*" >> "${STUB_GIT_LOG}"',
      'case "$*" in',
      '  "merge-base "*)',
      '    asked="$(cat "${STUB_MERGE_BASE_CALLS}")x"',
      '    printf "%s" "${asked}" > "${STUB_MERGE_BASE_CALLS}"',
      '    if [ "${#asked}" -le "${STUB_MERGE_BASE_FAILURES}" ]; then exit 1; fi',
      "    ;;",
      "esac",
    ].join("\n"),
  );

  const result = await run("bash", [SCRIPT], {
    env: {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      HOME: root,
      STUB_CURL_LOG: curlLog,
      STUB_GIT_LOG: gitLog,
      STUB_HEAD_CALLS: headCalls,
      STUB_MERGE_BASE_CALLS: mergeBaseCalls,
      STUB_MERGE_BASE_FAILURES: String(options.mergeBaseFailures ?? 0),
      STUB_COMMENTS: comments,
      STUB_POSTED: posted,
      STUB_BOT_UUID: BOT_UUID,
      STUB_USER_FAILS: options.userFails ? "1" : "",
      STUB_PUT_FAILS: options.putFails ? "1" : "",
      STUB_CURRENT_HEAD: options.currentHead ?? HEAD12,
      STUB_HEAD_AFTER_FIRST: options.headAfterFirstRead ?? "",
      PR_LENS_WORK: work,
      API_KEY_VARIABLE: "MODEL_KEY",
      TOKEN_VARIABLE: "LENS_TOKEN",
      MODEL_KEY: "model-key",
      LENS_TOKEN: "lens-token",
      CLI_VERSION: "0.0.0",
      BITBUCKET_PR_ID: "5",
      BITBUCKET_PR_DESTINATION_BRANCH: "main",
      BITBUCKET_COMMIT: HEAD,
      BITBUCKET_WORKSPACE: "acme",
      BITBUCKET_REPO_SLUG: "rocket",
      ...options.env,
    },
  }).catch((error: NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: unknown }) => error);

  const log = await readFile(curlLog, "utf8");
  const git = await readFile(gitLog, "utf8");
  const body = await readFile(posted, "utf8").catch(() => undefined);
  return { result, log, git, body };
};

const failed = (result: unknown): result is { code: number; stderr: string } =>
  typeof result === "object" && result !== null && "code" in result;

test("outside a pull-request pipeline it names the pull-requests section", async () => {
  const { result } = await runScript({ env: { BITBUCKET_PR_ID: "" } });
  expect(failed(result)).toBe(true);
  if (failed(result)) expect(result.stderr).toContain("pull-requests:");
});

test("a missing model key names the variable to fill", async () => {
  const { result } = await runScript({ env: { MODEL_KEY: "" } });
  expect(failed(result)).toBe(true);
  if (failed(result)) expect(result.stderr).toContain("MODEL_KEY");
});

test("commenting without a token names the token variable and the retired app passwords", async () => {
  const { result } = await runScript({ env: { LENS_TOKEN: "" } });
  expect(failed(result)).toBe(true);
  if (failed(result)) {
    expect(result.stderr).toContain("LENS_TOKEN");
    expect(result.stderr).toContain("app passwords");
  }
});

test("a shallow clone is deepened once before giving up", async () => {
  const { result, git } = await runScript({ mergeBaseFailures: 1 });
  expect(failed(result)).toBe(false);
  expect(git).toContain("--unshallow");
  // The explicit refspec, so a single-branch clone still materialises the ref.
  expect(git).toContain("+refs/heads/main:refs/remotes/origin/main");
});

test("a base out of reach fails before any model money is spent", async () => {
  const { result, log } = await runScript({ mergeBaseFailures: 99 });
  expect(failed(result)).toBe(true);
  if (failed(result)) expect(result.stderr).toContain("clone: depth: full");
  expect(log).toBe("");
});

test("a first run publishes the render and creates the comment", async () => {
  const { result, log, body } = await runScript({});
  expect(failed(result)).toBe(false);

  expect(log.match(/--form/g)).toHaveLength(1);
  expect(log).toContain("-X POST");
  expect(log).not.toContain("-X PUT");

  // The posted body was composed from the patched manifest: Downloads URLs,
  // and the content wrapped the Bitbucket way.
  expect(body).toContain('"content"');
  expect(body).toContain(MARKER);
  expect(body).toContain("https://bitbucket.org/acme/rocket/downloads/architecture-light.svg");
});

test("a second run edits the comment it already owns, matched by uuid", async () => {
  const { result, log } = await runScript({
    comments: [{ id: 88, user: { uuid: BOT_UUID }, content: { raw: `${MARKER}\nold` } }],
  });
  expect(failed(result)).toBe(false);
  expect(log).toContain("-X PUT");
  expect(log).toContain("/comments/88");
});

test("somebody else's marker is not ours to edit", async () => {
  const { result, log } = await runScript({
    comments: [{ id: 89, user: { uuid: "{1mp05702-0000-0000-0000-000000000000}" }, content: { raw: `${MARKER}\nnot ours` } }],
  });
  expect(failed(result)).toBe(false);
  expect(log).toContain("-X POST");
  expect(log).not.toContain("/comments/89");
});

test("with no identity to ask for, the marker match is tried and the server judges it", async () => {
  const { result, log } = await runScript({
    userFails: true,
    comments: [{ id: 88, user: { uuid: "{wh03v3r0-0000-0000-0000-000000000000}" }, content: { raw: `${MARKER}\nold` } }],
  });
  expect(failed(result)).toBe(false);
  expect(log).toContain("/comments/88");
  expect(log).not.toContain("-X POST");
});

test("a refused identityless edit becomes a fresh comment instead of a failure", async () => {
  const { result, log } = await runScript({
    userFails: true,
    putFails: true,
    comments: [{ id: 89, user: { uuid: "{1mp05702-0000-0000-0000-000000000000}" }, content: { raw: `${MARKER}\nnot ours` } }],
  });
  expect(failed(result)).toBe(false);
  expect(log).toContain("-X PUT");
  expect(log).toContain("-X POST");
});

test("an overtaken run publishes nothing and posts nothing", async () => {
  const { result, log } = await runScript({ currentHead: NEWER12 });
  expect(failed(result)).toBe(false);
  expect(log).not.toContain("--form");
  expect(log).not.toContain("-X POST");
});

test("a run overtaken between the publish and the write stops at the gate", async () => {
  const { result, log } = await runScript({ headAfterFirstRead: NEWER12 });
  expect(failed(result)).toBe(false);
  expect(log.match(/--form/g)).toHaveLength(1);
  expect(log).not.toContain("-X POST");
  expect(log).not.toContain("-X PUT");
});

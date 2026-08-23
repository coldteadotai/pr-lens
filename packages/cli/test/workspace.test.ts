import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { run as runCli } from "../src/cli.js";
import type { Terminal } from "../src/terminal.js";
import { ignoreWorkspace, WORKSPACE_DIR } from "../src/workspace.js";

const run = promisify(execFile);

const GOLDEN = new URL("../../schema/examples/postmark-refactor.graph.json", import.meta.url)
  .pathname;

/** A repository with nothing in it, which is all an ignore rule needs to be read. */
const repository = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "pr-lens-workspace-"));
  await run("git", ["init", "--quiet"], { cwd: directory });
  return directory;
};

const gitignore = (directory: string): Promise<string> =>
  readFile(join(directory, ".gitignore"), "utf8");

/**
 * Whether git ignores the previews written at `workspace` — the only question
 * that matters, and one only git can answer. A pattern that reads correctly
 * still leaves files visible when it is anchored to the wrong directory or
 * carries leading whitespace, so the tests ask about the real output path
 * rather than about the text of the entry.
 */
const ignoresPreviews = async (repo: string, workspace: string): Promise<boolean> =>
  run("git", ["check-ignore", "-q", "--", join(workspace, "manifest.json")], { cwd: repo }).then(
    () => true,
    () => false,
  );

const terminalCollecting = (lines: string[]): Terminal => ({
  out: (line) => lines.push(line),
  err: (line) => lines.push(line),
});

/** Runs the CLI with `cwd` as the working directory, as a user would. */
const renderIn = async (cwd: string, ...args: string[]): Promise<string[]> => {
  const lines: string[] = [];
  const previous = process.cwd();
  process.chdir(cwd);
  try {
    expect(await runCli(["render", GOLDEN, ...args], terminalCollecting(lines), {})).toBe(0);
  } finally {
    process.chdir(previous);
  }
  return lines;
};

test("writes a .gitignore when the repository has none", async () => {
  const directory = await repository();

  expect(await ignoreWorkspace(join(directory, WORKSPACE_DIR))).toMatch(/\.gitignore$/);
  expect(await ignoresPreviews(directory, join(directory, WORKSPACE_DIR))).toBe(true);
});

test("adds itself to a .gitignore that is already there, keeping what it holds", async () => {
  const directory = await repository();
  await writeFile(join(directory, ".gitignore"), "node_modules\ndist\n");

  await ignoreWorkspace(join(directory, WORKSPACE_DIR));

  expect((await gitignore(directory)).startsWith("node_modules\ndist\n")).toBe(true);
  expect(await ignoresPreviews(directory, join(directory, WORKSPACE_DIR))).toBe(true);
});

test("does not run the entry onto a last line that had no newline", async () => {
  const directory = await repository();
  await writeFile(join(directory, ".gitignore"), "dist");

  await ignoreWorkspace(join(directory, WORKSPACE_DIR));

  expect(await gitignore(directory)).toContain("dist\n");
  expect(await ignoresPreviews(directory, join(directory, WORKSPACE_DIR))).toBe(true);
});

test("says nothing when an entry already covers the previews", async () => {
  const directory = await repository();
  await writeFile(join(directory, ".gitignore"), `dist\n${WORKSPACE_DIR}/\n`);

  expect(await ignoreWorkspace(join(directory, WORKSPACE_DIR))).toBeUndefined();
  expect(await gitignore(directory)).toBe(`dist\n${WORKSPACE_DIR}/\n`);
});

/**
 * The two spellings that read as "already ignored" and are not. `/.pr-lens/`
 * is anchored to the root, so it says nothing about a run inside a
 * subdirectory; leading whitespace is part of a pattern, so that entry matches
 * nothing anywhere. Both must still end with the previews ignored.
 */
test.each([
  ["anchored to the root", `/${WORKSPACE_DIR}/\n`],
  ["prefixed with whitespace", `  ${WORKSPACE_DIR}/\n`],
])("covers previews under a subdirectory when the entry is %s", async (_, entry) => {
  const directory = await repository();
  await writeFile(join(directory, ".gitignore"), entry);
  const nested = join(directory, "sub");
  await mkdir(nested, { recursive: true });

  await ignoreWorkspace(join(nested, WORKSPACE_DIR));

  expect(await ignoresPreviews(directory, join(nested, WORKSPACE_DIR))).toBe(true);
});

/**
 * A negation is anchored the way any other pattern is, so which workspace it
 * speaks for depends on how it was written and on where the CLI is running.
 */
test.each([
  ["unanchored, at the root", `!${WORKSPACE_DIR}/\n`, ""],
  ["unanchored, from a subdirectory", `!${WORKSPACE_DIR}/\n`, "sub"],
  ["anchored, at the root", `!/${WORKSPACE_DIR}/\n`, ""],
  ["anchored at the subdirectory it names", `!sub/${WORKSPACE_DIR}/\n`, "sub"],
])("leaves a deliberate un-ignore alone when it is %s", async (_, entry, within) => {
  const directory = await repository();
  await writeFile(join(directory, ".gitignore"), entry);
  const workspace = join(directory, within, WORKSPACE_DIR);
  await mkdir(dirname(workspace), { recursive: true });

  expect(await ignoreWorkspace(workspace)).toBeUndefined();
  expect(await gitignore(directory)).toBe(entry);
});

/**
 * `!/.pr-lens/` at the root un-ignores the root's previews and says nothing
 * about a workspace under a subdirectory. Reading it as a blanket choice left
 * every nested preview file visible.
 */
test("ignores a nested workspace an anchored un-ignore does not speak for", async () => {
  const directory = await repository();
  await writeFile(join(directory, ".gitignore"), `!/${WORKSPACE_DIR}/\n`);
  const nested = join(directory, "sub");
  await mkdir(nested, { recursive: true });

  expect(await ignoreWorkspace(join(nested, WORKSPACE_DIR))).toMatch(/\.gitignore$/);
  expect(await ignoresPreviews(directory, join(nested, WORKSPACE_DIR))).toBe(true);
});

test("narrows its entry rather than overruling an un-ignore meant for elsewhere", async () => {
  const directory = await repository();
  await writeFile(join(directory, ".gitignore"), `!/${WORKSPACE_DIR}/\n`);
  const nested = join(directory, "sub");
  await mkdir(nested, { recursive: true });

  await ignoreWorkspace(join(nested, WORKSPACE_DIR));

  expect(await ignoresPreviews(directory, join(nested, WORKSPACE_DIR))).toBe(true);
  expect(await ignoresPreviews(directory, join(directory, WORKSPACE_DIR))).toBe(false);
});

/**
 * The narrowed entry carries a real directory name into a place where git reads
 * patterns. Every one of these names means something else as a pattern, and the
 * previews stay visible under an entry that looks right.
 */
test.each([
  ["a character class", "sub[1]"],
  ["a comment", "#sub"],
  ["a negation", "!sub"],
  ["a wildcard", "sub*x"],
])("writes a nested directory that would read as %s as a literal path", async (_, name) => {
  const directory = await repository();
  await writeFile(join(directory, ".gitignore"), `!/${WORKSPACE_DIR}/\n`);
  const nested = join(directory, name);
  await mkdir(nested, { recursive: true });

  await ignoreWorkspace(join(nested, WORKSPACE_DIR));

  expect(await ignoresPreviews(directory, join(nested, WORKSPACE_DIR))).toBe(true);
});

test("a wildcard in the entry is not left free to catch a neighbour", async () => {
  const directory = await repository();
  await writeFile(join(directory, ".gitignore"), `!/${WORKSPACE_DIR}/\n`);
  await mkdir(join(directory, "sub*x"), { recursive: true });
  await mkdir(join(directory, "subOTHERx"), { recursive: true });

  await ignoreWorkspace(join(directory, "sub*x", WORKSPACE_DIR));

  expect(await ignoresPreviews(directory, join(directory, "sub*x", WORKSPACE_DIR))).toBe(true);
  expect(await ignoresPreviews(directory, join(directory, "subOTHERx", WORKSPACE_DIR))).toBe(false);
});

test("reads an un-ignore whose path was escaped the way it writes one", async () => {
  const directory = await repository();
  await writeFile(join(directory, ".gitignore"), `!sub\\[1\\]/${WORKSPACE_DIR}/\n`);
  const nested = join(directory, "sub[1]");
  await mkdir(nested, { recursive: true });

  expect(await ignoreWorkspace(join(nested, WORKSPACE_DIR))).toBeUndefined();
});

test("adds itself once, however many times it runs", async () => {
  const directory = await repository();
  const workspace = join(directory, WORKSPACE_DIR);

  await ignoreWorkspace(workspace);
  await ignoreWorkspace(workspace);

  const listed = (await gitignore(directory)).split("\n").filter((line) => line.trim() !== "");
  expect(listed.filter((line) => line === `${WORKSPACE_DIR}/`)).toHaveLength(1);
});

test("writes nothing outside a repository", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pr-lens-loose-"));

  expect(await ignoreWorkspace(join(directory, WORKSPACE_DIR))).toBeUndefined();
});

test("render leaves its previews in the workspace, ignored and explained", async () => {
  const directory = await repository();

  const lines = await renderIn(directory);

  expect(lines.join("\n")).toContain(join(WORKSPACE_DIR, "manifest.json"));
  expect(await readFile(join(directory, WORKSPACE_DIR, "manifest.json"), "utf8")).toContain(
    "assets",
  );
  expect(await readFile(join(directory, WORKSPACE_DIR, "README.md"), "utf8")).toContain(
    "None of it belongs in a commit",
  );
  expect(await ignoresPreviews(directory, join(directory, WORKSPACE_DIR))).toBe(true);
});

test("a run inside a subdirectory ignores the previews it actually wrote", async () => {
  const directory = await repository();
  const nested = join(directory, "sub");
  await mkdir(nested, { recursive: true });

  await renderIn(nested);

  expect(await readFile(join(nested, WORKSPACE_DIR, "manifest.json"), "utf8")).toContain("assets");
  expect(await ignoresPreviews(directory, join(nested, WORKSPACE_DIR))).toBe(true);
});

test("a render from a subdirectory whose name is a git wildcard is still ignored", async () => {
  const directory = await repository();
  await writeFile(join(directory, ".gitignore"), `!/${WORKSPACE_DIR}/\n`);
  const nested = join(directory, "sub[1]");
  await mkdir(nested, { recursive: true });

  await renderIn(nested);

  expect(await readFile(join(nested, WORKSPACE_DIR, "manifest.json"), "utf8")).toContain("assets");
  expect(await ignoresPreviews(directory, join(nested, WORKSPACE_DIR))).toBe(true);
});

test("--out somewhere else leaves the repository's .gitignore alone", async () => {
  const directory = await repository();

  await renderIn(directory, "--out", "diagrams");

  await expect(gitignore(directory)).rejects.toThrow();
  await expect(readFile(join(directory, "diagrams", "manifest.json"), "utf8")).resolves.toContain(
    "assets",
  );
});

import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { run as runCli } from "../src/cli.js";
import type { Terminal } from "../src/terminal.js";
import { ignoreWorkspace, WORKSPACE_DIR } from "../src/workspace.js";

const GOLDEN = new URL("../../schema/examples/postmark-refactor.graph.json", import.meta.url)
  .pathname;

const run = promisify(execFile);

/** A repository with nothing in it, which is all the entry needs to be found. */
const repository = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "pr-lens-workspace-"));
  await run("git", ["init", "--quiet"], { cwd: directory });
  return directory;
};

const gitignore = (directory: string): Promise<string> =>
  readFile(join(directory, ".gitignore"), "utf8");

test("writes a .gitignore when the repository has none", async () => {
  const directory = await repository();

  expect(await ignoreWorkspace(directory)).toMatch(/\.gitignore$/);
  expect(await gitignore(directory)).toContain(`${WORKSPACE_DIR}/\n`);
});

test("adds itself to a .gitignore that is already there, keeping what it holds", async () => {
  const directory = await repository();
  await writeFile(join(directory, ".gitignore"), "node_modules\ndist\n");

  await ignoreWorkspace(directory);

  const contents = await gitignore(directory);
  expect(contents.startsWith("node_modules\ndist\n")).toBe(true);
  expect(contents).toContain(`${WORKSPACE_DIR}/\n`);
});

test("leaves a file whose last line has no newline readable", async () => {
  const directory = await repository();
  await writeFile(join(directory, ".gitignore"), "dist");

  await ignoreWorkspace(directory);

  expect(await gitignore(directory)).toContain(`dist\n`);
  expect(await gitignore(directory)).not.toContain(`dist#`);
});

test.each([`${WORKSPACE_DIR}/`, WORKSPACE_DIR, `/${WORKSPACE_DIR}`, `  ${WORKSPACE_DIR}/  `])(
  "says nothing when %s is already listed",
  async (entry) => {
    const directory = await repository();
    await writeFile(join(directory, ".gitignore"), `dist\n${entry}\n`);

    expect(await ignoreWorkspace(directory)).toBeUndefined();
    expect(await gitignore(directory)).toBe(`dist\n${entry}\n`);
  },
);

test("leaves a repository that deliberately un-ignores it alone", async () => {
  const directory = await repository();
  await writeFile(join(directory, ".gitignore"), `!${WORKSPACE_DIR}/\n`);

  expect(await ignoreWorkspace(directory)).toBeUndefined();
  expect(await gitignore(directory)).toBe(`!${WORKSPACE_DIR}/\n`);
});

test("adds itself once, however many times it runs", async () => {
  const directory = await repository();

  await ignoreWorkspace(directory);
  await ignoreWorkspace(directory);

  const listed = (await gitignore(directory)).split("\n").filter((line) => line.trim() !== "");
  expect(listed.filter((line) => line === `${WORKSPACE_DIR}/`)).toHaveLength(1);
});

test("writes nothing outside a repository", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pr-lens-loose-"));

  expect(await ignoreWorkspace(directory)).toBeUndefined();
});

test("render leaves its previews in the workspace, ignored and explained", async () => {
  const directory = await repository();
  const lines: string[] = [];
  const terminal: Terminal = { out: (line) => lines.push(line), err: (line) => lines.push(line) };

  const previous = process.cwd();
  process.chdir(directory);
  try {
    expect(await runCli(["render", GOLDEN], terminal, {})).toBe(0);
  } finally {
    process.chdir(previous);
  }

  expect(lines.join("\n")).toContain(join(WORKSPACE_DIR, "manifest.json"));
  expect(await readFile(join(directory, WORKSPACE_DIR, "manifest.json"), "utf8")).toContain("assets");
  expect(await readFile(join(directory, WORKSPACE_DIR, "README.md"), "utf8")).toContain(
    "None of it belongs in a commit",
  );
  expect(await gitignore(directory)).toContain(`${WORKSPACE_DIR}/\n`);
});

test("--out somewhere else leaves the repository's .gitignore alone", async () => {
  const directory = await repository();
  const lines: string[] = [];
  const terminal: Terminal = { out: (line) => lines.push(line), err: (line) => lines.push(line) };

  const previous = process.cwd();
  process.chdir(directory);
  try {
    expect(await runCli(["render", GOLDEN, "--out", "diagrams"], terminal, {})).toBe(0);
  } finally {
    process.chdir(previous);
  }

  await expect(gitignore(directory)).rejects.toThrow();
  await expect(readFile(join(directory, "diagrams", "manifest.json"), "utf8")).resolves.toContain(
    "assets",
  );
});

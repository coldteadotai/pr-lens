import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { run } from "../src/cli.js";
import { COMMENT_MARKER } from "../src/comment.js";
import type { Terminal } from "../src/terminal.js";
import { CLI_VERSION } from "../src/version.js";

const GOLDEN = new URL("../../schema/examples/postmark-refactor.graph.json", import.meta.url).pathname;

let out: string[] = [];
let err: string[] = [];
const terminal: Terminal = { out: (line) => out.push(line), err: (line) => err.push(line) };

const invoke = (...argv: string[]) => run(argv, terminal, {});

beforeEach(() => {
  out = [];
  err = [];
});

test("running it with nothing to do is a misuse, and prints what it can do", async () => {
  expect(await invoke()).toBe(2);
  expect(err.join("\n")).toContain("pr-lens analyze");
});

test("--help is an answer, not a misuse", async () => {
  expect(await invoke("--help")).toBe(0);
  expect(out.join("\n")).toContain("pr-lens validate");
});

test("--version is the version stamped on documents", async () => {
  expect(await invoke("--version")).toBe(0);
  expect(out).toEqual([CLI_VERSION]);
});

test("an unknown command is a misuse", async () => {
  expect(await invoke("draw")).toBe(2);
  expect(err.join("\n")).toContain('unknown command "draw"');
});

test("a command's --help prints that command's usage", async () => {
  expect(await invoke("analyze", "--help")).toBe(0);
  expect(out.join("\n")).toContain("--api-key-env");
});

test("a valid document validates, and says what it holds", async () => {
  expect(await invoke("validate", GOLDEN)).toBe(0);
  expect(out.join("\n")).toContain("10 nodes");
});

test("an invalid document fails with every problem, not only the first", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pr-lens-cli-"));
  const path = join(directory, "broken.json");
  await writeFile(
    path,
    JSON.stringify({
      schemaVersion: "0.1.0",
      kind: "graph",
      title: "Broken",
      lenses: ["architecture"],
      provenance: { repo: { owner: "o", name: "r" }, base: { sha: "1111111" }, head: { sha: "2222222" } },
      lanes: [{ id: "api", label: "API" }],
      nodes: [{ id: "a", label: "A", kind: "route", delta: "added", lane: "nowhere" }],
      edges: [{ id: "e", from: "a", to: "ghost", kind: "call", delta: "added" }],
    }),
    "utf8",
  );

  expect(await invoke("validate", path)).toBe(1);
  const reported = err.join("\n");
  expect(reported).toContain("unknown lane 'nowhere'");
  expect(reported).toContain("unknown node 'ghost'");
});

test("a missing required flag prints the reason and then the usage", async () => {
  expect(await invoke("analyze")).toBe(2);
  const reported = err.join("\n");
  expect(reported).toContain("--base is required");
  expect(reported).toContain("pr-lens analyze");
});

test("an unknown flag is a misuse rather than a stack trace", async () => {
  expect(await invoke("validate", "--depth", "2")).toBe(2);
  expect(err.join("\n")).toContain("[USAGE]");
});

test("the marker is printed by the CLI that owns it, so nothing else has to spell it", async () => {
  expect(await invoke("comment", "--print-marker")).toBe(0);
  expect(out).toEqual([COMMENT_MARKER]);
});

test("rendering says what is missing, and only after the document checked out", async () => {
  expect(await invoke("render", GOLDEN)).toBe(1);
  expect(err.join("\n")).toContain("[RENDERER_UNAVAILABLE]");
});

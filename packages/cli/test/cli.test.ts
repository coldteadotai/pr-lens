import { graphContentHash } from "@coldtea/pr-lens-renderer";
import { parseGraphDoc, parseRenderManifest } from "@coldtea/pr-lens-schema";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { run } from "../src/cli.js";
import { COMMENT_MARKER } from "../src/comment.js";
import type { Terminal } from "../src/terminal.js";
import { CLI_VERSION } from "../src/version.js";

const GOLDEN = new URL("../../schema/examples/postmark-refactor.graph.json", import.meta.url).pathname;
const MINIMAL = new URL("../../schema/examples/minimal.graph.json", import.meta.url).pathname;
const CONFIG = new URL("../../schema/examples/pr-lens.config.json", import.meta.url).pathname;

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
  expect(out.join("\n")).toContain("pr-lens mermaid");
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

test("mermaid writes one selected view for terminal rendering", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pr-lens-mermaid-"));
  const target = join(directory, "flow.mmd");

  expect(
    await invoke(
      "mermaid",
      GOLDEN,
      "--view",
      "send-pipeline-view",
      "--out",
      target,
      "--no-config",
    ),
  ).toBe(0);

  const diagram = await readFile(target, "utf8");
  expect(diagram).toMatch(/^sequenceDiagram\n/);
  expect(diagram).toContain("enqueue broadcast job (modified)");
  expect(out.join("\n")).toContain(target);
});

test("mermaid requires a lens when a document has several and no view was selected", async () => {
  expect(await invoke("mermaid", GOLDEN, "--no-config")).toBe(2);
  expect(err.join("\n")).toContain("--lens is required");
});

test("mermaid infers a document's only lens and writes to stdout", async () => {
  expect(await invoke("mermaid", MINIMAL, "--no-config")).toBe(0);
  expect(out.join("\n")).toMatch(/^flowchart LR/);
});

test("mermaid applies repository corrections before projecting", async () => {
  expect(
    await invoke("mermaid", GOLDEN, "--view", "new-batch-path", "--config", CONFIG),
  ).toBe(0);
  expect(out.join("\n")).toContain("Broadcast sender (added)");
});

test("mermaid rejects an invalid lens", async () => {
  expect(await invoke("mermaid", GOLDEN, "--lens", "security", "--no-config")).toBe(2);
  expect(err.join("\n")).toContain("architecture or data-flow");
});

test("mermaid rejects an unknown view", async () => {
  expect(await invoke("mermaid", GOLDEN, "--view", "missing", "--no-config")).toBe(1);
  expect(err.join("\n")).toContain("UNKNOWN_VIEW");
});

test("mermaid rejects a lens that disagrees with its view", async () => {
  expect(
    await invoke(
      "mermaid",
      GOLDEN,
      "--view",
      "send-pipeline-view",
      "--lens",
      "architecture",
      "--no-config",
    ),
  ).toBe(2);
  expect(err.join("\n")).toContain("uses the 'data-flow' lens");
});

test("mermaid reports corrections that remove the whole graph", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pr-lens-mermaid-config-"));
  const config = join(directory, "pr-lens.config.json");
  await writeFile(
    config,
    JSON.stringify({ schemaVersion: "0.1.0", map: { exclude: ["**", "id:postmark"] } }),
    "utf8",
  );

  expect(await invoke("mermaid", GOLDEN, "--config", config)).toBe(1);
  expect(err.join("\n")).toContain("removed every node");
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

test("rendering writes every SVG the manifest promises, and the manifest validates", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pr-lens-render-"));

  expect(await invoke("render", GOLDEN, "--out", directory, "--no-config")).toBe(0);

  const manifest = parseRenderManifest(JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")));
  expect(manifest.assets.length).toBeGreaterThan(0);

  for (const asset of manifest.assets) {
    expect(asset.path).toBeDefined();
    const svg = await readFile(join(directory, asset.path ?? ""), "utf8");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).not.toContain("<script");
  }
});

test("--theme draws one half of the pair, and nothing else", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pr-lens-render-"));

  expect(await invoke("render", GOLDEN, "--out", directory, "--theme", "dark", "--no-config")).toBe(0);

  const manifest = parseRenderManifest(JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")));
  expect(manifest.assets.every((asset) => asset.theme === "dark")).toBe(true);
});

test("a theme that is not a theme is a misuse", async () => {
  expect(await invoke("render", GOLDEN, "--theme", "sepia")).toBe(2);
  expect(err.join("\n")).toContain("--theme takes light, dark or both");
});

const CORRECTIONS = `schemaVersion: 0.1.0
map:
  exclude:
    - "id:process-broadcast"
    - "id:send-single-email"
    - "src/nothing-is-here.ts"
`;

test("a comment never announces a section the corrections stopped the render from drawing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pr-lens-render-"));
  const config = join(directory, "pr-lens.yml");
  await writeFile(config, CORRECTIONS, "utf8");

  expect(await invoke("render", GOLDEN, "--out", directory, "--config", config)).toBe(0);

  const manifest = parseRenderManifest(JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")));
  expect(manifest.assets.some((asset) => asset.view === "retired-path")).toBe(false);

  out = [];
  expect(
    await invoke(
      "comment",
      "--graph",
      join(directory, "drawn.graph.json"),
      "--manifest",
      join(directory, "manifest.json"),
      "--asset-base-url",
      "https://example.com/a",
    ),
  ).toBe(0);

  expect(out.join("\n")).not.toContain("What was retired");
});

test("the document that was read cannot stand in for the document that was drawn", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pr-lens-render-"));
  const config = join(directory, "pr-lens.yml");
  await writeFile(config, CORRECTIONS, "utf8");

  expect(await invoke("render", GOLDEN, "--out", directory, "--config", config)).toBe(0);
  err = [];

  expect(
    await invoke(
      "comment",
      "--graph",
      GOLDEN,
      "--manifest",
      join(directory, "manifest.json"),
      "--asset-base-url",
      "https://example.com/a",
    ),
  ).toBe(2);

  expect(err.join("\n")).toContain("is not the document");
});

test("a correction that matches nothing is said out loud", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pr-lens-render-"));
  const config = join(directory, "pr-lens.yml");
  await writeFile(config, CORRECTIONS, "utf8");

  expect(await invoke("render", GOLDEN, "--out", directory, "--config", config)).toBe(0);

  const reported = err.join("\n");
  expect(reported).toContain("exclude 'src/nothing-is-here.ts' changed nothing");
  expect(reported).not.toContain("id:process-broadcast");
});

test("the drawn document and the manifest are bound to each other", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pr-lens-render-"));
  const config = join(directory, "pr-lens.yml");
  await writeFile(config, CORRECTIONS, "utf8");

  expect(await invoke("render", GOLDEN, "--out", directory, "--config", config)).toBe(0);

  const drawn = parseGraphDoc(JSON.parse(await readFile(join(directory, "drawn.graph.json"), "utf8")));
  const manifest = parseRenderManifest(JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")));

  expect(graphContentHash(drawn)).toBe(manifest.graph.contentHash);
  expect(drawn.nodes.map((node) => node.id)).not.toContain("process-broadcast");
});

test("render and comment agree on where the SVGs are, without either deriving the other's names", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pr-lens-render-"));

  expect(await invoke("render", GOLDEN, "--out", directory, "--no-config")).toBe(0);
  out = [];

  expect(
    await invoke(
      "comment",
      "--graph",
      join(directory, "drawn.graph.json"),
      "--manifest",
      join(directory, "manifest.json"),
      "--asset-base-url",
      "https://raw.githubusercontent.com/o/r/pr-lens/42",
    ),
  ).toBe(0);

  const body = out.join("\n");
  const manifest = parseRenderManifest(JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")));

  for (const asset of manifest.assets) {
    expect(body).toContain(`https://raw.githubusercontent.com/o/r/pr-lens/42/${asset.path}`);
  }
});

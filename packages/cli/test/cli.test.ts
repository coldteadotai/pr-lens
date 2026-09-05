import { graphContentHash } from "@coldtea/pr-lens-renderer";
import { parseGraphDoc, parseRenderManifest } from "@coldtea/pr-lens-schema";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { run } from "../src/cli.js";
import { COMMENT_MARKER } from "../src/comment.js";
import { GRAPH_DOCUMENT_JSON_SCHEMA } from "../src/skill-content.generated.js";
import type { Terminal } from "../src/terminal.js";
import { CLI_VERSION } from "../src/version.js";

const GOLDEN = new URL("../../schema/examples/postmark-refactor.graph.json", import.meta.url).pathname;
const CLI_INVOCATION = "npx @coldtea/pr-lens-cli@latest";

const forBundledCli = (content: string): string =>
  content.replaceAll(CLI_INVOCATION, "pr-lens");

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
  expect(out.join("\n")).toContain("diagram instructions for coding agents");
});

test("--version is the version stamped on documents", async () => {
  expect(await invoke("--version")).toBe(0);
  expect(out).toEqual([CLI_VERSION]);
});

test("skill prints the operating manual from the agent skill package", async () => {
  const manual = await readFile(
    new URL("../../agent-skill/SKILL.md", import.meta.url),
    "utf8",
  );

  expect(await invoke("skill")).toBe(0);
  expect(out).toEqual([forBundledCli(manual)]);
  expect(out[0]).toContain("pr-lens render");
  expect(out[0]).not.toContain(CLI_INVOCATION);
});

test("skill help makes its agent-facing output clear", async () => {
  expect(await invoke("skill", "--help")).toBe(0);
  expect(out.join("\n")).toContain("create, validate, render, and");
  expect(out.join("\n")).toContain("share PR Lens diagrams");
  expect(out.join("\n")).toContain("written to stdout");
  expect(out.join("\n")).toContain("long, agent-facing document");
  expect(out.join("\n")).toContain("Use pr-lens --help for a short command overview");
});

test("skill references prints the config, graph specification, and example", async () => {
  const config = await readFile(
    new URL("../../agent-skill/references/config.md", import.meta.url),
    "utf8",
  );
  const graphDocument = await readFile(
    new URL("../../agent-skill/references/graph-document.md", import.meta.url),
    "utf8",
  );
  const exampleDocument = await readFile(
    new URL("../../agent-skill/references/example.graph.json", import.meta.url),
    "utf8",
  );

  expect(await invoke("skill", "references")).toBe(0);
  expect(out).toHaveLength(1);
  expect(out[0]).toContain(forBundledCli(config));
  expect(out[0]).toContain(forBundledCli(graphDocument));
  expect(out[0]).toContain(exampleDocument);
});

test("the embedded analysis schema matches the schema package", async () => {
  const graphDocumentJsonSchema = await readFile(
    new URL("../../schema/json-schema/graph-doc.schema.json", import.meta.url),
    "utf8",
  );

  expect(GRAPH_DOCUMENT_JSON_SCHEMA).toBe(graphDocumentJsonSchema);
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

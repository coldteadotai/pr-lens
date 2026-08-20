import {
  DELTAS,
  EdgeEmphasis,
  EdgeKind,
  LENSES,
  MessageKind,
  NodeKind,
  parseConfig,
  SCHEMA_VERSION,
} from "@coldtea/pr-lens-schema";
import { applyCorrections } from "@coldtea/pr-lens-renderer";
import { minimalGraph } from "@coldtea/pr-lens-schema/examples";
import { access, readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { parse } from "yaml";

const read = (name: string) => readFile(new URL(`../${name}`, import.meta.url), "utf8");

const skill = await read("SKILL.md");
const graphGuide = await read("references/graph-document.md");
const configGuide = await read("references/config.md");

const fenced = (source: string, language: string): string[] =>
  [...source.matchAll(new RegExp("```" + language + "\\n([\\s\\S]*?)```", "g"))].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );

test("the skill declares a name and the situations it is for", () => {
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(skill)?.[1];
  expect(frontmatter).toBeDefined();

  const declared: unknown = parse(frontmatter ?? "");
  expect(declared).toMatchObject({ name: "pr-lens" });
  expect(declared).toHaveProperty("description");
});

test("the reference pages the skill sends an agent to exist", async () => {
  const referenced = [...skill.matchAll(/references\/[a-z-]+\.md/g)].map((match) => match[0]);

  expect(referenced.length).toBeGreaterThan(0);
  for (const path of new Set(referenced)) {
    await expect(access(new URL(`../${path}`, import.meta.url))).resolves.toBeUndefined();
  }
})

test("every config the pages teach is a config the contract accepts", () => {
  const configs = [...fenced(skill, "yaml"), ...fenced(configGuide, "yaml")].filter((block) =>
    block.includes("schemaVersion"),
  );

  expect(configs.length).toBeGreaterThan(0);
  for (const config of configs) expect(() => parseConfig(parse(config))).not.toThrow();
});

test("the enums quoted to an agent are the enums the contract implements", () => {
  const quoted = (values: readonly string[]) => values.join(" ");

  expect(graphGuide).toContain(quoted(NodeKind.options));
  expect(graphGuide).toContain(quoted(EdgeKind.options));
  for (const value of [...EdgeEmphasis.options, ...MessageKind.options, ...DELTAS])
    expect(graphGuide).toContain(`\`${value}\``);

  for (const lens of LENSES) expect(skill).toContain(lens);
});

test("the lane rule the pages teach is the lane rule the renderer implements", () => {
  const declared = minimalGraph.lanes.map((lane) => lane.id);
  const corrected = applyCorrections(minimalGraph, {
    rename: [],
    exclude: [],
    lane: [{ match: `id:${minimalGraph.nodes[0]?.id ?? ""}`, lane: "infrastructure" }],
    group: [],
  });

  expect(declared).not.toContain("infrastructure");
  expect(corrected.lanes.map((lane) => lane.id)).toContain("infrastructure");
  expect(corrected.lanes.find((lane) => lane.id === "infrastructure")?.label).toBe("infrastructure");

  expect(configGuide).toContain("creating it");
  expect(skill).toContain("may name a lane the document never declared");
});

test("the contract version the pages tell an agent to write is the one that ships", () => {
  for (const page of [skill, graphGuide, configGuide]) {
    for (const version of page.match(/schemaVersion["']?\s*[:=]\s*["']?([\d.]+)/g) ?? []) {
      expect(version).toContain(SCHEMA_VERSION);
    }
  }
});

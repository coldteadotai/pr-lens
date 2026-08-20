import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { broadcastBaselinePatchInput } from "../src/examples/baseline.js";
import { minimalGraphInput } from "../src/examples/minimal.js";
import {
  exampleConfigInput,
  postmarkRefactorGraphInput,
  postmarkRefactorManifestInput,
} from "../src/examples/postmark-refactor.js";
import type { Parsed } from "../src/errors.js";
import {
  safeParseConfig,
  safeParseGraphDoc,
  safeParsePatchDoc,
  safeParseRenderManifest,
} from "../src/validate.js";

const packageRoot = join(import.meta.dirname, "..");
const JsonObject = z.record(z.string(), z.unknown());

const loadValidator = async (file: string) => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  ajv.addFormat("date-time", /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  ajv.addFormat("uri", /^[a-z][a-z\d+.-]*:\/\/\S+$/i);
  const source = JsonObject.parse(
    JSON.parse(await readFile(join(packageRoot, "json-schema", file), "utf8")),
  );
  return ajv.compile(source);
};

type ParityCase = {
  name: string;
  schema: string;
  parse: (input: unknown) => Parsed<unknown>;
  document: unknown;
  accepted: boolean;
  /** Set only where JSON Schema cannot express the rule; see `divergences`. */
  acceptedByJsonSchema?: boolean;
};

/**
 * The rules the parser enforces and JSON Schema cannot state. Each one has a
 * case below asserting the divergence, so it stays deliberate rather than
 * becoming a surprise for a producer working from the published files.
 */
const divergences = [
  "referential integrity between elements",
  "a line range that ends before it starts",
  "the agreement between a self message's endpoints",
] as const;

const withoutKey = (document: object, key: string): object =>
  Object.fromEntries(Object.entries(document).filter(([name]) => name !== key));

const withFileRef = (file: { path: string; startLine?: number; endLine?: number }) => ({
  ...minimalGraphInput,
  nodes: [{ ...minimalGraphInput.nodes[0]!, files: [file] }],
});

/**
 * The exported JSON Schemas describe what an author may write, which is the
 * input side of the contract: a field with a default is one they may leave
 * out. These cases pin the two representations to the same answer, in both
 * directions — a JSON Schema that quietly accepts more, or demands more, than
 * the parser would send every non-TypeScript producer down the wrong path.
 */
const parityCases: ParityCase[] = [
  {
    name: "the reference pull-request document",
    schema: "graph-doc.schema.json",
    parse: safeParseGraphDoc,
    document: postmarkRefactorGraphInput,
    accepted: true,
  },
  {
    name: "a minimal document that leans on every default",
    schema: "graph-doc.schema.json",
    parse: safeParseGraphDoc,
    document: minimalGraphInput,
    accepted: true,
  },
  {
    name: "a document missing its provenance",
    schema: "graph-doc.schema.json",
    parse: safeParseGraphDoc,
    document: withoutKey(minimalGraphInput, "provenance"),
    accepted: false,
  },
  {
    name: "a document carrying security findings",
    schema: "graph-doc.schema.json",
    parse: safeParseGraphDoc,
    document: { ...minimalGraphInput, findings: [] },
    accepted: false,
  },
  {
    name: "a document with an unknown lens",
    schema: "graph-doc.schema.json",
    parse: safeParseGraphDoc,
    document: { ...minimalGraphInput, lenses: ["security"] },
    accepted: false,
  },
  {
    name: "a view scoped to nothing at all",
    schema: "graph-doc.schema.json",
    parse: safeParseGraphDoc,
    document: {
      ...minimalGraphInput,
      views: [{ id: "empty", title: "Empty", lens: "architecture", scope: { kind: "selection" } }],
    },
    accepted: false,
  },
  {
    name: "the baseline patch",
    schema: "patch-doc.schema.json",
    parse: safeParsePatchDoc,
    document: broadcastBaselinePatchInput,
    accepted: true,
  },
  {
    name: "a patch with no operations",
    schema: "patch-doc.schema.json",
    parse: safeParsePatchDoc,
    document: { ...broadcastBaselinePatchInput, ops: [] },
    accepted: false,
  },
  {
    name: "the example repository config",
    schema: "config.schema.json",
    parse: safeParseConfig,
    document: exampleConfigInput,
    accepted: true,
  },
  {
    name: "a config that only declares its version",
    schema: "config.schema.json",
    parse: safeParseConfig,
    document: { schemaVersion: exampleConfigInput.schemaVersion },
    accepted: true,
  },
  {
    name: "a config with no version",
    schema: "config.schema.json",
    parse: safeParseConfig,
    document: {},
    accepted: false,
  },
  {
    name: "the render manifest",
    schema: "render-manifest.schema.json",
    parse: safeParseRenderManifest,
    document: postmarkRefactorManifestInput,
    accepted: true,
  },
  {
    name: "a manifest asset that is nowhere",
    schema: "render-manifest.schema.json",
    parse: safeParseRenderManifest,
    document: {
      ...postmarkRefactorManifestInput,
      assets: [withoutKey(postmarkRefactorManifestInput.assets[0]!, "url")],
    },
    accepted: false,
  },
  {
    name: "a document from a contract version this package does not read",
    schema: "graph-doc.schema.json",
    parse: safeParseGraphDoc,
    document: { ...minimalGraphInput, schemaVersion: "9.0.0" },
    accepted: false,
  },
  {
    name: "a file reference that escapes the repository",
    schema: "graph-doc.schema.json",
    parse: safeParseGraphDoc,
    document: withFileRef({ path: "../../etc/passwd" }),
    accepted: false,
  },
  {
    name: "a line range with no start",
    schema: "graph-doc.schema.json",
    parse: safeParseGraphDoc,
    document: withFileRef({ path: "src/routes/health.ts", endLine: 12 }),
    accepted: false,
  },
  {
    name: `${divergences[1]}, which only the parser can catch`,
    schema: "graph-doc.schema.json",
    parse: safeParseGraphDoc,
    document: withFileRef({ path: "src/routes/health.ts", startLine: 20, endLine: 2 }),
    accepted: false,
    acceptedByJsonSchema: true,
  },
  {
    name: `${divergences[0]}, which only the parser can catch`,
    schema: "graph-doc.schema.json",
    parse: safeParseGraphDoc,
    document: {
      ...minimalGraphInput,
      nodes: [{ ...minimalGraphInput.nodes[0]!, lane: "no-such-lane" }],
    },
    accepted: false,
    acceptedByJsonSchema: true,
  },
  {
    name: `${divergences[2]}, which only the parser can catch`,
    schema: "graph-doc.schema.json",
    parse: safeParseGraphDoc,
    document: {
      ...postmarkRefactorGraphInput,
      flows: [
        {
          ...postmarkRefactorGraphInput.flows![0]!,
          messages: postmarkRefactorGraphInput.flows![0]!.messages.map((message, index) =>
            index === 0 ? { ...message, kind: "self" } : message,
          ),
        },
      ],
    },
    accepted: false,
    acceptedByJsonSchema: true,
  },
  {
    name: "a patch that does not say which map it targets",
    schema: "patch-doc.schema.json",
    parse: safeParsePatchDoc,
    document: { ...broadcastBaselinePatchInput, target: {} },
    accepted: false,
  },
  {
    name: "a patch that names a map but not the commits",
    schema: "patch-doc.schema.json",
    parse: safeParsePatchDoc,
    document: {
      ...broadcastBaselinePatchInput,
      target: { graphId: broadcastBaselinePatchInput.target.graphId },
    },
    accepted: false,
  },
];

describe("exported JSON Schemas", () => {
  it.each(parityCases)("$schema and the parser agree on $name", async (parityCase) => {
    const validate = await loadValidator(parityCase.schema);
    const document = JsonObject.parse(JSON.parse(JSON.stringify(parityCase.document)));

    expect(validate(document), JSON.stringify(validate.errors, null, 2)).toBe(
      parityCase.acceptedByJsonSchema ?? parityCase.accepted,
    );
    expect(parityCase.parse(parityCase.document).ok).toBe(parityCase.accepted);
  });

  it("documents every rule it cannot carry", () => {
    const asserted = parityCases.filter((parityCase) => parityCase.acceptedByJsonSchema === true);
    expect(new Set(asserted.map((parityCase) => parityCase.name))).toEqual(
      new Set(divergences.map((rule) => `${rule}, which only the parser can catch`)),
    );
  });

  it.each([
    "postmark-refactor.graph.json",
    "broadcast-baseline.graph.json",
    "minimal.graph.json",
  ])("accepts the published %s", async (golden) => {
    const validate = await loadValidator("graph-doc.schema.json");
    const document = JsonObject.parse(
      JSON.parse(await readFile(join(packageRoot, "examples", golden), "utf8")),
    );

    expect(validate(document), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });
});

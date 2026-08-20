import { z } from "zod";
import { Config } from "../src/config.js";
import { GraphDoc, View } from "../src/graph.js";
import { RenderManifest } from "../src/manifest.js";
import { PatchDoc } from "../src/patch.js";
import { SCHEMA_VERSION } from "../src/version.js";
import { goldenDocuments } from "../src/examples/index.js";

const BASE_ID =
  "https://raw.githubusercontent.com/coldteadotai/pr-lens/main/packages/schema/json-schema";

// The drill-down tree is recursive, so it lands in $defs; without an id it
// would be published under a generated name that changes with the schema.
z.globalRegistry.add(View, { id: "View" });

const documents = [
  { file: "graph-doc.schema.json", title: "PR Lens graph document", schema: GraphDoc },
  { file: "patch-doc.schema.json", title: "PR Lens patch document", schema: PatchDoc },
  { file: "config.schema.json", title: "PR Lens repository config", schema: Config },
  { file: "render-manifest.schema.json", title: "PR Lens render manifest", schema: RenderManifest },
] as const;

const serialize = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/**
 * The zod schemas are the source of truth; these files exist so producers in
 * other languages, and editors validating `.github/pr-lens.yml`, can hold the
 * same contract without running our code.
 *
 * Emitted from the input side: the audience is authors, and a field with a
 * default is one they may leave out. Constraints JSON Schema cannot express —
 * referential integrity, and the equality between a self message's endpoints —
 * stay the runtime parser's job.
 */
export const buildJsonSchemas = (): Map<string, string> =>
  new Map(
    documents.map(({ file, title, schema }) => [
      file,
      serialize({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: `${BASE_ID}/${file}`,
        title,
        version: SCHEMA_VERSION,
        ...z.toJSONSchema(schema, { target: "draft-2020-12", io: "input" }),
      }),
    ]),
  );

export const buildExamples = (): Map<string, string> =>
  new Map(Object.entries(goldenDocuments).map(([file, doc]) => [file, serialize(doc)]));

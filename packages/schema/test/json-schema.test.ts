import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { goldenDocuments } from "../src/examples/index.js";

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

const cases = [
  { schema: "graph-doc.schema.json", golden: "postmark-refactor.graph.json" },
  { schema: "graph-doc.schema.json", golden: "minimal.graph.json" },
  { schema: "patch-doc.schema.json", golden: "postmark-refactor.patch.json" },
  { schema: "config.schema.json", golden: "pr-lens.config.json" },
  { schema: "render-manifest.schema.json", golden: "postmark-refactor.render-manifest.json" },
] as const;

/**
 * A published JSON Schema that disagrees with the zod schemas would be worse
 * than shipping none: every non-TypeScript producer would build against it.
 */
describe("exported JSON Schemas", () => {
  it.each(cases)("$schema accepts $golden", async ({ schema, golden }) => {
    const validate = await loadValidator(schema);
    const document = JsonObject.parse(
      JSON.parse(await readFile(join(packageRoot, "examples", golden), "utf8")),
    );

    expect(validate(document), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it("rejects a graph document that drops a required field", async () => {
    const validate = await loadValidator("graph-doc.schema.json");
    const { provenance, ...withoutProvenance } = goldenDocuments["minimal.graph.json"];

    expect(validate(withoutProvenance)).toBe(false);
    expect(validate.errors?.some((error) => error.message?.includes("provenance"))).toBe(true);
  });

  it("rejects security findings the same way the zod schema does", async () => {
    const validate = await loadValidator("graph-doc.schema.json");
    const document = { ...goldenDocuments["minimal.graph.json"], findings: [] };

    expect(validate(document)).toBe(false);
  });
});

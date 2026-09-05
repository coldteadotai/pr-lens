import { z } from "zod";
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { Config } from "../src/config.js";
import { SCHEMA_VERSION } from "../src/version.js";

const schema = z.record(z.string(), z.unknown()).parse(JSON.parse(readFileSync(new URL("../json-schema/config.schema.json", import.meta.url), "utf8")));
const validate = new Ajv2020({ strict: false }).compile(schema);

describe("GitHub comment config", () => {
  it.each([
    {},
    { github: {} },
    { github: { comment: {} } },
    { github: { comment: { collapsed: false } } },
  ])("defaults omitted and false settings to expanded: %j", (fields) => {
    const input = { schemaVersion: SCHEMA_VERSION, ...fields };
    expect(Config.parse(input).github.comment.collapsed).toBe(false);
    expect(validate(input)).toBe(true);
  });

  it("accepts true alongside existing fields in Zod and the published JSON Schema", () => {
    const input = { schemaVersion: SCHEMA_VERSION, lenses: ["architecture"], branding: false, map: {}, github: { comment: { collapsed: true } } };
    expect(Config.parse(input).github.comment.collapsed).toBe(true);
    expect(validate(input)).toBe(true);
  });

  it.each(["true", 1, null, [], {}])("rejects non-boolean collapsed values: %j", (collapsed) => {
    const input = { schemaVersion: SCHEMA_VERSION, github: { comment: { collapsed } } };
    expect(Config.safeParse(input).success).toBe(false);
    expect(validate(input)).toBe(false);
  });
});

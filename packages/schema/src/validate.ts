import type { z } from "zod";
import { Config } from "./config.js";
import { formatIssues, PrLensSchemaError, type Parsed, type SchemaIssue } from "./errors.js";
import { GraphDoc } from "./graph.js";
import { graphIntegrityIssues } from "./integrity.js";
import { RenderManifest } from "./manifest.js";
import { PatchDoc } from "./patch.js";
import { SCHEMA_VERSION } from "./version.js";

const formatPath = (path: readonly PropertyKey[]): string =>
  path.reduce<string>((acc, segment) => {
    if (typeof segment === "number") return `${acc}[${segment}]`;
    return acc === "" ? String(segment) : `${acc}.${String(segment)}`;
  }, "");

const toIssues = (error: z.ZodError): SchemaIssue[] =>
  error.issues.map((issue) => ({
    code: "INVALID_DOCUMENT" as const,
    path: formatPath(issue.path),
    message: issue.message,
  }));

const [currentMajor, currentMinor] = SCHEMA_VERSION.split(".");

/**
 * Below 1.0 a minor bump is allowed to be breaking, so only an exact
 * major.minor match is accepted; from 1.0 on, the major must match and a
 * newer minor is readable because minor releases only add optional fields.
 */
const isSupportedVersion = (version: string): boolean => {
  const [major, minor] = version.split(".");
  if (major !== currentMajor) return false;
  if (currentMajor === "0") return minor === currentMinor;
  return Number(minor) <= Number(currentMinor);
};

const versionIssues = (version: string, path: string): SchemaIssue[] =>
  isSupportedVersion(version)
    ? []
    : [
        {
          code: "UNSUPPORTED_SCHEMA_VERSION",
          path,
          message: `document targets schema version ${version}; this package implements ${SCHEMA_VERSION}`,
        },
      ];

const fail = (label: string, issues: SchemaIssue[]): PrLensSchemaError => {
  const first = issues[0];
  return new PrLensSchemaError(
    first ? first.code : "INVALID_DOCUMENT",
    `invalid ${label}:\n${formatIssues(issues)}`,
    issues,
  );
};

const parseDocument = <Schema extends z.ZodType>(
  schema: Schema,
  label: string,
  input: unknown,
  extraIssues: (value: z.infer<Schema>) => SchemaIssue[],
): Parsed<z.infer<Schema>> => {
  const result = schema.safeParse(input);
  if (!result.success) return { ok: false, error: fail(label, toIssues(result.error)) };

  const issues = extraIssues(result.data);
  if (issues.length > 0) return { ok: false, error: fail(label, issues) };

  return { ok: true, value: result.data };
};

const unwrap = <T>(parsed: Parsed<T>): T => {
  if (parsed.ok) return parsed.value;
  throw parsed.error;
};

/**
 * Structure, contract version and referential integrity in one pass. A
 * document that survives this is safe to render without further checking.
 */
export const safeParseGraphDoc = (input: unknown): Parsed<GraphDoc> =>
  parseDocument(GraphDoc, "graph document", input, (doc) => [
    ...versionIssues(doc.schemaVersion, "schemaVersion"),
    ...graphIntegrityIssues(doc),
  ]);

export const parseGraphDoc = (input: unknown): GraphDoc => unwrap(safeParseGraphDoc(input));

export const safeParsePatchDoc = (input: unknown): Parsed<PatchDoc> =>
  parseDocument(PatchDoc, "patch document", input, (doc) =>
    versionIssues(doc.schemaVersion, "schemaVersion"),
  );

export const parsePatchDoc = (input: unknown): PatchDoc => unwrap(safeParsePatchDoc(input));

export const safeParseConfig = (input: unknown): Parsed<Config> =>
  parseDocument(Config, "config", input, (config) =>
    versionIssues(config.schemaVersion, "schemaVersion"),
  );

export const parseConfig = (input: unknown): Config => unwrap(safeParseConfig(input));

export const safeParseRenderManifest = (input: unknown): Parsed<RenderManifest> =>
  parseDocument(RenderManifest, "render manifest", input, (manifest) =>
    versionIssues(manifest.schemaVersion, "schemaVersion"),
  );

export const parseRenderManifest = (input: unknown): RenderManifest =>
  unwrap(safeParseRenderManifest(input));

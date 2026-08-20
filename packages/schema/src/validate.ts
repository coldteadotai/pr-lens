import type { z } from "zod";
import { Config } from "./config.js";
import { formatIssues, PrLensSchemaError, type Parsed, type SchemaIssue } from "./errors.js";
import { GraphDoc } from "./graph.js";
import { graphIntegrityIssues } from "./integrity.js";
import { RenderManifest } from "./manifest.js";
import { PatchDoc } from "./patch.js";
import { isSupportedVersion, SCHEMA_VERSION } from "./version.js";

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

/**
 * Validating a recursive structure recurses, so a document nested deeply
 * enough exhausts the stack while zod is still walking it — before any check
 * of ours can count anything. A `safeParse` that throws would be a worse
 * failure than the document it was handed, so the stack running out is
 * reported as what it is: a document too deep to read.
 *
 * Every `RangeError` is read that way, not only the ones provoked by depth.
 * That is deliberate: failing closed keeps the promise that these functions
 * return a verdict rather than throwing one, and nesting is the only way a
 * document is known to provoke one. Narrowing this to rethrow would trade
 * that promise for a diagnosis.
 */
const attemptParse = <Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
): { read: true; value: z.infer<Schema> } | { read: false; issues: SchemaIssue[] } => {
  try {
    const result = schema.safeParse(input);
    return result.success
      ? { read: true, value: result.data }
      : { read: false, issues: toIssues(result.error) };
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return {
      read: false,
      issues: [
        {
          code: "INVALID_DOCUMENT",
          path: "",
          message: "document nests too deeply to read",
        },
      ],
    };
  }
};

const parseDocument = <Schema extends z.ZodType>(
  schema: Schema,
  label: string,
  input: unknown,
  extraIssues: (value: z.infer<Schema>) => SchemaIssue[],
): Parsed<z.infer<Schema>> => {
  const result = attemptParse(schema, input);
  if (!result.read) return { ok: false, error: fail(label, result.issues) };

  const issues = extraIssues(result.value);
  if (issues.length > 0) return { ok: false, error: fail(label, issues) };

  return { ok: true, value: result.value };
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

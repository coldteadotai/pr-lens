import {
  assertNever,
  formatIssues,
  safeParseConfig,
  safeParseGraphDoc,
  safeParsePatchDoc,
  safeParseRenderManifest,
  type Config,
  type GraphDoc,
  type Parsed,
  type PatchDoc,
  type PrLensSchemaError,
  type RenderManifest,
} from "@coldtea/pr-lens-schema";
import { extname } from "node:path";
import { parse as parseYaml } from "yaml";
import { PrLensCliError } from "./errors.js";
import { readTextFile } from "./io.js";

export type DocumentKind = "graph" | "patch" | "render-manifest" | "config";

export type ValidatedDocument =
  | { kind: "graph"; document: GraphDoc }
  | { kind: "patch"; document: PatchDoc }
  | { kind: "render-manifest"; document: RenderManifest }
  | { kind: "config"; document: Config };

export const describeDocumentKind = (kind: DocumentKind): string => {
  switch (kind) {
    case "graph":
      return "graph document";
    case "patch":
      return "patch document";
    case "render-manifest":
      return "render manifest";
    case "config":
      return "config";
    default:
      return assertNever(kind, "Unhandled document kind");
  }
};

export const invalidDocument = (
  path: string,
  kind: DocumentKind,
  error: PrLensSchemaError,
): PrLensCliError =>
  new PrLensCliError(
    "INVALID_DOCUMENT",
    `${path} is not a valid ${describeDocumentKind(kind)} [${error.code}]`,
    formatIssues(error.issues),
  );

const take = <T>(path: string, kind: DocumentKind, parsed: Parsed<T>): T => {
  if (!parsed.ok) throw invalidDocument(path, kind, parsed.error);
  return parsed.value;
};

/**
 * YAML is a superset of JSON, so one parser reads both and a hand-written
 * config gets the same treatment whichever spelling a repository chose.
 */
const readDocumentSource = async (path: string): Promise<unknown> => {
  const text = await readTextFile(path);
  try {
    return parseYaml(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const syntax = extname(path) === ".json" ? "JSON" : "YAML";
    throw new PrLensCliError("UNREADABLE_FILE", `${path} is not valid ${syntax}`, detail);
  }
};

export const readGraphDoc = async (path: string): Promise<GraphDoc> =>
  take(path, "graph", safeParseGraphDoc(await readDocumentSource(path)));

export const readRenderManifest = async (path: string): Promise<RenderManifest> =>
  take(path, "render-manifest", safeParseRenderManifest(await readDocumentSource(path)));

export const readConfig = async (path: string): Promise<Config> =>
  take(path, "config", safeParseConfig(await readDocumentSource(path)));

/**
 * `kind` names the document. Only a config lacks one, because it is the only
 * one of the four a person writes by hand, and a discriminant in a file a
 * person maintains buys nothing.
 */
const documentKindOf = (path: string, value: unknown): DocumentKind => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new PrLensCliError("UNKNOWN_DOCUMENT", `${path} does not hold a PR Lens document`);

  const kind = "kind" in value ? value.kind : undefined;
  if (kind === undefined) return "config";
  if (kind === "graph" || kind === "patch" || kind === "render-manifest") return kind;

  throw new PrLensCliError(
    "UNKNOWN_DOCUMENT",
    `${path} declares an unknown document kind ${JSON.stringify(kind)}`,
    "expected 'graph', 'patch' or 'render-manifest' — or no 'kind' at all, for a config",
  );
};

export const validateDocumentFile = async (path: string): Promise<ValidatedDocument> => {
  const source = await readDocumentSource(path);
  const kind = documentKindOf(path, source);

  switch (kind) {
    case "graph":
      return { kind, document: take(path, kind, safeParseGraphDoc(source)) };
    case "patch":
      return { kind, document: take(path, kind, safeParsePatchDoc(source)) };
    case "render-manifest":
      return { kind, document: take(path, kind, safeParseRenderManifest(source)) };
    case "config":
      return { kind, document: take(path, kind, safeParseConfig(source)) };
    default:
      return assertNever(kind, "Unhandled document kind");
  }
};

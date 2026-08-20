/**
 * Codes are the stable half of a failure; messages are not. Callers switch on
 * the code, and every code stays meaningful across contract versions.
 */
export type SchemaErrorCode =
  | "INVALID_DOCUMENT"
  | "BROKEN_REFERENCE"
  | "DUPLICATE_ID"
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "PATCH_CONFLICT";

export type SchemaIssue = {
  code: SchemaErrorCode;
  path: string;
  message: string;
};

export class PrLensSchemaError extends Error {
  readonly code: SchemaErrorCode;
  readonly issues: readonly SchemaIssue[];

  constructor(code: SchemaErrorCode, message: string, issues: readonly SchemaIssue[] = []) {
    super(message);
    this.name = "PrLensSchemaError";
    this.code = code;
    this.issues = issues;
  }
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: PrLensSchemaError };

export const formatIssues = (issues: readonly SchemaIssue[]): string =>
  issues.map((issue) => `  ${issue.path || "<root>"}: ${issue.message} [${issue.code}]`).join("\n");

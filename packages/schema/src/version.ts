/**
 * Version of the PR Lens document contract.
 *
 * Every document carries this string so a consumer can refuse, migrate, or
 * degrade gracefully when it meets a document it was not built for. Bumped
 * with semver semantics: patch/minor releases only ever add optional fields
 * or widen an enum, a major release may remove or retype a field.
 */
export const SCHEMA_VERSION = "0.1.0" as const;

export type SchemaVersion = typeof SCHEMA_VERSION;

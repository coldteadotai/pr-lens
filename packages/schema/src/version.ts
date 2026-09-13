/**
 * Version of the PR Lens document contract.
 *
 * Every document carries this string so a consumer can refuse, migrate, or
 * degrade gracefully when it meets a document it was not built for. Bumped
 * with semver semantics: patch/minor releases only ever add optional fields
 * or widen an enum, a major release may remove or retype a field.
 */
export const SCHEMA_VERSION = "0.2.0" as const;

export type SchemaVersion = typeof SCHEMA_VERSION;

const [currentMajor = "0", currentMinor = "0"] = SCHEMA_VERSION.split(".");

/** Contract 0.1 was the first one documents were stored against; nothing older exists to read. */
const FIRST_READABLE_MINOR = 1;

const readableMinors = Array.from(
  { length: Number(currentMinor) - FIRST_READABLE_MINOR + 1 },
  (_, offset) => FIRST_READABLE_MINOR + offset,
);

/**
 * Which versions this package reads, as a pattern so the rule can be carried
 * into the exported JSON Schemas rather than restated there.
 *
 * A newer minor than this package knows is refused: it may carry a field
 * this parser would reject as invented.
 */
export const SUPPORTED_VERSION_PATTERN = `^${currentMajor}\\.(${readableMinors.join("|")})\\.\\d+$`;

export const isSupportedVersion = (version: string): boolean =>
  new RegExp(SUPPORTED_VERSION_PATTERN).test(version);

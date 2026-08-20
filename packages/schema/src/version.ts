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

const [currentMajor = "0", currentMinor = "0"] = SCHEMA_VERSION.split(".");

const readableMinors = Array.from({ length: Number(currentMinor) + 1 }, (_, minor) => minor);

/**
 * Which versions this package reads, as a pattern so the rule can be carried
 * into the exported JSON Schemas rather than restated there.
 *
 * Below 1.0 a minor bump is allowed to break, so only the exact major.minor
 * is accepted; from 1.0 on, the major must match and a newer minor is
 * readable because minor releases only add optional fields.
 */
export const SUPPORTED_VERSION_PATTERN =
  currentMajor === "0"
    ? `^0\\.${currentMinor}\\.\\d+$`
    : `^${currentMajor}\\.(${readableMinors.join("|")})\\.\\d+$`;

export const isSupportedVersion = (version: string): boolean =>
  new RegExp(SUPPORTED_VERSION_PATTERN).test(version);

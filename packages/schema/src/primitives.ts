import { z } from "zod";
import { SCHEMA_VERSION, SUPPORTED_VERSION_PATTERN } from "./version.js";

/**
 * Identifiers are authored by an extraction model, so they are constrained to
 * a shape that survives being embedded in an SVG id, a URL fragment and a
 * GitHub comment anchor without escaping.
 */
export const Id = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/,
    "must start alphanumeric and contain only letters, digits and . _ : / -",
  )
  .describe("Stable identifier, unique within its collection in a document.");
export type Id = z.infer<typeof Id>;

/**
 * The loose shape is checked here and the supported range is checked by the
 * parser, which can say which version it implements. The exported JSON
 * Schemas carry the range instead, since they have no parser behind them.
 */
export const SchemaVersionField = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, "must be a semver string, e.g. 0.1.0")
  .meta({ pattern: SUPPORTED_VERSION_PATTERN })
  .describe(`Contract version the document targets. Current: ${SCHEMA_VERSION}.`);

/** Non-empty single-line label rendered on a card, lane header or edge. */
export const Label = z.string().min(1).max(120).describe("Short display label.");

/** Prose shown in drill-down bodies; kept short enough to stay scannable. */
export const Summary = z
  .string()
  .min(1)
  .max(2000)
  .describe("One or two sentences of plain prose. No markdown headings.");

export const Sha = z
  .string()
  .regex(/^[0-9a-f]{7,40}$/, "must be a lowercase hex git object name")
  .describe("Git commit sha, abbreviated or full.");

/**
 * Abbreviations are fine for something a human reads, but not for deciding
 * whether two records mean the same commit: two abbreviations of different
 * lengths compare unequal, and a short one can collide as a repository grows.
 * Anything a machine compares uses the full name.
 */
export const FullSha = z
  .string()
  .regex(/^[0-9a-f]{40}$/, "must be a full 40-character lowercase hex git object name")
  .describe("Git commit sha, in full.");

/**
 * The two lenses PR Lens ships. The enum is additive: a future contract
 * version may introduce further lenses, and consumers must treat an unknown
 * lens as "skip this view" rather than as a hard failure.
 */
export const Lens = z.enum(["architecture", "data-flow"]).describe("Rendering lens.");
export type Lens = z.infer<typeof Lens>;

export const LENSES = Lens.options;

/**
 * How an element relates to the base branch. `unchanged` elements are the
 * context a reader needs to judge blast radius, so they are first-class
 * rather than omitted.
 */
export const Delta = z
  .enum(["added", "modified", "removed", "unchanged"])
  .describe("Change state relative to the base commit.");
export type Delta = z.infer<typeof Delta>;

export const DELTAS = Delta.options;

/**
 * One rule both representations share: no absolute path in any spelling a
 * platform recognises, and no `..` segment. A path that breaks it cannot
 * produce a diff permalink, whatever else it might mean.
 */
const REPOSITORY_PATH = /^(?!\/)(?![A-Za-z]:)(?!.*\\)(?!.*(?:^|\/)\.\.(?:\/|$)).+$/;

/**
 * A pointer into the head tree, used to build diff permalinks. Line numbers
 * are 1-based and refer to the head revision except on `removed` elements,
 * where they refer to the base revision.
 */
export const FileRef = z
  .strictObject({
    path: z
      .string()
      .min(1)
      .max(1024)
      .regex(
        REPOSITORY_PATH,
        "must be a repository-relative POSIX path, without a drive letter, a backslash or a '..' segment",
      )
      .describe("Repository-relative path, POSIX separators."),
    startLine: z.int().min(1).optional().describe("1-based first line."),
    endLine: z.int().min(1).optional().describe("1-based last line, inclusive."),
    revision: z
      .enum(["head", "base"])
      .optional()
      .describe("Which side of the diff the lines refer to. Defaults to head."),
  })
  .meta({ dependentRequired: { endLine: ["startLine"] } })
  .refine((f) => f.endLine === undefined || f.startLine !== undefined, {
    message: "endLine requires startLine",
    path: ["endLine"],
  })
  .refine((f) => f.endLine === undefined || f.startLine === undefined || f.endLine >= f.startLine, {
    message: "endLine must be greater than or equal to startLine",
    path: ["endLine"],
  })
  .describe("A file (and optional line range) backing an element.");
export type FileRef = z.infer<typeof FileRef>;

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

/**
 * A walkthrough step's heading. The cap is part of the contract rather than
 * advice: the rail shows one line per step, so a heading long enough to wrap
 * turns the tour into a wall of text, and no producer can pad its way past it.
 */
export const Beat = z
  .string()
  .min(1)
  .max(48)
  .describe("A step heading. Short enough to read at a glance.");

/**
 * The one line of body under a step's heading. Required: a heading with
 * nothing under it reads as a step someone started and never finished.
 */
export const Line = z
  .string()
  .min(1)
  .max(140)
  .describe("A single line under a step heading.");

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
 * What a render can target. `light` and `dark` are the two halves of a
 * `<picture>` pair, for a surface that can swap them. `neutral` is the single
 * self-contained render for a surface that shows one image and cannot: it
 * carries its own ground, because no flat colour clears a readable contrast
 * ratio against both a white page and a near-black one.
 */
export const Theme = z
  .enum(["light", "dark", "neutral"])
  .describe("Which colour scheme a render targets.");
export type Theme = z.infer<typeof Theme>;

export const THEMES = Theme.options;

/**
 * The two that make a `<picture>` pair, and the widest render any target
 * asks for. `neutral` replaces the pair rather than joining it — a surface
 * wants either the pair or the single image, never all three — so this, not
 * the size of the enum, is what bounds a document's view tree.
 */
export const THEME_PAIR = ["light", "dark"] as const satisfies readonly Theme[];

/**
 * A render is one asset per view per theme, so these two caps are one rule
 * rather than two numbers that happen to sit near each other: a document with
 * more views than a manifest can carry at every theme is one whose full
 * render could never be described, however well formed it looks.
 *
 * Deriving the view cap from the asset budget keeps the relationship in one
 * place — raise the budget, or add a theme, and the other end moves with it
 * instead of every surface rediscovering the arithmetic.
 *
 * The cap is deliberately the worst case any target asks for — the pair —
 * rather than what some particular render would emit. A renderer asked for
 * one theme could describe twice as many views, but then whether a document
 * is renderable would depend on how it was asked to be rendered, and the
 * promise this package exists to make — if it parses, it renders — would
 * need a second rule at a second boundary to stay true.
 *
 * The worst case is the pair rather than the whole enum because `neutral`
 * replaces the pair and never joins it: a surface shows the two halves or
 * the one self-contained render. `RenderThemes` in the renderer is what
 * keeps that true at the boundary, so a caller cannot ask for all three and
 * emit three assets per view against a budget that assumed two.
 */
export const MAX_RENDER_ASSETS = 256;

export const MAX_VIEWS = MAX_RENDER_ASSETS / THEME_PAIR.length;

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

/**
 * Spelled out rather than `z.json()`: that one publishes its recursion under
 * a generated `$defs` name even when registered under an id.
 */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export const JsonValue: z.ZodType<JsonValue> = z
  .lazy(() =>
    z.union([
      z.null(),
      z.boolean(),
      z.number(),
      z.string(),
      z.array(JsonValue),
      z.record(z.string(), JsonValue),
    ]),
  )
  .describe("Any JSON value.");

/** Counted by hand: the build compiles with no node or DOM types, so there is no TextEncoder. */
export const byteLength = (text: string): number => {
  let bytes = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes += codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
  }
  return bytes;
};

/** A scalar is 0, `{}` or `[]` is 1, `{ a: [] }` is 2. */
export const jsonDepth = (value: JsonValue): number => {
  if (value === null || typeof value !== "object") return 0;
  let deepest = 0;
  for (const child of Array.isArray(value) ? value : Object.values(value))
    deepest = Math.max(deepest, jsonDepth(child));
  return 1 + deepest;
};

/** A value cannot be cut mid-string, so these caps refuse rather than truncate. */
export const MAX_PAYLOAD_DEPTH = 8;
export const MAX_SHAPE_BYTES = 2_048;
export const MAX_SAMPLE_BYTES = 4_096;
export const MAX_CHANGED_PATHS = 64;

/** `Metadata.batchId`, `[0].Cc`, or `headers["Content-Type"]` for a key an identifier cannot spell. */
const IDENTIFIER = "[A-Za-z_$][\\w$]*";
const QUOTED_KEY = '\\["(?:[^"\\\\]|\\\\.)+"\\]';
const FIRST_SEGMENT = `(?:${IDENTIFIER}|\\[\\d+\\]|${QUOTED_KEY})`;
const NEXT_SEGMENT = `(?:\\.${IDENTIFIER}|\\[\\d+\\]|${QUOTED_KEY})`;

export const JsonPath = z
  .string()
  .min(1)
  .max(200)
  .regex(
    new RegExp(`^${FIRST_SEGMENT}${NEXT_SEGMENT}*$`),
    'must be a path into a JSON value, e.g. Metadata.batchId, [0].Cc or headers["Content-Type"]',
  )
  .describe("A path into a sample: dotted keys, [n] indexes and bracket-quoted keys.");
export type JsonPath = z.infer<typeof JsonPath>;

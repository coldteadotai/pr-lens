import type { Delta, MessageKind } from "@coldtea/pr-lens-schema";
import { assertNever } from "@coldtea/pr-lens-schema";
import { MONO_STACK } from "../text.js";
import type { Palette } from "../theme.js";
import { toneColour, type Tone } from "./document.js";
import type { Attributes } from "./primitives.js";

/**
 * Every visual rule the renderer draws with, as the presentation attributes
 * each element carries.
 *
 * These used to live in one <style> block at the top of the document. That
 * works wherever the SVG is shown as an image, but not on the page GitHub
 * opens when a reader clicks the image to zoom: the stylesheet is not
 * honoured there, so every class-styled shape fell back to black fill and the
 * text became black on black, while the SMIL animation carried on running.
 * An attribute cannot be ignored the way a stylesheet can, so the same rules
 * are written onto the elements they apply to, and the document no longer
 * depends on CSS at all. The class names stay on the elements as inert
 * markers: they name what a shape is, which tests and tools still read.
 *
 * Where the stylesheet stacked several rules on one element, the cascade is
 * reproduced here in the order the rules won: later spreads override earlier
 * ones exactly as the later rule overrode the earlier one.
 */

const toneText = (palette: Palette, tone: Tone): string => {
  switch (tone) {
    case "added":
      return palette.addedText;
    case "modified":
      return palette.modifiedText;
    case "removed":
      return palette.removedText;
    case "neutral":
      return palette.muted;
    default:
      return assertNever(tone, "Unhandled tone");
  }
};

const toneFill = (palette: Palette, tone: Tone): string => {
  switch (tone) {
    case "added":
      return palette.addedFill;
    case "modified":
      return palette.modifiedFill;
    case "removed":
      return palette.removedFill;
    case "neutral":
      return palette.neutralFill;
    default:
      return assertNever(tone, "Unhandled tone");
  }
};

const toneBorder = (palette: Palette, tone: Tone): string => {
  switch (tone) {
    case "added":
      return palette.addedBorder;
    case "modified":
      return palette.modifiedBorder;
    case "removed":
      return palette.removedBorder;
    case "neutral":
      return palette.cardBorder;
    default:
      return assertNever(tone, "Unhandled tone");
  }
};

export const laneBox = (palette: Palette): Attributes => ({ fill: palette.lane });

export const laneLabel = (palette: Palette): Attributes => ({
  "font-size": 10,
  "font-weight": 700,
  "letter-spacing": ".12em",
  fill: palette.muted,
});

/** The card's group: its shadow, and the dimming a removed or unchanged node gets. */
export const cardGroup = (palette: Palette, delta: Delta): Attributes => {
  const shadow: Attributes = { filter: `drop-shadow(0 1px 2px ${palette.shadow})` };
  switch (delta) {
    case "removed":
      return { ...shadow, opacity: 0.55 };
    case "unchanged":
      return { ...shadow, opacity: 0.82 };
    case "added":
    case "modified":
      return shadow;
    default:
      return assertNever(delta, "Unhandled delta");
  }
};

export const cardOutline = (palette: Palette, delta: Delta): Attributes => {
  const base: Attributes = { fill: palette.card, stroke: palette.cardBorder, "stroke-width": 1 };
  switch (delta) {
    case "added":
      return { ...base, stroke: palette.added, "stroke-opacity": 0.55 };
    case "modified":
      return { ...base, stroke: palette.modified, "stroke-opacity": 0.5 };
    case "removed":
      return { ...base, stroke: palette.removed, "stroke-dasharray": "4 3", "stroke-opacity": 0.6 };
    case "unchanged":
      return base;
    default:
      return assertNever(delta, "Unhandled delta");
  }
};

export const nodeTitle = (palette: Palette, delta: Delta): Attributes => ({
  "font-weight": 600,
  fill: palette.foreground,
  ...(delta === "removed" ? { "text-decoration": "line-through" } : {}),
});

export const nodeSubtitle = (palette: Palette): Attributes => ({
  "font-size": 9.5,
  fill: palette.muted,
  "font-family": MONO_STACK,
});

export const iconChip = (palette: Palette): Attributes => ({ fill: palette.chip });

export const glyphFill = (palette: Palette): Attributes => ({ fill: palette.muted });

export const glyphStroke = (palette: Palette): Attributes => ({
  stroke: palette.muted,
  "stroke-width": 1.4,
  fill: "none",
});

export const badgeRect = (palette: Palette, tone: Tone): Attributes => ({
  "stroke-width": 1,
  fill: toneFill(palette, tone),
  stroke: toneBorder(palette, tone),
});

export const badgeText = (palette: Palette, tone: Tone): Attributes => ({
  "font-size": 8.5,
  "font-weight": 700,
  "letter-spacing": ".06em",
  fill: toneText(palette, tone),
});

export type EdgeLook = {
  tone: Tone;
  hero: boolean;
  /** Muted emphasis: drawn, but stepped back. */
  faded: boolean;
  /** An unchanged edge: context for the change rather than part of it. */
  context: boolean;
};

export const edgeLine = (palette: Palette, look: EdgeLook): Attributes => ({
  fill: "none",
  "stroke-width": look.hero ? 2.25 : 1.5,
  stroke: toneColour(palette, look.tone),
  ...(look.tone === "removed" ? { "stroke-dasharray": "5 4" } : {}),
  // Dimming, in the order the rules used to win: faded over removed over context.
  ...(look.faded
    ? { opacity: 0.45 }
    : look.tone === "removed"
      ? { opacity: 0.7 }
      : look.context
        ? { opacity: 0.82 }
        : {}),
});

export const heroGlow = (palette: Palette, tone: Tone): Attributes => ({
  fill: "none",
  stroke: toneColour(palette, tone),
  "stroke-width": 7,
  opacity: 0.14,
});

export const labelPill = (palette: Palette): Attributes => ({
  fill: palette.pill,
  stroke: palette.pillBorder,
  "stroke-width": 1,
});

export const labelText = (palette: Palette, tone: Tone): Attributes => ({
  "font-size": 9.5,
  "font-weight": 600,
  fill: toneText(palette, tone),
});

export const lifeline = (palette: Palette): Attributes => ({
  stroke: palette.lifeline,
  "stroke-width": 1,
  "stroke-dasharray": "3 4",
});

export const activationBar = (palette: Palette): Attributes => ({
  fill: palette.addedFill,
  stroke: palette.addedBorder,
});

export const messageLine = (
  palette: Palette,
  tone: Tone,
  kind: MessageKind,
  delta: Delta,
): Attributes => ({
  fill: "none",
  "stroke-width": delta === "added" ? 2.25 : 1.5,
  stroke: toneColour(palette, tone),
  ...(tone === "removed" ? { "stroke-dasharray": "5 4", opacity: 0.7 } : {}),
  // A reply's dashes win over a removal's: the rule came later.
  ...(kind === "return" ? { "stroke-dasharray": "4 3", opacity: 0.8 } : {}),
});

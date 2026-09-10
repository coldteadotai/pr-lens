import { assertNever } from "@coldtea/pr-lens-schema";
import type { Delta, FlowMessage, GraphEdge } from "@coldtea/pr-lens-schema";
import { MONO_STACK } from "../text.js";
import type { Palette } from "../theme.js";
import type { Attributes } from "./primitives.js";
import { toneColour, toneFor, type Tone } from "./document.js";

// GitHub's attachment viewer can ignore CSS, so appearance lives on the elements.
export const stylesFor = (palette: Palette) => ({
  lane: { fill: palette.lane },
  laneLabel: { "font-size": 10, "font-weight": 700, "letter-spacing": ".12em", fill: palette.muted },
  title: { "font-weight": 600, fill: palette.foreground },
  subtitle: { "font-size": 9.5, fill: palette.muted, "font-family": MONO_STACK },
  chip: { fill: palette.chip },
  glyph: { fill: palette.muted },
  glyphStroke: { stroke: palette.muted, "stroke-width": 1.4, fill: "none" },
  badgeText: { "font-size": 8.5, "font-weight": 700, "letter-spacing": ".06em" },
  glow: { fill: "none", "stroke-width": 7, opacity: 0.14 },
  pill: { fill: palette.pill, stroke: palette.pillBorder, "stroke-width": 1 },
  pillText: { "font-size": 9.5, "font-weight": 600 },
  lifeline: { stroke: palette.lifeline, "stroke-width": 1, "stroke-dasharray": "3 4" },
  activation: { fill: palette.addedFill, stroke: palette.addedBorder },
});

export type SvgStyles = ReturnType<typeof stylesFor>;

const cardStroke = (delta: Delta, palette: Palette): Attributes => {
  switch (delta) {
    case "added":
      return { stroke: palette.added, "stroke-opacity": 0.55 };
    case "modified":
      return { stroke: palette.modified, "stroke-opacity": 0.5 };
    case "removed":
      return { stroke: palette.removed, "stroke-dasharray": "4 3", "stroke-opacity": 0.6 };
    case "unchanged":
      return { stroke: palette.cardBorder };
    default:
      return assertNever(delta);
  }
};

export const cardAttributes = (delta: Delta, palette: Palette): Attributes => ({
  fill: palette.card,
  "stroke-width": 1,
  ...cardStroke(delta, palette),
});

const cardOpacity = (delta: Delta): number | undefined => {
  switch (delta) {
    case "removed":
      return 0.55;
    case "unchanged":
      return 0.82;
    case "added":
    case "modified":
      return undefined;
    default:
      return assertNever(delta);
  }
};

export const cardGroupAttributes = (delta: Delta, palette: Palette): Attributes => ({
  filter: `drop-shadow(0 1px 2px ${palette.shadow})`,
  opacity: cardOpacity(delta),
});

export const badgeColours = (tone: Tone, palette: Palette) => {
  switch (tone) {
    case "added":
      return { fill: palette.addedFill, stroke: palette.addedBorder, text: palette.addedText };
    case "modified":
      return { fill: palette.modifiedFill, stroke: palette.modifiedBorder, text: palette.modifiedText };
    case "removed":
      return { fill: palette.removedFill, stroke: palette.removedBorder, text: palette.removedText };
    case "neutral":
      return { fill: palette.neutralFill, stroke: palette.cardBorder, text: palette.muted };
    default:
      return assertNever(tone);
  }
};

const strokeAttributes = (delta: Delta, palette: Palette): Attributes => ({
  fill: "none",
  stroke: toneColour(palette, toneFor(delta)),
  "stroke-width": 1.5,
  "stroke-dasharray": delta === "removed" ? "5 4" : undefined,
  opacity: delta === "removed" ? 0.7 : undefined,
});

export const edgeAttributes = (edge: GraphEdge, palette: Palette): Attributes => {
  const attributes = {
    ...strokeAttributes(edge.delta, palette),
    ...(edge.delta === "unchanged" ? { opacity: 0.82 } : {}),
  };
  switch (edge.emphasis) {
    case "hero":
      return { ...attributes, "stroke-width": 2.25 };
    case "muted":
      return { ...attributes, opacity: 0.45 };
    case "normal":
      return attributes;
    default:
      return assertNever(edge.emphasis);
  }
};

export const messageAttributes = (message: FlowMessage, palette: Palette): Attributes => {
  const attributes = {
    ...strokeAttributes(message.delta, palette),
    "stroke-width": message.delta === "added" ? 2.25 : 1.5,
  };
  switch (message.kind) {
    case "return":
      return { ...attributes, "stroke-dasharray": "4 3", opacity: 0.8 };
    case "sync":
    case "async":
    case "self":
      return attributes;
    default:
      return assertNever(message.kind);
  }
};

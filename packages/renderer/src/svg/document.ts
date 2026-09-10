import type { Delta } from "@coldtea/pr-lens-schema";
import { assertNever } from "@coldtea/pr-lens-schema";
import { coord } from "../geometry.js";
import { SANS_STACK } from "../text.js";
import type { Canvas } from "../bounds.js";
import type { Palette } from "../theme.js";
import { escapeXml, lines, tag, wrap } from "./primitives.js";

/**
 * The colour family an element is drawn in. It follows the delta rather than
 * the element type, because the one question a reviewer asks of a diagram is
 * what changed.
 */
export type Tone = "added" | "modified" | "removed" | "neutral";

export const toneFor = (delta: Delta): Tone => {
  switch (delta) {
    case "added":
      return "added";
    case "modified":
      return "modified";
    case "removed":
      return "removed";
    case "unchanged":
      return "neutral";
    default:
      return assertNever(delta, "Unhandled delta");
  }
};

export const toneColour = (palette: Palette, tone: Tone): string => {
  switch (tone) {
    case "added":
      return palette.added;
    case "modified":
      return palette.modified;
    case "removed":
      return palette.removed;
    case "neutral":
      return palette.edge;
    default:
      return assertNever(tone, "Unhandled tone");
  }
};

const TONES = ["added", "modified", "removed", "neutral"] as const satisfies readonly Tone[];

/**
 * Two arrowhead forms per tone, the classic sequence-diagram pair: a filled
 * head for a message the sender waits on, an open line-form head for one it
 * fires and forgets. The open head anchors at its tip so the line runs all
 * the way into the point, where a filled head covers its own line end.
 */
const markers = (palette: Palette): string =>
  TONES.map(
    (tone) =>
      wrap(
        "marker",
        {
          id: `mk-${tone}`,
          viewBox: "0 0 10 10",
          refX: 8,
          refY: 5,
          markerWidth: 6.5,
          markerHeight: 6.5,
          orient: "auto-start-reverse",
        },
        tag("path", { d: "M0,0 L10,5 L0,10 z", fill: toneColour(palette, tone) }),
      ) +
      wrap(
        "marker",
        {
          id: `mko-${tone}`,
          viewBox: "0 0 10 10",
          refX: 10,
          refY: 5,
          markerWidth: 6.5,
          markerHeight: 6.5,
          orient: "auto-start-reverse",
        },
        tag("path", {
          d: "M2,1 L10,5 L2,9",
          fill: "none",
          stroke: toneColour(palette, tone),
          "stroke-width": 1.6,
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
        }),
      ),
  ).join("");

export const markerFor = (tone: Tone): string => `url(#mk-${tone})`;

export const openMarkerFor = (tone: Tone): string => `url(#mko-${tone})`;

const DOT_PITCH = 18;

/**
 * Wraps painted content in a standalone SVG file.
 *
 * Nothing outside the file is referenced: it is served through an image proxy
 * where the page it lands in does not exist, and it is served as an image, so
 * script would not run even if it were there. Colours are literal for the
 * same reason — the theme is chosen by picking a file, not by asking the page.
 */
export const svgDocument = (input: {
  width: number;
  height: number;
  palette: Palette;
  title: string;
  description?: string;
  body: string;
}): string => {
  const { width, height, palette, title, description, body } = input;

  const defs = wrap(
    "defs",
    {},
    wrap(
      "pattern",
      { id: "dots", width: DOT_PITCH, height: DOT_PITCH, patternUnits: "userSpaceOnUse" },
      tag("circle", { cx: 1.5, cy: 1.5, r: 1, fill: palette.dot }),
    ) + markers(palette),
  );

  return lines([
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${coord(width)} ${coord(height)}" ` +
      `width="${coord(width)}" height="${coord(height)}" role="img" aria-label="${escapeXml(title)}" ` +
      `font-family="${escapeXml(SANS_STACK)}">`,
    wrap("title", {}, escapeXml(title)),
    description === undefined ? "" : wrap("desc", {}, escapeXml(description)),
    defs,
    tag("rect", { x: 0, y: 0, width: coord(width), height: coord(height), rx: 12, fill: palette.background }),
    tag("rect", { x: 0, y: 0, width: coord(width), height: coord(height), rx: 12, fill: "url(#dots)" }),
    body,
    "</svg>",
  ]);
};

/**
 * Moves painted content clear of the canvas edge when something was drawn
 * above or to the left of the origin. Wrapping rather than re-deriving every
 * coordinate keeps the geometry — and so the bytes — unchanged whenever the
 * shift is zero, which is the ordinary case.
 */
export const shifted = (canvas: Canvas, body: string): string =>
  canvas.shiftX === 0 && canvas.shiftY === 0
    ? body
    : wrap("g", { transform: `translate(${coord(canvas.shiftX)},${coord(canvas.shiftY)})` }, body);

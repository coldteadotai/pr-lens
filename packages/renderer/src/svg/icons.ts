import type { NodeKind } from "@coldtea/pr-lens-schema";
import { assertNever } from "@coldtea/pr-lens-schema";
import { coord } from "../geometry.js";
import { MONO_STACK } from "../text.js";
import { lines, tag, textNode, wrap } from "./primitives.js";

const stroked = (path: string): string => tag("path", { class: "glyph-stroke", d: path });

const glyphText = (cx: number, cy: number, content: string, style: string): string =>
  textNode(
    {
      class: "glyph",
      x: coord(cx),
      y: coord(cy + 4.5),
      "text-anchor": "middle",
      style,
    },
    content,
  );

const box = (cx: number, cy: number, width: number, height: number, radius?: number): string =>
  tag("rect", {
    class: "glyph-stroke",
    x: coord(cx - width / 2),
    y: coord(cy - height / 2),
    width: coord(width),
    height: coord(height),
    rx: radius === undefined ? undefined : coord(radius),
  });

/**
 * The chip glyph for a node's kind, centred on a point.
 *
 * These say "what sort of thing is this" at a glance and nothing more, which
 * is why the kind enum is coarse. Every kind draws something: a card with an
 * empty chip reads as a rendering fault rather than as an unknown kind.
 */
const kindGlyph = (kind: NodeKind, cx: number, cy: number): string => {
  switch (kind) {
    case "service":
      return lines([
        box(cx, cy, 13, 13, 3),
        tag("circle", { class: "glyph", cx: coord(cx), cy: coord(cy), r: 2 }),
      ]);
    case "app":
      return lines([
        box(cx, cy, 14, 12, 2),
        stroked(`M${coord(cx - 7)},${coord(cy - 2)} h14`),
      ]);
    case "module":
      return glyphText(cx, cy, "{ }", `font-size:11px;font-family:${MONO_STACK}`);
    case "function":
      return glyphText(cx, cy, "ƒ", "font-size:14px;font-style:italic;font-family:Georgia,serif");
    case "route":
      return tag("path", {
        class: "glyph",
        d: `M${coord(cx - 7)},${coord(cy - 6)} L${coord(cx + 7)},${coord(cy)} L${coord(cx - 7)},${coord(cy + 6)} Z`,
      });
    case "job":
      return lines([
        tag("circle", { class: "glyph-stroke", cx: coord(cx), cy: coord(cy), r: 6.5 }),
        stroked(`M${coord(cx)},${coord(cy - 3.5)} V${coord(cy)} H${coord(cx + 3)}`),
      ]);
    case "queue":
      return lines([
        stroked(`M${coord(cx - 6.5)},${coord(cy - 4.5)} h13`),
        stroked(`M${coord(cx - 6.5)},${coord(cy)} h13`),
        stroked(`M${coord(cx - 6.5)},${coord(cy + 4.5)} h13`),
      ]);
    case "datastore":
      return lines([
        tag("ellipse", { class: "glyph-stroke", cx: coord(cx), cy: coord(cy - 4.5), rx: 6.5, ry: 2.6 }),
        stroked(
          `M${coord(cx - 6.5)},${coord(cy - 4.5)} v9 a6.5,2.6 0 0 0 13 0 v-9`,
        ),
      ]);
    case "cache":
      return tag("path", {
        class: "glyph",
        d: `M${coord(cx + 1)},${coord(cy - 7)} L${coord(cx - 6)},${coord(cy + 1)} H${coord(cx - 1)} L${coord(cx - 1)},${coord(cy + 7)} L${coord(cx + 6)},${coord(cy - 1)} H${coord(cx + 1)} Z`,
      });
    case "external":
      return lines([
        box(cx, cy, 16, 12, 2),
        stroked(`M${coord(cx - 8)},${coord(cy - 4)} l8,6 8,-6`),
      ]);
    case "ui":
      return lines([
        box(cx, cy, 14, 12, 2),
        stroked(`M${coord(cx - 2.5)},${coord(cy - 6)} v12`),
      ]);
    case "config":
      return lines([
        stroked(`M${coord(cx - 7)},${coord(cy - 4)} h14`),
        stroked(`M${coord(cx - 7)},${coord(cy + 4)} h14`),
        tag("circle", { class: "glyph", cx: coord(cx - 2), cy: coord(cy - 4), r: 2.2 }),
        tag("circle", { class: "glyph", cx: coord(cx + 3), cy: coord(cy + 4), r: 2.2 }),
      ]);
    case "test":
      return stroked(`M${coord(cx - 6)},${coord(cy)} l4,4 l8,-8`);
    case "package":
      return lines([
        stroked(
          `M${coord(cx)},${coord(cy - 7)} l6.5,3.5 v7 l-6.5,3.5 l-6.5,-3.5 v-7 Z`,
        ),
        stroked(`M${coord(cx - 6.5)},${coord(cy - 3.5)} l6.5,3.5 l6.5,-3.5`),
        stroked(`M${coord(cx)},${coord(cy)} v7`),
      ]);
    case "other":
      return lines([
        tag("circle", { class: "glyph", cx: coord(cx - 5), cy: coord(cy), r: 1.8 }),
        tag("circle", { class: "glyph", cx: coord(cx), cy: coord(cy), r: 1.8 }),
        tag("circle", { class: "glyph", cx: coord(cx + 5), cy: coord(cy), r: 1.8 }),
      ]);
    default:
      return assertNever(kind, "Unhandled node kind");
  }
};

export const glyphGroup = (kind: NodeKind, cx: number, cy: number): string =>
  wrap("g", {}, kindGlyph(kind, cx, cy));

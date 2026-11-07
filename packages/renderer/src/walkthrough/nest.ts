import { coord } from "../geometry.js";
import type { RenderedSvg } from "../render.js";

/** A render's painting placed inside another SVG. The outer document defines the markers it uses. */
export const nestedRender = (rendered: RenderedSvg, x: number, y: number): string =>
  `<svg x="${coord(x)}" y="${coord(y)}" width="${coord(rendered.width)}" height="${coord(rendered.height)}" viewBox="0 0 ${coord(rendered.width)} ${coord(rendered.height)}">${rendered.body}</svg>`;

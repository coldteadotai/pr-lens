import { assertNever, THEMES, THEME_PAIR, type Theme } from "@coldtea/pr-lens-schema";

/**
 * Every theme a render can target, and the two that make a GitHub
 * `<picture>` pair. A paired comment ships both halves and the client picks;
 * no render may depend on the page it lands in, because an SVG served as an
 * image cannot see it.
 *
 * The contract owns the pair, because its size is one half of the arithmetic
 * that bounds a document's view tree. Re-exported here so a caller rendering
 * a diagram does not have to reach into the schema for it.
 */
export { THEMES, THEME_PAIR, type Theme };

/**
 * Every colour the renderer can paint, resolved to a literal before it
 * reaches the document. CSS custom properties would be shorter, but GitHub
 * serves these files through an image proxy where nothing outside the file
 * exists, so the palette is baked in per theme.
 */
export type Palette = {
  background: string;
  dot: string;
  lane: string;
  card: string;
  cardBorder: string;
  foreground: string;
  muted: string;
  edge: string;
  chip: string;
  pill: string;
  pillBorder: string;
  lifeline: string;
  /** Strokes and text split per tone: on a light ground, a stroke bright
   * enough to pop is too pale for badge text. */
  added: string;
  addedText: string;
  addedFill: string;
  addedBorder: string;
  modified: string;
  modifiedText: string;
  modifiedFill: string;
  modifiedBorder: string;
  removed: string;
  removedText: string;
  removedFill: string;
  removedBorder: string;
  neutralFill: string;
  shadow: string;
};

const LIGHT: Palette = {
  background: "#f4f5f7",
  dot: "rgba(140,149,159,.5)",
  lane: "rgba(255,255,255,.55)",
  card: "#ffffff",
  cardBorder: "#d1d9e0",
  foreground: "#1f2328",
  muted: "#59636e",
  edge: "#8c959f",
  chip: "#f1f3f5",
  pill: "#ffffff",
  pillBorder: "#d8dee4",
  lifeline: "#d1d9e0",
  added: "#1f883d",
  addedText: "#116329",
  addedFill: "#b9f0c4",
  addedBorder: "rgba(31,136,61,.55)",
  modified: "#bf8700",
  modifiedText: "#7d4e00",
  modifiedFill: "#fae17d",
  modifiedBorder: "rgba(154,103,0,.55)",
  removed: "#cf222e",
  removedText: "#a40e26",
  removedFill: "#ffcecb",
  removedBorder: "rgba(207,34,46,.5)",
  neutralFill: "#f1f3f5",
  shadow: "rgba(31,35,40,.14)",
};

const DARK: Palette = {
  background: "#0d1117",
  dot: "rgba(110,118,129,.22)",
  lane: "rgba(110,118,129,.07)",
  card: "#1c2128",
  cardBorder: "#3d444d",
  foreground: "#e6edf3",
  muted: "#9198a1",
  edge: "#6e7681",
  chip: "rgba(110,118,129,.18)",
  pill: "#0d1117",
  pillBorder: "#21262d",
  lifeline: "#30363d",
  added: "#3fb950",
  addedText: "#3fb950",
  addedFill: "rgba(46,160,67,.15)",
  addedBorder: "rgba(63,185,80,.4)",
  modified: "#d29922",
  modifiedText: "#d29922",
  modifiedFill: "rgba(187,128,9,.15)",
  modifiedBorder: "rgba(210,153,34,.4)",
  removed: "#f85149",
  removedText: "#f85149",
  removedFill: "rgba(248,81,73,.12)",
  removedBorder: "rgba(248,81,73,.4)",
  neutralFill: "rgba(110,118,129,.18)",
  shadow: "rgba(0,0,0,.28)",
};

/**
 * The one render for a surface that shows a single image and cannot swap on
 * the reader's theme — GitLab and Bitbucket both.
 *
 * Handing such a surface the light asset is what it used to do, and it put a
 * glaring white rectangle in front of every dark-mode reader, with strokes
 * tuned for a light ground washing out against a dark page.
 *
 * A transparent render does not solve it either, and the arithmetic says why:
 * for any flat colour, contrast against white is `1.05 / (L + 0.05)` and
 * against black is `(L + 0.05) / 0.05`, which are equal only at L ≈ 0.179,
 * where both are 4.58:1. That is the ceiling for text meant to sit directly
 * on either page — barely over AA in the best case, and under it against a
 * near-black like #0d1117.
 *
 * So this render is opaque and self-contained: it brings its own ground, and
 * every contrast ratio inside it is fixed regardless of where it lands. The
 * ground is dimmed rather than light — on a dark page it sits naturally, and
 * on a light page it reads as a deliberately dark figure, the way a
 * screenshot or a code block does. Its border is visible against both, so it
 * never bleeds into the page.
 */
const NEUTRAL: Palette = {
  background: "#22272e",
  dot: "rgba(144,157,171,.2)",
  lane: "rgba(144,157,171,.06)",
  card: "#2d333b",
  cardBorder: "#444c56",
  foreground: "#cdd9e5",
  muted: "#909dab",
  edge: "#768390",
  chip: "rgba(144,157,171,.16)",
  pill: "#22272e",
  pillBorder: "#373e47",
  lifeline: "#444c56",
  added: "#57ab5a",
  addedText: "#6bc46d",
  addedFill: "rgba(70,149,74,.18)",
  addedBorder: "rgba(87,171,90,.45)",
  modified: "#c69026",
  modifiedText: "#daaa3f",
  modifiedFill: "rgba(174,124,20,.18)",
  modifiedBorder: "rgba(198,144,38,.45)",
  removed: "#e5534b",
  removedText: "#ff938a",
  removedFill: "rgba(229,83,75,.14)",
  removedBorder: "rgba(229,83,75,.45)",
  neutralFill: "rgba(144,157,171,.16)",
  shadow: "rgba(0,0,0,.3)",
};

export const paletteFor = (theme: Theme): Palette => {
  switch (theme) {
    case "light":
      return LIGHT;
    case "dark":
      return DARK;
    case "neutral":
      return NEUTRAL;
    default:
      return assertNever(theme, "Unhandled theme");
  }
};

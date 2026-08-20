import { assertNever } from "@coldtea/pr-lens-schema";

/**
 * The two halves of a GitHub `<picture>` pair. A comment ships both and the
 * client picks; neither half may depend on the page it lands in, because an
 * SVG served as an image cannot see it.
 */
export type Theme = "light" | "dark";

export const THEMES = ["light", "dark"] as const satisfies readonly Theme[];

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
  added: string;
  addedFill: string;
  addedBorder: string;
  modified: string;
  modifiedFill: string;
  modifiedBorder: string;
  removed: string;
  removedFill: string;
  removedBorder: string;
  neutralFill: string;
  shadow: string;
};

const LIGHT: Palette = {
  background: "#ffffff",
  dot: "rgba(140,149,159,.35)",
  lane: "#f6f8fa",
  card: "#ffffff",
  cardBorder: "#d1d9e0",
  foreground: "#1f2328",
  muted: "#59636e",
  edge: "#8c959f",
  chip: "#f6f8fa",
  pill: "#ffffff",
  pillBorder: "#d8dee4",
  lifeline: "#d1d9e0",
  added: "#1a7f37",
  addedFill: "#dafbe1",
  addedBorder: "rgba(31,136,61,.4)",
  modified: "#9a6700",
  modifiedFill: "#fff8c5",
  modifiedBorder: "rgba(154,103,0,.35)",
  removed: "#d1242f",
  removedFill: "#ffebe9",
  removedBorder: "rgba(209,36,47,.35)",
  neutralFill: "#f6f8fa",
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
  addedFill: "rgba(46,160,67,.15)",
  addedBorder: "rgba(63,185,80,.4)",
  modified: "#d29922",
  modifiedFill: "rgba(187,128,9,.15)",
  modifiedBorder: "rgba(210,153,34,.4)",
  removed: "#f85149",
  removedFill: "rgba(248,81,73,.12)",
  removedBorder: "rgba(248,81,73,.4)",
  neutralFill: "rgba(110,118,129,.18)",
  shadow: "rgba(0,0,0,.28)",
};

export const paletteFor = (theme: Theme): Palette => {
  switch (theme) {
    case "light":
      return LIGHT;
    case "dark":
      return DARK;
    default:
      return assertNever(theme, "Unhandled theme");
  }
};

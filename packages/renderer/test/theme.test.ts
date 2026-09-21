import { describe, expect, it } from "vitest";

import { paletteFor, THEMES, THEME_PAIR, type Palette } from "../src/theme.js";

/** WCAG relative luminance, on an opaque sRGB hex. */
const luminance = (hex: string): number => {
  const parsed = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (parsed === null) throw new Error(`not an opaque hex colour: ${hex}`);
  const channels = [0, 2, 4].map((at) => Number.parseInt(parsed[1]!.slice(at, at + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
};

const contrast = (a: string, b: string): number => {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter! + 0.05) / (darker! + 0.05);
};

/** The two grounds a comment can land on: a white page and GitHub/GitLab dark. */
const PAGE_LIGHT = "#ffffff";
const PAGE_DARK = "#0d1117";

const AA_TEXT = 4.5;
/** WCAG's threshold for a UI boundary rather than body text. */
const AA_NON_TEXT = 3;

describe("contrast inside a palette", () => {
  for (const theme of THEMES) {
    const palette: Palette = paletteFor(theme);

    it(`${theme}: body text clears AA against its own ground`, () => {
      expect(contrast(palette.foreground, palette.background)).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrast(palette.foreground, palette.card)).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it(`${theme}: muted text is still readable, not decorative`, () => {
      expect(contrast(palette.muted, palette.background)).toBeGreaterThanOrEqual(AA_NON_TEXT);
      expect(contrast(palette.muted, palette.card)).toBeGreaterThanOrEqual(AA_NON_TEXT);
    });

    it(`${theme}: a card is distinguishable from the ground it sits on`, () => {
      expect(contrast(palette.cardBorder, palette.card)).toBeGreaterThan(1.2);
    });
  }
});

describe("the neutral render", () => {
  const neutral = paletteFor("neutral");

  it("is not one of the paired themes", () => {
    // It replaces the pair for a single-image surface. Aliasing it to light
    // would put the bug it exists to fix straight back.
    expect(THEME_PAIR as readonly string[]).not.toContain("neutral");
    expect(neutral.background).not.toBe(paletteFor("light").background);
    expect(neutral.background).not.toBe(paletteFor("dark").background);
  });

  it("brings its own opaque ground, because no flat colour reads on both pages", () => {
    // The ceiling for text sitting directly on both a white and a black page
    // is 4.58:1, at L ≈ 0.179 — and against #0d1117 rather than pure black it
    // falls under AA. So the render cannot be transparent; it has to carry a
    // ground, and every ratio inside it is then fixed wherever it lands.
    expect(neutral.background).toMatch(/^#[0-9a-f]{6}$/i);
    const bestPossibleOnBothPages = Math.min(
      (1.05) / (0.1791 + 0.05),
      (0.1791 + 0.05) / (luminance(PAGE_DARK) + 0.05),
    );
    expect(bestPossibleOnBothPages).toBeLessThan(AA_TEXT);
  });

  it("stays visible against a light page and a dark one alike", () => {
    // Not text contrast — the panel only has to be seen as a panel, so it
    // never bleeds into whichever page it is posted on.
    expect(contrast(neutral.background, PAGE_LIGHT)).toBeGreaterThanOrEqual(AA_NON_TEXT);
    expect(contrast(neutral.cardBorder, neutral.background)).toBeGreaterThan(1.2);
    // Against a dark page the ground is close by design; the border is what
    // keeps an edge there.
    expect(contrast(neutral.cardBorder, PAGE_DARK)).toBeGreaterThan(1.5);
  });

  it("does not reuse the light palette's ratios, which were tuned for a light page", () => {
    const light = paletteFor("light");
    expect(contrast(light.foreground, light.background)).toBeGreaterThanOrEqual(AA_TEXT);
    // The light render on a dark page is the defect: its own ground is the
    // thing readers see, and it is a bright rectangle.
    expect(contrast(light.background, PAGE_DARK)).toBeGreaterThan(AA_TEXT);
    expect(contrast(neutral.background, PAGE_DARK)).toBeLessThan(
      contrast(light.background, PAGE_DARK),
    );
  });
});

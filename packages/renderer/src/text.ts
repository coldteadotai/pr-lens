import { assertNever } from "@coldtea/pr-lens-schema";

/**
 * The renderer never asks a font engine how wide a string is: it must produce
 * the same geometry on a CI runner with no fonts installed as on a laptop
 * with all of them. Widths come from a table instead, and every box is sized
 * with enough slack that the small error against a real face stays invisible.
 */
export type Face = "sans" | "sans-bold" | "mono";

export const SANS_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif';
export const MONO_STACK =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

/** Advance widths per 1000 units of em, for the regular sans face. */
const SANS_ADVANCE: Readonly<Record<string, number>> = {
  " ": 278, "!": 278, '"': 355, "#": 556, $: 556, "%": 889, "&": 667, "'": 191,
  "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
  "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556, "7": 556,
  "8": 556, "9": 556, ":": 278, ";": 278, "<": 584, "=": 584, ">": 584, "?": 556,
  "@": 1015, A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722,
  I: 278, J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722,
  S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611, "[": 278,
  "\\": 278, "]": 278, "^": 469, _: 556, "`": 333, a: 556, b: 556, c: 500, d: 556,
  e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833, n: 556,
  o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500,
  y: 500, z: 500, "{": 334, "|": 260, "}": 334, "~": 584,
};

/** What a character outside the table is assumed to cost, in the same units. */
const FALLBACK_ADVANCE = 600;

/**
 * The bold face of the same family runs a little wider at every weight step.
 * One factor over the regular table is close enough for boxes that already
 * carry padding, and it keeps a second table from drifting out of sync.
 */
const BOLD_WIDENING = 1.06;

const MONO_ADVANCE = 600;

const advanceFor = (face: Face, character: string): number => {
  switch (face) {
    case "sans":
      return SANS_ADVANCE[character] ?? FALLBACK_ADVANCE;
    case "sans-bold":
      return (SANS_ADVANCE[character] ?? FALLBACK_ADVANCE) * BOLD_WIDENING;
    case "mono":
      return MONO_ADVANCE;
    default:
      return assertNever(face, "Unhandled font face");
  }
};

/** Width of `text` in user units at `fontSize`, to a hundredth of a unit. */
export const measure = (text: string, face: Face, fontSize: number): number => {
  let thousandths = 0;
  for (const character of text) thousandths += advanceFor(face, character);
  return Math.round((thousandths / 1000) * fontSize * 100) / 100;
};

const ELLIPSIS = "…";

/**
 * Shortens `text` until it fits `maxWidth`, ellipsis included. Cutting by
 * code point rather than by UTF-16 unit keeps a surrogate pair from being
 * split into a replacement character.
 */
export const truncate = (
  text: string,
  face: Face,
  fontSize: number,
  maxWidth: number,
): string => {
  if (measure(text, face, fontSize) <= maxWidth) return text;

  const characters = [...text];
  const ellipsisWidth = measure(ELLIPSIS, face, fontSize);
  let width = 0;
  let kept = 0;

  for (const character of characters) {
    const next = width + measure(character, face, fontSize);
    if (next + ellipsisWidth > maxWidth) break;
    width = next;
    kept += 1;
  }

  if (kept === 0) return ELLIPSIS;
  return `${characters.slice(0, kept).join("").trimEnd()}${ELLIPSIS}`;
};

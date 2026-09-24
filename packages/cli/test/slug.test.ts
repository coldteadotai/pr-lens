import { expect, test } from "vitest";

import { FALLBACK_SLUG, slugify } from "../src/slug.js";

test("makes a readable directory name out of a title", () => {
  expect(slugify("Batch broadcast sending through Postmark")).toBe(
    "batch-broadcast-sending-through-postmark",
  );
  expect(slugify("Auth flow")).toBe("auth-flow");
});

test("keeps the letters out of a title that is not plain English", () => {
  // Decomposed and stripped, so a title stays recognisable rather than
  // becoming a row of hyphens.
  expect(slugify("Café résumé")).toBe("cafe-resume");
});

test("never produces a path separator", () => {
  // A title is free text and this is a path segment. A slash would write the
  // drawing somewhere nobody asked for.
  expect(slugify("auth/flow")).toBe("auth-flow");
  expect(slugify("a\\b")).toBe("a-b");
  expect(slugify("../../etc/passwd")).toBe("etc-passwd");
});

test("never produces a name the filesystem already means something by", () => {
  expect(slugify(".")).toBe(FALLBACK_SLUG);
  expect(slugify("..")).toBe(FALLBACK_SLUG);
  expect(slugify("...")).toBe(FALLBACK_SLUG);
  expect(slugify("")).toBe(FALLBACK_SLUG);
  expect(slugify("   ")).toBe(FALLBACK_SLUG);
  expect(slugify("🎨")).toBe(FALLBACK_SLUG);
});

test("does not start or end on a hyphen", () => {
  expect(slugify("  Auth flow  ")).toBe("auth-flow");
  expect(slugify("--auth--flow--")).toBe("auth-flow");
});

test("stays short enough to leave room in a path", () => {
  const slug = slugify("a".repeat(120));

  expect(slug.length).toBeLessThanOrEqual(48);
  expect(slug.endsWith("-")).toBe(false);
});

test("cuts a long title without leaving a trailing hyphen", () => {
  // The slice can land on one the trim had already removed.
  const slug = slugify(`${"word ".repeat(20)}end`);

  expect(slug.endsWith("-")).toBe(false);
  expect(slug.length).toBeLessThanOrEqual(48);
});

test("two documents with the same title are the same drawing", () => {
  // Deliberately not unique: a redraw should land on the directory and the
  // canvas it landed on last time.
  expect(slugify("Auth flow")).toBe(slugify("Auth  flow"));
});

/**
 * Whatever the title, the result is one plain path segment.
 *
 * A seeded generator rather than a library: the property is small, and the
 * inputs that matter — separators, dots, reserved words, marks, emoji — are
 * listed so every run visits them, with random noise around and between.
 */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

const PIECES = [
  "/", "\\", ".", "..", "...", " ", "-", "_", "~", ":", "*", "?", '"', "<", ">", "|",
  "\0", "\n", "\t", "é", "ß", "ø", "日本", "🎨", "́", "​", "‮",
  "CON", "aux", "NUL", "com1", "LPT9", "Auth", "flow", "0", "9", "a".repeat(60),
];

const seeded = (seed: number) => (): number => {
  seed = (seed * 1_103_515_245 + 12_345) & 0x7fff_ffff;
  return seed / 0x7fff_ffff;
};

const titleFrom = (random: () => number): string => {
  const parts = Math.floor(random() * 8);
  let title = "";
  for (let index = 0; index < parts; index += 1) {
    title += random() < 0.7
      ? PIECES[Math.floor(random() * PIECES.length)]
      : String.fromCodePoint(Math.floor(random() * 0x2fff) + 1);
  }
  return title;
};

test("never emits a separator, a reserved name, or anything but a plain segment", () => {
  const random = seeded(20260924);
  const titles = [...PIECES, ...Array.from({ length: 5_000 }, () => titleFrom(random))];

  for (const title of titles) {
    const slug = slugify(title);

    expect(slug, JSON.stringify(title)).toMatch(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/);
    expect(slug.length, JSON.stringify(title)).toBeLessThanOrEqual(48);
    expect(slug, JSON.stringify(title)).not.toBe(".");
    expect(slug, JSON.stringify(title)).not.toBe("..");
    // `.pr-lens/con/` cannot be created on Windows, and this CLI reads
    // `USERPROFILE`, so Windows is a place it expects to run.
    expect(slug, JSON.stringify(title)).not.toMatch(RESERVED);
  }
});

test("a title that is a device name on Windows still gets a directory", () => {
  for (const title of ["CON", "aux", "Nul", "com1", "LPT9", "prn"]) {
    expect(slugify(title)).not.toMatch(RESERVED);
    // Still recognisable, rather than falling all the way to the fallback.
    expect(slugify(title)).toContain(title.toLowerCase());
  }
});

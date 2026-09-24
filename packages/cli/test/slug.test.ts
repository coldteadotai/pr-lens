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

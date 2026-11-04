import { createHash } from "node:crypto";
import { slugify as transliteratedSlug } from "transliteration";

/**
 * Deliberately not unique: the same title is the same drawing redrawn, and
 * should land on the same directory and canvas.
 */

const MAX_LENGTH = 48;

export const FALLBACK_SLUG = "drawing";

const asciiSlug = (title: string, maxLength = MAX_LENGTH): string =>
  title
    .normalize("NFKD")
    // Combining marks left by NFKD.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/, "");

export function slugify(title: string): string {
  const slug = asciiSlug(title);
  // Windows cannot create a directory named after a device, such as `con`.
  if (slug === "") return FALLBACK_SLUG;
  return WINDOWS_DEVICE.test(slug) ? `${slug}-${FALLBACK_SLUG}` : slug;
}

export const unicodeFallbackSlug = (title: string): string | undefined => {
  if (asciiSlug(title) !== "" || !/[\p{L}\p{N}]/u.test(title)) return undefined;

  // Different titles can have the same transliteration.
  const suffix = createHash("sha256").update(title).digest("hex").slice(0, 16);
  const prefix = asciiSlug(transliteratedSlug(title), MAX_LENGTH - suffix.length - 1);
  return `${prefix || FALLBACK_SLUG}-${suffix}`;
};

const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

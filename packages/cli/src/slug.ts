/**
 * Deliberately not unique: the same title is the same drawing redrawn, and
 * should land on the same directory and canvas.
 */

const MAX_LENGTH = 48;

export const FALLBACK_SLUG = "drawing";

export function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    // Combining marks left by NFKD.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_LENGTH)
    .replace(/-+$/, "");

  // Windows cannot create a directory named after a device, such as `con`.
  if (slug === "") return FALLBACK_SLUG;
  return WINDOWS_DEVICE.test(slug) ? `${slug}-${FALLBACK_SLUG}` : slug;
}

const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

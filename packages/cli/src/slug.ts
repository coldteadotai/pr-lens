/**
 * A document's title as a directory name.
 *
 * Each drawing gets its own directory under `.pr-lens/`, and the title is the
 * only thing about a document that names it the way a person would. The
 * result is a path segment, so what matters is that it holds no separator and
 * nothing a shell or a filesystem treats specially — the rest is legibility.
 *
 * Not unique, and not trying to be: two documents with the same title are the
 * same drawing redrawn, which is exactly the case that should land on the
 * same directory and the same canvas.
 */

/** Long enough to stay readable, short enough to leave room inside a path. */
const MAX_LENGTH = 48;

/** Used when a title is empty, or is made entirely of characters that fall away. */
export const FALLBACK_SLUG = "drawing";

export function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    // Marks left behind by the decomposition above: "é" is "e" and one of these.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_LENGTH)
    // The slice can leave a trailing hyphen the trim above already removed.
    .replace(/-+$/, "");

  /*
   * Reserved names, refused rather than escaped.
   *
   * "." and ".." are directories that already exist and are not this one;
   * a title of "..." reduces to neither but is still nothing to name a
   * directory. Windows keeps a handful of words for devices — `.pr-lens/con/`
   * cannot be created there at all — so those get a suffix and stay readable.
   * Anything that survives to here is a plain segment.
   */
  if (slug === "") return FALLBACK_SLUG;
  return WINDOWS_DEVICE.test(slug) ? `${slug}-${FALLBACK_SLUG}` : slug;
}

const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

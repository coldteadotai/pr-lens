/**
 * Stamped into every render manifest so a stored diagram can be traced to the
 * code that drew it. Kept in step with package.json by a test, since a
 * package cannot read its own manifest without doing I/O the renderer does
 * not otherwise need.
 */
export const RENDERER_NAME = "@coldtea/pr-lens-renderer";

export const RENDERER_VERSION = "0.1.1";

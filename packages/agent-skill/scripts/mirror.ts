import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readdir } from "node:fs/promises";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The files under `packages/agent-skill` that every other copy follows. */
export const SKILL_SOURCE_DIR = packageRoot;

/**
 * The copy `npx skills add coldteadotai/pr-lens` installs. The installer
 * reaches `skills/<name>/` before any SKILL.md nested deeper, then copies that
 * folder whole. So this directory may hold nothing a user should not receive:
 * a package.json, a tsconfig, or a test file placed here lands in their
 * repository, and a test file lands where their own runner will try to run it.
 */
export const SKILL_MIRROR_DIR = join(packageRoot, "..", "..", "skills", "pr-lens");

const REFERENCES = "references";

/**
 * What a user receives, as paths relative to a skill root. The reference pages
 * are read from disk rather than listed here, so adding one carries it into
 * the mirror without anyone having to remember this file.
 */
export const skillFiles = async (root: string): Promise<readonly string[]> => {
  const references = await readdir(join(root, REFERENCES));

  return ["LICENSE", "SKILL.md", ...references.sort().map((name) => `${REFERENCES}/${name}`)];
};

/** Every file actually present under `dir`, relative and slash-separated. */
export const filesPresent = async (dir: string, prefix = ""): Promise<readonly string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });

  const found = await Promise.all(
    entries.map(async (entry) => {
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      return entry.isDirectory() ? filesPresent(join(dir, entry.name), path) : [path];
    }),
  );

  return found.flat().sort();
};

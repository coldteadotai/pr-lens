/**
 * Rewrites the root-level `skills/pr-lens/` from this package, which is the
 * only copy the skills.sh installer hands a user. A drift test fails until
 * this has been run, so the two never disagree.
 *
 *   pnpm skill:sync
 */
import { dirname, join } from "node:path";
import { cp, mkdir, rm } from "node:fs/promises";
import { filesPresent, skillFiles, SKILL_MIRROR_DIR, SKILL_SOURCE_DIR } from "./mirror.js";

const wanted = await skillFiles(SKILL_SOURCE_DIR);

await rm(SKILL_MIRROR_DIR, { recursive: true, force: true });

for (const file of wanted) {
  const destination = join(SKILL_MIRROR_DIR, file);
  await mkdir(dirname(destination), { recursive: true });
  await cp(join(SKILL_SOURCE_DIR, file), destination);
}

console.log((await filesPresent(SKILL_MIRROR_DIR)).map((file) => `  ${file}`).join("\n"));

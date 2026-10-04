import { join } from "node:path";
import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { filesPresent, SKILL_FILES, SKILL_MIRROR_DIR, SKILL_SOURCE_DIR } from "../scripts/mirror.js";

test("the skill a user installs holds the stub and its license, and nothing else", async () => {
  expect(await filesPresent(SKILL_MIRROR_DIR)).toEqual([...SKILL_FILES].sort());
});

test("every installed file is byte-identical to the one it came from", async () => {
  for (const file of SKILL_FILES) {
    const [source, mirrored] = await Promise.all([
      readFile(join(SKILL_SOURCE_DIR, file)),
      readFile(join(SKILL_MIRROR_DIR, file)),
    ]);

    expect(mirrored.equals(source), `${file} is stale; run pnpm skill:sync`).toBe(true);
  }
});

test("no packaging a user's own tooling would trip over ships with the skill", async () => {
  const installed = await filesPresent(SKILL_MIRROR_DIR);

  expect(installed).not.toContain("package.json");
  expect(installed).not.toContain("tsconfig.json");
  expect(installed).not.toContain("vitest.config.ts");
  expect(installed.some((file) => file.endsWith(".test.ts"))).toBe(false);
});

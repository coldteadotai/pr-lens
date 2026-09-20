import { SCHEMA_VERSION } from "@coldtea/pr-lens-schema";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { CONFIG_PATHS, discoverConfig } from "../src/config-file.js";

const roots: string[] = [];

const repository = async (configs: readonly string[]): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "pr-lens-config-"));
  roots.push(root);
  for (const relative of configs) {
    const path = join(root, relative);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `schemaVersion: ${SCHEMA_VERSION}\n`, "utf8");
  }
  return root;
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test.each(CONFIG_PATHS)("%s is discovered on its own", async (candidate) => {
  const root = await repository([candidate]);
  const found = await discoverConfig(root);
  expect(found?.path).toBe(join(root, candidate));
});

test("the .github spelling wins over every later location", async () => {
  const root = await repository([".github/pr-lens.yml", ".gitlab/pr-lens.yml", "pr-lens.yml"]);
  const found = await discoverConfig(root);
  expect(found?.path).toBe(join(root, ".github/pr-lens.yml"));
});

test(".gitlab wins over the root spelling", async () => {
  const root = await repository([".gitlab/pr-lens.yaml", "pr-lens.yml"]);
  const found = await discoverConfig(root);
  expect(found?.path).toBe(join(root, ".gitlab/pr-lens.yaml"));
});

test("a repository without a config gets none", async () => {
  const root = await repository([]);
  expect(await discoverConfig(root)).toBeUndefined();
});

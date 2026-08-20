import type { Config } from "@coldtea/pr-lens-schema";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { readConfig } from "./document.js";

/** Where a repository puts its corrections, in the order they are looked for. */
export const CONFIG_PATHS = [".github/pr-lens.yml", ".github/pr-lens.yaml"] as const;

export type LoadedConfig = { path: string; config: Config };

export const loadConfig = async (path: string): Promise<LoadedConfig> => ({
  path,
  config: await readConfig(path),
});

export const discoverConfig = async (root: string): Promise<LoadedConfig | undefined> => {
  for (const candidate of CONFIG_PATHS) {
    const path = join(root, candidate);
    const found = await access(path).then(
      () => true,
      () => false,
    );
    if (found) return loadConfig(path);
  }
  return undefined;
};

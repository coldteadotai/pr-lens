import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { CLI_VERSION } from "../src/version.js";

test("the version stamped on documents is the version that shipped", async () => {
  const manifest: unknown = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  expect(manifest).toMatchObject({ version: CLI_VERSION });
  expect(CLI_VERSION).toBe("0.3.0");
});

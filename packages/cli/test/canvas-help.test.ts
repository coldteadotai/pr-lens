import { expect, test } from "vitest";

import { setupCanvasTest } from "./helpers/canvas.js";

const { output, invoke } = setupCanvasTest();

test("canvas --help and canvas push --help both print the usage", async () => {
  expect(await invoke("canvas", "--help")).toBe(0);
  expect(output.out.join("\n")).toContain("pr-lens canvas push");

  output.out = [];
  expect(await invoke("canvas", "push", "--help")).toBe(0);
  expect(output.out.join("\n")).toContain("--canvas <id|name>");
});

test("a subcommand that is not one is a misuse", async () => {
  expect(await invoke("canvas", "publish")).toBe(2);
  const reported = output.err.join("\n");
  expect(reported).toContain('unknown canvas subcommand "publish"');
  expect(reported).toContain("pr-lens canvas <push | pull | rotate | delete>");
});

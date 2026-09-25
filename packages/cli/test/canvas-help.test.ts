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
  expect(reported).toContain(
    "pr-lens canvas <list | push | pull | claim | rotate | delete | open | answer | show | fork | look>",
  );
});

/**
 * Scoped to `push`, whose flags all take a value: an unknown one is refused by
 * the parser, a known one only lacks its value, and neither reaches the
 * network. The whole usage would also name `--remote`, which is `list`'s.
 */
test("the usage names no push flag the push parser refuses", async () => {
  expect(await invoke("canvas", "--help")).toBe(0);
  const usage = output.out.join("\n");

  const block = usage.slice(
    usage.indexOf("pr-lens canvas push"),
    usage.indexOf("pr-lens canvas pull"),
  );
  const named = [...new Set(block.match(/(?<=\s)--[a-z][a-z-]*/g) ?? [])];
  expect(named).toContain("--canvas");
  expect(named.length).toBeGreaterThan(1);

  for (const flag of named) {
    output.err = [];
    // No `--help`: it is answered before parsing, so everything would pass.
    await invoke("canvas", "push", flag);
    expect(output.err.join("\n"), `${flag} is named in the usage`).not.toContain(
      "Unknown option",
    );
  }
});

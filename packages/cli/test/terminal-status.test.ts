import { expect, test } from "vitest";

import { processTerminal } from "../src/terminal.js";

/**
 * A no-op `status` would still read as "can rewrite", so the static sentence
 * would be skipped and a pipe would get neither. Vitest's stderr is not a TTY.
 */
test("a terminal that cannot rewrite a line says so by having no status", () => {
  expect(process.stderr.isTTY).toBeFalsy();
  expect(processTerminal.status).toBeUndefined();
});

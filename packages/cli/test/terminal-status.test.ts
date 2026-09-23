import { expect, test } from "vitest";

import { processTerminal } from "../src/terminal.js";

/**
 * `status` must be absent without a TTY, not present and inert.
 *
 * A no-op function is still a defined property, so a caller asking "can this
 * terminal rewrite a line?" is told yes, skips the static sentence it would
 * print instead, and the no-op writes nothing — leaving a pipe with neither.
 * This test runs under vitest, where stderr is not a TTY.
 */
test("a terminal that cannot rewrite a line says so by having no status", () => {
  expect(process.stderr.isTTY).toBeFalsy();
  expect(processTerminal.status).toBeUndefined();
});

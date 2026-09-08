import { expect, test } from "vitest";
import { readFile, writeFile } from "node:fs/promises";

import { API, GOLDEN, REGISTRY } from "./helpers/canvas.js";
import { FIRST, TOKEN1, setupCanvasAppTest } from "./helpers/canvas-app.js";

const { output, app, invoke, registry, createCheckout } = setupCanvasAppTest();

test("rotate mints the next token here, and the old one stops opening the door", async () => {
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(
    0,
  );
  output.out = [];
  app.seen = [];

  expect(await invoke("canvas", "rotate", "--api", API)).toBe(0);

  const next = (await registry())[FIRST]?.writeToken;
  expect(next).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(next).not.toBe(TOKEN1);
  expect((await registry())[FIRST]).not.toHaveProperty("pending");
  expect(output.out).toEqual([
    `✓ new edit link for ${API}/c/${FIRST}: ${API}/c/${FIRST}#w=${next}`,
    "  the old edit link no longer works",
  ]);
  expect(app.seen[0]?.headers.get("authorization")).toBe(`Bearer ${TOKEN1}`);
  expect(app.seen[0]?.body).toEqual({ writeToken: next });

  // The app now knows only the new token, and the registry sends that one.
  output.out = [];
  app.seen = [];
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(
    0,
  );
  expect(app.seen[0]?.headers.get("authorization")).toBe(`Bearer ${next}`);
});

test("a rotation whose answer was lost is finished by the next command", async () => {
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(
    0,
  );
  app.loseNextAnswer = true;

  expect(await invoke("canvas", "rotate", "--api", API)).toBe(1);
  expect(output.err.join("\n")).toContain("the rotation is not finished");

  const pending = (await registry())[FIRST];
  expect(pending?.writeToken).toBe(TOKEN1);
  expect(pending?.pending).toMatch(/^[A-Za-z0-9_-]{22}$/);

  output.err = [];
  app.seen = [];
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(
    0,
  );
  expect(
    app.seen.map((request) => [
      request.method,
      request.path.endsWith("/rotate"),
    ]),
  ).toEqual([
    ["POST", true],
    ["PUT", false],
  ]);
  const settled = (await registry())[FIRST];
  expect(settled?.writeToken).toBe(pending?.pending);
  expect(settled).not.toHaveProperty("pending");
  expect(app.seen[1]?.headers.get("authorization")).toBe(
    `Bearer ${settled?.writeToken}`,
  );
});

test("rotate prints the link the app answered with, not one guessed from --api", async () => {
  expect(
    await invoke("canvas", "push", "drawn.graph.json", "--api", `${API}/`),
  ).toBe(0);
  output.out = [];

  expect(await invoke("canvas", "rotate", "--api", `${API}/`)).toBe(0);
  const next = (await registry())[FIRST]?.writeToken;
  expect(output.out[0]).toBe(
    `✓ new edit link for ${API}/c/${FIRST}: ${API}/c/${FIRST}#w=${next}`,
  );
});

test("rotate on a canvas pulled by its view link leaves nothing pending behind", async () => {
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(
    0,
  );
  const fresh = await createCheckout();
  process.chdir(fresh);
  expect(await invoke("canvas", "pull", `${API}/c/${FIRST}`)).toBe(0);

  expect(await invoke("canvas", "rotate", "--api", API)).toBe(1);
  expect(output.err.join("\n")).toContain("[CANVAS_UNREGISTERED]");
  expect((await registry())[FIRST]).not.toHaveProperty("pending");

  // The edit link arrives later; nothing retires it on the next push. (The
  // pull itself proves the token with a rotation onto itself, which is not
  // a rotation; the push after it must send none at all.)
  expect(await invoke("canvas", "pull", `${API}/c/${FIRST}#w=${TOKEN1}`)).toBe(
    0,
  );
  await writeFile("drawn.graph.json", await readFile(GOLDEN, "utf8"), "utf8");
  app.seen = [];
  expect(
    await invoke(
      "canvas",
      "push",
      "drawn.graph.json",
      "--canvas",
      FIRST,
      "--api",
      API,
    ),
  ).toBe(0);
  expect(
    app.seen.map((request) => [
      request.method,
      request.path.endsWith("/rotate"),
    ]),
  ).toEqual([["PUT", false]]);
  expect(app.seen[0]?.headers.get("authorization")).toBe(`Bearer ${TOKEN1}`);
});

test("a rotation the app has refused for good is dropped, not carried out by a later pen", async () => {
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(
    0,
  );
  const gone = "gone".padEnd(22, "g");
  const pending = "pending".padEnd(22, "p");
  const current = "current".padEnd(22, "c");
  const entries = await registry();
  await writeFile(
    REGISTRY,
    JSON.stringify({
      canvases: { [FIRST]: { ...entries[FIRST], writeToken: gone, pending } },
    }),
    "utf8",
  );
  app.canvases.get(FIRST)!.token = current;

  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(
    1,
  );
  expect(output.err.join("\n")).toContain("the pending rotation was dropped");
  expect((await registry())[FIRST]).not.toHaveProperty("pending");

  app.seen = [];
  expect(await invoke("canvas", "pull", `${API}/c/${FIRST}#w=${current}`)).toBe(
    0,
  );
  app.seen = [];
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(
    0,
  );
  expect(
    app.seen.map((request) => [
      request.method,
      request.path.endsWith("/rotate"),
    ]),
  ).toEqual([["PUT", false]]);
  expect(app.canvases.get(FIRST)?.token).toBe(current);
});

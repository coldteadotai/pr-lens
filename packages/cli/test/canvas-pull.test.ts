import { expect, test, vi } from "vitest";
import { link, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";

import { API, GOLDEN, REGISTRY } from "./helpers/canvas.js";
import { FIRST, TOKEN1, setupCanvasAppTest } from "./helpers/canvas-app.js";

const { output, app, invoke, registry, fakeFetch, createCheckout } =
  setupCanvasAppTest();

test("pull writes the document and brings the recorded rev up to date", async () => {
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(
    0,
  );
  const canvas = app.canvases.get(FIRST);
  if (canvas !== undefined) canvas.rev = 3;
  output.out = [];

  expect(await invoke("canvas", "pull", "--api", API)).toBe(0);

  expect(output.out).toEqual([
    `✓ .pr-lens/graph.json — rev 3 of ${API}/c/${FIRST}`,
  ]);
  expect(JSON.parse(await readFile(".pr-lens/graph.json", "utf8"))).toEqual(
    JSON.parse(await readFile(GOLDEN, "utf8")),
  );
  expect((await registry())[FIRST]?.rev).toBe(3);
});

test("pull takes the view link as it was shared, fragment included", async () => {
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(
    0,
  );
  app.seen = [];
  output.out = [];

  expect(
    await invoke(
      "canvas",
      "pull",
      `${API}/c/${FIRST}#v=371,80,0.414`,
      "-o",
      "pulled.json",
    ),
  ).toBe(0);

  expect(app.seen[0]?.path).toBe(`/api/canvas/${FIRST}`);
  expect(output.out).toEqual([`✓ pulled.json — rev 1 of ${API}/c/${FIRST}`]);
  expect(JSON.parse(await readFile("pulled.json", "utf8"))).toHaveProperty(
    "lanes",
  );
});

test("pull with nothing registered says how to get a canvas", async () => {
  expect(await invoke("canvas", "pull", "--api", API)).toBe(1);
  expect(output.err.join("\n")).toContain("[CANVAS_UNREGISTERED]");
  expect(app.seen).toEqual([]);
});

test("pulling an edit link brings its token into a checkout that never had it", async () => {
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(
    0,
  );
  const fresh = await createCheckout();
  process.chdir(fresh);
  await writeFile("drawn.graph.json", await readFile(GOLDEN, "utf8"), "utf8");
  output.out = [];
  app.seen = [];

  expect(await invoke("canvas", "pull", `${API}/c/${FIRST}#w=${TOKEN1}`)).toBe(
    0,
  );
  expect(output.out).toEqual([
    `✓ .pr-lens/graph.json — rev 1 of ${API}/c/${FIRST}`,
    "  the edit link's token is now in .pr-lens/canvas.json",
  ]);
  expect((await registry())[FIRST]).toEqual({
    name: "Batch broadcast sending through Postmark",
    source: ".pr-lens/graph.json",
    api: API,
    writeToken: TOKEN1,
    rev: 1,
  });

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
  expect(app.seen.at(-1)?.headers.get("authorization")).toBe(
    `Bearer ${TOKEN1}`,
  );
  expect((await registry())[FIRST]?.rev).toBe(2);
});

test("pulling an edit link that no longer opens the canvas keeps the token that does", async () => {
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(
    0,
  );
  expect(await invoke("canvas", "rotate", "--api", API)).toBe(0);
  const current = (await registry())[FIRST]?.writeToken;
  output.err = [];

  expect(await invoke("canvas", "pull", `${API}/c/${FIRST}#w=${TOKEN1}`)).toBe(
    0,
  );
  expect(output.err.join("\n")).toContain("no longer opens");
  expect((await registry())[FIRST]?.writeToken).toBe(current);
});

test("a link with something that is not a token after #w= is a misuse", async () => {
  expect(await invoke("canvas", "pull", `${API}/c/${FIRST}#w=A`)).toBe(2);
  expect(app.seen).toEqual([]);
});

test("a proof made against one entry is not acted on once another command has changed it", async () => {
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(
    0,
  );
  const other = "other-token".padEnd(22, "b");
  const entries = await registry();

  // The proof succeeds; then, before the pull writes, a rotate elsewhere
  // lands a different token in the registry and on the app.
  const proving = fakeFetch;
  vi.stubGlobal(
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const answer = await proving(input, init);
      if (url.pathname.endsWith("/rotate")) {
        await writeFile(
          REGISTRY,
          JSON.stringify({
            canvases: { [FIRST]: { ...entries[FIRST], writeToken: other } },
          }),
          "utf8",
        );
        app.canvases.get(FIRST)!.token = other;
      }
      return answer;
    },
  );

  output.err = [];
  expect(await invoke("canvas", "pull", `${API}/c/${FIRST}#w=${TOKEN1}`)).toBe(
    0,
  );
  expect(output.err.join("\n")).toContain(
    "changed while the edit link was being checked",
  );
  expect((await registry())[FIRST]?.writeToken).toBe(other);
});

test("importing a token drops a rotation that was pending for the old one", async () => {
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(
    0,
  );
  const pending = "pending".padEnd(22, "p");
  const current = "current".padEnd(22, "c");
  const entries = await registry();
  await writeFile(
    REGISTRY,
    JSON.stringify({ canvases: { [FIRST]: { ...entries[FIRST], pending } } }),
    "utf8",
  );
  app.canvases.get(FIRST)!.token = current;

  expect(await invoke("canvas", "pull", `${API}/c/${FIRST}#w=${current}`)).toBe(
    0,
  );
  const entry = (await registry())[FIRST];
  expect(entry?.writeToken).toBe(current);
  expect(entry).not.toHaveProperty("pending");
});

test("an edit link for a canvas nobody has pushed to is registered, and the push then lands", async () => {
  // The mint's answer was the only copy of the token, kept from the terminal.
  const minting = fakeFetch;
  vi.stubGlobal(
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const answer = await minting(input, init);
      if (init?.method === "POST") await mkdir(REGISTRY, { recursive: true });
      return answer;
    },
  );
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(
    1,
  );
  vi.stubGlobal("fetch", fakeFetch);
  await rm(REGISTRY, { recursive: true });
  output.out = [];
  app.seen = [];

  expect(await invoke("canvas", "pull", `${API}/c/${FIRST}#w=${TOKEN1}`)).toBe(
    0,
  );
  expect(output.out).toEqual([
    `✓ ${FIRST} has nothing pushed to it yet`,
    "  the edit link's token is now in .pr-lens/canvas.json",
  ]);
  expect((await registry())[FIRST]).toEqual({
    name: FIRST,
    source: ".pr-lens/drawn.graph.json",
    api: API,
    writeToken: TOKEN1,
    rev: 0,
  });

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
  expect(app.seen.map((request) => request.method)).toEqual(["PUT"]);
  expect(app.seen[0]?.headers.get("if-match")).toBe("0");
  expect((await registry())[FIRST]?.rev).toBe(1);
});

test("pulling an unpushed canvas's own link again keeps a rotation that is pending on it", async () => {
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(
    0,
  );
  const pending = "pending".padEnd(22, "p");
  const entries = await registry();
  await writeFile(
    REGISTRY,
    JSON.stringify({
      canvases: { [FIRST]: { ...entries[FIRST], rev: 0, pending } },
    }),
    "utf8",
  );
  app.canvases.get(FIRST)!.document = undefined;

  expect(await invoke("canvas", "pull", `${API}/c/${FIRST}#w=${TOKEN1}`)).toBe(
    0,
  );
  const entry = (await registry())[FIRST];
  expect(entry?.writeToken).toBe(TOKEN1);
  expect(entry?.pending).toBe(pending);
});

test("pull refuses the registry's names in a checkout that has no workspace yet", async () => {
  for (const target of [REGISTRY, ".pr-lens/Canvas.json", `${REGISTRY}.lock`]) {
    output.err = [];
    expect(
      await invoke("canvas", "pull", `${API}/c/${FIRST}`, "-o", target),
    ).toBe(2);
    expect(output.err.join("\n")).toContain("write tokens live");
  }
  expect(app.seen).toEqual([]);
  await expect(stat(".pr-lens")).rejects.toThrow();
});

test("pull will not write a document over the registry", async () => {
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(
    0,
  );
  const entries = await registry();

  for (const target of [
    REGISTRY,
    `./${REGISTRY}`,
    `${REGISTRY}.lock`,
    ".pr-lens/Canvas.json",
    ".pr-lens/CANVAS.JSON",
  ]) {
    output.err = [];
    expect(await invoke("canvas", "pull", "-o", target, "--api", API)).toBe(2);
    expect(output.err.join("\n")).toContain("write tokens live");
  }
  expect(await registry()).toEqual(entries);

  // A hard link to the registry is the registry.
  await link(REGISTRY, "alias.json");
  output.err = [];
  expect(await invoke("canvas", "pull", "-o", "alias.json", "--api", API)).toBe(
    2,
  );
  expect(await registry()).toEqual(entries);
});

test("pulling a view link records the revision, and push then asks for the edit link", async () => {
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(
    0,
  );
  const fresh = await createCheckout();
  process.chdir(fresh);
  await writeFile("drawn.graph.json", await readFile(GOLDEN, "utf8"), "utf8");

  expect(await invoke("canvas", "pull", `${API}/c/${FIRST}`)).toBe(0);
  expect((await registry())[FIRST]).toEqual({
    name: "Batch broadcast sending through Postmark",
    source: ".pr-lens/graph.json",
    api: API,
    rev: 1,
  });

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
  ).toBe(1);
  expect(output.err.join("\n")).toContain("pull its edit link");
});

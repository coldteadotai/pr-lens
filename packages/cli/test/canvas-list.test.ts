import { expect, test } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";

import { API, REGISTRY, setupCanvasTest } from "./helpers/canvas.js";

const { output, invoke } = setupCanvasTest();

const id = (n: number): string => String(n).padStart(22, "0");

const TOKEN = "token-kept-here-aaaaaa";

type Entry = {
  name: string;
  source: string;
  api: string;
  writeToken?: string;
  pending?: string;
  rev: number;
};

const seed = async (canvases: Record<string, Entry>): Promise<void> => {
  await mkdir(".pr-lens", { recursive: true });
  await writeFile(REGISTRY, JSON.stringify({ canvases }, null, 2), "utf8");
};

const written = (id: string, name: string, rev: number): Entry => ({
  name,
  source: "drawn.graph.json",
  api: API,
  writeToken: `${TOKEN.slice(0, 21)}${id.slice(-1)}`,
  rev,
});

const readOnly = (name: string, rev: number): Entry => ({
  name,
  source: "drawn.graph.json",
  api: API,
  rev,
});

test("a checkout that has never pushed is told so, not shown an empty table", async () => {
  expect(await invoke("canvas", "list")).toBe(0);
  expect(output.out.join("\n")).toBe(
    `no canvases in ${REGISTRY} yet\n  pr-lens canvas push mints one`,
  );
});

test("one canvas is a heading, a row and a count", async () => {
  await seed({ [id(1)]: written(id(1), "Auth flow rewrite", 7) });

  expect(await invoke("canvas", "list")).toBe(0);
  expect(output.out).toEqual([
    `  ID                      NAME               REV  EDIT HERE`,
    `  ${id(1)}  Auth flow rewrite  7    yes`,
    "",
    "  1 canvas",
  ]);
});

test("several canvases are listed by name, and the ones this checkout cannot edit are counted", async () => {
  await seed({
    [id(2)]: written(id(2), "Renderer lane packing", 11),
    [id(1)]: written(id(1), "Auth flow rewrite", 7),
    [id(3)]: readOnly("Scheduler backpressure", 2),
  });

  expect(await invoke("canvas", "list")).toBe(0);
  expect(output.out).toEqual([
    "  ID                      NAME                    REV  EDIT HERE",
    `  ${id(1)}  Auth flow rewrite       7    yes`,
    `  ${id(2)}  Renderer lane packing   11   yes`,
    `  ${id(3)}  Scheduler backpressure  2    no`,
    "",
    "  3 canvases · 1 this checkout cannot edit",
  ]);
});

test("a canvas pulled by its view link reads as one this checkout cannot edit", async () => {
  await seed({ [id(1)]: readOnly("Auth flow rewrite", 7) });

  expect(await invoke("canvas", "list")).toBe(0);
  const printed = output.out.join("\n");
  expect(printed).toContain("Auth flow rewrite  7    no");
  expect(printed).toContain("1 canvas · 1 this checkout cannot edit");
});

test("no write token ever reaches the terminal, in either shape", async () => {
  const entries = {
    [id(1)]: { ...written(id(1), "Auth flow rewrite", 7) },
    [id(2)]: {
      ...written(id(2), "Renderer lane packing", 11),
      pending: "pending-rotation-aaaaa",
    },
  };
  await seed(entries);

  expect(await invoke("canvas", "list")).toBe(0);
  expect(await invoke("canvas", "list", "--json")).toBe(0);

  const everything = [...output.out, ...output.err].join("\n");
  for (const entry of Object.values(entries)) {
    expect(entry.writeToken).toBeDefined();
    expect(everything).not.toContain(entry.writeToken);
  }
  expect(everything).not.toContain("pending-rotation-aaaaa");
});

test("--json is one parsable document a script can read fields off", async () => {
  await seed({
    [id(2)]: written(id(2), "Renderer lane packing", 11),
    [id(1)]: readOnly("Auth flow rewrite", 7),
  });

  expect(await invoke("canvas", "list", "--json")).toBe(0);
  expect(JSON.parse(output.out.join("\n"))).toEqual({
    canvases: [
      { id: id(1), name: "Auth flow rewrite", api: API, rev: 7, editHere: false },
      {
        id: id(2),
        name: "Renderer lane packing",
        api: API,
        rev: 11,
        editHere: true,
      },
    ],
  });
});

test("--json on a checkout with nothing is still an empty list, not a message", async () => {
  expect(await invoke("canvas", "list", "--json")).toBe(0);
  expect(JSON.parse(output.out.join("\n"))).toEqual({ canvases: [] });
});

test("list takes no arguments, and says so", async () => {
  expect(await invoke("canvas", "list", "everything")).toBe(2);
  expect(output.err.join("\n")).toContain(
    "list takes no positional arguments, got everything",
  );
});

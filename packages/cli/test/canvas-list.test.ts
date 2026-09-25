import { expect, test } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";

import { API, REGISTRY } from "./helpers/canvas.js";
import { ACCOUNT, setupCanvasAppTest } from "./helpers/canvas-app.js";

const { output, app, invoke, place, env, fetchMock } = setupCanvasAppTest();

const signedIn = (): void => {
  env().PR_LENS_TOKEN = ACCOUNT;
};

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

  place(id(1));
  place(id(2));
  signedIn();

  expect(await invoke("canvas", "list")).toBe(0);
  expect(await invoke("canvas", "list", "--json")).toBe(0);
  expect(await invoke("canvas", "list", "--remote", "--api", API)).toBe(0);
  expect(await invoke("canvas", "list", "--remote", "--json", "--api", API)).toBe(
    0,
  );

  const everything = [...output.out, ...output.err].join("\n");
  for (const entry of Object.values(entries)) {
    expect(entry.writeToken).toBeDefined();
    expect(everything).not.toContain(entry.writeToken);
  }
  expect(everything).not.toContain("pending-rotation-aaaaa");
  expect(everything).not.toContain(ACCOUNT);
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

test("--remote lists what the account owns beside what this checkout can edit", async () => {
  await seed({ [id(1)]: written(id(1), "Auth flow rewrite", 7) });
  place(id(1), { document: { title: "Auth flow rewrite" }, rev: 9 });
  place(id(2), { document: { title: "Renderer lane packing" }, rev: 11 });
  signedIn();

  expect(await invoke("canvas", "list", "--remote", "--api", API)).toBe(0);
  expect(output.out).toEqual([
    "  ID                      NAME                   REV  EDIT HERE",
    `  ${id(1)}  Auth flow rewrite      9    yes`,
    `  ${id(2)}  Renderer lane packing  11   no`,
    "",
    "  2 canvases · 1 this checkout cannot edit",
  ]);

  const request = app.seen[0];
  expect(request?.path).toBe("/api/canvases");
  expect(request?.headers.get("authorization")).toBe(`Bearer ${ACCOUNT}`);
});

test("the app's name and revision win over the ones this checkout remembers", async () => {
  await seed({ [id(1)]: written(id(1), "What it was called here", 2) });
  place(id(1), { document: { title: "Auth flow rewrite" }, rev: 9 });
  signedIn();

  expect(await invoke("canvas", "list", "--remote", "--json", "--api", API)).toBe(
    0,
  );
  expect(JSON.parse(output.out.join("\n"))).toEqual({
    canvases: [
      { id: id(1), name: "Auth flow rewrite", api: API, rev: 9, editHere: true },
    ],
  });
});

test("a canvas with nothing drawn, or a revision that will not read, is listed under its id", async () => {
  place(id(2), { document: undefined, rev: 0 });
  place(id(3), { unreadable: true, rev: 4 });
  signedIn();

  expect(await invoke("canvas", "list", "--remote", "--api", API)).toBe(0);
  const printed = output.out.join("\n");
  expect(printed).toContain(`${id(2)}  ${id(2)}  0    no`);
  expect(printed).toContain(`${id(3)}  ${id(3)}  4    no`);
  expect(printed).toContain("2 canvases · 2 this checkout cannot edit");
});

test("--remote on a machine that is not signed in asks the app for nothing", async () => {
  await seed({ [id(1)]: written(id(1), "Auth flow rewrite", 7) });

  expect(await invoke("canvas", "list", "--remote", "--api", API)).toBe(1);
  expect(output.err.join("\n")).toContain(
    "not signed in to canvas.test [AUTH_REQUIRED]",
  );
  expect(fetchMock).not.toHaveBeenCalled();
});

test("an empty PR_LENS_TOKEN is not a sign-in, which is how a workflow leaves it", async () => {
  env().PR_LENS_TOKEN = "";

  expect(await invoke("canvas", "list", "--remote", "--api", API)).toBe(1);
  expect(output.err.join("\n")).toContain("[AUTH_REQUIRED]");
  expect(fetchMock).not.toHaveBeenCalled();
});

test("--remote with nothing on either side says so rather than showing a heading", async () => {
  signedIn();

  expect(await invoke("canvas", "list", "--remote", "--api", API)).toBe(0);
  expect(output.out.join("\n")).toBe(
    `no canvases at canvas.test for this account, and none in ${REGISTRY}\n  pr-lens canvas push mints one`,
  );
});

test("--api narrows the listing to one app, and the environment does not", async () => {
  await seed({
    [id(1)]: written(id(1), "Auth flow rewrite", 7),
    [id(2)]: {
      ...written(id(2), "Renderer lane packing", 11),
      api: "https://elsewhere.test",
    },
  });

  expect(await invoke("canvas", "list", "--api", API)).toBe(0);
  expect(output.out.join("\n")).toContain("Auth flow rewrite");
  expect(output.out.join("\n")).not.toContain("Renderer lane packing");

  output.out = [];
  env().PR_LENS_API_URL = API;
  expect(await invoke("canvas", "list")).toBe(0);
  expect(output.out.join("\n")).toContain("Renderer lane packing");
});

test("a malformed $PR_LENS_API_URL cannot fail a listing that never leaves this machine", async () => {
  await seed({ [id(1)]: written(id(1), "Auth flow rewrite", 7) });
  env().PR_LENS_API_URL = "not a url";

  expect(await invoke("canvas", "list")).toBe(0);
  expect(output.out.join("\n")).toContain("Auth flow rewrite");

  expect(await invoke("canvas", "list", "--remote")).toBe(2);
  expect(output.err.join("\n")).toContain("--api needs a URL");
  expect(fetchMock).not.toHaveBeenCalled();
});

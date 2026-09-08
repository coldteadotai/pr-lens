import { beforeEach, expect, test } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { API, REGISTRY, setupCanvasTest } from "./helpers/canvas.js";

const ID = "a".repeat(22);
const OTHER = "b".repeat(22);
const TOKEN = "c".repeat(22);
const NEXT = "d".repeat(22);
const { output, fetchMock, invoke: run, registry } = setupCanvasTest();
const invoke = (...args: string[]) => run("canvas", "delete", ...args);

const entry = (name: string) => ({
  name,
  source: "graph.json",
  api: API,
  writeToken: TOKEN,
  rev: 2,
});
const save = (canvases: unknown) =>
  writeFile(REGISTRY, JSON.stringify({ canvases }));
const success = () => Response.json({ id: ID, deleted: true });

beforeEach(async () => {
  await mkdir(".pr-lens");
  await save({ [ID]: entry("Overview") });
  await writeFile("graph.json", "local graph");
  await writeFile("graph.svg", "local SVG");
  fetchMock.mockImplementation(async () => success());
});

test("defaults to the only canvas, authenticates, and removes only its registry entry", async () => {
  expect(await invoke("--api", API)).toBe(0);
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(fetchMock.mock.calls[0]?.[0]).toBe(`${API}/api/canvas/${ID}`);
  expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
    method: "DELETE",
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  expect(await registry()).toEqual({});
  expect(await readFile("graph.json", "utf8")).toBe("local graph");
  expect(await readFile("graph.svg", "utf8")).toBe("local SVG");
  expect(output.out.join("\n")).toContain(`deleted ${ID}`);
});

test.each([ID, "Overview"])(
  "selects by %s without deleting other entries",
  async (selector) => {
    await save({ [ID]: entry("Overview"), [OTHER]: entry("Other") });
    expect(await invoke("--api", API, "--canvas", selector)).toBe(0);
    expect(await registry()).toEqual({ [OTHER]: entry("Other") });
  },
);

test("requires explicit selection for multiple canvases", async () => {
  await save({ [ID]: entry("Overview"), [OTHER]: entry("Other") });
  expect(await invoke("--api", API)).not.toBe(0);
  expect(fetchMock).not.toHaveBeenCalled();
});

test("rejects ambiguous names, unknown selections, and positional arguments", async () => {
  await save({ [ID]: entry("Same"), [OTHER]: entry("Same") });
  for (const args of [["--canvas", "Same"], ["--canvas", "Missing"], [ID]]) {
    expect(await invoke("--api", API, ...args)).not.toBe(0);
  }
  expect(fetchMock).not.toHaveBeenCalled();
});

test("rejects an empty registry", async () => {
  await save({});
  expect(await invoke("--api", API)).not.toBe(0);
  expect(fetchMock).not.toHaveBeenCalled();
});

test("will not send a token to another API or delete without a saved token", async () => {
  expect(await invoke("--api", "https://elsewhere.test")).not.toBe(0);
  await save({ [ID]: { ...entry("Overview"), writeToken: undefined } });
  expect(await invoke("--api", API)).not.toBe(0);
  expect(fetchMock).not.toHaveBeenCalled();
});

test.each([
  [404, { error: { code: "NOT_FOUND", message: "There is no canvas here" } }],
  [
    409,
    {
      error: {
        code: "DELETION_INCOMPLETE",
        message: "Deletion is not complete; try again",
      },
    },
  ],
  [500, {}],
  [200, { id: ID, deleted: false }],
  [200, { id: OTHER, deleted: true }],
  [202, { id: ID, pending: true }],
])(
  "preserves the registry on an unconfirmed response (%s)",
  async (status, body) => {
    const before = await readFile(REGISTRY, "utf8");
    fetchMock.mockImplementation(async () => Response.json(body, { status }));
    expect(await invoke("--api", API)).not.toBe(0);
    expect(await readFile(REGISTRY, "utf8")).toBe(before);
  },
);

test("preserves the entry when the response is lost", async () => {
  fetchMock.mockRejectedValue(new TypeError("connection lost"));
  expect(await invoke("--api", API)).not.toBe(0);
  expect((await registry())[ID]).toEqual(entry("Overview"));
});

test("settles a pending rotation before deleting with the new token", async () => {
  await save({ [ID]: { ...entry("Overview"), pending: NEXT } });
  fetchMock.mockImplementationOnce(async () =>
    Response.json({ id: ID, editUrl: `${API}/c/${ID}#w=${NEXT}` }),
  );
  expect(await invoke("--api", API)).toBe(0);
  expect(fetchMock.mock.calls[0]?.[0]).toBe(`${API}/api/canvas/${ID}/rotate`);
  expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
    method: "POST",
    body: JSON.stringify({ writeToken: NEXT }),
  });
  expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
    method: "DELETE",
    headers: { authorization: `Bearer ${NEXT}` },
  });
  expect(await registry()).toEqual({});
});

test("does not delete when pending rotation recovery fails", async () => {
  await save({ [ID]: { ...entry("Overview"), pending: NEXT } });
  fetchMock.mockRejectedValue(new TypeError("connection lost"));
  expect(await invoke("--api", API)).not.toBe(0);
  expect(fetchMock).toHaveBeenCalledOnce();
  expect((await registry())[ID]?.pending).toBe(NEXT);
});

test("exposes delete in canvas and top-level help", async () => {
  await run("canvas", "--help");
  await run("--help");
  expect(output.out.join("\n")).toContain("pr-lens canvas delete");
  expect(output.out.join("\n")).toContain("push | pull | rotate | delete");
});

import { execFile } from "node:child_process";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { run } from "../src/cli.js";
import type { Terminal } from "../src/terminal.js";

const sh = promisify(execFile);

const GOLDEN = new URL("../../schema/examples/postmark-refactor.graph.json", import.meta.url).pathname;
const API = "https://canvas.test";
const REGISTRY = ".pr-lens/canvas.json";

let out: string[] = [];
let err: string[] = [];
const terminal: Terminal = { out: (line) => out.push(line), err: (line) => err.push(line) };

const invoke = (...argv: string[]) => run(argv, terminal, {});

/**
 * The app, in memory: four routes, the same envelope and the same refusals.
 * Every request is kept so a test can say what was sent.
 */
type Stored = { token: string; rev: number; document: unknown };
type Seen = { method: string; path: string; headers: Headers; body: unknown };

let canvases = new Map<string, Stored>();
let seen: Seen[] = [];
let minted = 0;
let loseNextAnswer = false;

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const refuse = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
  json(status, { error: { code, message, ...extra } });

const links = (id: string, token?: string) => ({
  viewUrl: `${API}/c/${id}`,
  embedUrl: `${API}/c/${id}.svg`,
  ...(token === undefined ? {} : { editUrl: `${API}/c/${id}#w=${token}` }),
});

const tile = (id: string) => ({
  id,
  title: id,
  lens: "architecture",
  crumbs: ["overview"],
  hero: id === "view:overview",
  width: 800,
  height: 600,
  renders: { light: `${id}-light.svg`, dark: `${id}-dark.svg` },
  images: { light: `${API}/i/${id}-light.svg`, dark: `${API}/i/${id}-dark.svg` },
});

const TILES = [tile("view:overview"), tile("view:new-batch-path")];

const bearer = (headers: Headers): string | undefined =>
  headers.get("authorization")?.replace(/^Bearer /, "");

const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = init?.method ?? "GET";
  const headers = new Headers(init?.headers);
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
  seen.push({ method, path: url.pathname, headers, body });

  if (method === "POST" && url.pathname === "/api/canvas") {
    minted += 1;
    const id = String(minted).padStart(22, "0");
    const token = `token-${minted}-a`;
    canvases.set(id, { token, rev: 0, document: undefined });
    return json(201, { id, writeToken: token, rev: 0, ...links(id, token) });
  }

  const [, , , id, action] = url.pathname.split("/");
  const canvas = id === undefined ? undefined : canvases.get(id);
  if (id === undefined || canvas === undefined) return refuse(404, "NOT_FOUND", "There is no canvas here");

  if (method === "GET" && action === undefined) {
    if (canvas.document === undefined) return refuse(404, "NOT_FOUND", "There is no canvas here");
    return json(200, { id, rev: canvas.rev, ...links(id), document: canvas.document, tiles: TILES });
  }

  if (method === "POST" && action === "rotate") {
    const next = typeof body === "object" && body !== null && "writeToken" in body ? body.writeToken : undefined;
    if (typeof next !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(next))
      return refuse(400, "INVALID_REQUEST", "The body must carry the new writeToken");
    if (bearer(headers) === canvas.token) canvas.token = next;
    else if (next !== canvas.token) return refuse(404, "NOT_FOUND", "There is no canvas here");
    if (loseNextAnswer) {
      loseNextAnswer = false;
      throw new TypeError("fetch failed");
    }
    return json(200, { id, editUrl: `${API}/c/${id}#w=${canvas.token}` });
  }

  if (bearer(headers) !== canvas.token) return refuse(404, "NOT_FOUND", "There is no canvas here");

  if (method === "PUT" && action === undefined) {
    if (headers.get("if-match") !== String(canvas.rev))
      return refuse(409, "REVISION_MOVED", "The canvas has moved on since you pulled it", { rev: canvas.rev });
    if (typeof body !== "object" || body === null || !("lanes" in body))
      return refuse(422, "INVALID_DOCUMENT", "The document does not match the PR Lens contract", {
        issues: [{ code: "INVALID_DOCUMENT", path: "lanes", message: "expected array, received undefined" }],
      });
    if ("title" in body && body.title === "Nothing to draw")
      return refuse(422, "CANNOT_DRAW", "The document has nothing the canvas can draw");
    canvas.rev += 1;
    canvas.document = body;
    return json(200, { id, rev: canvas.rev, ...links(id, canvas.token), tiles: TILES });
  }

  return refuse(404, "NOT_FOUND", "There is no canvas here");
};

const originalCwd = process.cwd();

beforeEach(async () => {
  out = [];
  err = [];
  canvases = new Map();
  seen = [];
  minted = 0;
  loseNextAnswer = false;
  vi.stubGlobal("fetch", fakeFetch);

  const directory = await mkdtemp(join(tmpdir(), "pr-lens-canvas-"));
  process.chdir(directory);
  await writeFile("drawn.graph.json", await readFile(GOLDEN, "utf8"), "utf8");
});

afterEach(() => {
  process.chdir(originalCwd);
  vi.unstubAllGlobals();
});

const registry = async (): Promise<Record<string, { name: string; source: string; writeToken: string; rev: number }>> =>
  JSON.parse(await readFile(REGISTRY, "utf8")).canvases;

const FIRST = "1".padStart(22, "0");

test("the first push mints a canvas, records it, and prints the three links", async () => {
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(0);

  expect(out).toEqual([
    `✓ ${API}/c/${FIRST} — rev 1 · 2 diagrams`,
    `  edit link, keep it to yourself: ${API}/c/${FIRST}#w=token-1-a`,
    `  README embed: ${API}/c/${FIRST}.svg`,
  ]);

  expect(await registry()).toEqual({
    [FIRST]: {
      name: "Batch broadcast sending through Postmark",
      source: "drawn.graph.json",
      writeToken: "token-1-a",
      rev: 1,
    },
  });

  expect(seen.map((request) => request.method)).toEqual(["POST", "PUT"]);
  expect(seen[1]?.headers.get("if-match")).toBe("0");
  expect(seen[1]?.headers.get("user-agent")).toMatch(/^pr-lens-cli\//);
});

test("a second push of the same file reuses the canvas and sends the rev it last saw", async () => {
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(0);
  seen = [];

  expect(await invoke("canvas", "push", "./drawn.graph.json", "--api", API)).toBe(0);

  expect(seen.map((request) => request.method)).toEqual(["PUT"]);
  expect(seen[0]?.headers.get("if-match")).toBe("1");
  expect((await registry())[FIRST]?.rev).toBe(2);
  expect(canvases.size).toBe(1);
});

test("a rev the app has moved past is a conflict, and says what to do", async () => {
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(0);
  const canvas = canvases.get(FIRST);
  if (canvas !== undefined) canvas.rev = 5;

  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(1);

  const reported = err.join("\n");
  expect(reported).toContain("[CANVAS_CONFLICT]");
  expect(reported).toContain("rev 5");
  expect(reported).toContain("pr-lens canvas pull, then push again");
});

test("--canvas takes the name a canvas was minted under", async () => {
  expect(await invoke("canvas", "push", "drawn.graph.json", "--name", "architecture", "--api", API)).toBe(0);
  await writeFile("other.graph.json", await readFile(GOLDEN, "utf8"), "utf8");
  seen = [];

  expect(await invoke("canvas", "push", "other.graph.json", "--canvas", "architecture", "--api", API)).toBe(0);

  expect(seen.map((request) => request.method)).toEqual(["PUT"]);
  expect(seen[0]?.path).toBe(`/api/canvas/${FIRST}`);
  expect((await registry())[FIRST]).toMatchObject({ name: "architecture", source: "other.graph.json", rev: 2 });
});

test("a name nobody minted is not a canvas this checkout knows", async () => {
  expect(await invoke("canvas", "push", "drawn.graph.json", "--canvas", "nope", "--api", API)).toBe(1);
  expect(err.join("\n")).toContain("[CANVAS_UNREGISTERED]");
  expect(seen).toEqual([]);
});

test("pull writes the document and brings the recorded rev up to date", async () => {
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(0);
  const canvas = canvases.get(FIRST);
  if (canvas !== undefined) canvas.rev = 3;
  out = [];

  expect(await invoke("canvas", "pull", "--api", API)).toBe(0);

  expect(out).toEqual([`✓ .pr-lens/graph.json — rev 3 of ${API}/c/${FIRST}`]);
  expect(JSON.parse(await readFile(".pr-lens/graph.json", "utf8"))).toEqual(
    JSON.parse(await readFile(GOLDEN, "utf8")),
  );
  expect((await registry())[FIRST]?.rev).toBe(3);
});

test("pull takes the view link as it was shared, fragment included", async () => {
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(0);
  seen = [];
  out = [];

  expect(await invoke("canvas", "pull", `${API}/c/${FIRST}#w=whatever`, "-o", "pulled.json")).toBe(0);

  expect(seen[0]?.path).toBe(`/api/canvas/${FIRST}`);
  expect(out).toEqual([`✓ pulled.json — rev 1 of ${API}/c/${FIRST}`]);
  expect(JSON.parse(await readFile("pulled.json", "utf8"))).toHaveProperty("lanes");
});

test("rotate mints the next token here, and the old one stops opening the door", async () => {
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(0);
  out = [];
  seen = [];

  expect(await invoke("canvas", "rotate", "--api", API)).toBe(0);

  const next = (await registry())[FIRST]?.writeToken;
  expect(next).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(next).not.toBe("token-1-a");
  expect((await registry())[FIRST]).not.toHaveProperty("nextWriteToken");
  expect(out).toEqual([
    `✓ new edit link for ${API}/c/${FIRST}: ${API}/c/${FIRST}#w=${next}`,
    "  the old edit link no longer works",
  ]);
  expect(seen[0]?.headers.get("authorization")).toBe("Bearer token-1-a");
  expect(seen[0]?.body).toEqual({ writeToken: next });

  // The app now knows only the new token, and the registry sends that one.
  out = [];
  seen = [];
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(0);
  expect(seen[0]?.headers.get("authorization")).toBe(`Bearer ${next}`);
});

test("a rotation whose answer was lost is finished by the next command", async () => {
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(0);
  loseNextAnswer = true;

  expect(await invoke("canvas", "rotate", "--api", API)).toBe(1);
  expect(err.join("\n")).toContain("the rotation is not finished");

  const pending = (await registry())[FIRST];
  expect(pending?.writeToken).toBe("token-1-a");
  expect(pending?.nextWriteToken).toMatch(/^[A-Za-z0-9_-]{22}$/);

  err = [];
  seen = [];
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(0);
  expect(seen.map((request) => [request.method, request.path.endsWith("/rotate")])).toEqual([
    ["POST", true],
    ["PUT", false],
  ]);
  const settled = (await registry())[FIRST];
  expect(settled?.writeToken).toBe(pending?.nextWriteToken);
  expect(settled).not.toHaveProperty("nextWriteToken");
  expect(seen[1]?.headers.get("authorization")).toBe(`Bearer ${settled?.writeToken}`);
});

test("two commands changing the registry at once both keep their canvas", async () => {
  await writeFile("other.json", await readFile(GOLDEN, "utf8"), "utf8");

  const [first, second] = await Promise.all([
    invoke("canvas", "push", "drawn.graph.json", "--api", API),
    invoke("canvas", "push", "other.json", "--api", API),
  ]);
  expect([first, second]).toEqual([0, 0]);

  const entries = await registry();
  expect(Object.keys(entries)).toHaveLength(2);
  expect(Object.values(entries).map((entry) => entry.source).sort()).toEqual(["drawn.graph.json", "other.json"]);
});

test("the registry is refused a home git would commit", async () => {
  await sh("git", ["init", "--quiet"], { cwd: process.cwd() });
  await writeFile(".gitignore", "!.pr-lens/\n", "utf8");

  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(1);
  expect(err.join("\n")).toContain("[CANVAS_REGISTRY_EXPOSED]");
  expect(seen).toEqual([]);
  await expect(readFile(REGISTRY, "utf8")).rejects.toThrow();
});

test("a document the app would refuse is refused with its reasons", async () => {
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(0);

  // The CLI validates before it sends, so a document the fake would refuse
  // never reaches it. Refuse the next push outright instead.
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    if (init?.method !== "PUT") return fakeFetch(input, init);
    return refuse(422, "INVALID_DOCUMENT", "The document does not match the PR Lens contract", {
      issues: [
        { code: "INVALID_DOCUMENT", path: "lanes", message: "expected array, received undefined" },
        { code: "INVALID_DOCUMENT", path: "", message: "the document names no lens" },
      ],
    });
  });

  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(1);
  const reported = err.join("\n");
  expect(reported).toContain("[CANVAS_REJECTED]");
  expect(reported).toContain("The document does not match the PR Lens contract");
  expect(reported).toContain("lanes: expected array, received undefined");
  expect(reported).toContain("\nthe document names no lens");
});

test("an invalid local document fails before anything is sent", async () => {
  const broken = JSON.parse(await readFile(GOLDEN, "utf8"));
  delete broken.lanes;
  await writeFile("broken.json", JSON.stringify(broken), "utf8");

  expect(await invoke("canvas", "push", "broken.json", "--api", API)).toBe(1);

  expect(err.join("\n")).toContain("[INVALID_DOCUMENT]");
  expect(seen).toEqual([]);
});

test("pull with nothing registered says how to get a canvas", async () => {
  expect(await invoke("canvas", "pull", "--api", API)).toBe(1);
  expect(err.join("\n")).toContain("[CANVAS_UNREGISTERED]");
  expect(seen).toEqual([]);
});

test("canvas --help and canvas push --help both print the usage", async () => {
  expect(await invoke("canvas", "--help")).toBe(0);
  expect(out.join("\n")).toContain("pr-lens canvas push");

  out = [];
  expect(await invoke("canvas", "push", "--help")).toBe(0);
  expect(out.join("\n")).toContain("--canvas <id|name>");
});

test("a subcommand that is not one is a misuse", async () => {
  expect(await invoke("canvas", "publish")).toBe(2);
  const reported = err.join("\n");
  expect(reported).toContain('unknown canvas subcommand "publish"');
  expect(reported).toContain("pr-lens canvas <push | pull | rotate>");
});

test("the registry is the owner's alone, and replaced whole", async () => {
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(0);

  const mode = (await stat(REGISTRY)).mode & 0o777;
  expect(mode.toString(8)).toBe("600");
  await expect(stat(`${REGISTRY}.${process.pid}.tmp`)).rejects.toThrow();
});

test("a document the renderer refuses is a rejection with the app's own words", async () => {
  const empty = JSON.parse(await readFile(GOLDEN, "utf8"));
  empty.title = "Nothing to draw";
  await writeFile("empty.json", JSON.stringify(empty), "utf8");

  expect(await invoke("canvas", "push", "empty.json", "--api", API)).toBe(1);

  const reported = err.join("\n");
  expect(reported).toContain("[CANVAS_REJECTED]");
  expect(reported).toContain("The document has nothing the canvas can draw");
});

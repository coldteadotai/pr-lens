import { beforeEach, expect, test } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { API, GOLDEN } from "./helpers/canvas.js";
import { FIRST, TOKEN1, refuse, setupCanvasAppTest } from "./helpers/canvas-app.js";

const { output, app, fakeFetch, fetchMock, invoke, registry, place } = setupCanvasAppTest();

const SESSION = "s".padEnd(22, "s");
const SECRET = "k".padEnd(22, "k");
const KEY = "r".padEnd(22, "r");

/** A public canvas pushed from somewhere else. */
const THEIRS = "9".padStart(22, "0");

/**
 * The live routes, in front of the fake canvas app. A session is open only
 * once minted, and `ended` stands for one the app has let lapse. The write
 * token drives FIRST; anyone else gets a reader's session and its key, unless
 * `limited` refuses the open.
 */
type Live = {
  opened: boolean;
  ended: boolean;
  limited: boolean;
  tab: "following" | "stepped_out" | "not_open";
  look: unknown;
  sent: unknown[];
};

const live: Live = { opened: false, ended: false, limited: false, tab: "stepped_out", look: undefined, sent: [] };

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  live.opened = false;
  live.ended = false;
  live.limited = false;
  live.tab = "stepped_out";
  live.look = undefined;
  live.sent = [];

  fetchMock.mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const [, , , id, action, session, tail] = url.pathname.split("/");
    if (action !== "live") return fakeFetch(input, init);

    const method = init?.method ?? "GET";
    const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    app.seen.push({ method, path: url.pathname, headers: new Headers(init?.headers), body });
    const bearer = new Headers(init?.headers).get("authorization");
    const writer = id === FIRST && bearer === `Bearer ${TOKEN1}`;
    const readable = id !== undefined && app.canvases.get(id)?.document !== undefined;

    if (session === undefined) {
      if (!writer && !readable) return refuse(404, "NOT_FOUND", "There is no canvas here");
      if (!writer && live.limited)
        return refuse(429, "RATE_LIMITED", "Too many live sessions opened here in the last hour", { retryAt: "2026-09-25T17:00:00.000Z" });
      live.opened = true;
      return json(200, {
        session: SESSION,
        url: `${API}/c/${id}#live=${SESSION}.${SECRET}`,
        expiresAt: "2026-09-25T18:00:00.000Z",
        ...(writer ? {} : { key: KEY }),
      });
    }
    if (!writer && !(readable && bearer === `Bearer ${KEY}`)) return refuse(404, "NOT_FOUND", "There is no canvas here");
    if (!live.opened || live.ended || session !== SESSION)
      return refuse(404, "LIVE_ENDED", "This live session has ended");

    if (tail === "look")
      return json(200, live.look === undefined ? { status: "not_open" } : { status: "seen", seenAt: "2026-09-25T16:00:00.000Z", look: live.look });

    live.sent.push(body);
    return json(200, { seq: live.sent.length, tab: live.tab });
  });
});

const pushAndOpen = async (): Promise<void> => {
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(0);
  expect(await invoke("canvas", "open", "drawn.graph.json", "--no-browser", "--api", API)).toBe(0);
  output.out = [];
  output.err = [];
};

const answer = (ref: { kind: string; id: string }) => ({
  question: "What sends the emails?",
  steps: [
    {
      heading: "The bulk sender sends each batch",
      stage: { kind: "view", view: "overview" },
      focus: { kind: "selection", nodes: ["send-broadcast-bulk"] },
      paragraphs: [{ parts: [{ text: "The " }, { text: "bulk sender", ref }, { text: " makes one call per batch." }] }],
    },
  ],
});

test("open pairs a tab and keeps its session beside the write token", async () => {
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(0);
  output.out = [];

  expect(await invoke("canvas", "open", "--no-browser", "--api", API)).toBe(0);

  expect((await registry())[FIRST]).toMatchObject({
    writeToken: TOKEN1,
    live: { session: SESSION, expiresAt: "2026-09-25T18:00:00.000Z" },
  });
  expect((await registry())[FIRST]?.live).not.toHaveProperty("key");
  expect(output.out).toEqual([
    `✓ open ${API}/c/${FIRST}#live=${SESSION}.${SECRET}`,
    "  a tab opened with this link follows your agent; anyone with the plain view link sees the canvas as it is",
    "  the session ends after 2 hours with nothing sent to it",
  ]);
  expect(app.seen.at(-1)).toMatchObject({ method: "POST", path: `/api/canvas/${FIRST}/live` });
  expect(app.seen.at(-1)?.headers.get("authorization")).toBe(`Bearer ${TOKEN1}`);
});

test("an answer naming a component the drawing does not have never leaves the machine", async () => {
  await pushAndOpen();
  await writeFile("answer.json", JSON.stringify(answer({ kind: "component", id: "bulk-sender" })), "utf8");
  app.seen = [];

  expect(await invoke("canvas", "answer", "answer.json", "--api", API)).toBe(1);

  const reported = output.err.join("\n");
  expect(reported).toContain("1 id is not on the canvas [LIVE_UNKNOWN_PLACE]");
  expect(reported).toContain('steps[0].paragraphs[0].parts[1].ref: no component "bulk-sender"');
  expect(reported).toContain("send-broadcast-bulk");
  expect(app.seen).toEqual([]);
});

test("an answer that checks out is sent, and says where the reader is", async () => {
  await pushAndOpen();
  await writeFile("answer.json", JSON.stringify(answer({ kind: "component", id: "send-broadcast-bulk" })), "utf8");

  expect(await invoke("canvas", "answer", "answer.json", "--api", API)).toBe(0);

  expect(live.sent).toMatchObject([{ kind: "answer", ...answer({ kind: "component", id: "send-broadcast-bulk" }) }]);
  expect(output.out).toEqual([
    `✓ answered on ${FIRST} in 1 step`,
    "  the reader stepped out of agent mode, so the answer is waiting in their Questions list",
  ]);
});

test("show sorts its focus by what the drawing calls each id", async () => {
  await pushAndOpen();
  live.tab = "following";

  expect(
    await invoke("canvas", "show", "--focus", "queue-route", "--focus", "send-pipeline/enqueue", "--diagram", "send-pipeline", "--api", API),
  ).toBe(0);

  expect(live.sent).toEqual([
    {
      kind: "show",
      stage: { kind: "flow", flow: "send-pipeline" },
      focus: { kind: "selection", lanes: [], nodes: ["queue-route"], edges: [], messages: ["send-pipeline/enqueue"] },
    },
  ]);
  expect(output.out).toEqual([`✓ moved ${FIRST}`, "  the reader's tab is following along"]);
});

test("a session the app has let lapse says to open another, and is forgotten", async () => {
  await pushAndOpen();
  live.ended = true;

  expect(await invoke("canvas", "look", "--api", API)).toBe(1);

  const reported = output.err.join("\n");
  expect(reported).toContain(`the live session on ${FIRST} has ended [LIVE_ENDED]`);
  expect(reported).toContain("pr-lens canvas open starts a new one");
  expect((await registry())[FIRST]).not.toHaveProperty("live");

  output.err = [];
  expect(await invoke("canvas", "look", "--api", API)).toBe(1);
  expect(output.err.join("\n")).toContain(`no tab is paired with ${FIRST} [LIVE_UNOPENED]`);
});

test("look says plainly when no tab has reported yet, and prints the look once one has", async () => {
  await pushAndOpen();

  expect(await invoke("canvas", "look", "--api", API)).toBe(0);
  expect(output.out).toEqual([
    "no tab has reported yet: open the link pr-lens canvas open printed, or run it again to get a new one",
  ]);

  const look = {
    following: true,
    rev: 1,
    diagram: { stage: { kind: "view", view: "overview" }, title: "Overview" },
    inFrame: [{ kind: "component", id: "queue-route", label: "Queue route" }],
    scope: { kind: "place", place: { kind: "component", id: "queue-route", label: "Queue route" } },
    answer: null,
    fork: { label: "Queue route", parts: ["Chunker", "Sender"] },
  };
  live.look = look;
  output.out = [];

  expect(await invoke("canvas", "look", "--api", API)).toBe(0);
  expect(JSON.parse(output.out.join("\n"))).toEqual(look);
});

test("a fork borrows the canvas's provenance and checks what it hangs from", async () => {
  await pushAndOpen();
  await writeFile(
    "sketch.json",
    JSON.stringify({
      title: "Inside the bulk sender",
      lenses: ["architecture"],
      lanes: [{ id: "inside", label: "Inside" }],
      nodes: [{ id: "chunker", label: "Chunker", kind: "function", lane: "inside", delta: "added" }],
    }),
    "utf8",
  );

  expect(await invoke("canvas", "fork", "sketch.json", "--from", "nope", "--api", API)).toBe(1);
  expect(output.err.join("\n")).toContain('subject.components[0]: no component "nope"');
  expect(live.sent).toEqual([]);

  output.out = [];
  expect(await invoke("canvas", "fork", "sketch.json", "--from", "send-broadcast-bulk", "--api", API)).toBe(0);
  expect(live.sent).toHaveLength(1);
  expect(live.sent[0]).toMatchObject({
    kind: "fork",
    subject: { components: ["send-broadcast-bulk"] },
    sketch: { kind: "graph", title: "Inside the bulk sender", provenance: { repo: { name: expect.any(String) } } },
  });
  expect(output.out[0]).toBe(`✓ drew inside send-broadcast-bulk on ${FIRST}`);
});

test("a command with no tab paired says how to pair one", async () => {
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(0);
  await writeFile("answer.json", JSON.stringify(answer({ kind: "component", id: "send-broadcast-bulk" })), "utf8");

  expect(await invoke("canvas", "answer", "answer.json", "--api", API)).toBe(1);
  const reported = output.err.join("\n");
  expect(reported).toContain(`no tab is paired with ${FIRST} [LIVE_UNOPENED]`);
  expect(reported).toContain("pr-lens canvas open");
});

test("with several canvases, open asks for the drawing, and the other commands take it with --drawing", async () => {
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(0);
  await mkdir("other", { recursive: true });
  const other = { ...JSON.parse(await readFile("drawn.graph.json", "utf8")), title: "Another drawing" };
  await writeFile("other/drawn.graph.json", JSON.stringify(other), "utf8");
  expect(await invoke("canvas", "push", "other/drawn.graph.json", "--api", API)).toBe(0);
  output.err = [];
  app.seen = [];

  expect(await invoke("canvas", "open", "--no-browser", "--api", API)).toBe(2);
  expect(output.err.join("\n")).toContain("name the drawing to open: drawn.graph.json, other/drawn.graph.json");
  expect(app.seen).toEqual([]);

  expect(await invoke("canvas", "open", "drawn.graph.json", "--no-browser", "--api", API)).toBe(0);
  await writeFile("answer.json", JSON.stringify(answer({ kind: "component", id: "send-broadcast-bulk" })), "utf8");
  expect(await invoke("canvas", "answer", "answer.json", "--drawing", "drawn.graph.json", "--api", API)).toBe(0);
  expect(live.sent).toHaveLength(1);

  output.err = [];
  expect(await invoke("canvas", "look", "--drawing", "drawn.graph.json", "--canvas", FIRST, "--api", API)).toBe(2);
  expect(output.err.join("\n")).toContain("pass --drawing or --canvas, not both");
});

const golden = async (): Promise<unknown> => JSON.parse(await readFile(GOLDEN, "utf8"));

const DRAWN_THEIRS = `.pr-lens/canvases/${THEIRS}.graph.json`;

test("open on a public canvas this checkout never pushed fetches it and opens a reader's session", async () => {
  place(THEIRS, { document: await golden() });

  expect(await invoke("canvas", "open", "--canvas", `${API}/c/${THEIRS}`, "--no-browser")).toBe(0);

  expect(JSON.parse(await readFile(DRAWN_THEIRS, "utf8"))).toEqual(await golden());
  expect((await registry())[THEIRS]).toEqual({
    name: "Batch broadcast sending through Postmark",
    source: DRAWN_THEIRS,
    api: API,
    rev: 1,
    live: { session: SESSION, expiresAt: "2026-09-25T18:00:00.000Z", key: KEY },
  });
  const opening = app.seen.at(-1);
  expect(opening).toMatchObject({ method: "POST", path: `/api/canvas/${THEIRS}/live` });
  expect(opening?.headers.get("authorization")).toBeNull();
  expect(output.out).toEqual([
    `✓ ${DRAWN_THEIRS}: rev 1 of ${API}/c/${THEIRS}`,
    `✓ open ${API}/c/${THEIRS}#live=${SESSION}.${SECRET}`,
    "  a tab opened with this link follows your agent; nobody else's view of the canvas changes",
    "  the session ends after 2 hours with nothing sent to it",
  ]);
});

test("a reader's answer and look carry the session's key, and ids are checked against the fetched drawing", async () => {
  place(THEIRS, { document: await golden() });
  expect(await invoke("canvas", "open", "--canvas", THEIRS, "--no-browser", "--api", API)).toBe(0);
  app.seen = [];

  await writeFile("answer.json", JSON.stringify(answer({ kind: "component", id: "bulk-sender" })), "utf8");
  expect(await invoke("canvas", "answer", "answer.json", "--api", API)).toBe(1);
  expect(output.err.join("\n")).toContain('no component "bulk-sender"');
  expect(app.seen).toEqual([]);

  await writeFile("answer.json", JSON.stringify(answer({ kind: "component", id: "send-broadcast-bulk" })), "utf8");
  expect(await invoke("canvas", "answer", "answer.json", "--api", API)).toBe(0);
  expect(await invoke("canvas", "look", "--api", API)).toBe(0);

  expect(live.sent).toHaveLength(1);
  expect(app.seen.map((seen) => [seen.method, seen.path, seen.headers.get("authorization")])).toEqual([
    ["POST", `/api/canvas/${THEIRS}/live/${SESSION}`, `Bearer ${KEY}`],
    ["GET", `/api/canvas/${THEIRS}/live/${SESSION}/look`, `Bearer ${KEY}`],
  ]);
});

test("a canvas pulled by its view link opens without a write token or a sign-in", async () => {
  place(THEIRS, { document: await golden() });
  expect(await invoke("canvas", "pull", THEIRS, "--api", API)).toBe(0);
  output.out = [];

  expect(await invoke("canvas", "open", "--no-browser", "--api", API)).toBe(0);
  expect((await registry())[THEIRS]?.live).toEqual({ session: SESSION, expiresAt: "2026-09-25T18:00:00.000Z", key: KEY });
});

test("open on a canvas that is private or missing says so plainly", async () => {
  expect(await invoke("canvas", "open", "--canvas", THEIRS, "--no-browser", "--api", API)).toBe(1);

  const reported = output.err.join("\n");
  expect(reported).toContain(`${THEIRS} is private, or there is no such canvas at canvas.test [CANVAS_UNKNOWN]`);
  expect(reported).toContain("pr-lens auth login");
  expect(reported).not.toContain("rotated");
});

test("a refused reader's open says when to try again", async () => {
  place(THEIRS, { document: await golden() });
  live.limited = true;

  expect(await invoke("canvas", "open", "--canvas", THEIRS, "--no-browser", "--api", API)).toBe(1);
  expect(output.err.join("\n")).toContain("canvas.test is rate limiting this client until 2026-09-25T17:00:00.000Z [CANVAS_RATE_LIMITED]");
  expect((await registry())[THEIRS]).not.toHaveProperty("live");
});

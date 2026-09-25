import { beforeEach, expect, test } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { API } from "./helpers/canvas.js";
import { FIRST, TOKEN1, refuse, setupCanvasAppTest } from "./helpers/canvas-app.js";

const { output, app, fakeFetch, fetchMock, invoke, registry } = setupCanvasAppTest();

const SESSION = "s".padEnd(22, "s");
const SECRET = "k".padEnd(22, "k");

/**
 * The live routes, in front of the fake canvas app. A session is open only
 * once minted, and `ended` stands for one the app has let lapse.
 */
type Live = {
  opened: boolean;
  ended: boolean;
  tab: "following" | "stepped_out" | "not_open";
  look: unknown;
  sent: unknown[];
};

const live: Live = { opened: false, ended: false, tab: "stepped_out", look: undefined, sent: [] };

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  live.opened = false;
  live.ended = false;
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
    if (id !== FIRST || new Headers(init?.headers).get("authorization") !== `Bearer ${TOKEN1}`)
      return refuse(404, "NOT_FOUND", "There is no canvas here");

    if (session === undefined) {
      live.opened = true;
      return json(200, {
        session: SESSION,
        url: `${API}/c/${id}#live=${SESSION}.${SECRET}`,
        expiresAt: "2026-09-25T18:00:00.000Z",
      });
    }
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
  expect(output.out[0]).toBe(`✓ open ${API}/c/${FIRST}#live=${SESSION}.${SECRET}`);
  expect(app.seen.at(-1)).toMatchObject({ method: "POST", path: `/api/canvas/${FIRST}/live` });
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

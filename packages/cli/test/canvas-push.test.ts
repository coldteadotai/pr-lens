import { expect, test, vi } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { API, GOLDEN, REGISTRY } from "./helpers/canvas.js";
import {
  FIRST,
  TOKEN1,
  refuse,
  setupCanvasAppTest,
} from "./helpers/canvas-app.js";

const { output, app, invoke, registry, fakeFetch } = setupCanvasAppTest();

test("the first push records a canvas and prints its links, access warning, and remove hint", async () => {
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(
    0,
  );

  expect(output.out).toEqual([
    `✓ ${API}/c/${FIRST} — rev 1 · 2 diagrams`,
    "  unlisted: anyone you give the link can open it, no sign-in needed",
    `  README embed: ${API}/c/${FIRST}.svg`,
    "  remove: pr-lens canvas delete",
  ]);

  expect(await registry()).toEqual({
    [FIRST]: {
      name: "Batch broadcast sending through Postmark",
      source: "drawn.graph.json",
      api: API,
      writeToken: TOKEN1,
      rev: 1,
    },
  });

  expect(app.seen.map((request) => request.method)).toEqual(["POST", "PUT"]);
  expect(app.seen[1]?.headers.get("if-match")).toBe("0");
  expect(app.seen[1]?.headers.get("user-agent")).toMatch(/^pr-lens-cli\//);
});

test("a second push of the same file reuses the canvas and sends the rev it last saw", async () => {
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(
    0,
  );
  app.seen = [];

  expect(
    await invoke("canvas", "push", "./drawn.graph.json", "--api", API),
  ).toBe(0);

  expect(app.seen.map((request) => request.method)).toEqual(["PUT"]);
  expect(app.seen[0]?.headers.get("if-match")).toBe("1");
  expect((await registry())[FIRST]?.rev).toBe(2);
  expect(app.canvases.size).toBe(1);
});

test("a rev the app has moved past is a conflict, and says what to do", async () => {
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(
    0,
  );
  const canvas = app.canvases.get(FIRST);
  if (canvas !== undefined) canvas.rev = 5;

  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(
    1,
  );

  const reported = output.err.join("\n");
  expect(reported).toContain("[CANVAS_CONFLICT]");
  expect(reported).toContain("rev 5");
  expect(reported).toContain("pr-lens canvas pull, then push again");
});

test("--canvas takes the name a canvas was minted under", async () => {
  expect(
    await invoke(
      "canvas",
      "push",
      "drawn.graph.json",
      "--name",
      "architecture",
      "--api",
      API,
    ),
  ).toBe(0);
  await writeFile("other.graph.json", await readFile(GOLDEN, "utf8"), "utf8");
  app.seen = [];

  expect(
    await invoke(
      "canvas",
      "push",
      "other.graph.json",
      "--canvas",
      "architecture",
      "--api",
      API,
    ),
  ).toBe(0);

  expect(app.seen.map((request) => request.method)).toEqual(["PUT"]);
  expect(app.seen[0]?.path).toBe(`/api/canvas/${FIRST}`);
  expect((await registry())[FIRST]).toMatchObject({
    name: "architecture",
    source: "other.graph.json",
    rev: 2,
  });
});

test("a name nobody minted is not a canvas this checkout knows", async () => {
  expect(
    await invoke(
      "canvas",
      "push",
      "drawn.graph.json",
      "--canvas",
      "nope",
      "--api",
      API,
    ),
  ).toBe(1);
  expect(output.err.join("\n")).toContain("[CANVAS_UNREGISTERED]");
  expect(app.seen).toEqual([]);
});

test("a document the app would refuse is refused with its reasons", async () => {
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(
    0,
  );

  // The CLI validates before it sends, so a document the fake would refuse
  // never reaches it. Refuse the next push outright instead.
  vi.stubGlobal(
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      if (init?.method !== "PUT") return fakeFetch(input, init);
      return refuse(
        422,
        "INVALID_DOCUMENT",
        "The document does not match the PR Lens contract",
        {
          issues: [
            {
              code: "INVALID_DOCUMENT",
              path: "lanes",
              message: "expected array, received undefined",
            },
            {
              code: "INVALID_DOCUMENT",
              path: "",
              message: "the document names no lens",
            },
          ],
        },
      );
    },
  );

  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(
    1,
  );
  const reported = output.err.join("\n");
  expect(reported).toContain("[CANVAS_REJECTED]");
  expect(reported).toContain(
    "The document does not match the PR Lens contract",
  );
  expect(reported).toContain("lanes: expected array, received undefined");
  expect(reported).toContain("\nthe document names no lens");
});

test("an invalid local document fails before anything is sent", async () => {
  const broken = JSON.parse(await readFile(GOLDEN, "utf8"));
  delete broken.lanes;
  await writeFile("broken.json", JSON.stringify(broken), "utf8");

  expect(await invoke("canvas", "push", "broken.json", "--api", API)).toBe(1);

  expect(output.err.join("\n")).toContain("[INVALID_DOCUMENT]");
  expect(app.seen).toEqual([]);
});

test("a document the renderer refuses is a rejection with the app's own words", async () => {
  const empty = JSON.parse(await readFile(GOLDEN, "utf8"));
  empty.title = "Nothing to draw";
  await writeFile("empty.json", JSON.stringify(empty), "utf8");

  expect(await invoke("canvas", "push", "empty.json", "--api", API)).toBe(1);

  const reported = output.err.join("\n");
  expect(reported).toContain("[CANVAS_REJECTED]");
  expect(reported).toContain("The document has nothing the canvas can draw");
});

test("a minted canvas whose token cannot be written down is handed to the terminal", async () => {
  // The moment the app mints, the registry path becomes a directory: the
  // write that follows the mint fails, and the mint has already happened.
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
  const reported = output.err.join("\n");
  expect(reported).toContain(
    "the canvas was minted and its token is not saved",
  );
  expect(reported).toContain(`${API}/c/${FIRST}#w=${TOKEN1}`);
  expect(app.seen.map((request) => request.method)).toEqual(["POST"]);
});

test("a connection that dies after the headers is reported in the CLI's words too", async () => {
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(
    0,
  );
  vi.stubGlobal("fetch", async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => {
      throw new TypeError("terminated: other side closed (10.0.0.7:443)");
    },
  }));
  output.err = [];

  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(
    1,
  );
  const reported = output.err.join("\n");
  expect(reported).toContain("[CANVAS_UNAVAILABLE]");
  expect(reported).toContain("cut off");
  expect(reported).not.toContain("10.0.0.7");
});

test("a connection that fails is reported in the CLI's words, not the runtime's", async () => {
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(
    0,
  );
  vi.stubGlobal("fetch", async () => {
    throw new TypeError(
      "fetch failed: connect ECONNREFUSED 127.0.0.1:1 (https://canvas.test/api/canvas?secret=1)",
    );
  });
  output.err = [];

  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(
    1,
  );
  const reported = output.err.join("\n");
  expect(reported).toContain("[CANVAS_UNAVAILABLE]");
  expect(reported).toContain("did not answer");
  expect(reported).not.toContain("ECONNREFUSED");
  expect(reported).not.toContain("secret=1");
});

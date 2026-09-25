import { expect, test, vi } from "vitest";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { API, GOLDEN, REGISTRY } from "./helpers/canvas.js";
import {
  ACCOUNT,
  FIRST,
  TOKEN1,
  refuse,
  setupCanvasAppTest,
} from "./helpers/canvas-app.js";

const { output, app, invoke, registry, fakeFetch, fetchMock, env } = setupCanvasAppTest();

test("the first push records a canvas and prints its links, access warning, and remove hint", async () => {
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(
    0,
  );

  expect(output.out).toEqual([
    `✓ ${API}/c/${FIRST} — rev 1 · 2 diagrams`,
    "  unlisted: anyone you share it with can open it, no sign-in needed",
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

test("a redirect is refused, and names the address it points at", async () => {
  fetchMock.mockImplementation(
    async () =>
      new Response(null, {
        status: 301,
        headers: { location: "https://prlens.dev/api/canvas" },
      }),
  );

  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(
    1,
  );

  expect(output.err.join("\n")).toContain("answered 301");
  // Without the address the person has nothing to act on.
  expect(output.err.join("\n")).toContain("https://prlens.dev/api/canvas");
  expect(output.err.join("\n")).toContain("--api");
});

test("a redirect carrying terminal escapes cannot write them to the screen", async () => {
  fetchMock.mockImplementation(
    async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://evil.test/\u001b[2Kwiped" },
      }),
  );

  await invoke("canvas", "push", "drawn.graph.json", "--api", API);

  // Content from a server we have just declined to follow.
  expect(output.err.join("\n")).not.toContain("\u001b");
  expect(output.err.join("\n")).toContain("https://evil.test/[2Kwiped");
});

const SECOND = "2".padStart(22, "0");

/** Where `render` puts the golden document, from its own title. */
const DRAWING = ".pr-lens/batch-broadcast-sending-through-postmark";
const OTHER = ".pr-lens/auth-flow";

const draw = async (directory: string, title?: string): Promise<string> => {
  await mkdir(directory, { recursive: true });
  const document = JSON.parse(await readFile(GOLDEN, "utf8")) as { title: string };
  await writeFile(
    `${directory}/drawn.graph.json`,
    JSON.stringify(title === undefined ? document : { ...document, title }),
    "utf8",
  );
  return `${directory}/drawn.graph.json`;
};

/** Each drawing has its own directory, so the path rule gives it its own canvas. */
test("two drawings are two canvases, with no flag to say so", async () => {
  await draw(DRAWING);
  await draw(OTHER, "Auth flow");

  expect(await invoke("canvas", "push", `${DRAWING}/drawn.graph.json`, "--api", API)).toBe(0);
  expect(await invoke("canvas", "push", `${OTHER}/drawn.graph.json`, "--api", API)).toBe(0);

  const entries = await registry();
  expect(Object.keys(entries).sort()).toEqual([FIRST, SECOND]);
  expect(entries[SECOND]?.name).toBe("Auth flow");
});

test("redrawing the same one is still an update", async () => {
  await draw(DRAWING);
  await invoke("canvas", "push", `${DRAWING}/drawn.graph.json`, "--api", API);
  output.out = [];

  // A correction is a new revision, not a near-identical second canvas.
  expect(await invoke("canvas", "push", `${DRAWING}/drawn.graph.json`, "--api", API)).toBe(0);

  expect(output.out[0]).toBe(`✓ ${API}/c/${FIRST} — rev 2 · 2 diagrams`);
  expect(Object.keys(await registry())).toEqual([FIRST]);
});

test("a bare push takes the checkout's only drawing", async () => {
  await rm(".pr-lens/drawn.graph.json", { force: true });
  await draw(DRAWING);
  output.out = [];

  expect(await invoke("canvas", "push", "--api", API)).toBe(0);

  expect(output.out[0]).toBe(`✓ ${API}/c/${FIRST} — rev 1 · 2 diagrams`);
});

test("and says which ones there are rather than guessing between them", async () => {
  await rm(".pr-lens/drawn.graph.json", { force: true });
  await draw(DRAWING);
  await draw(OTHER, "Auth flow");
  output.err = [];

  expect(await invoke("canvas", "push", "--api", API)).not.toBe(0);

  const said = output.err.join("\n");
  expect(said).toContain("2 drawings");
  expect(said).toContain(DRAWING);
  expect(said).toContain(OTHER);
});

test("a drawing reached through a symlink is still a drawing", async () => {
  await rm(".pr-lens/drawn.graph.json", { force: true });
  // How a shared drawings directory or another volume lands under `.pr-lens/`.
  const elsewhere = await draw("elsewhere");
  await mkdir(".pr-lens", { recursive: true });
  await symlink(resolve("elsewhere"), ".pr-lens/linked", "dir");
  output.out = [];

  expect(await invoke("canvas", "push", "--api", API)).toBe(0);

  expect(output.out[0]).toBe(`✓ ${API}/c/${FIRST} — rev 1 · 2 diagrams`);
  expect(elsewhere).toContain("elsewhere");
});

test("a file named like a drawing directory is not one", async () => {
  await rm(".pr-lens/drawn.graph.json", { force: true });
  await draw(DRAWING);
  await writeFile(".pr-lens/notes", "not a drawing", "utf8");
  await mkdir(".pr-lens/empty", { recursive: true });
  output.out = [];

  expect(await invoke("canvas", "push", "--api", API)).toBe(0);
  expect(output.out[0]).toBe(`✓ ${API}/c/${FIRST} — rev 1 · 2 diagrams`);
});

test("with nothing drawn it says to draw something", async () => {
  await rm(".pr-lens/drawn.graph.json", { force: true });
  output.err = [];

  expect(await invoke("canvas", "push", "--api", API)).not.toBe(0);

  expect(output.err.join("\n")).toContain("pr-lens render");
});

/**
 * 0.7.0 registered `.pr-lens/drawn.graph.json`. Without adoption, the first
 * push from the new layout mints a second canvas and orphans the first.
 */
test("a canvas pushed before the layout changed is adopted, not replaced", async () => {
  // Where 0.7.0's render put it; the fixture's root copy was never that path.
  const legacy = await draw(".pr-lens");
  expect(await invoke("canvas", "push", legacy, "--api", API)).toBe(0);
  await draw(DRAWING);
  output.out = [];

  expect(await invoke("canvas", "push", `${DRAWING}/drawn.graph.json`, "--api", API)).toBe(0);

  expect(output.out[0]).toBe(`✓ ${API}/c/${FIRST} — rev 2 · 2 diagrams`);
  expect(Object.keys(await registry())).toEqual([FIRST]);
  expect((await registry())[FIRST]?.source).toBe(`${DRAWING}/drawn.graph.json`);
});

test("after upgrading, a bare push adopts the old canvas instead of asking which drawing", async () => {
  await invoke("canvas", "push", await draw(".pr-lens"), "--api", API);
  await draw(DRAWING);
  output.out = [];

  expect(await invoke("canvas", "push", "--api", API)).toBe(0);

  expect(output.out[0]).toBe(`✓ ${API}/c/${FIRST} — rev 2 · 2 diagrams`);
  expect((await registry())[FIRST]?.source).toBe(`${DRAWING}/drawn.graph.json`);
});

test("and an unpushed 0.7.0 drawing does not compete with one rendered since", async () => {
  await draw(".pr-lens");
  await draw(DRAWING);
  output.out = [];

  expect(await invoke("canvas", "push", "--api", API)).toBe(0);

  expect((await registry())[FIRST]?.source).toBe(`${DRAWING}/drawn.graph.json`);
});

test("a checkout that has only rendered with 0.7.0 still pushes bare", async () => {
  const legacy = await draw(".pr-lens");
  output.out = [];

  expect(await invoke("canvas", "push", "--api", API)).toBe(0);

  expect((await registry())[FIRST]?.source).toBe(legacy);
});

test("adopting happens once, so the next drawing is still its own canvas", async () => {
  await invoke("canvas", "push", await draw(".pr-lens"), "--api", API);
  await draw(DRAWING);
  await invoke("canvas", "push", `${DRAWING}/drawn.graph.json`, "--api", API);

  await draw(OTHER, "Auth flow");
  expect(await invoke("canvas", "push", `${OTHER}/drawn.graph.json`, "--api", API)).toBe(0);

  expect(Object.keys(await registry()).sort()).toEqual([FIRST, SECOND]);
});

/**
 * `pull` and `render` write to different paths and the registry records one,
 * so the title is what links the other back to the canvas.
 */
test("pulling, rendering and pushing lands back on the canvas that was pulled", async () => {
  await invoke("canvas", "push", "drawn.graph.json", "--api", API);
  await invoke("canvas", "pull", "--api", API);
  await draw(DRAWING);
  output.out = [];

  expect(await invoke("canvas", "push", `${DRAWING}/drawn.graph.json`, "--api", API)).toBe(0);

  expect(output.out[0]).toBe(`✓ ${API}/c/${FIRST} — rev 2 · 2 diagrams`);
  expect(Object.keys(await registry())).toEqual([FIRST]);
});

test("and so does pushing the pulled document itself", async () => {
  await invoke("canvas", "push", "drawn.graph.json", "--api", API);
  await invoke("canvas", "pull", "--api", API);
  output.out = [];

  expect(await invoke("canvas", "push", ".pr-lens/graph.json", "--api", API)).toBe(0);

  expect(output.out[0]).toBe(`✓ ${API}/c/${FIRST} — rev 2 · 2 diagrams`);
  expect(Object.keys(await registry())).toEqual([FIRST]);
});

test("a title two canvases already answer to is asked about rather than guessed", async () => {
  await invoke("canvas", "push", "drawn.graph.json", "--api", API);
  await draw(OTHER, "Auth flow");
  await invoke("canvas", "push", `${OTHER}/drawn.graph.json`, "--api", API);
  // Rename the second to collide, the way `--name` lets somebody.
  const entries = await registry();
  await writeFile(
    ".pr-lens/canvas.json",
    JSON.stringify({
      canvases: {
        ...entries,
        [SECOND]: { ...entries[SECOND], name: entries[FIRST]?.name, source: undefined },
      },
    }),
    "utf8",
  );
  await draw(".pr-lens/third");
  output.err = [];

  expect(await invoke("canvas", "push", ".pr-lens/third/drawn.graph.json", "--api", API)).not.toBe(0);
  expect(output.err.join("\n")).toContain("2 canvases are named");
});

/** The app checks the account owns the canvas; the CLI only picks a credential. */
test("pushes with the account token when the registry holds no write token", async () => {
  // Signed in before the mint, so the canvas has an owner. An unowned one
  // still needs its write token.
  env().PR_LENS_TOKEN = ACCOUNT;
  await invoke("canvas", "push", "drawn.graph.json", "--api", API);
  const entries = await registry();
  // A checkout that pulled the view link: canvas known, no token.
  await writeFile(
    ".pr-lens/canvas.json",
    JSON.stringify({ canvases: { [FIRST]: { ...entries[FIRST], writeToken: undefined } } }),
    "utf8",
  );
  app.seen = [];
  output.out = [];

  const code = await invoke("canvas", "push", "drawn.graph.json", "--api", API);
  expect(code, output.err.join("\n")).toBe(0);

  const put = app.seen.find((request) => request.method === "PUT");
  expect(put?.headers.get("authorization")).toBe(`Bearer ${ACCOUNT}`);
});

test("prefers the write token when it has one", async () => {
  await invoke("canvas", "push", "drawn.graph.json", "--api", API);
  env().PR_LENS_TOKEN = ACCOUNT;
  app.seen = [];

  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(0);

  // The write token works whether or not anybody is signed in.
  const put = app.seen.find((request) => request.method === "PUT");
  expect(put?.headers.get("authorization")).toBe(`Bearer ${TOKEN1}`);
});

test("says both ways in when it has neither", async () => {
  await invoke("canvas", "push", "drawn.graph.json", "--api", API);
  const entries = await registry();
  await writeFile(
    ".pr-lens/canvas.json",
    JSON.stringify({ canvases: { [FIRST]: { ...entries[FIRST], writeToken: undefined } } }),
    "utf8",
  );
  delete env().PR_LENS_TOKEN;
  output.err = [];

  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(1);

  const said = output.err.join("\n");
  expect(said).toContain("auth login");
  expect(said).toContain("#w=");
});

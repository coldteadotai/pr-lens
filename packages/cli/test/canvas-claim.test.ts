import { expect, test } from "vitest";
import { writeFile } from "node:fs/promises";

import { API, REGISTRY } from "./helpers/canvas.js";
import {
  ACCOUNT,
  FIRST,
  TOKEN1,
  setupCanvasAppTest,
} from "./helpers/canvas-app.js";

const { output, app, invoke, registry, env, place } = setupCanvasAppTest();

const OTHER_ACCOUNT = `prl_u_${"other".padEnd(22, "b")}`;

const claim = (...args: string[]) => invoke("canvas", "claim", ...args);

const signedIn = (token = ACCOUNT): void => {
  env().PR_LENS_TOKEN = token;
};

/** A canvas this checkout pushed, so its write token is in the registry. */
const pushed = async (): Promise<void> => {
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(
    0,
  );
  output.out = [];
  output.err = [];
  app.seen = [];
};

const asked = (): string[] =>
  app.seen.map((request) => `${request.method} ${request.path}`);

test("claims with the account token, retires the token that proved it, and keeps the new one here", async () => {
  await pushed();
  signedIn();

  expect(await claim(FIRST, "--api", API)).toBe(0);

  const next = (await registry())[FIRST]?.writeToken;
  expect(next).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(next).not.toBe(TOKEN1);
  expect((await registry())[FIRST]).not.toHaveProperty("pending");

  const sent = app.seen.find((request) => request.path.endsWith("/claim"));
  expect(sent?.headers.get("authorization")).toBe(`Bearer ${ACCOUNT}`);
  expect(sent?.body).toEqual({ writeToken: TOKEN1, nextWriteToken: next });

  expect(app.canvases.get(FIRST)?.owner).toBe(ACCOUNT);
  expect(app.canvases.get(FIRST)?.token).toBe(next);

  expect(output.err).toEqual([
    "! Claiming rotates this canvas's write token.",
    "  Edit links you have already shared will stop working.",
  ]);
  expect(output.out[0]).toBe(`✓ ${API}/c/${FIRST} is yours`);

  const everything = [...output.out, ...output.err].join("\n");
  for (const secret of [next, TOKEN1, ACCOUNT])
    expect(everything).not.toContain(secret);

  // Both ends agree the rotation landed: the recorded token still pushes.
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(
    0,
  );
});

test("a second claim is refused rather than quietly rotating again", async () => {
  await pushed();
  signedIn();
  expect(await claim(FIRST, "--api", API)).toBe(0);

  const settled = (await registry())[FIRST]?.writeToken;
  output.err = [];
  app.seen = [];

  expect(await claim(FIRST, "--api", API)).toBe(1);
  expect(output.err.join("\n")).toContain(`${FIRST} is already yours`);
  expect(output.err.join("\n")).toContain("[CANVAS_OWNED]");

  // Asked who owns it and stopped there: nothing was sent to the claim route.
  expect(asked()).toEqual(["GET /api/canvases"]);
  expect((await registry())[FIRST]?.writeToken).toBe(settled);
  expect(app.canvases.get(FIRST)?.token).toBe(settled);
});

test("a canvas another account claimed first is refused, and nothing is left pending here", async () => {
  await pushed();
  place(FIRST, { token: TOKEN1, owner: OTHER_ACCOUNT });
  signedIn();

  expect(await claim(FIRST, "--api", API)).toBe(1);
  const reported = output.err.join("\n");
  expect(reported).toContain("belongs to another account");
  expect(reported).toContain("[CANVAS_OWNED]");

  expect((await registry())[FIRST]).not.toHaveProperty("pending");
  expect((await registry())[FIRST]?.writeToken).toBe(TOKEN1);
  expect(app.canvases.get(FIRST)?.token).toBe(TOKEN1);
  expect(app.canvases.get(FIRST)?.owner).toBe(OTHER_ACCOUNT);
});

test("a claim whose answer was lost keeps the token it minted, and the next run finishes it", async () => {
  await pushed();
  signedIn();
  app.loseNextAnswer = true;

  expect(await claim(FIRST, "--api", API)).toBe(1);
  expect(output.err.join("\n")).toContain("the claim may have landed");

  const pending = (await registry())[FIRST]?.pending;
  expect(pending).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect((await registry())[FIRST]?.writeToken).toBe(TOKEN1);

  // It did land: only the answer was lost.
  expect(app.canvases.get(FIRST)?.owner).toBe(ACCOUNT);
  expect(app.canvases.get(FIRST)?.token).toBe(pending);

  output.err = [];
  expect(await claim(FIRST, "--api", API)).toBe(1);
  expect(output.err.join("\n")).toContain("is already yours");

  const finished = (await registry())[FIRST];
  expect(finished?.writeToken).toBe(pending);
  expect(finished).not.toHaveProperty("pending");
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(
    0,
  );
});

test("a machine that is not signed in is told so, and the app is asked nothing", async () => {
  await pushed();

  expect(await claim(FIRST, "--api", API)).toBe(1);
  expect(output.err.join("\n")).toContain(
    "not signed in to canvas.test [AUTH_REQUIRED]",
  );
  expect(app.seen).toEqual([]);
});

test("will not send a token to another app, or claim what this checkout holds no token for", async () => {
  await pushed();
  signedIn();

  expect(await claim(FIRST, "--api", "https://elsewhere.test")).toBe(1);
  expect(output.err.join("\n")).toContain("[CANVAS_UNREGISTERED]");

  await writeFile(
    REGISTRY,
    JSON.stringify({
      canvases: {
        [FIRST]: { name: "Overview", source: "drawn.graph.json", api: API, rev: 1 },
      },
    }),
  );
  output.err = [];
  expect(await claim(FIRST, "--api", API)).toBe(1);
  expect(output.err.join("\n")).toContain("holds no write token for it");
  expect(app.seen).toEqual([]);
});

test("claim takes one canvas, named or by id", async () => {
  await pushed();
  signedIn();

  expect(await claim("--api", API)).toBe(2);
  expect(output.err.join("\n")).toContain(
    "expected the id or name of a canvas to claim",
  );
  expect(app.seen).toEqual([]);

  const name = (await registry())[FIRST]?.name;
  expect(name).toBeDefined();
  expect(await claim(String(name), "--api", API)).toBe(0);
  expect(app.canvases.get(FIRST)?.owner).toBe(ACCOUNT);
});

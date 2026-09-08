import { promisify } from "node:util";
import { expect, test } from "vitest";
import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  readFile,
  stat,
  symlink,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";

import { API, GOLDEN, REGISTRY } from "./helpers/canvas.js";
import { FIRST, TOKEN1, setupCanvasAppTest } from "./helpers/canvas-app.js";

const { output, app, invoke, registry } = setupCanvasAppTest();

const sh = promisify(execFile);

/** A pid nothing is running under: the largest Linux allows, which macOS never reaches. */
const DEAD_PID = 4194304;

test("two commands changing the registry at once both keep their canvas", async () => {
  await writeFile("other.json", await readFile(GOLDEN, "utf8"), "utf8");

  const [first, second] = await Promise.all([
    invoke("canvas", "push", "drawn.graph.json", "--api", API),
    invoke("canvas", "push", "other.json", "--api", API),
  ]);
  expect([first, second]).toEqual([0, 0]);

  const entries = await registry();
  expect(Object.keys(entries)).toHaveLength(2);
  expect(
    Object.values(entries)
      .map((entry) => entry.source)
      .sort(),
  ).toEqual(["drawn.graph.json", "other.json"]);
});

test("a lock left behind by a command that is gone is reported, with the way out, never taken over", async () => {
  const lock = `${REGISTRY}.lock`;
  await mkdir(".pr-lens", { recursive: true });
  await writeFile(lock, `${DEAD_PID}:deadbeef`, "utf8");

  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(
    1,
  );
  const reported = output.err.join("\n");
  expect(reported).toContain(
    `locked by pid ${DEAD_PID}, which is no longer running`,
  );
  expect(reported).toContain(`remove ${lock}`);
  expect(await readFile(lock, "utf8")).toBe(`${DEAD_PID}:deadbeef`);
  await expect(readFile(REGISTRY, "utf8")).rejects.toThrow();
});

test("a lock with nobody written in it is reported the same way", async () => {
  const lock = `${REGISTRY}.lock`;
  await mkdir(".pr-lens", { recursive: true });
  await writeFile(lock, "", "utf8");

  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(
    1,
  );
  expect(output.err.join("\n")).toContain("did not finish taking it");
  await expect(readFile(REGISTRY, "utf8")).rejects.toThrow();
});

test("a lock held by a command that is still running is waited for, however old, not removed", async () => {
  const lock = `${REGISTRY}.lock`;
  await mkdir(".pr-lens", { recursive: true });
  await writeFile(lock, `${process.pid}:cafebabe`, "utf8");
  const longAgo = new Date(Date.now() - 600_000);
  await utimes(lock, longAgo, longAgo);

  const pushing = invoke("canvas", "push", "drawn.graph.json", "--api", API);
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(await registry().catch(() => ({}))).toEqual({});
  expect(await readFile(lock, "utf8")).toBe(`${process.pid}:cafebabe`);
  await unlink(lock);

  expect(await pushing).toBe(0);
  expect(Object.keys(await registry())).toHaveLength(1);
});

test("a checkout git cannot read is not outside a repository", async () => {
  await sh("git", ["init", "--quiet"], { cwd: process.cwd() });
  await unlink(".git/HEAD");

  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(
    1,
  );
  expect(output.err.join("\n")).toContain("[CANVAS_REGISTRY_EXPOSED]");
  expect(app.seen).toEqual([]);
  await expect(readFile(REGISTRY, "utf8")).rejects.toThrow();
});

test("git failing for any reason but absence refuses to write the registry", async () => {
  await sh("git", ["init", "--quiet"], { cwd: process.cwd() });
  await writeFile(".git/config", "[core]\n\tthis is not a config\n", "utf8");

  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(
    1,
  );
  expect(output.err.join("\n")).toContain("[CANVAS_REGISTRY_EXPOSED]");
  expect(app.seen).toEqual([]);
  await expect(readFile(REGISTRY, "utf8")).rejects.toThrow();
});

test("the registry is refused a home git would commit", async () => {
  await sh("git", ["init", "--quiet"], { cwd: process.cwd() });
  await writeFile(".gitignore", "!.pr-lens/\n", "utf8");

  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(
    1,
  );
  expect(output.err.join("\n")).toContain("[CANVAS_REGISTRY_EXPOSED]");
  expect(app.seen).toEqual([]);
  await expect(readFile(REGISTRY, "utf8")).rejects.toThrow();

  // Ignoring the registry alone is not enough: it is staged through a
  // sibling name, and a crash would leave the tokens there.
  await writeFile(".gitignore", "!.pr-lens/\n.pr-lens/canvas.json\n", "utf8");
  output.err = [];
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(
    1,
  );
  expect(output.err.join("\n")).toContain("[CANVAS_REGISTRY_EXPOSED]");
  expect(app.seen).toEqual([]);
});

test("the registry is the owner's alone, and replaced whole", async () => {
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(
    0,
  );

  const mode = (await stat(REGISTRY)).mode & 0o777;
  expect(mode.toString(8)).toBe("600");
  await expect(stat(`${REGISTRY}.${process.pid}.tmp`)).rejects.toThrow();
});

test("an entry answers only for the app it was made against", async () => {
  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(
    0,
  );
  const pending = "pending".padEnd(22, "p");
  const entries = await registry();
  await writeFile(
    REGISTRY,
    JSON.stringify({
      canvases: {
        [FIRST]: { ...entries[FIRST], api: "https://staging.test", pending },
      },
    }),
    "utf8",
  );
  const before = (await registry())[FIRST];

  // Neither push nor rotate here may act on it, and nothing changes.
  output.err = [];
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
  ).toBe(1);
  expect(output.err.join("\n")).toContain(
    "registered against https://staging.test",
  );
  expect(app.seen).toEqual([]);
  output.err = [];
  expect(await invoke("canvas", "rotate", "--api", API)).toBe(1);
  expect(output.err.join("\n")).toContain(
    "registered against https://staging.test",
  );
  expect((await registry())[FIRST]).toEqual(before);

  // A pull of the same id from this app leaves that entry alone too, even
  // with a token this app vouches for.
  output.err = [];
  expect(await invoke("canvas", "pull", `${API}/c/${FIRST}#w=${TOKEN1}`)).toBe(
    0,
  );
  expect(output.err.join("\n")).toContain("registered against another app");
  expect((await registry())[FIRST]).toEqual(before);
});

test("a filesystem that will not take the lock is a typed failure, not a crash", async () => {
  await mkdir(".pr-lens", { recursive: true });
  await chmod(".pr-lens", 0o500);
  try {
    // Whichever write the read-only directory refuses first, the workspace
    // README or the lock, the answer is the typed file error, not a trace.
    expect(
      await invoke("canvas", "push", "drawn.graph.json", "--api", API),
    ).toBe(1);
    const reported = output.err.join("\n");
    expect(reported).toContain("[UNREADABLE_FILE]");
    expect(reported).toMatch(/cannot (write|take the lock)/);
    expect(reported).not.toContain("    at ");
  } finally {
    await chmod(".pr-lens", 0o700);
  }
});

test("a checkout whose .git is a dangling link is not outside a repository", async () => {
  await symlink("nowhere", ".git");

  expect(await invoke("canvas", "push", "drawn.graph.json", "--api", API)).toBe(
    1,
  );
  expect(output.err.join("\n")).toContain("[CANVAS_REGISTRY_EXPOSED]");
  expect(app.seen).toEqual([]);
});

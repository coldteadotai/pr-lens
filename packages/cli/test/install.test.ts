import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";

import { API } from "./helpers/canvas.js";
import { setupCanvasAppTest, TOKEN1 } from "./helpers/canvas-app.js";
import { installPath, readInstallId } from "../src/install.js";

const OTHER = "https://lens.example.com";

const made: string[] = [];

const configHome = async (): Promise<Record<string, string | undefined>> => {
  const directory = await mkdtemp(join(tmpdir(), "pr-lens-install-"));
  made.push(directory);
  return { XDG_CONFIG_HOME: directory };
};

const seed = async (
  env: Record<string, string | undefined>,
  api: string,
  contents: string,
): Promise<string> => {
  const path = installPath(env, api) as string;
  await mkdir(join(env.XDG_CONFIG_HOME as string, "pr-lens", "installs"), {
    recursive: true,
  });
  await writeFile(path, contents, "utf8");
  return path;
};

afterAll(async () => {
  await Promise.all(made.map((path) => rm(path, { recursive: true, force: true })));
});

test("mints an id on first use and reuses it afterwards", async () => {
  const env = await configHome();

  const first = await readInstallId(env, API);
  expect(first).toMatch(/^prl_i_[A-Za-z0-9_-]{22}$/);

  expect(await readInstallId(env, API)).toBe(first);
});

test("a different config home is a different machine", async () => {
  const [one, two] = [await configHome(), await configHome()];
  expect(await readInstallId(one, API)).not.toBe(await readInstallId(two, API));
});

test("one machine is a different id at every store", async () => {
  const env = await configHome();

  const hosted = await readInstallId(env, API);
  const private_ = await readInstallId(env, OTHER);

  expect(hosted).toMatch(/^prl_i_/);
  expect(private_).toMatch(/^prl_i_/);
  // A store is never told the id used anywhere else, so learning one buys
  // nothing against another.
  expect(hosted).not.toBe(private_);
  // And each is still stable on its own.
  expect(await readInstallId(env, API)).toBe(hosted);
});

test("a path differs by origin but not by the rest of the URL", async () => {
  const env = await configHome();
  expect(installPath(env, "https://prlens.dev")).toBe(
    installPath(env, "https://prlens.dev/some/where"),
  );
  expect(installPath(env, "https://prlens.dev")).not.toBe(
    installPath(env, "https://other.example"),
  );

  // Every non-http scheme has an origin of the literal "null", so filing them
  // would put unrelated stores in one place. No path, no id, no sharing.
  expect(installPath(env, "file:///tmp/store")).toBeUndefined();
  expect(installPath(env, "weird://a.example")).toBeUndefined();
});

test("keeps the id readable by its owner alone", async () => {
  const env = await configHome();
  await readInstallId(env, API);

  const path = installPath(env, API) as string;
  expect((await stat(path)).mode & 0o777).toBe(0o600);
});

test("never replaces an id that is already there", async () => {
  const env = await configHome();
  const kept = await readInstallId(env, API);
  const path = installPath(env, API) as string;
  const before = await readFile(path, "utf8");

  expect(await readInstallId(env, API)).toBe(kept);
  expect(await readFile(path, "utf8")).toBe(before);
});

test("concurrent first runs settle on one id", async () => {
  const env = await configHome();

  const racing = await Promise.all(
    Array.from({ length: 8 }, () => readInstallId(env, API)),
  );

  // Every caller must have been told the id that is actually on disk. A caller
  // handed a discarded id would mint a canvas this machine can never claim.
  const onDisk = await readInstallId(env, API);
  expect(new Set(racing)).toEqual(new Set([onDisk]));
});

test("replaces a file whose bytes say nothing usable, and keeps what it made", async () => {
  const env = await configHome();
  await seed(env, API, "{ not json");

  const repaired = await readInstallId(env, API);
  expect(repaired).toMatch(/^prl_i_/);
  // Proves the repair persisted, not merely that it answered.
  expect(await readInstallId(env, API)).toBe(repaired);
});

test("never destroys a good id it merely could not read", async () => {
  // Root reads a 0000 file, so there the read would succeed and this would
  // assert nothing at all.
  if (process.getuid?.() === 0) return;

  const env = await configHome();
  const good = await readInstallId(env, API);
  const path = installPath(env, API) as string;
  const before = await readFile(path, "utf8");

  // Unreadable, not corrupt — the id on disk is fine and the app has it.
  await chmod(path, 0o000);
  await readInstallId(env, API);
  await chmod(path, 0o600);

  expect(await readFile(path, "utf8")).toBe(before);
  expect(await readInstallId(env, API)).toBe(good);
});

test("refuses an id of the wrong shape, so a stray file cannot name the machine", async () => {
  const env = await configHome();
  await seed(env, API, JSON.stringify({ installId: "nonsense" }));

  const minted = await readInstallId(env, API);
  expect(minted).not.toBe("nonsense");
  expect(minted).toMatch(/^prl_i_/);
});

test("has no id, and no path, when nothing says where the home is", async () => {
  expect(installPath({}, API)).toBeUndefined();
  expect(await readInstallId({}, API)).toBeUndefined();
});

describe("through a push", () => {
  const { app, invoke, installId, env } = setupCanvasAppTest();

  test("names the machine that minted the canvas", async () => {
    expect(
      await invoke("canvas", "push", "drawn.graph.json", "--api", API),
    ).toBe(0);

    const sent = app.seen[0]?.headers.get("x-pr-lens-install");
    expect(sent).toMatch(/^prl_i_[A-Za-z0-9_-]{22}$/);
    // The id the app was told is the one this machine keeps, not a fresh one.
    expect(sent).toBe(await installId(API));
  });

  test("reuses the id on a second mint", async () => {
    await invoke("canvas", "push", "drawn.graph.json", "--api", API);
    // A different title, because that is what makes a second drawing: the
    // same document under another path is the same drawing, and pushing it
    // updates the canvas it already has rather than minting beside it.
    const document = JSON.parse(await readFile("drawn.graph.json", "utf8")) as {
      title: string;
    };
    await writeFile(
      "other.graph.json",
      JSON.stringify({ ...document, title: "Another drawing" }),
    );
    await invoke("canvas", "push", "other.graph.json", "--api", API);

    const mints = app.seen.filter((request) => request.method === "POST");
    expect(mints).toHaveLength(2);
    expect(mints[0]?.headers.get("x-pr-lens-install")).toBe(
      mints[1]?.headers.get("x-pr-lens-install"),
    );
  });

  test("keeps no id for a store it never minted against", async () => {
    await invoke("canvas", "push", "drawn.graph.json", "--api", API);

    expect(await installId(API)).toMatch(/^prl_i_/);
    expect(await installId(OTHER)).toBeUndefined();
  });

  test("sends the account token on the mint when CI names one", async () => {
    // The app attributes a mint to an account only from the bearer on
    // `POST /api/canvas`. A runner is a fresh machine every time, so its
    // install id is never linked: the token is the only way a workflow's
    // canvases reach the dashboard, and the Action's `token` input promises
    // exactly that.
    env().PR_LENS_TOKEN = "prl_u_" + "ci".padEnd(22, "c");

    expect(
      await invoke("canvas", "push", "drawn.graph.json", "--api", API),
    ).toBe(0);

    const mint = app.seen.find((request) => request.method === "POST");
    expect(mint?.headers.get("authorization")).toBe(
      `Bearer ${env().PR_LENS_TOKEN}`,
    );
    // And never on the push that follows: that one carries the write token.
    const push = app.seen.find((request) => request.method === "PUT");
    expect(push?.headers.get("authorization")).toBe(`Bearer ${TOKEN1}`);
  });

  test("an empty PR_LENS_TOKEN sends no authorization on the mint", async () => {
    env().PR_LENS_TOKEN = "";

    expect(
      await invoke("canvas", "push", "drawn.graph.json", "--api", API),
    ).toBe(0);
    expect(app.seen[0]?.headers.get("authorization")).toBeNull();
  });

  test("still pushes when there is nowhere to keep an id", async () => {
    delete env().XDG_CONFIG_HOME;

    expect(
      await invoke("canvas", "push", "drawn.graph.json", "--api", API),
    ).toBe(0);
    expect(app.seen[0]?.headers.get("x-pr-lens-install")).toBeNull();
  });
});

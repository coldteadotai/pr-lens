import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import { run } from "../../src/cli.js";
import type { Terminal } from "../../src/terminal.js";

export const API = "https://canvas.test";
export const REGISTRY = ".pr-lens/canvas.json";
export const GOLDEN = new URL(
  "../../../schema/examples/postmark-refactor.graph.json",
  import.meta.url,
).pathname;

type RegistryEntry = {
  name: string;
  source: string;
  api: string;
  writeToken?: string;
  pending?: string;
  rev: number;
};

export const setupCanvasTest = () => {
  const originalCwd = process.cwd();
  let directory = "";
  const output: { out: string[]; err: string[]; status: (string | undefined)[] } = {
    out: [],
    err: [],
    status: [],
  };
  // No `status` by default, like a pipe or a CI log.
  const terminal: Terminal = {
    out: (line) => output.out.push(line),
    err: (line) => output.err.push(line),
  };

  const rewritable = (): void => {
    terminal.status = (line) => output.status.push(line);
  };
  const fetchMock = vi.fn<typeof fetch>();
  /** Points the config home into the temp directory, away from the real one. */
  let env: Record<string, string | undefined> = {};
  const invoke = (...argv: string[]) => run(argv, terminal, env);
  /** Ids are kept one per origin. */
  const installId = async (api: string): Promise<string | undefined> => {
    const home = env.XDG_CONFIG_HOME;
    if (home === undefined) return undefined;
    const file = `${encodeURIComponent(new URL(api).origin)}.json`;
    return readFile(join(home, "pr-lens", "installs", file), "utf8").then(
      (text) => JSON.parse(text).installId,
      () => undefined,
    );
  };
  const registry = async (): Promise<Record<string, RegistryEntry>> =>
    JSON.parse(await readFile(REGISTRY, "utf8")).canvases;
  const createCheckout = () => mkdtemp(join(directory, "checkout-"));

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "pr-lens-canvas-"));
    process.chdir(directory);
    env = { XDG_CONFIG_HOME: join(directory, "config") };
    output.out = [];
    output.err = [];
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    await writeFile("drawn.graph.json", await readFile(GOLDEN, "utf8"), "utf8");
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    vi.unstubAllGlobals();
    await rm(directory, { recursive: true, force: true });
  });

  return { output, fetchMock, invoke, rewritable, registry, createCheckout, installId, env: () => env };
};

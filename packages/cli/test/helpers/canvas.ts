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
  const output: { out: string[]; err: string[] } = { out: [], err: [] };
  const terminal: Terminal = {
    out: (line) => output.out.push(line),
    err: (line) => output.err.push(line),
  };
  const fetchMock = vi.fn<typeof fetch>();
  const invoke = (...argv: string[]) => run(argv, terminal, {});
  const registry = async (): Promise<Record<string, RegistryEntry>> =>
    JSON.parse(await readFile(REGISTRY, "utf8")).canvases;
  const createCheckout = () => mkdtemp(join(directory, "checkout-"));

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "pr-lens-canvas-"));
    process.chdir(directory);
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

  return { output, fetchMock, invoke, registry, createCheckout };
};

import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseGraphDoc } from "@coldtea/pr-lens-schema";
import { expect, test } from "vitest";
import { run } from "../src/cli.js";
import { DRAWN_NAME, WORKSPACE_DIR } from "../src/workspace.js";

const fixture = new URL("../../schema/examples/minimal.graph.json", import.meta.url);
const graph = parseGraphDoc(JSON.parse(await readFile(fixture, "utf8")));

const setup = async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pr-lens-render-title-"));
  const workspace = join(cwd, WORKSPACE_DIR);
  return { cwd, workspace };
};

const render = async (cwd: string, title: string, ...args: string[]): Promise<void> => {
  const input = join(cwd, "input.json");
  await writeFile(input, JSON.stringify({ ...graph, title }));
  const previous = process.cwd();
  const errors: string[] = [];
  process.chdir(cwd);
  try {
    const status = await run(["render", input, "--no-config", ...args], {
      out: () => undefined,
      err: (line) => errors.push(line),
    }, {});
    expect(status, errors.join("\n")).toBe(0);
  } finally {
    process.chdir(previous);
  }
};

const drawingTitle = async (directory: string): Promise<string> =>
  parseGraphDoc(JSON.parse(await readFile(join(directory, DRAWN_NAME), "utf8"))).title;

test.each([
  ["支付流程", "用户登录"],
  ["支付", "制服"],
])("default render keeps both %s and %s and reuses their paths on redraw", async (first, second) => {
  const { cwd, workspace } = await setup();
  await render(cwd, first);
  await render(cwd, second);
  const dirs = (await readdir(workspace, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  expect(dirs).toHaveLength(2);
  expect(dirs.every((name) => /^[a-z0-9-]{1,48}$/.test(name))).toBe(true);
  const titles = await Promise.all(dirs.map((name) => drawingTitle(join(workspace, name))));
  expect(titles.sort()).toEqual([first, second].sort());

  const listing = (await readdir(workspace)).sort();
  await render(cwd, first);
  expect((await readdir(workspace)).sort()).toEqual(listing);
});

test("keeps the old drawing path for its matching title only", async () => {
  const { cwd, workspace } = await setup();
  const legacy = join(workspace, "drawing");
  await mkdir(legacy, { recursive: true });
  await writeFile(join(legacy, DRAWN_NAME), JSON.stringify({ ...graph, title: "支付流程" }));
  await render(cwd, "支付流程");
  expect(await drawingTitle(legacy)).toBe("支付流程");
  expect(await readFile(join(legacy, "manifest.json"), "utf8")).toContain("assets");

  await render(cwd, "用户登录");
  expect(await drawingTitle(legacy)).toBe("支付流程");
  expect((await readdir(workspace, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())).toHaveLength(2);
});

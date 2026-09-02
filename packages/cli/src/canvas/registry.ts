import { access } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { z } from "zod";
import { PrLensCliError, usageError } from "../errors.js";
import { readJsonFile, writeJsonFile } from "../io.js";
import type { Terminal } from "../terminal.js";
import { prepareWorkspace, WORKSPACE_DIR } from "../workspace.js";

/**
 * Which canvases this checkout has pushed, and the token each one takes. The
 * token is the only thing here that cannot be rebuilt, which is why the file
 * sits in the workspace git already ignores rather than beside the document.
 */
export const REGISTRY_PATH = join(WORKSPACE_DIR, "canvas.json");

const CANVAS_ID = /^[A-Za-z0-9_-]{22}$/;

export const isCanvasId = (value: string): boolean => CANVAS_ID.test(value);

const Entry = z.object({
  name: z.string(),
  source: z.string(),
  writeToken: z.string(),
  rev: z.number().int().nonnegative(),
});

const Registry = z.object({ canvases: z.record(z.string().regex(CANVAS_ID), Entry) });

export type CanvasEntry = z.infer<typeof Entry>;
export type CanvasRegistry = z.infer<typeof Registry>;
export type Registered = { id: string; entry: CanvasEntry };

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

export const readRegistry = async (): Promise<CanvasRegistry> => {
  if (!(await exists(REGISTRY_PATH))) return { canvases: {} };

  const parsed = Registry.safeParse(await readJsonFile(REGISTRY_PATH));
  if (!parsed.success)
    throw new PrLensCliError(
      "UNREADABLE_FILE",
      `${REGISTRY_PATH} is not a canvas registry`,
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n"),
    );

  return parsed.data;
};

export const writeRegistry = async (registry: CanvasRegistry, terminal: Terminal): Promise<void> => {
  await prepareWorkspace(WORKSPACE_DIR, terminal);
  await writeJsonFile(REGISTRY_PATH, registry);
};

/** The path as the registry records it, so the same file matches however it was spelled. */
export const sourceKey = (path: string): string => relative(process.cwd(), resolve(path));

const entries = (registry: CanvasRegistry): Registered[] =>
  Object.entries(registry.canvases).map(([id, entry]) => ({ id, entry }));

const describe = ({ id, entry }: Registered): string => `${id} (${entry.name})`;

const unregistered = (message: string, details: string): PrLensCliError =>
  new PrLensCliError("CANVAS_UNREGISTERED", message, details);

/** An id first, then a name; a name two canvases share names neither. */
export const findCanvas = (registry: CanvasRegistry, ref: string): Registered => {
  const byId = registry.canvases[ref];
  if (byId !== undefined) return { id: ref, entry: byId };

  const byName = entries(registry).filter(({ entry }) => entry.name === ref);
  const [only, ...more] = byName;
  if (only === undefined)
    throw unregistered(
      `no canvas ${JSON.stringify(ref)} in ${REGISTRY_PATH}`,
      "pass the id or name of a canvas this checkout pushed, or push without --canvas to mint one",
    );
  if (more.length > 0)
    throw usageError(
      `${byName.length} canvases are named ${JSON.stringify(ref)}`,
      `pass an id instead: ${byName.map(describe).join(", ")}`,
    );

  return only;
};

export const findBySource = (registry: CanvasRegistry, path: string): Registered | undefined => {
  const key = sourceKey(path);
  const matching = entries(registry).filter(({ entry }) => sourceKey(entry.source) === key);
  const [only, ...more] = matching;
  if (more.length > 0)
    throw unregistered(
      `${matching.length} canvases were pushed from ${key}`,
      `pass --canvas <id|name>: ${matching.map(describe).join(", ")}`,
    );

  return only;
};

/** The canvas a command means when nobody named one: the checkout's only one. */
export const onlyCanvas = (registry: CanvasRegistry): Registered => {
  const all = entries(registry);
  const [only, ...more] = all;
  if (only === undefined)
    throw unregistered(
      `no canvas in ${REGISTRY_PATH}`,
      "pr-lens canvas push mints one, or pass --canvas <id|name> for one pushed elsewhere",
    );
  if (more.length > 0)
    throw unregistered(
      `${all.length} canvases in ${REGISTRY_PATH}`,
      `pass --canvas <id|name>: ${all.map(describe).join(", ")}`,
    );

  return only;
};

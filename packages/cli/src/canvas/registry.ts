import { randomBytes } from "node:crypto";
import { access, mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { PrLensCliError, usageError } from "../errors.js";
import { git } from "../git.js";
import { readJsonFile, secretStagingPath, writeSecretJsonFile } from "../io.js";
import type { Terminal } from "../terminal.js";
import { prepareWorkspace, WORKSPACE_DIR } from "../workspace.js";

/**
 * Which canvases this checkout has pushed, and the token each one takes. The
 * token is the only thing here that cannot be rebuilt, which is why the file
 * sits in the workspace git already ignores rather than beside the document.
 */
export const REGISTRY_PATH = join(WORKSPACE_DIR, "canvas.json");

const LOCK_PATH = `${REGISTRY_PATH}.lock`;

const CANVAS_ID = /^[A-Za-z0-9_-]{22}$/;

export const isCanvasId = (value: string): boolean => CANVAS_ID.test(value);

/** A write token has the same shape as an id: 128 random bits as base64url. */
export const mintWriteToken = (): string => randomBytes(16).toString("base64url");

const Entry = z.object({
  name: z.string(),
  source: z.string(),
  writeToken: z.string(),
  /**
   * A rotation in flight: minted here and sent to the app, not yet confirmed
   * as the one on record. Kept so a lost answer is finished, not lost.
   */
  nextWriteToken: z.string().optional(),
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

/**
 * Whether git would ever take the registry. The workspace is normally ignored,
 * but a repository may un-ignore it on purpose, and a file already tracked is
 * committed whatever the rules say. A bearer token in a commit is a token
 * given to everyone with the repository, so the answer has to be no before a
 * token is written down.
 */
const assertRegistryPrivate = async (): Promise<void> => {
  const cwd = process.cwd();
  const inRepository = await git(cwd, ["rev-parse", "--is-inside-work-tree"]).then(
    () => true,
    () => false,
  );
  if (!inRepository) return;

  const tracked = (await git(cwd, ["ls-files", "--", REGISTRY_PATH])).trim() !== "";
  if (tracked)
    throw new PrLensCliError(
      "CANVAS_REGISTRY_EXPOSED",
      `${REGISTRY_PATH} is tracked by git, and it holds write tokens`,
      `git rm --cached ${REGISTRY_PATH}, make sure ${WORKSPACE_DIR}/ is ignored, then try again`,
    );

  // The registry, the file it is staged through, and the lock beside it: a
  // rule that covers the first alone leaves a token under the second name
  // whenever a write is interrupted.
  for (const path of [REGISTRY_PATH, relative(cwd, secretStagingPath(REGISTRY_PATH)), LOCK_PATH]) {
    const ignored = await git(cwd, ["check-ignore", "-q", "--", path]).then(
      () => true,
      () => false,
    );
    if (!ignored)
      throw new PrLensCliError(
        "CANVAS_REGISTRY_EXPOSED",
        `${path} is not ignored by git, and ${REGISTRY_PATH} holds write tokens`,
        `ignore the whole ${WORKSPACE_DIR}/ directory in .gitignore, then try again`,
      );
  }
};

/**
 * The workspace, ready to hold a token: on disk, ignored, and not tracked.
 * Asked before a canvas is minted, so a refusal costs nothing on the app.
 */
export const ensureRegistryHome = async (terminal: Terminal): Promise<void> => {
  await prepareWorkspace(WORKSPACE_DIR, terminal);
  await assertRegistryPrivate();
};

export const writeRegistry = async (registry: CanvasRegistry, terminal: Terminal): Promise<void> => {
  await ensureRegistryHome(terminal);
  await writeSecretJsonFile(REGISTRY_PATH, registry);
};

/** A lock left by a command that died; anything this old is not a command. */
const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 50;
const LOCK_ATTEMPTS = 100;

const isAlreadyThere = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";

/**
 * Takes the lock, or nothing. The file is created exclusively and signed with
 * this holder's nonce, so releasing it later removes this holder's lock and
 * never one that was taken over in the meantime.
 */
const takeLock = async (nonce: string): Promise<boolean> => {
  const handle = await open(LOCK_PATH, "wx").catch((error: unknown) => {
    if (isAlreadyThere(error)) return undefined;
    throw error;
  });
  if (handle === undefined) return false;
  try {
    await handle.writeFile(nonce, "utf8");
  } finally {
    await handle.close();
  }
  return true;
};

const releaseLock = async (nonce: string): Promise<void> => {
  const holder = await readFile(LOCK_PATH, "utf8").catch(() => undefined);
  if (holder === nonce) await unlink(LOCK_PATH).catch(() => undefined);
};

/**
 * Removes a lock nobody is holding any more. The lock is moved aside first,
 * and only one of several waiters can move the same file, so a lock taken
 * afresh by another waiter in the meantime is never the one removed.
 */
const reclaimStaleLock = async (nonce: string): Promise<void> => {
  const age = await stat(LOCK_PATH).then(
    (info) => Date.now() - info.mtimeMs,
    () => 0,
  );
  if (age <= LOCK_STALE_MS) return;

  const aside = `${LOCK_PATH}.stale.${nonce}`;
  const moved = await rename(LOCK_PATH, aside).then(
    () => true,
    () => false,
  );
  if (moved) await unlink(aside).catch(() => undefined);
};

/**
 * The registry is read, changed and written back as a whole, and two commands
 * doing that at once would each keep only their own change. One holds the
 * lock at a time; the other waits its turn.
 */
export const withRegistryLock = async <T>(work: () => Promise<T>): Promise<T> => {
  await mkdir(dirname(LOCK_PATH), { recursive: true });
  const nonce = `${process.pid}.${randomBytes(8).toString("hex")}`;

  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    if (await takeLock(nonce)) {
      try {
        return await work();
      } finally {
        await releaseLock(nonce);
      }
    }
    await reclaimStaleLock(nonce);
    await sleep(LOCK_WAIT_MS);
  }

  throw new PrLensCliError(
    "UNREADABLE_FILE",
    `${REGISTRY_PATH} is in use by another pr-lens command`,
    `wait for it to finish, or delete ${LOCK_PATH} if nothing is running`,
  );
};

/** One change to the registry, read and written under the lock. */
export const updateRegistry = (
  change: (registry: CanvasRegistry) => void,
  terminal: Terminal,
): Promise<CanvasRegistry> =>
  withRegistryLock(async () => {
    const registry = await readRegistry();
    change(registry);
    await writeRegistry(registry, terminal);
    return registry;
  });

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

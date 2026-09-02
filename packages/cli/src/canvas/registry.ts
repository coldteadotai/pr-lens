import { randomBytes } from "node:crypto";
import { access, link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { assertNever } from "@coldtea/pr-lens-schema";
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
  const standing = await repositoryStanding(cwd);
  switch (standing) {
    case "outside":
      return;
    case "inside":
      break;
    default:
      return assertNever(standing, "Unhandled repository standing");
  }

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

type RepositoryStanding = "inside" | "outside";

/**
 * Whether this directory is in a git work tree. Only git's own "not a
 * repository" is taken as being outside one; git failing for any other
 * reason (an owner it distrusts, a broken config, a corrupt index) leaves the
 * question open, and an open question is not permission to write a secret.
 */
const repositoryStanding = async (cwd: string): Promise<RepositoryStanding> => {
  try {
    await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
    return "inside";
  } catch (error) {
    // Git says "not a repository" about a broken checkout too, one with its
    // HEAD missing for instance, and that checkout is repaired one day with
    // whatever was written into it meanwhile. Only a tree with no .git
    // anywhere above it is outside a repository.
    const outside =
      error instanceof PrLensCliError &&
      error.details?.includes("not a git repository") === true &&
      !(await hasGitAbove(cwd));
    if (outside) return "outside";

    throw new PrLensCliError(
      "CANVAS_REGISTRY_EXPOSED",
      `git could not say whether ${REGISTRY_PATH} would be committed`,
      error instanceof PrLensCliError ? error.details : undefined,
    );
  }
};

const hasGitAbove = async (start: string): Promise<boolean> => {
  let directory = resolve(start);
  for (;;) {
    if (await exists(join(directory, ".git"))) return true;
    const parent = dirname(directory);
    if (parent === directory) return false;
    directory = parent;
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

const LOCK_WAIT_MS = 50;
const LOCK_ATTEMPTS = 100;

const isAlreadyThere = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";

/** Who holds a lock: the process, and a nonce so two lives of one pid differ. */
type Holder = { pid: number; nonce: string };

const holderOf = (text: string): Holder | undefined => {
  const [pid, nonce] = text.trim().split(":");
  const number = Number(pid);
  return Number.isInteger(number) && number > 0 && nonce !== undefined && nonce !== ""
    ? { pid: number, nonce }
    : undefined;
};

const readHolder = async (path: string): Promise<Holder | undefined> =>
  readFile(path, "utf8").then(holderOf, () => undefined);

/** Whether a process is still running here. A signal of 0 is only a question. */
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "EPERM";
  }
};

/**
 * Takes the lock, or nothing. The holder is written to a private file first
 * and that file is linked into place, so the lock either exists with its
 * holder inside or does not exist: there is no moment at which it is empty.
 */
const takeLock = async (mine: Holder): Promise<boolean> => {
  const draft = `${LOCK_PATH}.${mine.nonce}`;
  await writeFile(draft, `${mine.pid}:${mine.nonce}`, { encoding: "utf8", mode: 0o600 });
  try {
    await link(draft, LOCK_PATH);
    return true;
  } catch (error) {
    if (isAlreadyThere(error)) return false;
    throw error;
  } finally {
    await unlink(draft).catch(() => undefined);
  }
};

/**
 * No lock is ever taken away from another command by this code. Reclaiming
 * a lock means deciding its holder is gone and then removing it, and those
 * are two moments: another command can take the same path in between, and
 * the removal then lands on a live lock. Nothing that risks two writers is
 * worth a stale lock, which a person removes in a second once told which
 * process left it.
 */
const inUse = async (): Promise<PrLensCliError> => {
  const holder = await readHolder(LOCK_PATH);
  const who =
    holder === undefined
      ? "a command that did not finish taking it"
      : alive(holder.pid)
        ? `pid ${holder.pid}, which is still running`
        : `pid ${holder.pid}, which is no longer running`;
  return new PrLensCliError(
    "UNREADABLE_FILE",
    `${REGISTRY_PATH} is locked by ${who}`,
    holder !== undefined && alive(holder.pid)
      ? "wait for it to finish, then try again"
      : `remove ${LOCK_PATH} and try again; nothing is running under it`,
  );
};

/**
 * The registry is read, changed and written back as a whole, and two commands
 * doing that at once would each keep only their own change. One holds the
 * lock at a time; the other waits its turn, and gives up with the holder's
 * name when the turn does not come.
 */
export const withRegistryLock = async <T>(work: () => Promise<T>): Promise<T> => {
  await mkdir(dirname(LOCK_PATH), { recursive: true });
  const mine: Holder = { pid: process.pid, nonce: randomBytes(8).toString("hex") };

  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    if (await takeLock(mine)) {
      try {
        return await work();
      } finally {
        // Only this command's own lock is removed. The path cannot hold
        // anything else while this command holds it, since nothing here
        // takes a lock away.
        await unlink(LOCK_PATH).catch(() => undefined);
      }
    }

    const holder = await readHolder(LOCK_PATH);
    if (holder === undefined || !alive(holder.pid)) break;
    await sleep(LOCK_WAIT_MS);
  }

  throw await inUse();
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

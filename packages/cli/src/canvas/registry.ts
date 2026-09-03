import { randomBytes } from "node:crypto";
import type { Stats } from "node:fs";
import { access, link, lstat, mkdir, readFile, realpath, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { assertNever } from "@coldtea/pr-lens-schema";
import { z } from "zod";
import { PrLensCliError, usageError } from "../errors.js";
import { git } from "../git.js";
import { readJsonFile, secretStagingPath, writeSecretJsonFile } from "../io.js";
import type { Terminal } from "../terminal.js";
import { prepareWorkspace, WORKSPACE_DIR } from "../workspace.js";

/** Holds write tokens, the one thing here nothing can rebuild. */
export const REGISTRY_PATH = join(WORKSPACE_DIR, "canvas.json");

const LOCK_PATH = `${REGISTRY_PATH}.lock`;

const CANVAS_ID = /^[A-Za-z0-9_-]{22}$/;

export const isCanvasId = (value: string): boolean => CANVAS_ID.test(value);

export const mintWriteToken = (): string => randomBytes(16).toString("base64url");

const Entry = z.object({
  name: z.string(),
  source: z.string(),
  /** Another app's answers, its 404 above all, say nothing about this entry. */
  api: z.string(),
  /** Absent for a canvas pulled by its view link. */
  writeToken: z.string().optional(),
  /** Next token of a rotation whose answer has not arrived yet, so it can be asked again. */
  pending: z.string().optional(),
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

/** A token in a commit is a token given to everyone with the repository. */
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

  // An interrupted write leaves the tokens under the staging name.
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

/** Any git failure but "not a repository" leaves the question open, and an open question is no permission to write a secret. */
const repositoryStanding = async (cwd: string): Promise<RepositoryStanding> => {
  try {
    await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
    return "inside";
  } catch (error) {
    // Git says "not a repository" about a checkout with a missing HEAD too,
    // and that checkout gets repaired one day.
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

const isMissing = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR");

/** lstat, not stat: a dangling `.git` link is still a checkout. */
const gitEntryAt = (directory: string): Promise<boolean> =>
  lstat(join(directory, ".git")).then(
    () => true,
    (error: unknown) => {
      if (isMissing(error)) return false;
      throw new PrLensCliError(
        "CANVAS_REGISTRY_EXPOSED",
        `${join(directory, ".git")} could not be looked at, so ${REGISTRY_PATH} might be committed`,
        error instanceof Error ? error.message : String(error),
      );
    },
  );

const hasGitAbove = async (start: string): Promise<boolean> => {
  let directory = resolve(start);
  for (;;) {
    if (await gitEntryAt(directory)) return true;
    const parent = dirname(directory);
    if (parent === directory) return false;
    directory = parent;
  }
};

/** Asked before a canvas is minted, so a refusal costs nothing on the app. */
export const ensureRegistryHome = async (terminal: Terminal): Promise<void> => {
  await prepareWorkspace(WORKSPACE_DIR, terminal);
  await assertRegistryPrivate();
};

const reservedRegistryPaths = (): string[] => [resolve(REGISTRY_PATH), resolve(LOCK_PATH), secretStagingPath(REGISTRY_PATH)];

const sameFile = (a: Stats, b: Stats): boolean => a.dev === b.dev && a.ino === b.ino;

/** Case-blind and by inode, because spelling is not identity on the usual filesystems. */
export const isReservedRegistryTarget = async (path: string): Promise<boolean> => {
  const target = resolve(path);
  const reserved = reservedRegistryPaths();
  const names = reserved.map((entry) => basename(entry).toLowerCase());

  // Spelling first: a fresh checkout has nothing on disk to compare yet.
  const workspaceDir = dirname(reserved[0] ?? target);
  if (dirname(target).toLowerCase() === workspaceDir.toLowerCase() && names.includes(basename(target).toLowerCase()))
    return true;

  const workspace = await realpath(workspaceDir).catch(() => undefined);
  const parent = await realpath(dirname(target)).catch(() => undefined);
  if (workspace !== undefined && parent === workspace && names.includes(basename(target).toLowerCase())) return true;

  const existing = await stat(target).catch(() => undefined);
  if (existing === undefined) return false;
  for (const entry of reserved) {
    const kept = await stat(entry).catch(() => undefined);
    if (kept !== undefined && sameFile(existing, kept)) return true;
  }
  return false;
};

export const writeRegistry = async (registry: CanvasRegistry, terminal: Terminal): Promise<void> => {
  await ensureRegistryHome(terminal);
  await writeSecretJsonFile(REGISTRY_PATH, registry);
};

const LOCK_WAIT_MS = 50;
const LOCK_ATTEMPTS = 100;

const isAlreadyThere = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";

/** A nonce beside the pid, since pids are reused. */
type Holder = { pid: number; nonce: string };

const holderOf = (text: string): Holder | undefined => {
  const [pid, nonce] = text.trim().split(":");
  const number = Number(pid);
  return Number.isInteger(number) && number > 0 && nonce !== undefined && nonce !== ""
    ? { pid: number, nonce }
    : undefined;
};

type LockState = { type: "absent" } | { type: "held"; holder: Holder } | { type: "unfinished" };

const readLock = (path: string): Promise<LockState> =>
  readFile(path, "utf8").then(
    (text) => {
      const holder = holderOf(text);
      return holder === undefined ? { type: "unfinished" } : { type: "held", holder };
    },
    (error: unknown) => (isMissing(error) ? { type: "absent" } : { type: "unfinished" }),
  );

const cannotLock = (error: unknown): PrLensCliError =>
  new PrLensCliError(
    "UNREADABLE_FILE",
    `cannot take the lock on ${REGISTRY_PATH}`,
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? `the filesystem answered ${error.code} for ${LOCK_PATH}`
      : `the filesystem refused ${LOCK_PATH}`,
  );

/** Signal 0 only asks. */
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "EPERM";
  }
};

/** Written first, linked into place second, so the lock is never empty. */
const takeLock = async (mine: Holder): Promise<boolean> => {
  const draft = `${LOCK_PATH}.${mine.nonce}`;
  await writeFile(draft, `${mine.pid}:${mine.nonce}`, { encoding: "utf8", mode: 0o600 }).catch((error: unknown) => {
    throw cannotLock(error);
  });
  try {
    await link(draft, LOCK_PATH);
    return true;
  } catch (error) {
    if (isAlreadyThere(error)) return false;
    throw cannotLock(error);
  } finally {
    await unlink(draft).catch(() => undefined);
  }
};

/**
 * Nothing here ever removes another command's lock: deciding a holder is
 * gone and removing its lock are two moments, and a live lock can slip in
 * between. A stale lock is cheap for a person to remove once told whose it is.
 */
const inUse = (lock: LockState): PrLensCliError => {
  const who = (() => {
    switch (lock.type) {
      case "absent":
        return "commands taking turns faster than this one could get one";
      case "unfinished":
        return "a command that did not finish taking it";
      case "held":
        return alive(lock.holder.pid)
          ? `pid ${lock.holder.pid}, which is still running`
          : `pid ${lock.holder.pid}, which is no longer running`;
      default:
        return assertNever(lock, "Unhandled lock state");
    }
  })();
  const running = lock.type === "absent" || (lock.type === "held" && alive(lock.holder.pid));
  return new PrLensCliError(
    "UNREADABLE_FILE",
    `${REGISTRY_PATH} is locked by ${who}`,
    running ? "wait for it to finish, then try again" : `remove ${LOCK_PATH} and try again; nothing is running under it`,
  );
};

/** Two commands writing the whole file at once would each keep only their own change. */
export const withRegistryLock = async <T>(work: () => Promise<T>): Promise<T> => {
  await mkdir(dirname(LOCK_PATH), { recursive: true }).catch((error: unknown) => {
    throw cannotLock(error);
  });
  const mine: Holder = { pid: process.pid, nonce: randomBytes(8).toString("hex") };

  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    if (await takeLock(mine)) {
      try {
        return await work();
      } finally {
        await unlink(LOCK_PATH).catch(() => undefined);
      }
    }

    const lock = await readLock(LOCK_PATH);
    switch (lock.type) {
      case "absent":
        continue;
      case "unfinished":
        throw inUse(lock);
      case "held":
        if (!alive(lock.holder.pid)) throw inUse(lock);
        await sleep(LOCK_WAIT_MS);
        continue;
      default:
        return assertNever(lock, "Unhandled lock state");
    }
  }

  throw inUse(await readLock(LOCK_PATH));
};

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

export const sourceKey = (path: string): string => relative(process.cwd(), resolve(path));

const entries = (registry: CanvasRegistry): Registered[] =>
  Object.entries(registry.canvases).map(([id, entry]) => ({ id, entry }));

const describe = ({ id, entry }: Registered): string => `${id} (${entry.name})`;

const unregistered = (message: string, details: string): PrLensCliError =>
  new PrLensCliError("CANVAS_UNREGISTERED", message, details);

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

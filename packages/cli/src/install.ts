/**
 * Names this machine to a store so a later sign-in can claim what it pushed.
 *
 * Kept per store, since whoever holds the id can have this machine's canvases
 * attributed to them. Never put in a link, unlike a write token.
 */
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

import { originPath } from "./config-home.js";

const INSTALLS = "installs";

const PREFIX = "prl_i_";

const INSTALL_ID = /^prl_i_[A-Za-z0-9_-]{22}$/;

export const installPath = (
  env: Record<string, string | undefined>,
  api: string,
): string | undefined => originPath(env, INSTALLS, api);

const idIn = (text: string): string | undefined => {
  const contents = ((): unknown => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return undefined;
    }
  })();
  if (typeof contents !== "object" || contents === null) return undefined;

  const { installId } = contents as { installId?: unknown };
  return typeof installId === "string" && INSTALL_ID.test(installId)
    ? installId
    : undefined;
};

/** Unreadable counts as absent: a machine with no id still pushes. */
const storedId = (path: string): Promise<string | undefined> =>
  readFile(path, "utf8").then(idIn, () => undefined);

export const readStoredInstallId = async (
  env: Record<string, string | undefined>,
  api: string,
): Promise<string | undefined> => {
  const path = installPath(env, api);
  return path === undefined ? undefined : storedId(path);
};

const write = async (path: string): Promise<string> => {
  const minted = `${PREFIX}${randomBytes(16).toString("base64url")}`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify({ installId: minted }, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  return minted;
};

const alreadyThere = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "EEXIST";

/**
 * Exclusive create settles two first runs without a lock: the loser reads the
 * winner's id. Repairing a junk file can race under concurrency; accepted as rare.
 */
const create = async (path: string): Promise<string | undefined> => {
  try {
    return await write(path);
  } catch (error) {
    if (!alreadyThere(error)) return undefined;

    // One read, so a peer's repair cannot land between two.
    const text = await readFile(path, "utf8").catch(() => undefined);

    // An unreadable file may hold an id the app already has; never delete it.
    if (text === undefined) return undefined;

    const won = idIn(text);
    if (won !== undefined) return won;

    const cleared = await rm(path, { force: true }).then(
      () => true,
      () => false,
    );
    if (!cleared) return undefined;

    return write(path).catch(() => storedId(path));
  }
};

/** Failures answer undefined: attribution is never worth breaking a push. */
export const readInstallId = async (
  env: Record<string, string | undefined>,
  api: string,
): Promise<string | undefined> => {
  const path = installPath(env, api);
  if (path === undefined) return undefined;

  return (await storedId(path)) ?? (await create(path));
};

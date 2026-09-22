/**
 * What this machine is called when it pushes a canvas, so that signing in
 * later can claim everything it has already sent.
 *
 * It lives beside the account credentials rather than in `.pr-lens/`, because
 * it belongs to the machine and not to any one checkout: the same id is meant
 * to cover every repository a person draws from. It is also never put in a
 * link, which is what separates it from a write token — an edit link carries
 * its token in the fragment and gets pasted into chat, so ownership taken
 * from possession of one would leak with every link ever shared.
 *
 * One id per store, not one per machine. The id is what links a machine to an
 * account, so whoever holds it can have this machine's canvases attributed to
 * them; sending the same one to every `--api` would hand that to a private
 * store, or to a host someone was talked into passing. Account credentials
 * will be kept per origin for the same reason.
 *
 * A file is made by exclusive create and then left alone, so two first runs
 * settle without a lock: the loser reads the winner's id instead of minting a
 * second machine. The one exception is repair, below, which has a ceiling.
 */
import { join, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

const DIRECTORY = "pr-lens";
const INSTALLS = "installs";

/** The same 128 random bits the app's ids use, behind a prefix that names the kind. */
const PREFIX = "prl_i_";

const INSTALL_ID = /^prl_i_[A-Za-z0-9_-]{22}$/;

/**
 * Read from the environment the caller was given rather than the process, so
 * that a test never writes to the real home directory, and so a run with
 * nothing set is a run without an install id rather than a guess.
 */
const configHome = (env: Record<string, string | undefined>): string | undefined => {
  const xdg = env.XDG_CONFIG_HOME;
  if (xdg) return xdg;

  const home = env.HOME || env.USERPROFILE;
  return home ? join(home, ".config") : undefined;
};

/**
 * Percent-encoded, so one file name can hold an origin and still be a file
 * name. Only the two schemes the API speaks: every other scheme has an origin
 * of the literal "null", which would file unrelated stores together in the one
 * function whose whole job is that stores never share.
 */
const fileFor = (api: string): string | undefined => {
  try {
    const { protocol, origin } = new URL(api);
    if (protocol !== "http:" && protocol !== "https:") return undefined;
    return `${encodeURIComponent(origin)}.json`;
  } catch {
    return undefined;
  }
};

export const installPath = (
  env: Record<string, string | undefined>,
  api: string,
): string | undefined => {
  const home = configHome(env);
  const file = fileFor(api);
  return home === undefined || file === undefined
    ? undefined
    : join(home, DIRECTORY, INSTALLS, file);
};

/** Pure, so that "these bytes say nothing usable" is answerable without a read. */
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

/** Anything unreadable is treated as absent: a machine with no id still pushes. */
const storedId = (path: string): Promise<string | undefined> =>
  readFile(path, "utf8").then(idIn, () => undefined);

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
 * Exclusive create, falling back to whatever won the race.
 *
 * Anything other than the file already existing — a read-only home, no
 * entropy — answers undefined on the first attempt, and the caller mints
 * unattributed.
 *
 * Repair is deliberately narrow: only a file whose bytes were read and say
 * nothing usable is cleared. Its ceiling is concurrency — several runs
 * repairing one junk file can each be handed an id that is not the one left
 * on disk, or none at all. Closing that needs deletion by identity rather
 * than by path, which is more machinery than a corrupt install.json is worth;
 * with the read/junk distinction above, reaching it at all is rare.
 */
const create = async (path: string): Promise<string | undefined> => {
  try {
    return await write(path);
  } catch (error) {
    if (!alreadyThere(error)) return undefined;

    // One read answers both questions. Reading twice leaves a gap for a peer's
    // repair to land in, and the second read then reports a file the first
    // never saw — handing back nothing while a good id sits on disk.
    const text = await readFile(path, "utf8").catch(() => undefined);

    // Never delete what cannot be seen. An unreadable file may hold an id
    // already sent to the app, and unlinking is governed by the directory
    // rather than the file, so a run that cannot read it can still remove it.
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

/**
 * This machine's id for one store, minting one on first use.
 *
 * Every failure answers `undefined`, and the caller mints the canvas without
 * an install id, exactly as it did before this existed. Attribution is worth
 * having but it is not worth a push that used to work and now does not —
 * there is no home directory on some runners, and a read-only one on others.
 */
export const readInstallId = async (
  env: Record<string, string | undefined>,
  api: string,
): Promise<string | undefined> => {
  const path = installPath(env, api);
  if (path === undefined) return undefined;

  return (await storedId(path)) ?? (await create(path));
};

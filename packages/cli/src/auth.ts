/**
 * The credential that signs this machine in, on disk.
 *
 * One file per store, beside the install ids and for the same reason: a token
 * is enough to be someone at the store that issued it, so a single file
 * holding every store's token is a single file to send to the wrong one.
 *
 * It is also what settles two shells signing in at once. A file per origin
 * means the only thing they can race for is the same origin's token, where
 * the last write is the right answer — both tokens work, and the later one is
 * the one the person just asked for. A map keyed by origin would have to be
 * read and then written back, and the shell that lost would take a token for
 * an origin it never touched down with it.
 *
 * `0600`, because the whole point of the file is that nobody else on the
 * machine can be you; `0700` on the directory, because the names in it say
 * which stores this person has signed in to.
 */
import { dirname } from "node:path";
import { mkdir, readFile, rm } from "node:fs/promises";

import { PrLensCliError } from "./errors.js";
import { writeSecretJsonFile } from "./io.js";
import { originPath } from "./config-home.js";

const CREDENTIALS = "auth";

/**
 * Read with `||` and never `??`.
 *
 * The Action sets this key to the empty string when no token was given —
 * GitHub Actions has no way to leave an `env` key out conditionally — so
 * `??` would read a blank as a credential and send every workflow run an
 * authorization header with nothing behind it.
 */
export const TOKEN_ENV = "PR_LENS_TOKEN";

/** The app's account tokens: a prefix naming the kind, then 128 bits of base64url. */
const ACCOUNT_TOKEN = /^prl_u_[A-Za-z0-9_-]{22}$/;

export const authPath = (
  env: Record<string, string | undefined>,
  api: string,
): string | undefined => originPath(env, CREDENTIALS, api);

export type Credential = { token: string; signedInAt: string | undefined };

/**
 * Could not read it, and is wrong, and is absent are three answers.
 *
 * A home directory that is momentarily unreadable is not a person who is
 * signed out, and nothing here deletes what it could not understand — the
 * bytes may be a working token this version simply failed to open, and
 * `auth logout` is the one place a person asks for the file to go.
 */
export type CredentialRead =
  | { type: "credential"; path: string; credential: Credential }
  | { type: "none" }
  | { type: "unreadable"; path: string; why: string };

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const missing = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "ENOENT";

/** Pure, so "these bytes say nothing usable" is answerable without a read. */
const credentialIn = (text: string): Credential | undefined => {
  const contents = ((): unknown => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return undefined;
    }
  })();
  if (typeof contents !== "object" || contents === null) return undefined;

  const { token, signedInAt } = contents as {
    token?: unknown;
    signedInAt?: unknown;
  };
  if (typeof token !== "string" || !ACCOUNT_TOKEN.test(token)) return undefined;

  return {
    token,
    signedInAt: typeof signedInAt === "string" ? signedInAt : undefined,
  };
};

export const readCredential = async (
  env: Record<string, string | undefined>,
  api: string,
): Promise<CredentialRead> => {
  const path = authPath(env, api);
  if (path === undefined) return { type: "none" };

  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    return missing(error)
      ? { type: "none" }
      : { type: "unreadable", path, why: describe(error) };
  }

  const credential = credentialIn(text);
  return credential === undefined
    ? { type: "unreadable", path, why: "it holds no token this CLI can read" }
    : { type: "credential", path, credential };
};

/**
 * The token to send, from the environment first.
 *
 * Every failure answers undefined and the caller goes on unauthenticated,
 * which is the property the install id has and for the same reason: a push
 * has never needed an account, and nothing added here may be the thing that
 * makes one start failing.
 */
export const readToken = async (
  env: Record<string, string | undefined>,
  api: string,
): Promise<string | undefined> => {
  const given = env[TOKEN_ENV];
  if (given) return given;

  const stored = await readCredential(env, api);
  return stored.type === "credential" ? stored.credential.token : undefined;
};

export const writeCredential = async (
  env: Record<string, string | undefined>,
  api: string,
  token: string,
  now: string,
): Promise<string> => {
  const path = authPath(env, api);
  if (path === undefined)
    throw new PrLensCliError(
      "UNREADABLE_FILE",
      "there is no home directory to keep this sign-in in",
      "set HOME, or XDG_CONFIG_HOME, to somewhere this machine can write",
    );

  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  return writeSecretJsonFile(path, { api, token, signedInAt: now });
};

/**
 * Signing out, which is the one thing allowed to remove a file it could not
 * read — and the only place that removes this file at all.
 *
 * The removal is what reports whether there was anything to remove, rather
 * than a read before it: reading first would let a sign-in that landed in
 * another shell in between be thrown away as though it had been seen.
 */
export const forgetCredential = async (
  env: Record<string, string | undefined>,
  api: string,
): Promise<boolean> => {
  const path = authPath(env, api);
  if (path === undefined) return false;

  try {
    await rm(path);
    return true;
  } catch (error) {
    if (missing(error)) return false;
    throw new PrLensCliError(
      "UNREADABLE_FILE",
      `cannot remove ${path}`,
      describe(error),
    );
  }
};

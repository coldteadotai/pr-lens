/**
 * The sign-in credential on disk, one file per store so a token never reaches
 * the wrong one. A file per origin also means two shells signing in at once
 * can only race on the same origin, where the last write wins correctly.
 * `0600` on the file, `0700` on the directory: the file names reveal which
 * stores this person signs in to.
 */
import { dirname } from "node:path";
import { mkdir, readFile, rm } from "node:fs/promises";
import { assertNever } from "@coldtea/pr-lens-schema";

import { PrLensCliError } from "./errors.js";
import { writeSecretJsonFile } from "./io.js";
import { originPath } from "./config-home.js";

const CREDENTIALS = "auth";

/**
 * Read with `||`, never `??`: the Action sets it to "" when no token was
 * given, since Actions cannot omit an `env` key conditionally.
 */
export const TOKEN_ENV = "PR_LENS_TOKEN";

const ACCOUNT_TOKEN = /^prl_u_[A-Za-z0-9_-]{22}$/;

export const authPath = (
  env: Record<string, string | undefined>,
  api: string,
): string | undefined => originPath(env, CREDENTIALS, api);

export type Credential = { token: string; signedInAt: string | undefined };

/**
 * An unreadable file is kept apart from a missing one and never deleted here:
 * it may hold a working token. Only `auth logout` removes it.
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

/** Every failure answers undefined, so a push never starts failing over an account. */
export const readToken = async (
  env: Record<string, string | undefined>,
  api: string,
): Promise<string | undefined> => {
  const given = env[TOKEN_ENV];
  if (given) return given;

  const stored = await readCredential(env, api);
  return stored.type === "credential" ? stored.credential.token : undefined;
};

/**
 * For account commands, which must tell an unreadable file apart from being
 * signed out rather than advise signing in again.
 */
export const requireToken = async (
  env: Record<string, string | undefined>,
  api: string,
): Promise<string> => {
  const given = env[TOKEN_ENV];
  if (given) return given;

  const host = new URL(api).host;
  const stored = await readCredential(env, api);
  switch (stored.type) {
    case "credential":
      return stored.credential.token;
    case "unreadable":
      throw new PrLensCliError(
        "UNREADABLE_FILE",
        `the sign-in for ${host} cannot be read`,
        [
          `${stored.path}: ${stored.why}`,
          "pr-lens auth logout clears it, and then auth login writes a fresh one",
        ].join("\n"),
      );
    case "none":
      throw new PrLensCliError(
        "AUTH_REQUIRED",
        `not signed in to ${host}`,
        "pr-lens auth login",
      );
    default:
      return assertNever(stored, "Unhandled credential read");
  }
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
 * The only place that removes the file, readable or not. No read first: a
 * sign-in from another shell in between would be thrown away unseen.
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

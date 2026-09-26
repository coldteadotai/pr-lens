import { readString } from "../args.js";
import { readToken } from "../auth.js";
import { rotateCanvas } from "./api.js";
import type { Terminal } from "../terminal.js";
import { PrLensCliError, usageError } from "../errors.js";
import { updateRegistry, type Registered } from "./registry.js";

export const DEFAULT_API = "https://prlens.dev";
export const API_ENV = "PR_LENS_API_URL";

/**
 * `||` for the environment: a workflow cannot omit an `env` key, so it sets
 * it to "". The flag keeps `??`, so a typed `--api ""` is reported.
 */
export const readApi = (
  value: unknown,
  env: Record<string, string | undefined>,
): string => {
  const api = readString(value, "api") ?? (env[API_ENV] || DEFAULT_API);
  try {
    new URL(api);
  } catch {
    throw usageError(`--api needs a URL, got ${JSON.stringify(api)}`);
  }
  return api.replace(/\/+$/, "");
};

/** Another app's 404 says nothing about this entry, so it must not change it. */
export const requireSameApi = (
  api: string,
  { id, entry }: Registered,
): void => {
  if (entry.api === api) return;
  throw new PrLensCliError(
    "CANVAS_UNREGISTERED",
    `${id} is registered against ${entry.api}, not ${api}`,
    `pass --api ${entry.api}, or push the document without --canvas to mint a canvas here`,
  );
};

export const requireWriteToken = ({ id, entry }: Registered): string => {
  if (entry.writeToken !== undefined) return entry.writeToken;
  throw new PrLensCliError(
    "CANVAS_UNREGISTERED",
    `this checkout can read ${id} but holds no write token for it`,
    "pull its edit link, the one with #w= at the end, and the token comes with it",
  );
};

/**
 * The write token first: it works signed out and on stores without accounts.
 * The account token only works if the app finds the account owns the canvas.
 */
export const writeCredential = async (
  registered: Registered,
  env: Record<string, string | undefined>,
  api: string,
): Promise<string> => {
  if (registered.entry.writeToken !== undefined) return registered.entry.writeToken;

  const account = await readToken(env, api);
  if (account !== undefined) return account;

  throw new PrLensCliError(
    "CANVAS_UNREGISTERED",
    `this checkout can read ${registered.id} but holds no write token for it`,
    [
      "pr-lens auth login signs this machine in, and an owner needs no token",
      "or pull its edit link, the one with #w= at the end, and the token comes with it",
    ].join("\n"),
  );
};

const unfinishedRotation = (error: PrLensCliError): PrLensCliError =>
  new PrLensCliError(
    error.code,
    `${error.message}; the rotation is not finished`,
    [
      error.details,
      "run pr-lens canvas rotate again to finish it: the new token is kept until the app confirms it",
    ]
      .filter((line) => line !== undefined && line !== "")
      .join("\n"),
  );

/** Asking again with the same pair is safe: the app answers "rotated" once the token is on record. */
export const settleRotation = async (
  api: string,
  { id, entry }: Registered,
  nextToken: string,
  terminal: Terminal,
  env: Record<string, string | undefined>,
): Promise<{ registered: Registered; editUrl: string }> => {
  const rotated = await rotateCanvas(
    api,
    id,
    await writeCredential({ id, entry }, env, api),
    nextToken,
  ).catch(async (error: unknown) => {
    if (!(error instanceof PrLensCliError)) throw error;
    if (error.code !== "CANVAS_UNKNOWN") throw unfinishedRotation(error);

    // Final: a pending token that was current would have been answered
    // "rotated". Drop it now, or a token imported later would carry it out.
    await updateRegistry((registry) => {
      const current = registry.canvases[id];
      if (
        current === undefined ||
        current.pending !== nextToken ||
        current.api !== api
      )
        return;
      registry.canvases[id] = { ...current, pending: undefined };
    }, terminal);
    throw new PrLensCliError(
      error.code,
      `${error.message}; the pending rotation was dropped`,
      error.details,
    );
  });

  // A different token pending by now belongs to a later rotation.
  await updateRegistry((registry) => {
    const current = registry.canvases[id];
    if (
      current === undefined ||
      current.pending !== nextToken ||
      current.api !== api
    )
      return;
    registry.canvases[id] = {
      ...current,
      writeToken: nextToken,
      pending: undefined,
    };
  }, terminal);

  return {
    registered: {
      id,
      entry: { ...entry, writeToken: nextToken, pending: undefined },
    },
    editUrl: rotated.editUrl,
  };
};

export const settlePendingRotation = async (
  api: string,
  registered: Registered,
  terminal: Terminal,
  env: Record<string, string | undefined>,
): Promise<Registered> => {
  requireSameApi(api, registered);

  const pending = registered.entry.pending;
  if (pending === undefined) return registered;

  return (await settleRotation(api, registered, pending, terminal, env)).registered;
};

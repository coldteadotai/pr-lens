/**
 * Talking to the app about who this machine belongs to.
 *
 * The sign-in half is the OAuth 2.0 device grant, RFC 8628: the terminal asks
 * for a code, a person approves it in a browser that may be on another
 * device entirely, and the terminal polls until somebody answers. It is the
 * only flow that works over SSH and inside a container, which is where a CLI
 * spends much of its life.
 *
 * The wire vocabulary here is the RFC's — `authorization_pending`,
 * `slow_down`, `access_denied`, `expired_token` — and not this CLI's error
 * codes, because the app answers every device-flow client that way and it is
 * the one place a standard is more useful than a house style.
 */
import { z } from "zod";
import { createHash } from "node:crypto";
import { assertNever } from "@coldtea/pr-lens-schema";

import { CLI_VERSION } from "./version.js";
import { PrLensCliError } from "./errors.js";

const REQUEST_TIMEOUT_MS = 30_000;

const hostOf = (api: string): string => new URL(api).host;

const unavailable = (
  api: string,
  details: string,
  status?: number,
): PrLensCliError =>
  new PrLensCliError(
    "APP_UNAVAILABLE",
    status === undefined
      ? `${hostOf(api)} did not answer`
      : `${hostOf(api)} answered ${status}`,
    details,
  );

type Answer = { status: number; body: unknown };

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const send = async (
  api: string,
  path: string,
  init: { method: "GET" | "POST" | "DELETE"; token?: string; body?: unknown },
): Promise<Answer> => {
  const headers: Record<string, string> = {
    accept: "application/json",
    "user-agent": `pr-lens-cli/${CLI_VERSION}`,
  };
  if (init.token !== undefined) headers.authorization = `Bearer ${init.token}`;
  if (init.body !== undefined) headers["content-type"] = "application/json";

  const response = await fetch(`${api}${path}`, {
    method: init.method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    // Never followed, for the reason the canvas API gives: a hop would carry
    // the install id — and here a token — to whatever host answered.
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => {
    // The runtime's message names addresses and internals; keep it out.
    throw unavailable(api, "check the address and the connection, then try again");
  });

  if (response.status >= 300 && response.status < 400)
    throw unavailable(api, "the sign-in routes answer where they are asked, and this one redirects", response.status);

  const text = await response.text().catch(() => {
    throw unavailable(api, "the answer was cut off; check the connection, then try again", response.status);
  });

  return { status: response.status, body: parseJson(text) };
};

/** The app's refusals outside the device flow, which keep this app's shape. */
const Refusal = z.object({
  error: z.looseObject({ code: z.string(), message: z.string() }),
});

const Started = z.object({
  device_code: z.string().min(1),
  user_code: z.string().min(1),
  verification_uri: z.string().min(1),
  verification_uri_complete: z.string().min(1).optional(),
  expires_in: z.number().int().positive(),
  interval: z.number().int().nonnegative().optional(),
});

export type StartedSignIn = {
  deviceCode: string;
  userCode: string;
  /** Already carrying the code, so nobody has to type it. */
  approveUrl: string;
  expiresInSeconds: number;
  intervalSeconds: number;
};

/** RFC 8628 §3.2 names it as the floor, and as the default when none is served. */
export const DEFAULT_INTERVAL_SECONDS = 5;

/**
 * Asks for a code, and names the machine the approval will link.
 *
 * The install id travels with the request rather than with the approval,
 * because the browser that approves may be on someone's phone and has no way
 * to know which machine asked. It is the machine that becomes the account's,
 * so the grant has to know which one from the first round trip.
 */
export const startSignIn = async (
  api: string,
  installId: string,
  client: string,
  name: string,
): Promise<StartedSignIn> => {
  const answer = await send(api, "/api/device/code", {
    method: "POST",
    body: { install_id: installId, client, name },
  });

  if (answer.status !== 200) {
    const refused = Refusal.safeParse(answer.body);
    const code = refused.success ? refused.data.error.code : undefined;
    // Twenty codes an hour from one address. Somebody who mistyped and came
    // back is far likelier than an attacker, so this says what to do next
    // rather than what it suspects.
    throw code === "RATE_LIMITED"
      ? new PrLensCliError(
          "APP_UNAVAILABLE",
          `${hostOf(api)} has handed this machine enough sign-in codes for now`,
          "it goes by the hour, so a short wait clears it; the sign-in you already have is unaffected",
        )
      : unavailable(
          api,
          refused.success ? refused.data.error.message : "the answer was not in the shape the sign-in expects",
          answer.status,
        );
  }

  const started = Started.safeParse(answer.body);
  if (!started.success)
    throw unavailable(api, "the answer was not in the shape the sign-in expects", answer.status);

  return {
    deviceCode: started.data.device_code,
    userCode: started.data.user_code,
    approveUrl: started.data.verification_uri_complete ?? started.data.verification_uri,
    expiresInSeconds: started.data.expires_in,
    intervalSeconds: started.data.interval ?? DEFAULT_INTERVAL_SECONDS,
  };
};

const Granted = z.object({ access_token: z.string().min(1) });

const Pending = z.object({
  error: z.enum(["authorization_pending", "slow_down", "access_denied", "expired_token"]),
  interval: z.number().int().nonnegative().optional(),
});

export type PollOutcome =
  | { type: "token"; token: string }
  | { type: "pending" }
  /** Polled too fast. The floor is now at least `interval` seconds. */
  | { type: "slow_down"; intervalSeconds: number | undefined }
  | { type: "denied" }
  | { type: "expired" };

export const pollSignIn = async (api: string, deviceCode: string): Promise<PollOutcome> => {
  const answer = await send(api, "/api/device/token", {
    method: "POST",
    body: { device_code: deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" },
  });

  if (answer.status === 200) {
    const granted = Granted.safeParse(answer.body);
    if (!granted.success)
      throw unavailable(api, "the sign-in was approved and the answer carried no token", answer.status);
    return { type: "token", token: granted.data.access_token };
  }

  const pending = Pending.safeParse(answer.body);
  if (!pending.success)
    // `invalid_request` lands here too: the app could not read what this CLI
    // sent, which is not something waiting longer will fix.
    throw unavailable(api, "the answer was not one the device flow defines", answer.status);

  switch (pending.data.error) {
    case "authorization_pending":
      return { type: "pending" };
    case "slow_down":
      return { type: "slow_down", intervalSeconds: pending.data.interval };
    case "access_denied":
      return { type: "denied" };
    case "expired_token":
      return { type: "expired" };
    default:
      return assertNever(pending.data.error, "Unhandled device flow answer");
  }
};

/**
 * The app's own hash of an install id, which is how it names machines.
 *
 * Deliberately duplicated across the two repos rather than shared: the id is
 * hashed so a list of machines is not a list of working credentials, and the
 * only alternative to computing it here is asking the app which hash is ours,
 * which would hand the id back out in a URL.
 */
export const installHash = (installId: string): string =>
  createHash("sha256").update(installId, "utf8").digest("hex");

const Machines = z.object({
  machines: z.array(z.object({ id: z.string(), revoked: z.boolean() })),
});

/** `unknown` is this machine having no id to ask about, not the app declining to say. */
export type MachineState = "linked" | "revoked" | "unlinked" | "unknown";

export type SignInCheck =
  /** The token works, and this is what the account says about this machine. */
  | { type: "live"; machine: MachineState }
  /** The token was turned down: signed out elsewhere, or the machine removed. */
  | { type: "rejected" }
  /** Could not be asked. Not an answer about the credential, and never read as one. */
  | { type: "unknown"; why: string };

/**
 * Whether a stored credential still opens anything.
 *
 * `GET /api/machines` is the cheapest thing behind the account wall and the
 * only one that also answers the question `auth login` leaves a person with:
 * is this machine actually linked now. A store that has never heard of
 * accounts answers something else entirely, and that is `unknown` rather than
 * "signed out" — an old app must not read as a revoked credential.
 */
export const checkSignIn = async (
  api: string,
  token: string,
  ourInstallId: string | undefined,
): Promise<SignInCheck> => {
  let answer: Answer;
  try {
    answer = await send(api, "/api/machines", { method: "GET", token });
  } catch (error) {
    if (!(error instanceof PrLensCliError)) throw error;
    return { type: "unknown", why: error.message };
  }

  if (answer.status === 401 || answer.status === 403) return { type: "rejected" };

  const machines = Machines.safeParse(answer.body);
  if (!machines.success)
    return { type: "unknown", why: `${hostOf(api)} answered ${answer.status}, which this CLI cannot read` };

  if (ourInstallId === undefined) return { type: "live", machine: "unknown" };

  const ours = installHash(ourInstallId);
  const machine = machines.data.machines.find((entry) => entry.id === ours);

  return {
    type: "live",
    machine: machine === undefined ? "unlinked" : machine.revoked ? "revoked" : "linked",
  };
};

const Account = z.object({ email: z.string().min(3) });

/**
 * The address this token signs in as, for the one line `auth login` could not
 * print without it.
 *
 * `undefined` for every failure, including a store that has never heard of
 * accounts: the sign-in has already happened by the time this is asked, and a
 * name is a nicety. Refusing to report a successful sign-in because the
 * greeting could not be fetched would be the tail wagging the dog.
 */
export const whoAmI = async (api: string, token: string): Promise<string | undefined> => {
  try {
    const answer = await send(api, "/api/account", { method: "GET", token });
    const account = Account.safeParse(answer.body);
    return answer.status === 200 && account.success ? account.data.email : undefined;
  } catch {
    return undefined;
  }
};

export type SignOut = "ended" | "already" | { type: "unreachable"; why: string };

/**
 * Ends this session at the app, and nothing else.
 *
 * Deliberately not `DELETE /api/machines/{id}`, which is the only other
 * revoke and is permanent: that one shuts the install id out forever, so
 * signing out would cost the machine its ability to sign back in. This ends
 * the credential and leaves the machine linked.
 *
 * Unreachable is its own answer and not a failure to report, because the
 * caller must forget the token locally either way — somebody signing out of
 * a laptop they are holding cannot be made to wait on a store being up.
 */
export const endSession = async (api: string, token: string): Promise<SignOut> => {
  try {
    const answer = await send(api, "/api/session", { method: "DELETE", token });
    if (answer.status === 200) return "ended";
    // A store with no such route, or one that turned the token down: either
    // way there is nothing live at the far end to end.
    if (answer.status === 404 || answer.status === 401) return "already";
    return { type: "unreachable", why: `${hostOf(api)} answered ${answer.status}` };
  } catch (error) {
    if (!(error instanceof PrLensCliError)) throw error;
    return { type: "unreachable", why: error.message };
  }
};

/**
 * Sign-in is the OAuth 2.0 device grant (RFC 8628), the one flow that works
 * over SSH and in containers. Its wire codes are the RFC's, not this CLI's.
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
    // A redirect would carry the token to whatever host answered.
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => {
    // The runtime's message leaks addresses and internals.
    throw unavailable(api, "check the address and the connection, then try again");
  });

  if (response.status >= 300 && response.status < 400)
    throw unavailable(api, "this address redirects, and the sign-in routes must answer directly", response.status);

  const text = await response.text().catch(() => {
    throw unavailable(api, "the answer was cut off; check the connection, then try again", response.status);
  });

  return { status: response.status, body: parseJson(text) };
};

/** Refusals outside the device flow use the app's own envelope. */
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
  /** Carries the code, so nobody types it. */
  approveUrl: string;
  expiresInSeconds: number;
  intervalSeconds: number;
};

/** RFC 8628 §3.2: the floor, and the default when none is served. */
export const DEFAULT_INTERVAL_SECONDS = 5;

/** The install id goes with the request: the approving browser may be on a phone and cannot know which machine asked. */
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
    // Twenty codes an hour per address. Usually a retry after a typo, so say what to do next.
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

/** `claimed` is an app extension (RFC 6749 §5.1 allows it); optional so a sign-in never fails over it. */
const Granted = z.object({
  access_token: z.string().min(1),
  claimed: z.coerce.number().int().min(0).optional(),
});

const Pending = z.object({
  error: z.enum(["authorization_pending", "slow_down", "access_denied", "expired_token"]),
  interval: z.number().int().nonnegative().optional(),
});

export type PollOutcome =
  | { type: "token"; token: string; claimed: number | undefined }
  | { type: "pending" }
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
    return { type: "token", token: granted.data.access_token, claimed: granted.data.claimed };
  }

  const pending = Pending.safeParse(answer.body);
  if (!pending.success)
    // Includes `invalid_request`, which waiting will not fix.
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
 * Must match the app's hash. Duplicated on purpose: asking the app for ours
 * would put the install id in a URL.
 */
export const installHash = (installId: string): string =>
  createHash("sha256").update(installId, "utf8").digest("hex");

const Machines = z.object({
  machines: z.array(z.object({ id: z.string(), revoked: z.boolean() })),
});

/** `unknown`: this machine has no install id to look up. */
export type MachineState = "linked" | "revoked" | "unlinked" | "unknown";

export type SignInCheck =
  | { type: "live"; machine: MachineState }
  | { type: "rejected" }
  /** The app could not be asked; says nothing about the credential. */
  | { type: "unknown"; why: string };

/**
 * `/api/machines` also answers whether this machine is linked. A store without
 * accounts reads as `unknown`, never as a revoked credential.
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

/** Undefined on any failure: the sign-in already succeeded and the email is only for the greeting. */
export const whoAmI = async (api: string, token: string): Promise<string | undefined> => {
  try {
    const answer = await send(api, "/api/account", { method: "GET", token });
    const account = Account.safeParse(answer.body);
    return answer.status === 200 && account.success ? account.data.email : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Unlike `whoAmI`, keeps a dead token (`ended`) apart from an unreachable store
 * (`unknown`), which the sign-in flow will report itself.
 */
export type Session =
  | { type: "active"; email: string }
  | { type: "ended" }
  | { type: "unknown" };

export const checkSession = async (api: string, token: string): Promise<Session> => {
  let answer: Awaited<ReturnType<typeof send>>;
  try {
    answer = await send(api, "/api/account", { method: "GET", token });
  } catch {
    return { type: "unknown" };
  }

  // Any other status is an outage, not evidence about the credential.
  if (answer.status === 401 || answer.status === 403) return { type: "ended" };

  const account = Account.safeParse(answer.body);
  return answer.status === 200 && account.success
    ? { type: "active", email: account.data.email }
    : { type: "unknown" };
};

export type SignOut = "ended" | "already" | { type: "unreachable"; why: string };

/**
 * Ends the session and leaves the machine linked (`DELETE /api/machines/{id}`
 * would unlink it). Unreachable is not thrown: the caller forgets the token
 * locally either way.
 */
export const endSession = async (api: string, token: string): Promise<SignOut> => {
  try {
    const answer = await send(api, "/api/session", { method: "DELETE", token });
    if (answer.status === 200) return "ended";
    // No such route, or the token was already dead.
    if (answer.status === 404 || answer.status === 401) return "already";
    return { type: "unreachable", why: `${hostOf(api)} answered ${answer.status}` };
  } catch (error) {
    if (!(error instanceof PrLensCliError)) throw error;
    return { type: "unreachable", why: error.message };
  }
};

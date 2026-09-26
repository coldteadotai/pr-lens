import { z } from "zod";
import {
  assertNever,
  safeParseGraphDoc,
  ViewerLook,
  type GraphDoc,
  type LiveCommand,
} from "@coldtea/pr-lens-schema";

import { CLI_VERSION } from "../version.js";
import { PrLensCliError } from "../errors.js";

const REQUEST_TIMEOUT_MS = 60_000;

const Tile = z.object({
  id: z.string(),
  title: z.string(),
  lens: z.string(),
  crumbs: z.array(z.string()),
  hero: z.boolean(),
  width: z.number(),
  height: z.number(),
  renders: z.record(z.string(), z.string()),
  images: z.record(z.string(), z.string()),
});

const Minted = z.object({
  id: z.string(),
  writeToken: z.string(),
  rev: z.number().int(),
  viewUrl: z.string(),
  editUrl: z.string(),
  embedUrl: z.string(),
});

const Fetched = z.object({
  id: z.string(),
  rev: z.number().int(),
  viewUrl: z.string(),
  embedUrl: z.string(),
  document: z.unknown(),
  tiles: z.array(Tile),
});

const Pushed = z.object({
  id: z.string(),
  rev: z.number().int(),
  viewUrl: z.string(),
  editUrl: z.string(),
  embedUrl: z.string(),
  tiles: z.array(Tile),
});

const Rotated = z.object({ id: z.string(), editUrl: z.string() });

export type Minted = z.infer<typeof Minted>;
export type Pushed = z.infer<typeof Pushed>;
export type Rotated = z.infer<typeof Rotated>;
export type Fetched = Omit<z.infer<typeof Fetched>, "document"> & {
  document: GraphDoc;
};

/** Loose inner object: an unknown code must still reach the refusal below. */
const Envelope = z.object({
  error: z.looseObject({ code: z.string(), message: z.string() }),
});

const Refusal = z.discriminatedUnion("code", [
  z.object({ code: z.literal("NOT_FOUND"), message: z.string() }),
  z.object({ code: z.literal("INVALID_REQUEST"), message: z.string() }),
  z.object({
    code: z.literal("INVALID_DOCUMENT"),
    message: z.string(),
    issues: z.array(
      z.object({ code: z.string(), path: z.string(), message: z.string() }),
    ),
  }),
  z.object({ code: z.literal("CANNOT_DRAW"), message: z.string() }),
  z.object({
    code: z.literal("REVISION_MOVED"),
    message: z.string(),
    rev: z.number().int(),
  }),
  z.object({
    code: z.literal("RATE_LIMITED"),
    message: z.string(),
    retryAt: z.string(),
  }),
  z.object({ code: z.literal("TOO_LARGE"), message: z.string() }),
  z.object({ code: z.literal("UNAUTHENTICATED"), message: z.string() }),
  z.object({ code: z.literal("ALREADY_OWNED"), message: z.string() }),
  z.object({ code: z.literal("LIVE_ENDED"), message: z.string() }),
  z.object({
    code: z.literal("UNKNOWN_PLACE"),
    message: z.string(),
    unknown: z.array(
      z.object({ at: z.string(), kind: z.string(), id: z.string(), detail: z.string() }),
    ),
    valid: z.object({
      components: z.array(z.string()),
      messages: z.array(z.string()),
      diagrams: z.array(z.string()),
    }),
  }),
]);

type Request = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  /** Undefined when minting, so a 404 there is not blamed on a canvas. */
  canvas: string | undefined;
  token?: string;
  /** Lets a later sign-in claim what this machine pushed. */
  install?: string;
  ifMatch?: number;
  body?: unknown;
};

const hostOf = (api: string): string => new URL(api).host;

const unavailable = (
  api: string,
  status: number | undefined,
  details?: string,
): PrLensCliError =>
  new PrLensCliError(
    "CANVAS_UNAVAILABLE",
    status === undefined
      ? `${hostOf(api)} did not answer`
      : `${hostOf(api)} answered ${status}`,
    details,
  );

/** Untrusted server content, so printable and short. */
const LOCATION_SHOWN = 200;

/** Printing the target turns an `http://` for `https://` typo into a fix. */
const redirected = (api: string, response: Response): PrLensCliError => {
  const location = response.headers
    .get("location")
    ?.replace(/[^\x20-\x7e]/g, "")
    .slice(0, LOCATION_SHOWN);

  return unavailable(
    api,
    response.status,
    location === undefined || location === ""
      ? "the canvas API answers at the address it is given, and this one redirects"
      : `the canvas API answers at the address it is given; this one points at ${location}, so pass that as --api`,
  );
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const refusal = (
  api: string,
  request: Request,
  status: number,
  body: unknown,
): PrLensCliError => {
  const envelope = Envelope.safeParse(body);
  if (!envelope.success) return unavailable(api, status);

  const known = Refusal.safeParse(envelope.data.error);
  if (!known.success)
    return unavailable(api, status, envelope.data.error.message);

  const error = known.data;
  switch (error.code) {
    case "NOT_FOUND":
      return request.canvas === undefined
        ? unavailable(api, status, error.message)
        : new PrLensCliError(
            "CANVAS_UNKNOWN",
            `no canvas ${request.canvas} at ${hostOf(api)}, or the token is wrong`,
            "if the token was rotated elsewhere, pull the current edit link to record it",
          );
    case "REVISION_MOVED":
      return new PrLensCliError(
        "CANVAS_CONFLICT",
        `${request.canvas ?? "the canvas"} is at rev ${error.rev} on ${hostOf(api)}, not rev ${request.ifMatch ?? "?"}`,
        "pr-lens canvas pull, then push again",
      );
    case "INVALID_DOCUMENT":
      return new PrLensCliError(
        "CANVAS_REJECTED",
        error.message,
        error.issues
          .map((issue) =>
            issue.path === ""
              ? issue.message
              : `${issue.path}: ${issue.message}`,
          )
          .join("\n"),
      );
    case "CANNOT_DRAW":
      // Passed the contract but nothing to draw; the app's message says why.
      return new PrLensCliError("CANVAS_REJECTED", error.message);
    case "RATE_LIMITED":
      return new PrLensCliError(
        "CANVAS_RATE_LIMITED",
        `${hostOf(api)} is rate limiting this client until ${error.retryAt}`,
        error.message,
      );
    case "UNAUTHENTICATED":
      return new PrLensCliError(
        "AUTH_REQUIRED",
        `${hostOf(api)} did not accept this sign-in`,
        [error.message, "pr-lens auth login signs this machine in again"].join(
          "\n",
        ),
      );
    case "ALREADY_OWNED":
      // The caller holds the write token, so naming the case leaks nothing.
      return new PrLensCliError(
        "CANVAS_OWNED",
        `${request.canvas ?? "that canvas"} belongs to another account on ${hostOf(api)}`,
        "the first claim wins, and somebody else's landed first",
      );
    case "LIVE_ENDED":
      return new PrLensCliError(
        "LIVE_ENDED",
        `the live session on ${request.canvas ?? "this canvas"} has ended`,
        "pr-lens canvas open starts a new one and opens a tab for it",
      );
    case "UNKNOWN_PLACE":
      return unknownPlaces(
        error.unknown.map((place) => `${place.at}: "${place.id}" ${place.detail}`),
        error.valid,
      );
    case "INVALID_REQUEST":
    case "TOO_LARGE":
      return unavailable(api, status, error.message);
    default:
      return assertNever(error, "Unhandled canvas refusal");
  }
};

/** The ids the canvas would have taken, so the next attempt can copy one rather than guess again. */
export type ValidPlaces = { components: readonly string[]; messages: readonly string[]; diagrams: readonly string[] };

const SHOWN_IDS = 40;

const idList = (label: string, ids: readonly string[]): string =>
  ids.length === 0
    ? `  ${label}: none`
    : `  ${label}: ${ids.slice(0, SHOWN_IDS).join(", ")}${ids.length > SHOWN_IDS ? `, and ${ids.length - SHOWN_IDS} more` : ""}`;

export const unknownPlaces = (problems: readonly string[], valid: ValidPlaces): PrLensCliError =>
  new PrLensCliError(
    "LIVE_UNKNOWN_PLACE",
    problems.length === 1
      ? "1 id is not on the canvas"
      : `${problems.length} ids are not on the canvas`,
    [
      ...problems,
      "copy an id from these:",
      idList("components", valid.components),
      idList("messages", valid.messages),
      idList("diagrams", valid.diagrams),
    ].join("\n"),
  );

const call = async <T>(
  api: string,
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> => {
  const headers: Record<string, string> = {
    accept: "application/json",
    "user-agent": `pr-lens-cli/${CLI_VERSION}`,
  };

  if (request.token !== undefined)
    headers.authorization = `Bearer ${request.token}`;

  if (request.install !== undefined)
    headers["x-pr-lens-install"] = request.install;

  if (request.ifMatch !== undefined)
    headers["if-match"] = String(request.ifMatch);

  if (request.body !== undefined) headers["content-type"] = "application/json";

  const response = await fetch(`${api}${request.path}`, {
    method: request.method,
    headers,
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
    // A cross-origin redirect keeps every header but `authorization`, which
    // would leak the install id to another host.
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => {
    // The runtime's message names addresses and internals; keep it out.
    throw unavailable(
      api,
      undefined,
      "check the address and the connection, then try again",
    );
  });

  // A 3xx body is not an error envelope.
  if (response.status >= 300 && response.status < 400)
    throw redirected(api, response);

  // A body can fail after the headers arrived.
  const text = await response.text().catch(() => {
    throw unavailable(
      api,
      response.status,
      "the answer was cut off; check the connection, then try again",
    );
  });
  const body = parseJson(text);
  if (!response.ok) throw refusal(api, request, response.status, body);

  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw unavailable(
      api,
      response.status,
      "the answer was not in the shape the canvas API documents",
    );

  return parsed.data;
};

const canvasPath = (id: string): string => `/api/canvas/${id}`;

/** The bearer is how CI attributes a mint: a runner's install id is never linked. */
export const mintCanvas = (
  api: string,
  install: string | undefined,
  token: string | undefined,
): Promise<Minted> =>
  call(
    api,
    { method: "POST", path: "/api/canvas", canvas: undefined, install, token },
    Minted,
  );

export const fetchCanvas = async (
  api: string,
  id: string,
): Promise<Fetched> => {
  const fetched = await call(
    api,
    { method: "GET", path: canvasPath(id), canvas: id },
    Fetched,
  );

  const document = safeParseGraphDoc(fetched.document);
  if (!document.ok)
    throw new PrLensCliError(
      "CANVAS_UNAVAILABLE",
      `${hostOf(api)} serves a document for ${id} that this CLI cannot read [${document.error.code}]`,
      "a newer CLI may know the shape: npx @coldtea/pr-lens-cli@latest",
    );

  return { ...fetched, document: document.value };
};

export const pushCanvas = (
  api: string,
  id: string,
  token: string,
  rev: number,
  document: GraphDoc,
): Promise<Pushed> =>
  call(
    api,
    {
      method: "PUT",
      path: canvasPath(id),
      canvas: id,
      token,
      ifMatch: rev,
      body: document,
    },
    Pushed,
  );

/** A rotation onto itself changes nothing and is answered "rotated" only for the current token. */
export const verifyWriteToken = (
  api: string,
  id: string,
  token: string,
): Promise<boolean> =>
  rotateCanvas(api, id, token, token).then(
    () => true,
    (error: unknown) => {
      if (error instanceof PrLensCliError && error.code === "CANVAS_UNKNOWN")
        return false;
      throw error;
    },
  );

/** The caller mints the next token, so a lost answer can be asked for again. */
export const rotateCanvas = (
  api: string,
  id: string,
  token: string,
  nextToken: string,
): Promise<Rotated> =>
  call(
    api,
    {
      method: "POST",
      path: `${canvasPath(id)}/rotate`,
      canvas: id,
      token,
      body: { writeToken: nextToken },
    },
    Rotated,
  );

export const deleteCanvas = (
  api: string,
  id: string,
  token: string,
): Promise<{ id: string; deleted: true }> =>
  call(
    api,
    { method: "DELETE", path: canvasPath(id), canvas: id, token },
    z.object({ id: z.literal(id), deleted: z.literal(true) }),
  );

/** An unreadable revision must not read as an empty canvas. */
const Preview = z.discriminatedUnion("type", [
  z.object({ type: z.literal("drawn"), title: z.string().min(1) }),
  z.object({ type: z.literal("not_drawn") }),
  z.object({ type: z.literal("unreadable") }),
]);

const Owned = z.object({
  id: z.string(),
  rev: z.number().int(),
  preview: Preview,
});

const Owning = z.object({ canvases: z.array(Owned) });

export type CanvasPreview = z.infer<typeof Preview>;
export type OwnedCanvas = z.infer<typeof Owned>;

/**
 * Carries no write tokens: the app keeps only their hashes. A store without
 * accounts 404s here, which reads as unavailable, not as a missing canvas.
 */
export const listOwnedCanvases = (
  api: string,
  token: string,
): Promise<OwnedCanvas[]> =>
  call(
    api,
    { method: "GET", path: "/api/canvases", canvas: undefined, token },
    Owning,
  ).then(({ canvases }) => canvases);

/**
 * The account token takes the header, so the write tokens go in the body.
 * The caller mints the next token so a lost answer can be replayed.
 */
export const claimCanvas = (
  api: string,
  id: string,
  accountToken: string,
  writeToken: string,
  nextWriteToken: string,
): Promise<Rotated> =>
  call(
    api,
    {
      method: "POST",
      path: `${canvasPath(id)}/claim`,
      canvas: id,
      token: accountToken,
      body: { writeToken, nextWriteToken },
    },
    Rotated,
  );

const LiveOpened = z.object({
  session: z.string(),
  url: z.string(),
  expiresAt: z.string(),
});

const TAB_STATES = ["following", "stepped_out", "not_open"] as const;

const LiveSent = z.object({
  seq: z.number().int(),
  tab: z.enum(TAB_STATES),
});

const LookRead = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not_open") }),
  z.object({ status: z.literal("seen"), seenAt: z.string(), look: ViewerLook }),
]);

export type LiveOpened = z.infer<typeof LiveOpened>;
export type TabState = (typeof TAB_STATES)[number];
export type LookRead = z.infer<typeof LookRead>;

const livePath = (id: string, session?: string): string =>
  session === undefined ? `${canvasPath(id)}/live` : `${canvasPath(id)}/live/${session}`;

/** A session is one tab, paired by the secret in the link this answers with. */
export const openLive = (
  api: string,
  id: string,
  token: string,
): Promise<LiveOpened> =>
  call(api, { method: "POST", path: livePath(id), canvas: id, token }, LiveOpened);

export const sendLive = (
  api: string,
  id: string,
  token: string,
  session: string,
  command: LiveCommand,
): Promise<z.infer<typeof LiveSent>> =>
  call(
    api,
    { method: "POST", path: livePath(id, session), canvas: id, token, body: command },
    LiveSent,
  );

export const readLook = (
  api: string,
  id: string,
  token: string,
  session: string,
): Promise<LookRead> =>
  call(
    api,
    { method: "GET", path: `${livePath(id, session)}/look`, canvas: id, token },
    LookRead,
  );

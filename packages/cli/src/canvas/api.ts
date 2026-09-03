import {
  assertNever,
  safeParseGraphDoc,
  type GraphDoc,
} from "@coldtea/pr-lens-schema";
import { z } from "zod";
import { PrLensCliError } from "../errors.js";
import { CLI_VERSION } from "../version.js";

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
]);

type Request = {
  method: "GET" | "POST" | "PUT";
  path: string;
  /** Undefined when minting, so a 404 there is not blamed on a canvas. */
  canvas: string | undefined;
  token?: string;
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
    case "INVALID_REQUEST":
    case "TOO_LARGE":
      return unavailable(api, status, error.message);
    default:
      return assertNever(error, "Unhandled canvas refusal");
  }
};

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

  if (request.ifMatch !== undefined)
    headers["if-match"] = String(request.ifMatch);

  if (request.body !== undefined) headers["content-type"] = "application/json";

  const response = await fetch(`${api}${request.path}`, {
    method: request.method,
    headers,
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => {
    // The runtime's message names addresses and internals; keep it out.
    throw unavailable(
      api,
      undefined,
      "check the address and the connection, then try again",
    );
  });

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

export const mintCanvas = (api: string): Promise<Minted> =>
  call(api, { method: "POST", path: "/api/canvas", canvas: undefined }, Minted);

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

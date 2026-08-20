import { PrLensCliError } from "../errors.js";

/** Long enough for a reasoning model on a large diff, short enough to fail a stuck CI job. */
const REQUEST_TIMEOUT_MS = 300_000;

const MAX_ERROR_BODY_CHARS = 600;

export const postJson = async (
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<unknown> => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch((error: unknown) => {
    throw new PrLensCliError(
      "PROVIDER_FAILED",
      `the request to ${url} did not complete`,
      error instanceof Error ? error.message : String(error),
    );
  });

  const text = await response.text();

  if (!response.ok)
    throw new PrLensCliError(
      "PROVIDER_FAILED",
      `${url} answered ${response.status} ${response.statusText}`,
      text.slice(0, MAX_ERROR_BODY_CHARS),
    );

  try {
    return JSON.parse(text);
  } catch {
    throw new PrLensCliError(
      "PROVIDER_FAILED",
      `${url} answered with something that is not JSON`,
      text.slice(0, MAX_ERROR_BODY_CHARS),
    );
  }
};

export const cutOff = (provider: string): PrLensCliError =>
  new PrLensCliError(
    "PROVIDER_FAILED",
    `${provider} stopped before finishing the document`,
    "the answer hit the output token limit — raise --max-output-tokens, or narrow the diff with --base",
  );

export const unreadableResponse = (provider: string, detail: string): PrLensCliError =>
  new PrLensCliError("PROVIDER_FAILED", `${provider} returned no usable text`, detail);

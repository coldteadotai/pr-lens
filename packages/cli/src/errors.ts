/**
 * Every failure a run can end on, as a code a caller — a script, a workflow
 * step, or a future command — can branch on. Messages are for humans and may
 * be reworded; codes are the contract.
 */
export type CliErrorCode =
  | "USAGE"
  | "UNREADABLE_FILE"
  | "UNKNOWN_DOCUMENT"
  | "INVALID_DOCUMENT"
  | "GIT_FAILED"
  | "EMPTY_DIFF"
  | "REPOSITORY_UNKNOWN"
  | "MISSING_API_KEY"
  | "PROVIDER_FAILED"
  | "MODEL_OUTPUT_INVALID"
  | "RENDER_FAILED"
  | "CANVAS_UNREGISTERED"
  | "CANVAS_UNKNOWN"
  | "CANVAS_CONFLICT"
  | "CANVAS_REJECTED"
  | "CANVAS_RATE_LIMITED"
  | "CANVAS_UNAVAILABLE"
  | "CANVAS_REGISTRY_EXPOSED";

export class PrLensCliError extends Error {
  readonly code: CliErrorCode;
  /** Extra lines printed under the message: validation issues, a git stderr, a hint. */
  readonly details: string | undefined;

  constructor(code: CliErrorCode, message: string, details?: string) {
    super(message);
    this.name = "PrLensCliError";
    this.code = code;
    this.details = details;
  }
}

export const usageError = (message: string, details?: string): PrLensCliError =>
  new PrLensCliError("USAGE", message, details);

export const formatError = (error: PrLensCliError): string =>
  [`✗ ${error.message} [${error.code}]`, error.details ?? ""].filter((line) => line !== "").join("\n");

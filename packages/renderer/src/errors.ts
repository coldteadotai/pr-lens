/**
 * Codes are the stable half of a failure; the message is for a human. Every
 * one of these describes a document the renderer cannot draw, never an
 * internal fault.
 */
export type RenderErrorCode =
  | "UNKNOWN_VIEW"
  | "LENS_NOT_DECLARED"
  | "NOTHING_TO_RENDER"
  | "NO_FLOW_IN_SCOPE";

export class PrLensRenderError extends Error {
  readonly code: RenderErrorCode;

  constructor(code: RenderErrorCode, message: string) {
    super(message);
    this.name = "PrLensRenderError";
    this.code = code;
  }
}

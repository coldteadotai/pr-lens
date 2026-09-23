export type Terminal = {
  out: (line: string) => void;
  err: (line: string) => void;
  /**
   * A line that replaces itself, where the terminal can do that.
   *
   * Optional, and absent is a complete answer rather than a missing feature:
   * a pipe, a CI log and a file all want the static line that was printed
   * before, not a carriage return and a spinner frame they will keep forever.
   *
   * `undefined` clears it. Writing to stderr rather than stdout, because
   * progress is not output — `pr-lens canvas push | jq` must not have a
   * spinner in its input.
   */
  status?: (line: string | undefined) => void;
};

const CLEAR_LINE = "\r\u001B[2K";

/*
 * Absent without a TTY, rather than present and doing nothing.
 *
 * A no-op function is still a defined property, so callers asking "can this
 * terminal rewrite a line?" were told yes and skipped the static sentence
 * they print instead — leaving a pipe with neither. Undefined is the honest
 * answer and makes the question answerable.
 */
export const processTerminal: Terminal = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  ...(process.stderr.isTTY
    ? {
        status: (line: string | undefined) =>
          process.stderr.write(line === undefined ? CLEAR_LINE : `${CLEAR_LINE}${line}`),
      }
    : {}),
};

export type Terminal = {
  out: (line: string) => void;
  err: (line: string) => void;
  /**
   * A line that rewrites itself, on stderr so a pipe never reads a spinner.
   * Absent without a TTY; `undefined` clears it.
   */
  status?: (line: string | undefined) => void;
};

const CLEAR_LINE = "\r\u001B[2K";

// Absent, not a no-op: callers check for it and print a static line instead.
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

export type Terminal = {
  out: (line: string) => void;
  err: (line: string) => void;
};

export const processTerminal: Terminal = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};

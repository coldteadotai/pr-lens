import { expectOne, parseOptions } from "../args.js";
import { readGraphDoc } from "../document.js";
import { PrLensCliError } from "../errors.js";
import type { Terminal } from "../terminal.js";

export const USAGE = `pr-lens render <graph.json> [options]

Renders a graph document to self-contained SVGs — one light and one dark per
lens — and writes the manifest describing them.

  -o, --out <dir>      where the SVGs go (default pr-lens/)
      --theme <theme>  light | dark | both (default both)`;

export const renderCommand = async (args: readonly string[], _terminal: Terminal): Promise<void> => {
  const { positionals } = parseOptions(args, {
    out: { type: "string", short: "o" },
    theme: { type: "string" },
  });

  await readGraphDoc(expectOne(positionals, "one graph document to render"));

  throw new PrLensCliError(
    "RENDERER_UNAVAILABLE",
    "this build cannot render",
    "the document is valid, and @coldtea/pr-lens-renderer will draw it once it ships",
  );
};

import {
  applyCorrections,
  findView,
  PrLensRenderError,
  renderMermaid,
} from "@coldtea/pr-lens-renderer";
import {
  safeParseGraphDoc,
  type Config,
  type GraphDoc,
  type Lens,
} from "@coldtea/pr-lens-schema";
import { expectOne, parseOptions, readBoolean, readString } from "../args.js";
import { discoverConfig, loadConfig } from "../config-file.js";
import { unmatchedCorrections } from "../corrections.js";
import { readGraphDoc } from "../document.js";
import { PrLensCliError, usageError } from "../errors.js";
import { repositoryRoot } from "../git.js";
import { writeTextFile } from "../io.js";
import type { Terminal } from "../terminal.js";

export const USAGE = `pr-lens mermaid <graph.json> [options]

Projects one architecture or data-flow diagram from the evidence graph as
Mermaid source for terminal rendering. Select a view to infer its lens, or
name the lens when projecting the whole document.

  -o, --out <file>    write Mermaid source to this file (default stdout)
      --lens <lens>   architecture | data-flow
      --view <id>     project one named view and infer its lens
      --config <file> apply these repository corrections
      --no-config     ignore the repository's corrections`;

const readLens = (value: unknown): Lens | undefined => {
  const lens = readString(value, "lens");
  switch (lens) {
    case undefined:
      return undefined;
    case "architecture":
    case "data-flow":
      return lens;
    default:
      throw usageError(
        `--lens takes architecture or data-flow, got ${JSON.stringify(lens)}`,
      );
  }
};

const selectedLens = (graph: GraphDoc, requested: Lens | undefined, viewId: string | undefined): Lens => {
  if (viewId !== undefined) {
    const view = findView(graph.views, viewId);
    if (view === undefined)
      throw new PrLensCliError("RENDER_FAILED", `this document has no view '${viewId}' [UNKNOWN_VIEW]`);
    if (requested !== undefined && requested !== view.lens)
      throw usageError(
        `view '${viewId}' uses the '${view.lens}' lens, not '${requested}'`,
      );
    return view.lens;
  }

  if (requested !== undefined) return requested;
  if (graph.lenses.length === 1) {
    const lens = graph.lenses[0];
    if (lens !== undefined) return lens;
  }

  throw usageError("--lens is required when the document declares several lenses and no view is selected");
};

const correct = (graph: GraphDoc, config: Config): GraphDoc => {
  let corrected: GraphDoc;
  try {
    corrected = applyCorrections(graph, config.map);
  } catch (error) {
    if (!(error instanceof PrLensRenderError)) throw error;
    throw new PrLensCliError("RENDER_FAILED", `${error.message} [${error.code}]`);
  }

  const parsed = safeParseGraphDoc(corrected);
  if (!parsed.ok)
    throw new PrLensCliError(
      "INVALID_DOCUMENT",
      `the configured document no longer validates [${parsed.error.code}]`,
      parsed.error.message,
    );
  return parsed.value;
};

export const mermaidCommand = async (
  args: readonly string[],
  terminal: Terminal,
): Promise<void> => {
  const { values, positionals } = parseOptions(args, {
    out: { type: "string", short: "o" },
    lens: { type: "string" },
    view: { type: "string" },
    config: { type: "string" },
    "no-config": { type: "boolean" },
  });

  const graph = await readGraphDoc(expectOne(positionals, "one graph document to project"));
  const configPath = readString(values.config, "config");
  const configured = readBoolean(values["no-config"])
    ? undefined
    : configPath === undefined
      ? await discoverConfig(await repositoryRoot(process.cwd()).catch(() => process.cwd()))
      : await loadConfig(configPath);

  const prepared = (() => {
    if (configured === undefined) return graph;
    for (const warning of unmatchedCorrections(graph, configured.config))
      terminal.err(`${configured.path}: ${warning}`);
    return correct(graph, configured.config);
  })();

  const view = readString(values.view, "view");
  const lens = selectedLens(prepared, readLens(values.lens), view);
  const diagram = (() => {
    try {
      return renderMermaid(prepared, { lens, view });
    } catch (error) {
      if (!(error instanceof PrLensRenderError)) throw error;
      throw new PrLensCliError("RENDER_FAILED", `${error.message} [${error.code}]`);
    }
  })();

  const out = readString(values.out, "out");
  if (out === undefined) {
    terminal.out(diagram.trimEnd());
    return;
  }

  const written = await writeTextFile(out, diagram);
  terminal.out(`✓ wrote ${written} as Mermaid ${lens}`);
};

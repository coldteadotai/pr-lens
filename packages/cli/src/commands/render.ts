import { applyCorrections, PrLensRenderError, renderAll, THEMES, type Theme } from "@coldtea/pr-lens-renderer";
import { safeParseGraphDoc, type Config, type GraphDoc } from "@coldtea/pr-lens-schema";
import { join } from "node:path";
import { expectOne, parseOptions, readBoolean, readString } from "../args.js";
import { discoverConfig, loadConfig } from "../config-file.js";
import { unmatchedCorrections } from "../corrections.js";
import { readGraphDoc } from "../document.js";
import { PrLensCliError, usageError } from "../errors.js";
import { repositoryRoot } from "../git.js";
import { writeJsonFile, writeTextFile } from "../io.js";
import type { Terminal } from "../terminal.js";

const DEFAULT_OUT = "pr-lens";
const MANIFEST = "manifest.json";

/**
 * The document as it was drawn, written beside the manifest.
 *
 * Corrections are applied here, so the document on the way in and the
 * diagrams on the way out can describe different systems — a view whose every
 * element was excluded is drawn by neither. Whatever composes the comment has
 * to read the one the pictures came from, and it is a different file from the
 * one analyze wrote so that neither overwrites the other.
 */
const DRAWN = "drawn.graph.json";

export const USAGE = `pr-lens render <graph.json> [options]

Draws the document as self-contained SVGs — one per drill-down section per
lens, in light and dark — and writes the manifest describing them. A document
with no sections gets one diagram per lens it declares.

  -o, --out <dir>      where the SVGs and the manifest go (default ${DEFAULT_OUT}/)
      --theme <theme>  light | dark | both (default both)
      --config <file>  corrections to draw with (default the repository's, if any)
      --no-config      ignore the repository's corrections`;

const readThemes = (value: unknown): readonly Theme[] => {
  const theme = readString(value, "theme") ?? "both";
  switch (theme) {
    case "light":
    case "dark":
      return [theme];
    case "both":
      return THEMES;
    default:
      throw usageError(`--theme takes light, dark or both, got ${JSON.stringify(theme)}`);
  }
};

/**
 * The overlay is applied here rather than by passing the config into
 * `renderAll`, which would apply the same function to the same document — but
 * out of reach, and the comment has to be composed from what was drawn.
 */
const correct = (graph: GraphDoc, config: Config): GraphDoc => {
  try {
    return applyCorrections(graph, config.map);
  } catch (error) {
    if (!(error instanceof PrLensRenderError)) throw error;
    throw new PrLensCliError("RENDER_FAILED", `${error.message} [${error.code}]`);
  }
};

export const renderCommand = async (args: readonly string[], terminal: Terminal): Promise<void> => {
  const { values, positionals } = parseOptions(args, {
    out: { type: "string", short: "o" },
    theme: { type: "string" },
    config: { type: "string" },
    "no-config": { type: "boolean" },
  });

  const graph = await readGraphDoc(expectOne(positionals, "one graph document to render"));
  const out = readString(values.out, "out") ?? DEFAULT_OUT;

  const configPath = readString(values.config, "config");
  const configured = readBoolean(values["no-config"])
    ? undefined
    : configPath === undefined
      ? await discoverConfig(await repositoryRoot(process.cwd()).catch(() => process.cwd()))
      : await loadConfig(configPath);

  const themes = readThemes(values.theme);

  const drawn = (() => {
    if (configured === undefined) return graph;

    for (const warning of unmatchedCorrections(graph, configured.config))
      terminal.err(`${configured.path}: ${warning}`);

    const corrected = correct(graph, configured.config);
    const parsed = safeParseGraphDoc(corrected);
    if (!parsed.ok)
      throw new PrLensCliError(
        `INVALID_DOCUMENT`,
        `${configured.path} leaves a document that no longer validates [${parsed.error.code}]`,
        parsed.error.message,
      );

    return parsed.value;
  })();

  const rendered = (() => {
    try {
      return renderAll(drawn, { themes });
    } catch (error) {
      if (!(error instanceof PrLensRenderError)) throw error;
      throw new PrLensCliError("RENDER_FAILED", `${error.message} [${error.code}]`);
    }
  })();

  for (const drawing of rendered.assets) {
    const { id, path } = drawing.asset;
    if (path === undefined)
      throw new PrLensCliError("RENDER_FAILED", `the render named no file for asset '${id}'`);
    await writeTextFile(join(out, path), drawing.svg);
  }
  await writeJsonFile(join(out, DRAWN), drawn);
  await writeJsonFile(join(out, MANIFEST), rendered.manifest);

  const diagrams = new Set(rendered.assets.map((asset) => asset.asset.view ?? asset.lens));
  terminal.out(
    `✓ ${join(out, MANIFEST)} — ${rendered.assets.length} SVGs across ${diagrams.size} ${diagrams.size === 1 ? "diagram" : "diagrams"}${configured === undefined ? "" : `, corrected by ${configured.path}`}`,
  );
};

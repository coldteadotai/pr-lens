import { assertNever } from "@coldtea/pr-lens-schema";
import { PrLensRenderError, renderAll, THEMES, type Theme } from "@coldtea/pr-lens-renderer";
import { join } from "node:path";
import { expectOne, parseOptions, readBoolean, readString } from "../args.js";
import { discoverConfig, loadConfig } from "../config-file.js";
import { readGraphDoc } from "../document.js";
import { PrLensCliError, usageError } from "../errors.js";
import { repositoryRoot } from "../git.js";
import { writeJsonFile, writeTextFile } from "../io.js";
import type { Terminal } from "../terminal.js";

const DEFAULT_OUT = "pr-lens";
const MANIFEST = "manifest.json";

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

  const rendered = (() => {
    try {
      return renderAll(graph, {
        themes: readThemes(values.theme),
        ...(configured === undefined ? {} : { config: configured.config }),
      });
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
  await writeJsonFile(join(out, MANIFEST), rendered.manifest);

  const drawn = new Set(rendered.assets.map((asset) => asset.asset.view ?? asset.lens));
  terminal.out(
    `✓ ${join(out, MANIFEST)} — ${rendered.assets.length} SVGs across ${drawn.size} ${drawn.size === 1 ? "diagram" : "diagrams"}${configured === undefined ? "" : `, corrected by ${configured.path}`}`,
  );
};

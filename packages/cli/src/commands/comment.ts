import { graphContentHash } from "@coldtea/pr-lens-renderer";
import { parseOptions, readBoolean, readString } from "../args.js";
import { composeComment, COMMENT_MARKER } from "../comment.js";
import { loadConfig } from "../config-file.js";
import { readGraphDoc, readRenderManifest } from "../document.js";
import { usageError } from "../errors.js";
import { writeTextFile } from "../io.js";
import type { Terminal } from "../terminal.js";

export const USAGE = `pr-lens comment --graph <graph.json> --manifest <manifest.json> [options]

Composes the pull request comment: the diagrams as light/dark <picture> pairs,
the headline numbers, and the drill-down tree. It posts nothing — the markdown
goes to stdout, or to a file, for whatever does the posting.

      --graph <file>          the document that was rendered — the one the render
                              wrote beside the manifest, not the one it read
      --manifest <file>       what the render produced (required)
      --asset-base-url <url>  where the rendered SVGs are published, when the
                              manifest records local paths
      --config <file>         read 'branding' from a repository config
      --no-branding           leave off the PR Lens footer
      --print-marker          print the hidden marker that identifies the
                              comment, and nothing else
  -o, --out <file>            write the markdown here instead of stdout`;

export const commentCommand = async (args: readonly string[], terminal: Terminal): Promise<void> => {
  const { values, positionals } = parseOptions(args, {
    graph: { type: "string" },
    manifest: { type: "string" },
    "asset-base-url": { type: "string" },
    config: { type: "string" },
    "no-branding": { type: "boolean" },
    "print-marker": { type: "boolean" },
    out: { type: "string", short: "o" },
  });

  if (positionals.length > 0)
    throw usageError(`comment takes no positional arguments, got ${positionals.join(" ")}`);

  if (readBoolean(values["print-marker"])) {
    terminal.out(COMMENT_MARKER);
    return;
  }

  const graphPath = readString(values.graph, "graph");
  const manifestPath = readString(values.manifest, "manifest");
  if (graphPath === undefined || manifestPath === undefined)
    throw usageError("--graph and --manifest are both required");

  const configPath = readString(values.config, "config");
  const configured = configPath === undefined ? undefined : await loadConfig(configPath);

  const graph = await readGraphDoc(graphPath);
  const manifest = await readRenderManifest(manifestPath);

  if (graphContentHash(graph) !== manifest.graph.contentHash)
    throw usageError(
      `${graphPath} is not the document ${manifestPath} describes`,
      "corrections change what the diagrams show, so a comment built from a different document would announce sections that were never drawn. Pass the drawn.graph.json the render wrote beside the manifest",
    );

  const body = composeComment({
    graph,
    manifest,
    assetBaseUrl: readString(values["asset-base-url"], "asset-base-url"),
    branding: readBoolean(values["no-branding"]) ? false : (configured?.config.branding ?? true),
  });

  const out = readString(values.out, "out");
  if (out === undefined) {
    terminal.out(body.trimEnd());
    return;
  }

  terminal.err(`✓ ${await writeTextFile(out, body)}`);
};

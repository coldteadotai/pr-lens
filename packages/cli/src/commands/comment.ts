import { graphContentHash } from "@coldtea/pr-lens-renderer";
import { PROVIDERS, type Provider } from "@coldtea/pr-lens-schema";
import { parseOptions, readBoolean, readString } from "../args.js";
import { commentMarker, composeComment } from "../comment.js";
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
      --target <forge>        github | gitlab | bitbucket — who renders the
                              comment (default github). GitLab gets no <picture>
                              pair; Bitbucket gets plain markdown, no HTML
      --print-marker          print the hidden marker that identifies the
                              comment, and nothing else
  -o, --out <file>            write the markdown here instead of stdout`;

const readTarget = (values: Record<string, unknown>): Provider => {
  const target = readString(values.target, "target") ?? "github";
  const known = PROVIDERS.find((provider) => provider === target);
  if (known === undefined)
    throw usageError(`unknown target ${JSON.stringify(target)}`, `known targets: ${PROVIDERS.join(", ")}`);
  return known;
};

export const commentCommand = async (args: readonly string[], terminal: Terminal): Promise<void> => {
  const { values, positionals } = parseOptions(args, {
    graph: { type: "string" },
    manifest: { type: "string" },
    "asset-base-url": { type: "string" },
    config: { type: "string" },
    "no-branding": { type: "boolean" },
    target: { type: "string" },
    "print-marker": { type: "boolean" },
    out: { type: "string", short: "o" },
  });

  if (positionals.length > 0)
    throw usageError(`comment takes no positional arguments, got ${positionals.join(" ")}`);

  const target = readTarget(values);

  if (readBoolean(values["print-marker"])) {
    terminal.out(commentMarker(target));
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
    target,
  });

  const out = readString(values.out, "out");
  if (out === undefined) {
    terminal.out(body.trimEnd());
    return;
  }

  terminal.err(`✓ ${await writeTextFile(out, body)}`);
};

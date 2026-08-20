import { assertNever } from "@coldtea/pr-lens-schema";
import { parseOptions } from "../args.js";
import { validateDocumentFile, type ValidatedDocument } from "../document.js";
import { formatError, PrLensCliError, usageError } from "../errors.js";
import type { Terminal } from "../terminal.js";

const count = (n: number, singular: string): string =>
  `${n} ${n === 1 ? singular : `${singular}s`}`;

const describe = (validated: ValidatedDocument): string => {
  switch (validated.kind) {
    case "graph": {
      const { lanes, nodes, edges, flows, lenses } = validated.document;
      return `graph document · ${count(lanes.length, "lane")}, ${count(nodes.length, "node")}, ${count(edges.length, "edge")}, ${count(flows.length, "flow")} · ${lenses.join(", ")}`;
    }
    case "patch":
      return `patch document · ${count(validated.document.ops.length, "operation")} · ${validated.document.target.fromSha.slice(0, 7)} → ${validated.document.target.toSha.slice(0, 7)}`;
    case "render-manifest":
      return `render manifest · ${count(validated.document.assets.length, "asset")}`;
    case "config": {
      const { map, lenses } = validated.document;
      const corrections =
        map.rename.length + map.exclude.length + map.lane.length + map.group.length;
      return `config · ${lenses.join(", ")} · ${count(corrections, "correction")}`;
    }
    default:
      return assertNever(validated, "Unhandled document");
  }
};

export const USAGE = `pr-lens validate <file...>

Parses graph documents, patch documents, render manifests and configs — JSON or
YAML — and reports every problem in each, rather than only the first. A file
without a 'kind' field is read as a config.`;

export const validateCommand = async (args: readonly string[], terminal: Terminal): Promise<void> => {
  const { positionals } = parseOptions(args, {});
  if (positionals.length === 0) throw usageError("expected at least one file to validate");

  let failed = 0;
  for (const path of positionals) {
    try {
      terminal.out(`✓ ${path} — ${describe(await validateDocumentFile(path))}`);
    } catch (error) {
      if (!(error instanceof PrLensCliError)) throw error;
      failed += 1;
      terminal.err(formatError(error));
    }
  }

  if (failed > 0)
    throw new PrLensCliError(
      "INVALID_DOCUMENT",
      `${failed} of ${count(positionals.length, "document")} did not validate`,
    );
};

import { usageError } from "../errors.js";
import type { Terminal } from "../terminal.js";
import {
  SKILL_MANUAL,
  CONFIG_REFERENCE,
  EXAMPLE_GRAPH_DOCUMENT,
  GRAPH_DOCUMENT_REFERENCE,
} from "../skill-content.generated.js";

export const USAGE = `pr-lens skill [references]

Print detailed instructions for coding agents to create, validate, render, and
share PR Lens diagrams. This long, agent-facing document is written to stdout.
Use pr-lens --help for a short command overview. Pass references for the
configuration format, graph-document specification, and a complete example.`;

const REFERENCES = [
  "# references/config.md",
  CONFIG_REFERENCE,
  "# references/graph-document.md",
  GRAPH_DOCUMENT_REFERENCE,
  "# references/example.graph.json",
  EXAMPLE_GRAPH_DOCUMENT,
].join("\n\n");

export const skillCommand = async (
  args: readonly string[],
  terminal: Terminal,
): Promise<void> => {
  if (args.length === 0) {
    terminal.out(SKILL_MANUAL);
    return;
  }

  if (args.length === 1 && args[0] === "references") {
    terminal.out(REFERENCES);
    return;
  }

  throw usageError("skill takes only the optional references argument");
};

import type {
  Config,
  Delta,
  FlowMessage,
  GraphDoc,
  GraphNode,
  Lens,
  View,
  ViewScope,
} from "@coldtea/pr-lens-schema";
import { assertNever } from "@coldtea/pr-lens-schema";
import { applyCorrections } from "./corrections.js";
import { PrLensRenderError } from "./errors.js";
import { findView, resolveScope, type ScopedGraph } from "./scope.js";

export type MermaidRenderOptions = {
  lens: Lens;
  /** Id of the drill-down section to project. Omitted projects the whole document. */
  view?: string;
  /** The repository's corrections, applied before the projection is built. */
  config?: Config;
};

const WHOLE_DOCUMENT: ViewScope = { kind: "all" };

const requireView = (views: readonly View[], id: string): View => {
  const view = findView(views, id);
  if (view === undefined)
    throw new PrLensRenderError("UNKNOWN_VIEW", `this document has no view '${id}'`);
  return view;
};

/**
 * Mermaid treats labels as syntax, so graph text has to be encoded before it
 * enters quoted nodes, subgraphs, participants or edge labels.
 */
const LABEL_ESCAPES = new Map([
  ["&", "&amp;"],
  ['"', "&quot;"],
  ["|", "&#124;"],
  ["<", "&lt;"],
  [">", "&gt;"],
]);

const escapeLabel = (value: string): string =>
  value
    .replace(/[&"|<>]/g, (character) => LABEL_ESCAPES.get(character) ?? "")
    .replaceAll(/\r?\n/g, " ");

const deltaText = (delta: Delta): string => {
  switch (delta) {
    case "added":
      return " (added)";
    case "modified":
      return " (modified)";
    case "removed":
      return " (removed)";
    case "unchanged":
      return "";
    default:
      return assertNever(delta, "Unhandled delta");
  }
};

const nodeLabel = (node: GraphNode): string =>
  escapeLabel(`${node.label}${deltaText(node.delta)}${node.subtitle === undefined ? "" : ` / ${node.subtitle}`}`);

const orderedLanes = (graph: ScopedGraph, doc: GraphDoc): ScopedGraph["lanes"] => {
  const explicit = new Map(doc.layout?.laneOrder.map((id, index) => [id, index]) ?? []);
  const sourceIndex = new Map(graph.lanes.map((lane, index) => [lane.id, index]));

  return [...graph.lanes].sort((left, right) => {
    const leftOrder = explicit.get(left.id) ?? left.order ?? sourceIndex.get(left.id) ?? 0;
    const rightOrder = explicit.get(right.id) ?? right.order ?? sourceIndex.get(right.id) ?? 0;
    return leftOrder - rightOrder;
  });
};

const architectureDirection = (doc: GraphDoc): "LR" | "TD" => {
  const direction = doc.layout?.direction ?? "right";
  switch (direction) {
    case "right":
      return "LR";
    case "down":
      return "TD";
    default:
      return assertNever(direction, "Unhandled layout direction");
  }
};

const architectureMermaid = (graph: ScopedGraph, doc: GraphDoc): string => {
  if (graph.nodes.length === 0)
    throw new PrLensRenderError("NOTHING_TO_RENDER", "no nodes are in scope for this view");

  const aliases = new Map(graph.nodes.map((node, index) => [node.id, `n${index}`]));
  const lines = [`flowchart ${architectureDirection(doc)}`];

  for (const [laneIndex, lane] of orderedLanes(graph, doc).entries()) {
    const subtitle = lane.subtitle === undefined ? "" : ` / ${lane.subtitle}`;
    lines.push(`  subgraph lane${laneIndex}["${escapeLabel(`${lane.label}${subtitle}${deltaText(lane.delta ?? "unchanged")}`)}"]`);
    for (const node of graph.nodes) {
      if (node.lane !== lane.id) continue;
      const alias = aliases.get(node.id);
      if (alias === undefined)
        throw new PrLensRenderError("NOTHING_TO_RENDER", `node '${node.id}' has no Mermaid alias`);
      lines.push(`    ${alias}["${nodeLabel(node)}"]`);
    }
    lines.push("  end");
  }

  for (const edge of graph.edges) {
    const from = aliases.get(edge.from);
    const to = aliases.get(edge.to);
    if (from === undefined || to === undefined)
      throw new PrLensRenderError(
        "NOTHING_TO_RENDER",
        `edge '${edge.id}' points outside the selected Mermaid scope`,
      );
    const description = escapeLabel(`${edge.label ?? edge.kind}${deltaText(edge.delta)}`);
    lines.push(`  ${from} -->|"${description}"| ${to}`);
  }

  return `${lines.join("\n")}\n`;
};

const messageArrow = (message: FlowMessage): string => {
  switch (message.kind) {
    case "sync":
    case "self":
      return "->>";
    case "async":
      return "-)";
    case "return":
      return "-->>";
    default:
      return assertNever(message.kind, "Unhandled message kind");
  }
};

const dataFlowMermaid = (graph: ScopedGraph, doc: GraphDoc): string => {
  if (graph.flows.length === 0)
    throw new PrLensRenderError("NO_FLOW_IN_SCOPE", "the data-flow lens needs a flow to project");

  const nodes = new Map(doc.nodes.map((node) => [node.id, node]));
  const aliases = new Map<string, string>();
  const labels = new Map<string, string>();

  for (const flow of graph.flows)
    for (const participant of flow.participants) {
      if (aliases.has(participant.node)) continue;
      const node = nodes.get(participant.node);
      if (node === undefined)
        throw new PrLensRenderError(
          "NO_FLOW_IN_SCOPE",
          `flow '${flow.id}' names unknown participant '${participant.node}'`,
        );
      aliases.set(participant.node, `p${aliases.size}`);
      labels.set(participant.node, participant.label ?? node.label);
    }

  const lines = ["sequenceDiagram"];
  for (const [nodeId, alias] of aliases) {
    const label = labels.get(nodeId);
    if (label === undefined)
      throw new PrLensRenderError("NO_FLOW_IN_SCOPE", `participant '${nodeId}' has no label`);
    lines.push(`  participant ${alias} as "${escapeLabel(label)}"`);
  }

  for (const flow of graph.flows) {
    const firstParticipant = flow.participants[0];
    const lastParticipant = flow.participants.at(-1);
    const first = firstParticipant === undefined ? undefined : aliases.get(firstParticipant.node);
    const last = lastParticipant === undefined ? undefined : aliases.get(lastParticipant.node);
    if (first === undefined || last === undefined)
      throw new PrLensRenderError(
        "NO_FLOW_IN_SCOPE",
        `flow '${flow.id}' has no complete participant range`,
      );
    lines.push(
      `  Note over ${first},${last}: ${escapeLabel(`${flow.title}${deltaText(flow.delta)}`)}`,
    );
    for (const message of flow.messages) {
      const from = aliases.get(message.from);
      const to = aliases.get(message.to);
      if (from === undefined || to === undefined)
        throw new PrLensRenderError(
          "NO_FLOW_IN_SCOPE",
          `message '${message.id}' points outside its flow participants`,
        );
      const repeat = message.repeat === undefined ? "" : `, repeated ${message.repeat} times`;
      lines.push(
        `  ${from}${messageArrow(message)}${to}: ${escapeLabel(`${message.label}${deltaText(message.delta)}${repeat}`)}`,
      );
      if (message.note !== undefined)
        lines.push(`  Note right of ${to}: ${escapeLabel(message.note)}`);
    }
  }

  return `${lines.join("\n")}\n`;
};

/**
 * Projects the same evidence graph used by the SVG renderer into terminal-
 * friendly Mermaid. It contains no clock, file or random input, so identical
 * documents and options always produce identical bytes.
 */
export const renderMermaid = (doc: GraphDoc, options: MermaidRenderOptions): string => {
  const prepared = options.config === undefined ? doc : applyCorrections(doc, options.config.map);

  if (!prepared.lenses.includes(options.lens))
    throw new PrLensRenderError(
      "LENS_NOT_DECLARED",
      `this document does not declare the '${options.lens}' lens`,
    );

  const view = options.view === undefined ? undefined : requireView(prepared.views, options.view);
  if (view !== undefined && view.lens !== options.lens)
    throw new PrLensRenderError(
      "VIEW_LENS_MISMATCH",
      `view '${view.id}' uses the '${view.lens}' lens, not '${options.lens}'`,
    );

  const graph = resolveScope(prepared, view?.scope ?? WHOLE_DOCUMENT);
  switch (options.lens) {
    case "architecture":
      return architectureMermaid(graph, prepared);
    case "data-flow":
      return dataFlowMermaid(graph, prepared);
    default:
      return assertNever(options.lens, "Unhandled Mermaid lens");
  }
};

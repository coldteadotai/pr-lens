import type {
  Flow,
  FlowMessage,
  GraphDoc,
  GraphEdge,
  GraphNode,
  Lane,
  MapCorrections,
  View,
  ViewScope,
} from "@coldtea/pr-lens-schema";
import { assertNever } from "@coldtea/pr-lens-schema";
import { PrLensRenderError } from "./errors.js";
import { matchesGlob } from "./glob.js";

const ID_SELECTOR = "id:";

const selects = (selector: string, node: GraphNode): boolean => {
  if (selector.startsWith(ID_SELECTOR)) return node.id === selector.slice(ID_SELECTOR.length);
  return node.files.some((file) => matchesGlob(selector, file.path));
};

/**
 * A view of a selection with the ids the overlay removed taken out, or
 * `undefined` when nothing it pointed at survived. A selection is never
 * allowed to empty out into "show everything": that is a different view.
 */
const narrowScope = (
  scope: ViewScope,
  survives: { lane: (id: string) => boolean; node: (id: string) => boolean; edge: (id: string) => boolean; flow: (id: string) => boolean },
): ViewScope | undefined => {
  switch (scope.kind) {
    case "all":
      return scope;
    case "selection": {
      const narrowed = {
        kind: "selection" as const,
        lanes: scope.lanes.filter(survives.lane),
        nodes: scope.nodes.filter(survives.node),
        edges: scope.edges.filter(survives.edge),
        flows: scope.flows.filter(survives.flow),
      };
      const total =
        narrowed.lanes.length + narrowed.nodes.length + narrowed.edges.length + narrowed.flows.length;
      return total > 0 ? narrowed : undefined;
    }
    default:
      return assertNever(scope, "Unhandled view scope");
  }
};

const narrowViews = (
  views: readonly View[],
  survives: Parameters<typeof narrowScope>[1],
): View[] =>
  views.flatMap((view) => {
    const scope = narrowScope(view.scope, survives);
    if (scope === undefined) return [];
    return [{ ...view, scope, children: narrowViews(view.children, survives) }];
  });

/**
 * Applies a repository's corrections over an inferred document.
 *
 * The overlay is re-applied to fresh inference on every run, so a correction
 * keeps holding as the code moves and inference never learns to agree with
 * it. Everything a removed node touched goes with it: an edge to a node that
 * is no longer drawn would point at empty space, and a flow step from one
 * would animate out of nowhere.
 */
export const applyCorrections = (doc: GraphDoc, corrections: MapCorrections): GraphDoc => {
  const excluded = new Set(
    doc.nodes.filter((node) => corrections.exclude.some((selector) => selects(selector, node))).map((node) => node.id),
  );

  const nodes: GraphNode[] = doc.nodes
    .filter((node) => !excluded.has(node.id))
    .map((node) => {
      const rename = corrections.rename.find((rule) => selects(rule.match, node));
      const lane = corrections.lane.find((rule) => selects(rule.match, node));
      const group = corrections.group.find((rule) => selects(rule.match, node));
      return {
        ...node,
        label: rename ? rename.to : node.label,
        lane: lane ? lane.lane : node.lane,
        group: group ? group.group : node.group,
      };
    });

  if (nodes.length === 0)
    throw new PrLensRenderError(
      "NOTHING_TO_RENDER",
      "the exclude rules in this repository's config removed every node",
    );

  /**
   * A `lane` correction may name a band the document never declared, which is
   * how a repository adds one of its own. It gets the id for a label, since
   * that is the only name the config carries.
   */
  const declared = new Set(doc.lanes.map((lane) => lane.id));
  const invented: Lane[] = [...new Set(nodes.map((node) => node.lane))]
    .filter((id) => !declared.has(id))
    .map((id) => ({ id, label: id }));

  const lanes = [...doc.lanes, ...invented];

  const edges: GraphEdge[] = doc.edges.filter(
    (edge) => !excluded.has(edge.from) && !excluded.has(edge.to),
  );

  const flows: Flow[] = doc.flows.flatMap((flow) => {
    const participants = flow.participants.filter((participant) => !excluded.has(participant.node));
    if (participants.length < 2) return [];

    const kept = new Set(participants.map((participant) => participant.node));
    const messages: FlowMessage[] = flow.messages.filter(
      (message) => kept.has(message.from) && kept.has(message.to),
    );
    if (messages.length === 0) return [];

    return [{ ...flow, participants, messages }];
  });

  const survives = {
    lane: (id: string) => lanes.some((lane) => lane.id === id),
    node: (id: string) => !excluded.has(id),
    edge: (id: string) => edges.some((edge) => edge.id === id),
    flow: (id: string) => flows.some((flow) => flow.id === id),
  };

  return { ...doc, lanes, nodes, edges, flows, views: narrowViews(doc.views, survives) };
};

import type { Flow, GraphDoc, GraphEdge, GraphNode, Lane, View, ViewScope } from "@coldtea/pr-lens-schema";
import { assertNever } from "@coldtea/pr-lens-schema";

/** The slice of a document one SVG draws. */
export type ScopedGraph = {
  lanes: Lane[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  flows: Flow[];
};

export const findView = (views: readonly View[], id: string): View | undefined => {
  for (const view of views) {
    if (view.id === id) return view;
    const nested = findView(view.children, id);
    if (nested) return nested;
  }
  return undefined;
};

export const flattenViews = (views: readonly View[]): View[] =>
  views.flatMap((view) => [view, ...flattenViews(view.children)]);

/**
 * Turns a view's scope into the elements to draw.
 *
 * A selection pulls in what its members need to make sense: the lanes its
 * nodes sit in, and both ends of every edge it names, since half an arrow is
 * worse than none. Edges are the one place the author keeps full control —
 * name any and exactly those are drawn, name none and the connections between
 * the selected nodes come along.
 */
export const resolveScope = (doc: GraphDoc, scope: ViewScope): ScopedGraph => {
  switch (scope.kind) {
    case "all":
      return { lanes: [...doc.lanes], nodes: [...doc.nodes], edges: [...doc.edges], flows: [...doc.flows] };
    case "selection": {
      const selectedLanes = new Set(scope.lanes);
      const selectedEdges = new Set(scope.edges);
      const selectedFlows = new Set(scope.flows);
      const flows = doc.flows.filter((flow) => selectedFlows.has(flow.id));

      const nodeIds = new Set<string>(scope.nodes);
      for (const node of doc.nodes) if (selectedLanes.has(node.lane)) nodeIds.add(node.id);
      for (const edge of doc.edges) {
        if (!selectedEdges.has(edge.id)) continue;
        nodeIds.add(edge.from);
        nodeIds.add(edge.to);
      }
      for (const flow of flows)
        for (const participant of flow.participants) nodeIds.add(participant.node);

      const nodes = doc.nodes.filter((node) => nodeIds.has(node.id));
      const edges =
        scope.edges.length > 0
          ? doc.edges.filter((edge) => selectedEdges.has(edge.id))
          : doc.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));

      const laneIds = new Set<string>(scope.lanes);
      for (const node of nodes) laneIds.add(node.lane);

      return { lanes: doc.lanes.filter((lane) => laneIds.has(lane.id)), nodes, edges, flows };
    }
    default:
      return assertNever(scope, "Unhandled view scope");
  }
};

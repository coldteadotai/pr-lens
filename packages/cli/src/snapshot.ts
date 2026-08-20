import {
  applyPatch,
  formatIssues,
  graphSnapshotIssues,
  PrLensSchemaError,
  safeParseGraphDoc,
  type Flow,
  type GraphDoc,
  type Parsed,
  type PatchOp,
} from "@coldtea/pr-lens-schema";

export type StoredMapOptions = {
  id: string;
  sha: string;
  generatedAt: string;
};

const withoutRemovedMessages = (flow: Flow): Flow["messages"] =>
  flow.messages.filter((message) => message.delta !== "removed");

/**
 * A pull-request document says what a change did; a stored map says what the
 * system is once it has been done. So elements the change deletes go, and the
 * rest stops being annotated.
 *
 * The deletions run through `applyPatch` rather than a filter, because
 * removing a node also strands its edges, its flow steps, the drill-down views
 * that pointed at it and the layout hints that named it — the contract already
 * owns that cascade and there is no second version of it here.
 */
const deletionOps = (graph: GraphDoc): PatchOp[] => {
  const flowOps = graph.flows.flatMap<PatchOp>((flow) => {
    const messages = withoutRemovedMessages(flow);
    if (flow.delta === "removed" || messages.length === 0) return [{ op: "remove_flow", id: flow.id }];
    if (messages.length === flow.messages.length) return [];
    return [{ op: "update_flow", id: flow.id, patch: { messages } }];
  });

  return [
    ...flowOps,
    ...graph.edges
      .filter((edge) => edge.delta === "removed")
      .map<PatchOp>((edge) => ({ op: "remove_edge", id: edge.id })),
    ...graph.nodes
      .filter((node) => node.delta === "removed")
      .map<PatchOp>((node) => ({ op: "remove_node", id: node.id })),
    ...graph.lanes
      .filter((lane) => lane.delta === "removed")
      .map<PatchOp>((lane) => ({ op: "remove_lane", id: lane.id })),
  ];
};

/**
 * The map a repository commits: the merged state of the system, identified,
 * stamped with the one commit it reflects, and carrying no annotations.
 *
 * Change statistics are dropped rather than carried over. A line count
 * describes a diff, and this document no longer describes one.
 */
export const toStoredMap = (graph: GraphDoc, options: StoredMapOptions): Parsed<GraphDoc> => {
  const applied = applyPatch(graph, deletionOps(graph));
  if (!applied.ok) return applied;

  const merged = applied.value;
  const head = { ...merged.provenance.head, sha: options.sha };

  const candidate = {
    ...merged,
    id: options.id,
    generatedAt: options.generatedAt,
    provenance: { ...merged.provenance, base: head, head },
    stats: undefined,
    lanes: merged.lanes.map(({ delta: _delta, ...lane }) => lane),
    nodes: merged.nodes.map((node) => ({ ...node, delta: "unchanged" as const })),
    edges: merged.edges.map((edge) => ({ ...edge, delta: "unchanged" as const })),
    flows: merged.flows.map((flow) => ({
      ...flow,
      delta: "unchanged" as const,
      messages: withoutRemovedMessages(flow).map((message) => ({
        ...message,
        delta: "unchanged" as const,
      })),
    })),
  };

  const parsed = safeParseGraphDoc(candidate);
  if (!parsed.ok) return parsed;

  const issues = graphSnapshotIssues(parsed.value);
  if (issues.length > 0)
    return {
      ok: false,
      error: new PrLensSchemaError(
        "NOT_A_SNAPSHOT",
        `the exported document is not a stored map:\n${formatIssues(issues)}`,
        issues,
      ),
    };

  return parsed;
};

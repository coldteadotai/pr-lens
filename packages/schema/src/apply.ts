import { PrLensSchemaError, type Parsed, type SchemaIssue } from "./errors.js";
import { safeParseGraphDoc } from "./validate.js";
import type { Flow, GraphDoc, GraphEdge, Lane, View } from "./graph.js";
import type { PatchDoc, PatchOp } from "./patch.js";
import { assertNever } from "./utils.js";

type Collections = {
  lanes: Lane[];
  nodes: GraphDoc["nodes"];
  edges: GraphEdge[];
  flows: Flow[];
  stats: GraphDoc["stats"];
};

const conflict = (path: string, message: string): SchemaIssue => ({
  code: "PATCH_CONFLICT",
  path,
  message,
});

const brokenReference = (path: string, message: string): SchemaIssue => ({
  code: "BROKEN_REFERENCE",
  path,
  message,
});

const indexOfId = (items: readonly { id: string }[], id: string): number =>
  items.findIndex((item) => item.id === id);

type RemovedIds = {
  lanes: ReadonlySet<string>;
  nodes: ReadonlySet<string>;
  edges: ReadonlySet<string>;
  flows: ReadonlySet<string>;
};

const nothingRemoved: RemovedIds = {
  lanes: new Set(),
  nodes: new Set(),
  edges: new Set(),
  flows: new Set(),
};

/**
 * A view whose selection loses its last element no longer has a subject, so
 * it goes rather than being left to render as an empty section.
 */
const pruneViews = (views: readonly View[], removed: RemovedIds): View[] =>
  views.flatMap((view) => {
    const children = pruneViews(view.children, removed);

    switch (view.scope.kind) {
      case "all":
        return [{ ...view, children }];
      case "selection": {
        const scope = {
          kind: "selection",
          lanes: view.scope.lanes.filter((id) => !removed.lanes.has(id)),
          nodes: view.scope.nodes.filter((id) => !removed.nodes.has(id)),
          edges: view.scope.edges.filter((id) => !removed.edges.has(id)),
          flows: view.scope.flows.filter((id) => !removed.flows.has(id)),
        } as const;

        const selected =
          scope.lanes.length + scope.nodes.length + scope.edges.length + scope.flows.length;
        return selected === 0 ? [] : [{ ...view, scope, children }];
      }
      default:
        return assertNever(view.scope, "Unhandled view scope");
    }
  });

/** Layout hints name elements, so they strand the same way view scopes do. */
const pruneLayout = (layout: GraphDoc["layout"], removed: RemovedIds): GraphDoc["layout"] => {
  if (layout === undefined) return undefined;

  const rank = layout.rank
    ? Object.fromEntries(
        Object.entries(layout.rank).filter(([nodeId]) => !removed.nodes.has(nodeId)),
      )
    : undefined;

  return {
    ...layout,
    laneOrder: layout.laneOrder.filter((id) => !removed.lanes.has(id)),
    ...(rank ? { rank } : {}),
  };
};

/**
 * Deleting a node would strand every edge and flow step that touched it, so
 * those go with it. A flow left with fewer than two participants, or with no
 * steps, no longer describes a pipeline and is dropped whole.
 */
const cascadeNodeRemoval = (working: Collections, nodeId: string): RemovedIds => {
  const strandedEdges = working.edges.filter((edge) => edge.from === nodeId || edge.to === nodeId);
  working.edges = working.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId);

  const droppedFlows: string[] = [];
  working.flows = working.flows.flatMap((flow) => {
    const participants = flow.participants.filter((participant) => participant.node !== nodeId);
    if (participants.length === flow.participants.length) return [flow];

    const messages = flow.messages.filter(
      (message) => message.from !== nodeId && message.to !== nodeId,
    );
    if (participants.length < 2 || messages.length === 0) {
      droppedFlows.push(flow.id);
      return [];
    }

    return [{ ...flow, participants, messages }];
  });

  return {
    ...nothingRemoved,
    nodes: new Set([nodeId]),
    edges: new Set(strandedEdges.map((edge) => edge.id)),
    flows: new Set(droppedFlows),
  };
};

/**
 * Applies patch operations to a stored graph — the way a baseline map moves
 * forward as pull requests merge, instead of being re-extracted wholesale.
 *
 * Operations apply in order and the first conflict stops the batch: a later
 * operation in the same patch was written against the state the earlier one
 * was supposed to produce.
 *
 * A successful result is a fully valid graph document: per-operation checks
 * catch the common mistakes with a message naming the operation, and the
 * candidate is validated as a whole before it is handed back, so no patch can
 * quietly leave a document the renderer would choke on.
 */
export const applyPatch = (graph: GraphDoc, ops: readonly PatchOp[]): Parsed<GraphDoc> => {
  const working: Collections = {
    lanes: [...graph.lanes],
    nodes: [...graph.nodes],
    edges: [...graph.edges],
    flows: [...graph.flows],
    stats: graph.stats,
  };
  let views = graph.views;
  let layout = graph.layout;

  const prune = (removed: RemovedIds): void => {
    views = pruneViews(views, removed);
    layout = pruneLayout(layout, removed);
  };

  for (const [index, op] of ops.entries()) {
    const at = `ops[${index}]`;
    const reject = (issue: SchemaIssue): Parsed<GraphDoc> => ({
      ok: false,
      error: new PrLensSchemaError(issue.code, `${at}: ${issue.message}`, [issue]),
    });

    switch (op.op) {
      case "add_lane": {
        if (indexOfId(working.lanes, op.lane.id) !== -1)
          return reject(conflict(`${at}.lane.id`, `lane '${op.lane.id}' already exists`));
        working.lanes.push(op.lane);
        break;
      }
      case "update_lane": {
        const position = indexOfId(working.lanes, op.id);
        const lane = working.lanes[position];
        if (lane === undefined) return reject(conflict(`${at}.id`, `unknown lane '${op.id}'`));
        working.lanes[position] = { ...lane, ...op.patch };
        break;
      }
      case "remove_lane": {
        const position = indexOfId(working.lanes, op.id);
        if (position === -1) return reject(conflict(`${at}.id`, `unknown lane '${op.id}'`));

        const occupant = working.nodes.find((node) => node.lane === op.id);
        if (occupant !== undefined)
          return reject(
            conflict(
              `${at}.id`,
              `lane '${op.id}' still holds node '${occupant.id}'; move or remove its nodes first`,
            ),
          );

        working.lanes.splice(position, 1);
        prune({ ...nothingRemoved, lanes: new Set([op.id]) });
        break;
      }

      case "add_node": {
        if (indexOfId(working.nodes, op.node.id) !== -1)
          return reject(conflict(`${at}.node.id`, `node '${op.node.id}' already exists`));
        if (indexOfId(working.lanes, op.node.lane) === -1)
          return reject(brokenReference(`${at}.node.lane`, `unknown lane '${op.node.lane}'`));
        working.nodes.push(op.node);
        break;
      }
      case "update_node": {
        const position = indexOfId(working.nodes, op.id);
        const node = working.nodes[position];
        if (node === undefined) return reject(conflict(`${at}.id`, `unknown node '${op.id}'`));
        if (op.patch.lane !== undefined && indexOfId(working.lanes, op.patch.lane) === -1)
          return reject(brokenReference(`${at}.patch.lane`, `unknown lane '${op.patch.lane}'`));
        working.nodes[position] = { ...node, ...op.patch };
        break;
      }
      case "remove_node": {
        const position = indexOfId(working.nodes, op.id);
        if (position === -1) return reject(conflict(`${at}.id`, `unknown node '${op.id}'`));
        working.nodes.splice(position, 1);
        prune(cascadeNodeRemoval(working, op.id));
        break;
      }

      case "add_edge": {
        if (indexOfId(working.edges, op.edge.id) !== -1)
          return reject(conflict(`${at}.edge.id`, `edge '${op.edge.id}' already exists`));
        for (const [field, id] of [
          ["from", op.edge.from],
          ["to", op.edge.to],
        ] as const) {
          if (indexOfId(working.nodes, id) === -1)
            return reject(brokenReference(`${at}.edge.${field}`, `unknown node '${id}'`));
        }
        working.edges.push(op.edge);
        break;
      }
      case "update_edge": {
        const position = indexOfId(working.edges, op.id);
        const edge = working.edges[position];
        if (edge === undefined) return reject(conflict(`${at}.id`, `unknown edge '${op.id}'`));
        for (const [field, id] of [
          ["from", op.patch.from],
          ["to", op.patch.to],
        ] as const) {
          if (id !== undefined && indexOfId(working.nodes, id) === -1)
            return reject(brokenReference(`${at}.patch.${field}`, `unknown node '${id}'`));
        }
        working.edges[position] = { ...edge, ...op.patch };
        break;
      }
      case "remove_edge": {
        const position = indexOfId(working.edges, op.id);
        if (position === -1) return reject(conflict(`${at}.id`, `unknown edge '${op.id}'`));
        working.edges.splice(position, 1);
        prune({ ...nothingRemoved, edges: new Set([op.id]) });
        break;
      }

      case "add_flow": {
        if (indexOfId(working.flows, op.flow.id) !== -1)
          return reject(conflict(`${at}.flow.id`, `flow '${op.flow.id}' already exists`));
        for (const [participantIndex, participant] of op.flow.participants.entries()) {
          if (indexOfId(working.nodes, participant.node) === -1)
            return reject(
              brokenReference(
                `${at}.flow.participants[${participantIndex}].node`,
                `unknown node '${participant.node}'`,
              ),
            );
        }
        working.flows.push(op.flow);
        break;
      }
      case "update_flow": {
        const position = indexOfId(working.flows, op.id);
        const flow = working.flows[position];
        if (flow === undefined) return reject(conflict(`${at}.id`, `unknown flow '${op.id}'`));
        for (const [participantIndex, participant] of (op.patch.participants ?? []).entries()) {
          if (indexOfId(working.nodes, participant.node) === -1)
            return reject(
              brokenReference(
                `${at}.patch.participants[${participantIndex}].node`,
                `unknown node '${participant.node}'`,
              ),
            );
        }
        working.flows[position] = { ...flow, ...op.patch };
        break;
      }
      case "remove_flow": {
        const position = indexOfId(working.flows, op.id);
        if (position === -1) return reject(conflict(`${at}.id`, `unknown flow '${op.id}'`));
        working.flows.splice(position, 1);
        prune({ ...nothingRemoved, flows: new Set([op.id]) });
        break;
      }

      case "set_stats": {
        working.stats = op.stats;
        break;
      }

      default:
        return assertNever(op, "Unhandled patch operation");
    }
  }

  return safeParseGraphDoc({
    ...graph,
    lanes: working.lanes,
    nodes: working.nodes,
    edges: working.edges,
    flows: working.flows,
    stats: working.stats,
    views,
    layout,
  });
};

/**
 * Applies a patch document, honouring the target it declares.
 *
 * `applyPatch` takes bare operations and trusts the caller to have picked the
 * right document; this checks first. A baseline map is long-lived and patched
 * repeatedly, so applying a patch to the wrong map, or to one that has moved
 * on since the patch was written, has to fail loudly rather than merge.
 *
 * On success the map records the commit it now reflects: `head` becomes the
 * patch's `toSha`, and `base` becomes the commit the map came from.
 */
export const applyPatchDoc = (graph: GraphDoc, patch: PatchDoc): Parsed<GraphDoc> => {
  const { graphId, fromSha, toSha } = patch.target;

  if (graphId !== undefined && graph.id !== graphId)
    return {
      ok: false,
      error: new PrLensSchemaError(
        "PATCH_CONFLICT",
        `patch targets graph '${graphId}' but was applied to '${graph.id ?? "an unidentified graph"}'`,
        [{ code: "PATCH_CONFLICT", path: "target.graphId", message: "wrong graph" }],
      ),
    };

  if (fromSha !== undefined && graph.provenance.head.sha !== fromSha)
    return {
      ok: false,
      error: new PrLensSchemaError(
        "PATCH_CONFLICT",
        `patch expects the graph at ${fromSha} but it reflects ${graph.provenance.head.sha}`,
        [{ code: "PATCH_CONFLICT", path: "target.fromSha", message: "stale baseline" }],
      ),
    };

  const applied = applyPatch(graph, patch.ops);
  if (!applied.ok || toSha === undefined) return applied;

  return {
    ok: true,
    value: {
      ...applied.value,
      provenance: {
        ...applied.value.provenance,
        base: applied.value.provenance.head,
        head: { ...applied.value.provenance.head, sha: toSha },
      },
    },
  };
};

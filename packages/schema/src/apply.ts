import { PrLensSchemaError, type Parsed, type SchemaIssue } from "./errors.js";
import type { Flow, GraphDoc, GraphEdge, Lane, View } from "./graph.js";
import type { PatchOp } from "./patch.js";
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

const pruneViews = (views: readonly View[], removed: RemovedIds): View[] =>
  views.map((view) => ({
    ...view,
    scope: {
      lanes: view.scope.lanes.filter((id) => !removed.lanes.has(id)),
      nodes: view.scope.nodes.filter((id) => !removed.nodes.has(id)),
      edges: view.scope.edges.filter((id) => !removed.edges.has(id)),
      flows: view.scope.flows.filter((id) => !removed.flows.has(id)),
    },
    children: pruneViews(view.children, removed),
  }));

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
        views = pruneViews(views, { ...nothingRemoved, lanes: new Set([op.id]) });
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
        views = pruneViews(views, cascadeNodeRemoval(working, op.id));
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
        views = pruneViews(views, { ...nothingRemoved, edges: new Set([op.id]) });
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
        views = pruneViews(views, { ...nothingRemoved, flows: new Set([op.id]) });
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

  return {
    ok: true,
    value: {
      ...graph,
      lanes: working.lanes,
      nodes: working.nodes,
      edges: working.edges,
      flows: working.flows,
      stats: working.stats,
      views,
    },
  };
};

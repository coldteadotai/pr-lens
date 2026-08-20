import type { SchemaIssue } from "./errors.js";
import type { GraphDoc, View } from "./graph.js";
import type { Delta } from "./primitives.js";
import { assertNever } from "./utils.js";

const duplicates = (ids: readonly string[]): string[] => {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) repeated.add(id);
    seen.add(id);
  }
  return [...repeated];
};

const flattenViews = (views: readonly View[], prefix: string): { view: View; path: string }[] =>
  views.flatMap((view, index) => {
    const path = `${prefix}[${index}]`;
    return [{ view, path }, ...flattenViews(view.children, `${path}.children`)];
  });

/**
 * Structural validation says a field holds an id; these checks say the id
 * points at something. Extraction models routinely emit an edge to a node
 * they forgot to declare, and a renderer must never be handed that document.
 */
export const graphIntegrityIssues = (doc: GraphDoc): SchemaIssue[] => {
  const issues: SchemaIssue[] = [];
  const broken = (path: string, message: string) =>
    issues.push({ code: "BROKEN_REFERENCE", path, message });
  const duplicate = (path: string, message: string) =>
    issues.push({ code: "DUPLICATE_ID", path, message });

  const laneIds = new Set(doc.lanes.map((lane) => lane.id));
  const nodeIds = new Set(doc.nodes.map((node) => node.id));
  const flowIds = new Set(doc.flows.map((flow) => flow.id));
  const edgeIds = new Set(doc.edges.map((edge) => edge.id));
  const lenses = new Set(doc.lenses);

  for (const id of duplicates(doc.lanes.map((lane) => lane.id)))
    duplicate("lanes", `duplicate lane id '${id}'`);
  for (const id of duplicates(doc.nodes.map((node) => node.id)))
    duplicate("nodes", `duplicate node id '${id}'`);
  for (const id of duplicates(doc.edges.map((edge) => edge.id)))
    duplicate("edges", `duplicate edge id '${id}'`);
  for (const id of duplicates(doc.flows.map((flow) => flow.id)))
    duplicate("flows", `duplicate flow id '${id}'`);

  doc.nodes.forEach((node, index) => {
    if (!laneIds.has(node.lane))
      broken(`nodes[${index}].lane`, `node '${node.id}' references unknown lane '${node.lane}'`);
  });

  doc.edges.forEach((edge, index) => {
    if (!nodeIds.has(edge.from))
      broken(`edges[${index}].from`, `edge '${edge.id}' references unknown node '${edge.from}'`);
    if (!nodeIds.has(edge.to))
      broken(`edges[${index}].to`, `edge '${edge.id}' references unknown node '${edge.to}'`);
  });

  doc.flows.forEach((flow, flowIndex) => {
    const participantIds = new Set(flow.participants.map((participant) => participant.node));

    for (const id of duplicates(flow.participants.map((participant) => participant.node)))
      duplicate(`flows[${flowIndex}].participants`, `participant '${id}' listed twice`);
    for (const id of duplicates(flow.messages.map((message) => message.id)))
      duplicate(`flows[${flowIndex}].messages`, `duplicate message id '${id}'`);

    flow.participants.forEach((participant, index) => {
      if (!nodeIds.has(participant.node))
        broken(
          `flows[${flowIndex}].participants[${index}].node`,
          `flow '${flow.id}' references unknown node '${participant.node}'`,
        );
    });

    flow.messages.forEach((message, index) => {
      if (!participantIds.has(message.from))
        broken(
          `flows[${flowIndex}].messages[${index}].from`,
          `message '${message.id}' sends from '${message.from}', which is not a participant`,
        );
      if (!participantIds.has(message.to))
        broken(
          `flows[${flowIndex}].messages[${index}].to`,
          `message '${message.id}' sends to '${message.to}', which is not a participant`,
        );
    });
  });

  if (doc.flows.length > 0 && !lenses.has("data-flow"))
    broken("lenses", "document carries flows but does not declare the 'data-flow' lens");

  const views = flattenViews(doc.views, "views");
  for (const id of duplicates(views.map(({ view }) => view.id)))
    duplicate("views", `duplicate view id '${id}'`);

  for (const { view, path } of views) {
    if (!lenses.has(view.lens))
      broken(`${path}.lens`, `view '${view.id}' uses lens '${view.lens}', which the document does not declare`);

    switch (view.scope.kind) {
      case "all":
        break;
      case "selection": {
        const selection = view.scope;
        const scoped: [keyof Omit<typeof selection, "kind">, string, ReadonlySet<string>][] = [
          ["lanes", "lane", laneIds],
          ["nodes", "node", nodeIds],
          ["edges", "edge", edgeIds],
          ["flows", "flow", flowIds],
        ];
        for (const [collection, singular, known] of scoped) {
          selection[collection].forEach((id, index) => {
            if (!known.has(id))
              broken(
                `${path}.scope.${collection}[${index}]`,
                `view '${view.id}' scopes unknown ${singular} '${id}'`,
              );
          });
        }
        break;
      }
      default:
        assertNever(view.scope, "Unhandled view scope");
    }
  }

  if (doc.layout) {
    doc.layout.laneOrder.forEach((id, index) => {
      if (!laneIds.has(id)) broken(`layout.laneOrder[${index}]`, `unknown lane '${id}'`);
    });
    for (const id of Object.keys(doc.layout.rank ?? {})) {
      if (!nodeIds.has(id)) broken(`layout.rank.${id}`, `unknown node '${id}'`);
    }
  }

  return issues;
};

/**
 * A stored map describes a system, not a change to one: it reflects a single
 * commit, and nothing in it is annotated as a change. A map that fails this
 * would hand the next pull request a baseline that already claims to be mid
 * change, and every delta computed against it would inherit the mistake.
 */
export const graphSnapshotIssues = (doc: GraphDoc): SchemaIssue[] => {
  const issues: SchemaIssue[] = [];

  const requireUnchanged = (delta: Delta | undefined, path: string, subject: string) => {
    if (delta === undefined || delta === "unchanged") return;
    issues.push({
      code: "NOT_A_SNAPSHOT",
      path,
      message: `${subject} is marked '${delta}', but a stored map describes a system rather than a change`,
    });
  };

  if (doc.provenance.base.sha !== doc.provenance.head.sha)
    issues.push({
      code: "NOT_A_SNAPSHOT",
      path: "provenance",
      message: `a stored map reflects one commit, but base is ${doc.provenance.base.sha} and head is ${doc.provenance.head.sha}`,
    });

  doc.lanes.forEach((lane, index) =>
    requireUnchanged(lane.delta, `lanes[${index}].delta`, `lane '${lane.id}'`),
  );
  doc.nodes.forEach((node, index) =>
    requireUnchanged(node.delta, `nodes[${index}].delta`, `node '${node.id}'`),
  );
  doc.edges.forEach((edge, index) =>
    requireUnchanged(edge.delta, `edges[${index}].delta`, `edge '${edge.id}'`),
  );
  doc.flows.forEach((flow, flowIndex) => {
    requireUnchanged(flow.delta, `flows[${flowIndex}].delta`, `flow '${flow.id}'`);
    flow.messages.forEach((message, index) =>
      requireUnchanged(
        message.delta,
        `flows[${flowIndex}].messages[${index}].delta`,
        `step '${message.id}' of flow '${flow.id}'`,
      ),
    );
  });

  return issues;
};

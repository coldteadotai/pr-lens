import type { SchemaIssue } from "./errors.js";
import type { GraphDoc, View } from "./graph.js";
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

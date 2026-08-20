import {
  applyPatch,
  type Config,
  type GraphDoc,
  type GraphNode,
  type Parsed,
  type PatchOp,
  type Selector,
} from "@coldtea/pr-lens-schema";
import picomatch from "picomatch";

const ID_PREFIX = "id:";

/**
 * A selector addresses one node by id, or every node backed by a matching
 * file. The path form is the useful one: it keeps holding when the model
 * renames a node between runs, which it will.
 */
const selects = (selector: Selector): ((node: GraphNode) => boolean) => {
  if (selector.startsWith(ID_PREFIX)) {
    const id = selector.slice(ID_PREFIX.length);
    return (node) => node.id === id;
  }

  const matches = picomatch(selector, { dot: true });
  return (node) => node.files.some((file) => matches(file.path));
};

export type Corrections = {
  result: Parsed<GraphDoc>;
  /** Corrections that changed nothing, so a stale config is visible rather than silent. */
  warnings: string[];
};

/**
 * Applies a repository's map corrections over a freshly inferred document.
 *
 * They are an overlay, applied on every run: inference never writes back into
 * the config, so a correction keeps holding as the code moves. Excluding a
 * node takes its edges and flow steps with it, which is `applyPatch`'s cascade
 * rather than a second copy of that rule here.
 */
export const applyCorrections = (graph: GraphDoc, config: Config): Corrections => {
  const warnings: string[] = [];
  const { rename, exclude, lane, group } = config.map;

  const note = (what: string, selector: Selector) =>
    warnings.push(`${what} '${selector}' matched no node`);

  const excluded = new Set<string>();
  for (const selector of exclude) {
    const matched = graph.nodes.filter(selects(selector));
    if (matched.length === 0) note("exclude", selector);
    for (const node of matched) excluded.add(node.id);
  }

  const remaining = graph.nodes.filter((node) => !excluded.has(node.id));
  const laneIds = new Set(graph.lanes.map((declared) => declared.id));

  const ops: PatchOp[] = [...excluded].map((id) => ({ op: "remove_node", id }));

  const update = (selector: Selector, what: string, patch: Partial<GraphNode>): void => {
    const matched = remaining.filter(selects(selector));
    if (matched.length === 0) {
      note(what, selector);
      return;
    }
    for (const node of matched) ops.push({ op: "update_node", id: node.id, patch });
  };

  for (const correction of rename) update(correction.match, "rename", { label: correction.to });

  for (const correction of lane) {
    if (!laneIds.has(correction.lane)) {
      warnings.push(
        `lane '${correction.match}' moves nodes into lane '${correction.lane}', which the document does not declare — skipped`,
      );
      continue;
    }
    update(correction.match, "lane", { lane: correction.lane });
  }

  for (const correction of group) update(correction.match, "group", { group: correction.group });

  return { result: applyPatch(graph, ops), warnings };
};

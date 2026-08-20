import { applyCorrections, graphContentHash } from "@coldtea/pr-lens-renderer";
import type { Config, GraphDoc, MapCorrections } from "@coldtea/pr-lens-schema";

const NOTHING: MapCorrections = { rename: [], exclude: [], lane: [], group: [] };

/**
 * A label, lane id and group id that appear nowhere in this document.
 *
 * It is what makes the question answerable at all: a rename to the label a
 * node already carries moves nothing, and so does a lane pin into the lane a
 * node is already in. Asking with a value the document cannot already hold
 * separates "no node matches this" from "every node it matches already agrees
 * with it" — and the difference matters, because the second is a live
 * correction holding the line against the next inference.
 */
const unusedEverywhere = (graph: GraphDoc): string => {
  const taken = new Set([
    ...graph.nodes.map((node) => node.label),
    ...graph.nodes.flatMap((node) => (node.group === undefined ? [] : [node.group])),
    ...graph.nodes.map((node) => node.lane),
    ...graph.lanes.map((lane) => lane.id),
  ]);

  let candidate = "pr-lens-probe";
  for (let suffix = 1; taken.has(candidate); suffix += 1) candidate = `pr-lens-probe-${suffix}`;
  return candidate;
};

type Probe = { what: string; match: string; only: MapCorrections };

/**
 * Each correction on its own, aimed somewhere the document is not, so that
 * matching it always shows. Excluding is the one that needs no probe: a node
 * a rule matches is always removed.
 */
const probes = (map: MapCorrections, probe: string): Probe[] => [
  ...map.rename.map((rule) => ({
    what: "rename",
    match: rule.match,
    only: { ...NOTHING, rename: [{ match: rule.match, to: probe }] },
  })),
  ...map.exclude.map((selector) => ({
    what: "exclude",
    match: selector,
    only: { ...NOTHING, exclude: [selector] },
  })),
  ...map.lane.map((rule) => ({
    what: "lane",
    match: rule.match,
    only: { ...NOTHING, lane: [{ match: rule.match, lane: probe }] },
  })),
  ...map.group.map((rule) => ({
    what: "group",
    match: rule.match,
    only: { ...NOTHING, group: [{ match: rule.match, group: probe }] },
  })),
];

/**
 * Which of a repository's corrections match no node in this document.
 *
 * A selector that matches nothing is a config that has drifted since it was
 * written — the file it named was moved or deleted — and saying so is the
 * difference between a correction that stopped working and one that never
 * did. It is never a reason to delete a correction that does match: that one
 * is what keeps holding as the code moves.
 *
 * Which nodes a selector matches is the renderer's answer to give, so it is
 * asked rather than recomputed. A second opinion about what a selector means
 * is how the two drift apart.
 */
export const unmatchedCorrections = (graph: GraphDoc, config: Config): string[] => {
  const before = graphContentHash(graph);
  const probe = unusedEverywhere(graph);

  return probes(config.map, probe).flatMap(({ what, match, only }) => {
    try {
      if (graphContentHash(applyCorrections(graph, only)) !== before) return [];
    } catch {
      // A correction that emptied the document is a correction that matched.
      return [];
    }

    return [`${what} '${match}' changed nothing — no node in this document matches it`];
  });
};

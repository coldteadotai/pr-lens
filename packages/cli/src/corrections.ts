import { applyCorrections, graphContentHash } from "@coldtea/pr-lens-renderer";
import type { Config, GraphDoc, MapCorrections } from "@coldtea/pr-lens-schema";

const NOTHING: MapCorrections = { rename: [], exclude: [], lane: [], group: [] };

const eachAlone = (map: MapCorrections): { what: string; match: string; only: MapCorrections }[] => [
  ...map.rename.map((rule) => ({ what: "rename", match: rule.match, only: { ...NOTHING, rename: [rule] } })),
  ...map.exclude.map((selector) => ({ what: "exclude", match: selector, only: { ...NOTHING, exclude: [selector] } })),
  ...map.lane.map((rule) => ({ what: "lane", match: rule.match, only: { ...NOTHING, lane: [rule] } })),
  ...map.group.map((rule) => ({ what: "group", match: rule.match, only: { ...NOTHING, group: [rule] } })),
];

/**
 * Which of a repository's corrections changed nothing about this document.
 *
 * A correction that matches no node is a config that has drifted since it was
 * written — the file it named was moved or deleted — and saying so is the
 * difference between a correction that stopped working and one that never
 * did.
 *
 * The question is answered by applying each correction on its own and asking
 * whether the document moved, rather than by matching selectors here. The
 * renderer owns what a selector means, and a second opinion about that is how
 * the two drift apart.
 */
export const unmatchedCorrections = (graph: GraphDoc, config: Config): string[] =>
  eachAlone(config.map).flatMap(({ what, match, only }) => {
    const before = graphContentHash(graph);

    try {
      if (graphContentHash(applyCorrections(graph, only)) !== before) return [];
    } catch {
      // A correction that emptied the document is a correction that matched.
      return [];
    }

    return [`${what} '${match}' changed nothing — no node in this document matches it`];
  });

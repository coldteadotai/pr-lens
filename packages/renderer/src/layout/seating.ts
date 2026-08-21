import type { GraphEdge, GraphNode, Lane } from "@coldtea/pr-lens-schema";
import { rankNodes } from "./rank.js";

/** One occupied row of one lane: a single card, or two side by side. */
export type SeatedRow = { grid: number; nodes: GraphNode[] };

export type Seating = {
  rowsByLane: Map<string, SeatedRow[]>;
  rowCount: number;
  /** First row of the dead band; absent when nothing was removed. */
  deadFromRow: number | undefined;
};

/**
 * Where every card sits: a row grid shared across all lanes.
 *
 * Ranks are compressed globally rather than per lane, so a card and the card
 * it converses with across a lane boundary land on comparable rows — that is
 * what lets their connection run straight. The cost is honest: a lane that
 * enters the story late leaves its upper rows empty, and the diagram gets
 * taller. Stability is the invariant this trades nothing of: seating reads
 * connections and document order, never a label, so a rename moves nothing.
 *
 * What was removed drops out of the living graph entirely, into a band of
 * rows below everything alive, keeping its internal structure. Living ranks
 * are computed over living connections only, so a retired pathway cannot
 * push a living card down the page.
 */
export const seatNodes = (
  orderedLanes: readonly Lane[],
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  rankHints: Readonly<Record<string, number>>,
): Seating => {
  const laneIndex = new Map(orderedLanes.map((lane, index) => [lane.id, index]));
  const docIndex = new Map(nodes.map((node, index) => [node.id, index]));

  const living = nodes.filter((node) => node.delta !== "removed");
  const dead = nodes.filter((node) => node.delta === "removed");
  const livingEdges = edges.filter((edge) => edge.delta !== "removed");

  const livingRanks = rankNodes(living, livingEdges, rankHints);
  const livingRowOfRank = compressRanks(living, livingRanks);
  const keys = barycenters(living, livingEdges, livingRanks, laneIndex);

  const rowsByLane = new Map<string, SeatedRow[]>();
  let lastRow = -1;

  for (const lane of orderedLanes) {
    const members = living.filter((node) => node.lane === lane.id);
    if (members.length === 0) continue;
    const rows = seatLane(members, livingRanks, livingRowOfRank, -1, keys, docIndex);
    rowsByLane.set(lane.id, rows);
    lastRow = Math.max(lastRow, rows[rows.length - 1]?.grid ?? -1);
  }

  const deadFromRow = dead.length === 0 ? undefined : lastRow + 1;
  if (deadFromRow !== undefined) {
    const deadRanks = rankNodes(dead, edges, {});
    const deadRowOfRank = compressRanks(dead, deadRanks);
    const deadKeys = barycenters(dead, edges, deadRanks, laneIndex);

    for (const lane of orderedLanes) {
      const members = dead.filter((node) => node.lane === lane.id);
      if (members.length === 0) continue;
      const rows = seatLane(members, deadRanks, deadRowOfRank, deadFromRow - 1, deadKeys, docIndex);
      const seated = rowsByLane.get(lane.id);
      if (seated === undefined) rowsByLane.set(lane.id, rows);
      else seated.push(...rows);
      lastRow = Math.max(lastRow, rows[rows.length - 1]?.grid ?? -1);
    }
  }

  return { rowsByLane, rowCount: lastRow + 1, deadFromRow };
};

/** Rank values in use, in order, mapped onto contiguous rows. */
const compressRanks = (
  nodes: readonly GraphNode[],
  ranks: ReadonlyMap<string, number>,
): Map<number, number> => {
  const used = [...new Set(nodes.map((node) => ranks.get(node.id) ?? 0))].sort((a, b) => a - b);
  return new Map(used.map((rank, index) => [rank, index]));
};

type Barycenters = {
  /** Mean rank of a card's partners: decides who falls when a rank collides. */
  fall: Map<string, number>;
  /** Mean lane of a card's partners: decides who sits left in a shared row. */
  side: Map<string, number>;
};

const barycenters = (
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  ranks: ReadonlyMap<string, number>,
  laneIndex: ReadonlyMap<string, number>,
): Barycenters => {
  const laneOf = new Map(nodes.map((node) => [node.id, laneIndex.get(node.lane) ?? 0]));
  const partners = new Map<string, string[]>(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    if (edge.from === edge.to || !laneOf.has(edge.from) || !laneOf.has(edge.to)) continue;
    partners.get(edge.from)?.push(edge.to);
    partners.get(edge.to)?.push(edge.from);
  }

  const fall = new Map<string, number>();
  const side = new Map<string, number>();
  for (const node of nodes) {
    const linked = partners.get(node.id) ?? [];
    fall.set(node.id, mean(linked.map((id) => ranks.get(id) ?? 0)) ?? ranks.get(node.id) ?? 0);
    side.set(
      node.id,
      mean(linked.map((id) => laneOf.get(id) ?? 0)) ?? laneOf.get(node.id) ?? 0,
    );
  }
  return { fall, side };
};

const mean = (values: readonly number[]): number | undefined =>
  values.length === 0
    ? undefined
    : values.reduce((sum, value) => sum + value, 0) / values.length;

/**
 * One lane's members onto the shared grid.
 *
 * A card sits at its rank's row unless an earlier card of the same lane
 * already claimed it, in which case it falls to the next free one — a lane
 * never overlaps itself. Two cards share a row only at the same rank in the
 * same sub-group, so a pair always reads as "these happen alongside each
 * other". Who falls, and who sits left in a pair, is decided by where each
 * card's partners are — the card leaning toward its neighbours stays put —
 * with document order as the stable tiebreak.
 */
const seatLane = (
  members: readonly GraphNode[],
  ranks: ReadonlyMap<string, number>,
  rowOfRank: ReadonlyMap<number, number>,
  floor: number,
  keys: Barycenters,
  docIndex: ReadonlyMap<string, number>,
): SeatedRow[] => {
  const doc = (node: GraphNode): number => docIndex.get(node.id) ?? 0;
  const sorted = [...members].sort((a, b) => {
    const row =
      (rowOfRank.get(ranks.get(a.id) ?? 0) ?? 0) - (rowOfRank.get(ranks.get(b.id) ?? 0) ?? 0);
    if (row !== 0) return row;
    const fall = (keys.fall.get(a.id) ?? 0) - (keys.fall.get(b.id) ?? 0);
    if (fall !== 0) return fall;
    return doc(a) - doc(b);
  });

  const rows: { grid: number; rank: number; nodes: GraphNode[] }[] = [];
  let previous = floor;

  for (const node of sorted) {
    const rank = ranks.get(node.id) ?? 0;
    const open = rows[rows.length - 1];

    if (
      open !== undefined &&
      open.nodes.length === 1 &&
      open.rank === rank &&
      (open.nodes[0]?.group ?? "") === (node.group ?? "")
    ) {
      const first = open.nodes[0];
      if (first !== undefined && leansLeft(node, first, keys, doc)) open.nodes.unshift(node);
      else open.nodes.push(node);
      continue;
    }

    previous = Math.max(previous + 1, floor + 1 + (rowOfRank.get(rank) ?? 0));
    rows.push({ grid: previous, rank, nodes: [node] });
  }

  return rows.map(({ grid, nodes }) => ({ grid, nodes }));
};

const leansLeft = (
  node: GraphNode,
  other: GraphNode,
  keys: Barycenters,
  doc: (node: GraphNode) => number,
): boolean => {
  const side = (keys.side.get(node.id) ?? 0) - (keys.side.get(other.id) ?? 0);
  if (side !== 0) return side < 0;
  return doc(node) < doc(other);
};

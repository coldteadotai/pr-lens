import type { Delta, GraphEdge, GraphNode, Lane, LayoutHints } from "@coldtea/pr-lens-schema";
import { assertNever } from "@coldtea/pr-lens-schema";
import {
  BADGE_GAP,
  BADGE_HEIGHT,
  BADGE_PADDING_X,
  BADGE_RISE,
  BADGE_TEXT_SIZE,
  BADGE_TRACKING,
  CARD_GAP_X,
  CARD_HEIGHT,
  CARD_HEIGHT_WITH_SUBTITLE,
  CARD_MAX_WIDTH,
  CARD_MIN_WIDTH,
  CARD_PADDING_X,
  CONTENT_TOP,
  DIAGRAM_MARGIN,
  ICON_CHIP_GAP,
  ICON_CHIP_SIZE,
  ICON_MIN_CARD_WIDTH,
  LANE_BOTTOM_PADDING,
  LANE_GAP,
  LANE_LABEL_SIZE,
  LANE_LABEL_TRACKING,
  LANE_PADDING_X,
  LANE_TOP,
  LANE_WIDTH_STEP,
  ROW_GAP,
  SUBTITLE_SIZE,
  TITLE_SIZE,
  TITLE_SIZE_SMALL,
} from "../design.js";
import type { Box } from "../geometry.js";
import type { ScopedGraph } from "../scope.js";
import { measure, type Face } from "../text.js";
import { rankNodes } from "./rank.js";

/**
 * Ordering by code unit, not by `localeCompare`: the renderer must produce the
 * same bytes on every machine, and collation depends on the host's locale data.
 */
const compareCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const deltaBadgeText = (delta: Delta): string | undefined => {
  switch (delta) {
    case "added":
      return "NEW";
    case "modified":
      return "CHANGED";
    case "removed":
      return "REMOVED";
    case "unchanged":
      return undefined;
    default:
      return assertNever(delta, "Unhandled delta");
  }
};

/** Width of tracked text: letter-spacing adds a fixed step after every glyph. */
const trackedWidth = (
  text: string,
  face: Face,
  fontSize: number,
  tracking: number,
): number => measure(text, face, fontSize) + [...text].length * tracking * fontSize;

export const badgeWidth = (text: string): number =>
  trackedWidth(text, "sans-bold", BADGE_TEXT_SIZE, BADGE_TRACKING) + BADGE_PADDING_X * 2;

/** Every badge a card carries, its own first and the delta badge last. */
export const cardBadges = (node: GraphNode): string[] => {
  const delta = deltaBadgeText(node.delta);
  return delta === undefined ? [...node.badges] : [...node.badges, delta];
};

const badgeRowWidth = (badges: readonly string[]): number =>
  badges.reduce((total, badge) => total + badgeWidth(badge), 0) +
  Math.max(0, badges.length - 1) * BADGE_GAP;

export type PlacedNode = {
  node: GraphNode;
  box: Box;
  /** Wide enough for the kind glyph to earn its place. */
  showIcon: boolean;
  titleSize: number;
  row: number;
  laneIndex: number;
};

export type PlacedLane = { lane: Lane; box: Box };

/**
 * The badges a card actually shows and the strip they occupy above it.
 *
 * When the row is wider than the card the badges the author added give way
 * first: the delta badge is the one a reviewer is scanning for. Nothing is
 * returned when the card carries no badge, and the strip counts as occupied
 * space so an edge label does not settle on top of it.
 */
export const badgeRow = (placed: PlacedNode): { badges: string[]; box: Box } | undefined => {
  const all = cardBadges(placed.node);
  if (all.length === 0) return undefined;

  const room = placed.box.width - CARD_PADDING_X;
  const shown: string[] = [];
  let used = 0;
  for (const text of [...all].reverse()) {
    const next = used + badgeWidth(text) + (shown.length > 0 ? BADGE_GAP : 0);
    if (next > room) break;
    used = next;
    shown.unshift(text);
  }
  if (shown.length === 0) return undefined;

  const right = placed.box.x + placed.box.width - CARD_PADDING_X / 2;
  return {
    badges: shown,
    box: {
      x: right - used,
      y: placed.box.y - BADGE_RISE,
      width: used,
      height: BADGE_HEIGHT,
    },
  };
};

export type ArchitectureLayout = {
  width: number;
  height: number;
  lanes: PlacedLane[];
  nodes: PlacedNode[];
};

const cardHeight = (node: GraphNode): number =>
  node.subtitle === undefined ? CARD_HEIGHT : CARD_HEIGHT_WITH_SUBTITLE;

/** How wide a card wants to be before the lane tells it what it gets. */
const naturalWidth = (node: GraphNode): number => {
  const title = measure(node.label, "sans-bold", TITLE_SIZE);
  const subtitle = node.subtitle === undefined ? 0 : measure(node.subtitle, "mono", SUBTITLE_SIZE);
  const text = Math.max(title, subtitle);
  const withIcon = text + ICON_CHIP_SIZE + ICON_CHIP_GAP + CARD_PADDING_X * 2;
  const badges = badgeRowWidth(cardBadges(node)) + CARD_PADDING_X * 2;
  return Math.min(CARD_MAX_WIDTH, Math.max(CARD_MIN_WIDTH, withIcon, badges));
};

/**
 * Lane order: the document's explicit list first, for the lanes it names,
 * then whatever is left by declared order and finally by the order they were
 * written in. `order` may be absent, and two lanes may share one, so the
 * document's own array is the tie-break that keeps this stable.
 */
const orderLanes = (lanes: readonly Lane[], hints: LayoutHints | undefined): Lane[] => {
  const named = hints?.laneOrder ?? [];
  const byId = new Map(lanes.map((lane) => [lane.id, lane]));
  const ordered: Lane[] = [];
  const taken = new Set<string>();

  for (const id of named) {
    const lane = byId.get(id);
    if (lane === undefined || taken.has(id)) continue;
    ordered.push(lane);
    taken.add(id);
  }

  const rest = lanes
    .map((lane, index) => ({ lane, index }))
    .filter(({ lane }) => !taken.has(lane.id))
    .sort((a, b) => (a.lane.order ?? Number.MAX_SAFE_INTEGER) - (b.lane.order ?? Number.MAX_SAFE_INTEGER) || a.index - b.index)
    .map(({ lane }) => lane);

  return [...ordered, ...rest];
};

/**
 * A grid row of a lane holds one card across the lane's full width, or two
 * side by side. There is no third shape: three cards abreast stop being
 * readable at the widths a pull-request comment gets.
 */
type Row =
  | { kind: "single"; rank: number; node: GraphNode }
  | { kind: "pair"; rank: number; first: GraphNode; second: GraphNode };

const rowNodes = (row: Row): GraphNode[] => {
  switch (row.kind) {
    case "single":
      return [row.node];
    case "pair":
      return [row.first, row.second];
    default:
      return assertNever(row, "Unhandled row shape");
  }
};


/**
 * A lane's nodes as rows of at most two.
 *
 * Two cards share a row only when they belong at the same depth and in the
 * same sub-group, so a pair always reads as "these happen alongside each
 * other" rather than as two things that merely fitted. Rows sit at their
 * rank's row of the grid unless an earlier row of the same lane already
 * claimed it, in which case they fall to the next free one — a lane never
 * overlaps itself, whatever the ranks say.
 *
 * What was removed settles at the foot of its lane rather than in the middle
 * of the live path, so a reviewer reads what the code does now first and what
 * it used to do second.
 *
 * Depth is counted within the lane, not across the diagram: what matters is
 * which of a lane's own cards come before which, so a lane that only enters
 * the story late still starts at the top of its column, and a rank no card in
 * the lane occupies leaves no empty row behind. Without that, one unconnected
 * new node could drop every card in its lane by several rows at once.
 */
const rowsForLane = (
  nodes: readonly GraphNode[],
  ranks: ReadonlyMap<string, number>,
  order: ReadonlyMap<string, number>,
): { row: Row; grid: number }[] => {
  const sorted = [...nodes].sort((a, b) => {
    const ghost = Number(a.delta === "removed") - Number(b.delta === "removed");
    if (ghost !== 0) return ghost;
    const rank = (ranks.get(a.id) ?? 0) - (ranks.get(b.id) ?? 0);
    if (rank !== 0) return rank;
    const group = compareCodeUnits(a.group ?? "", b.group ?? "");
    if (group !== 0) return group;
    return (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
  });

  const used = [...new Set(sorted.map((node) => ranks.get(node.id) ?? 0))].sort((a, b) => a - b);
  const depth = new Map(used.map((rank, index) => [rank, index]));

  const rows: { row: Row; grid: number }[] = [];
  let previousGrid = -1;

  for (const node of sorted) {
    const rank = depth.get(ranks.get(node.id) ?? 0) ?? 0;
    const open = rows[rows.length - 1];

    if (
      open !== undefined &&
      open.row.kind === "single" &&
      open.row.rank === rank &&
      (open.row.node.group ?? "") === (node.group ?? "") &&
      (open.row.node.delta === "removed") === (node.delta === "removed")
    ) {
      open.row = { kind: "pair", rank, first: open.row.node, second: node };
      continue;
    }

    previousGrid = Math.max(previousGrid + 1, rank);
    rows.push({ row: { kind: "single", rank, node }, grid: previousGrid });
  }

  return rows;
};

export const layoutArchitecture = (
  graph: ScopedGraph,
  hints: LayoutHints | undefined,
): ArchitectureLayout => {
  const ranks = rankNodes(graph.nodes, graph.edges, hints?.rank ?? {});
  const order = new Map(graph.nodes.map((node, index) => [node.id, index]));

  const lanes = orderLanes(graph.lanes, hints).flatMap((lane) => {
    const members = graph.nodes.filter((node) => node.lane === lane.id);
    return members.length === 0 ? [] : [{ lane, rows: rowsForLane(members, ranks, order) }];
  });

  const laneWidths = lanes.map(({ rows }) =>
    Math.max(
      ...rows.map(({ row }) =>
        row.kind === "single"
          ? naturalWidth(row.node)
          : naturalWidth(row.first) + naturalWidth(row.second) + CARD_GAP_X,
      ),
      CARD_MIN_WIDTH,
    ),
  );

  const laneBoxWidths = lanes.map((placed, index) => {
    const wanted = Math.max(
      (laneWidths[index] ?? CARD_MIN_WIDTH) + LANE_PADDING_X * 2,
      laneHeaderWidth(placed.lane) + LANE_PADDING_X * 2,
    );
    return Math.ceil(wanted / LANE_WIDTH_STEP) * LANE_WIDTH_STEP;
  });

  const gridHeights = new Map<number, number>();
  for (const { rows } of lanes)
    for (const { row, grid } of rows) {
      const height = Math.max(...rowNodes(row).map(cardHeight));
      gridHeights.set(grid, Math.max(gridHeights.get(grid) ?? 0, height));
    }

  const gridTops = new Map<number, number>();
  let cursor = CONTENT_TOP;
  for (const grid of [...gridHeights.keys()].sort((a, b) => a - b)) {
    gridTops.set(grid, cursor);
    cursor += (gridHeights.get(grid) ?? 0) + ROW_GAP;
  }
  const contentBottom = cursor - ROW_GAP;

  const laneBottom = contentBottom + LANE_BOTTOM_PADDING;
  const placedLanes: PlacedLane[] = [];
  const placedNodes: PlacedNode[] = [];
  let laneX = DIAGRAM_MARGIN;

  lanes.forEach(({ lane, rows }, laneIndex) => {
    const boxWidth = laneBoxWidths[laneIndex] ?? CARD_MIN_WIDTH;
    const contentX = laneX + LANE_PADDING_X;
    const contentWidth = boxWidth - LANE_PADDING_X * 2;

    placedLanes.push({
      lane,
      box: { x: laneX, y: LANE_TOP, width: boxWidth, height: laneBottom - LANE_TOP },
    });

    for (const { row, grid } of rows) {
      const top = gridTops.get(grid) ?? CONTENT_TOP;
      const widths =
        row.kind === "single" ? [contentWidth] : splitPair(contentWidth, row.first, row.second);

      let x = contentX;
      rowNodes(row).forEach((node, index) => {
        const width = widths[index] ?? contentWidth;
        placedNodes.push({
          node,
          box: { x, y: top, width, height: cardHeight(node) },
          showIcon: width >= ICON_MIN_CARD_WIDTH,
          titleSize: width >= ICON_MIN_CARD_WIDTH ? TITLE_SIZE : TITLE_SIZE_SMALL,
          row: grid,
          laneIndex,
        });
        x += width + CARD_GAP_X;
      });
    }

    laneX += boxWidth + LANE_GAP;
  });

  return {
    // Whole numbers: the canvas is reported to the comment composer as pixels,
    // and half a pixel of diagram is not a thing a reviewer can be shown.
    width: Math.ceil(laneX - LANE_GAP + DIAGRAM_MARGIN),
    height: Math.ceil(laneBottom + DIAGRAM_MARGIN),
    lanes: placedLanes,
    nodes: placedNodes,
  };
};

/** Two cards divide the lane in proportion to what each of them asked for. */
const splitPair = (
  contentWidth: number,
  first: GraphNode,
  second: GraphNode,
): [number, number] => {
  const available = contentWidth - CARD_GAP_X;
  const wanted = naturalWidth(first);
  const share = Math.round((available * wanted) / (wanted + naturalWidth(second)));
  return [share, available - share];
};

const laneHeaderWidth = (lane: Lane): number =>
  trackedWidth(laneHeaderText(lane), "sans-bold", LANE_LABEL_SIZE, LANE_LABEL_TRACKING);

export const laneHeaderText = (lane: Lane): string =>
  (lane.subtitle === undefined ? lane.label : `${lane.label} · ${lane.subtitle}`).toUpperCase();

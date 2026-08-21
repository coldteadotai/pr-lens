import type { Delta, GraphNode, Lane, LayoutHints } from "@coldtea/pr-lens-schema";
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
  CARD_PADDING_X,
  CONTENT_TOP,
  DIAGRAM_MARGIN,
  ICON_MIN_CARD_WIDTH,
  LANE_BOTTOM_PADDING,
  LANE_GAP,
  LANE_LABEL_SIZE,
  LANE_LABEL_TRACKING,
  LANE_CONTENT_WIDTH,
  LANE_PADDING_X,
  LANE_TOP,
  ROW_GAP,
  TITLE_SIZE,
  TITLE_SIZE_SMALL,
} from "../design.js";
import type { Box } from "../geometry.js";
import type { ScopedGraph } from "../scope.js";
import { measure, type Face } from "../text.js";
import { seatNodes, type SeatedRow } from "./seating.js";

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

/**
 * The gaps of the grid, for the router: the vertical corridors beside each
 * lane's cards and the horizontal extents of every row. Corridor `i` runs to
 * the left of lane `i`; the extra corridor after the last lane is where
 * retired pathways are exiled to.
 */
export type LayoutGrid = {
  rows: { top: number; height: number }[];
  corridors: { left: number; right: number }[];
  /** Where lane content ends — the floor of the last band under the last row. */
  laneBottom: number;
  /** First row of the dead band; absent when nothing was removed. */
  deadFromRow: number | undefined;
};

/**
 * Extra room granted to individual gaps, keyed by corridor or band index —
 * how the layout widens where traffic would otherwise compress track pitch
 * through the floor. Expanding a corridor moves every lane after it sideways
 * by the same amount; expanding a band moves every row after it down. Cards
 * travel with their lane and row — nothing re-seats, nothing reorders.
 */
export type GapExpansions = {
  corridors: ReadonlyMap<number, number>;
  bands: ReadonlyMap<number, number>;
};

export type ArchitectureLayout = {
  width: number;
  height: number;
  lanes: PlacedLane[];
  nodes: PlacedNode[];
  grid: LayoutGrid;
};

const cardHeight = (node: GraphNode): number =>
  node.subtitle === undefined ? CARD_HEIGHT : CARD_HEIGHT_WITH_SUBTITLE;

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
 * A pair divides its row into equal halves. Splitting in proportion to what
 * each card's text asked for would mean a rename moves its neighbour — and a
 * rename moving anything is exactly what the seating guarantee rules out.
 */
const rowWidths = (contentWidth: number, row: SeatedRow): number[] => {
  if (row.nodes.length < 2) return [contentWidth];
  const half = Math.round((contentWidth - CARD_GAP_X) / 2);
  return [half, contentWidth - CARD_GAP_X - half];
};

export const layoutArchitecture = (
  graph: ScopedGraph,
  hints: LayoutHints | undefined,
  expansions?: GapExpansions,
): ArchitectureLayout => {
  const corridorExtra = (index: number): number => expansions?.corridors.get(index) ?? 0;
  const bandExtra = (index: number): number => expansions?.bands.get(index) ?? 0;

  const ordered = orderLanes(graph.lanes, hints);
  const seating = seatNodes(ordered, graph.nodes, graph.edges, hints?.rank ?? {});

  const lanes = ordered.flatMap((lane) => {
    const rows = seating.rowsByLane.get(lane.id);
    return rows === undefined ? [] : [{ lane, rows }];
  });

  const laneBoxWidth = LANE_CONTENT_WIDTH + LANE_PADDING_X * 2;

  const gridHeights = new Map<number, number>();
  for (const { rows } of lanes)
    for (const { grid, nodes } of rows) {
      const height = Math.max(...nodes.map(cardHeight));
      gridHeights.set(grid, Math.max(gridHeights.get(grid) ?? 0, height));
    }

  // Every row of the shared grid is occupied by whichever card created it, so
  // walking 0..rowCount visits exactly the keys collected above.
  const gridRows: { top: number; height: number }[] = [];
  let cursor = CONTENT_TOP;
  for (let grid = 0; grid < seating.rowCount; grid += 1) {
    if (grid > 0) cursor += bandExtra(grid);
    const height = gridHeights.get(grid) ?? 0;
    gridRows.push({ top: cursor, height });
    cursor += height + ROW_GAP;
  }
  const contentBottom = cursor - ROW_GAP;

  const laneBottom = contentBottom + LANE_BOTTOM_PADDING + bandExtra(seating.rowCount);
  const placedLanes: PlacedLane[] = [];
  const placedNodes: PlacedNode[] = [];
  let laneX = DIAGRAM_MARGIN;

  lanes.forEach(({ lane, rows }, laneIndex) => {
    laneX += corridorExtra(laneIndex);
    const contentX = laneX + LANE_PADDING_X;
    const contentWidth = LANE_CONTENT_WIDTH;

    placedLanes.push({
      lane,
      box: { x: laneX, y: LANE_TOP, width: laneBoxWidth, height: laneBottom - LANE_TOP },
    });

    for (const row of rows) {
      const top = gridRows[row.grid]?.top ?? CONTENT_TOP;
      const widths = rowWidths(contentWidth, row);

      let x = contentX;
      row.nodes.forEach((node, index) => {
        const width = widths[index] ?? contentWidth;
        placedNodes.push({
          node,
          box: { x, y: top, width, height: cardHeight(node) },
          showIcon: width >= ICON_MIN_CARD_WIDTH,
          titleSize: width >= ICON_MIN_CARD_WIDTH ? TITLE_SIZE : TITLE_SIZE_SMALL,
          row: row.grid,
          laneIndex,
        });
        x += width + CARD_GAP_X;
      });
    }

    laneX += laneBoxWidth + LANE_GAP;
  });

  const gutter = LANE_PADDING_X * 2 + LANE_GAP;
  const corridors = placedLanes.map(({ box }, index) => ({
    left: box.x + LANE_PADDING_X - gutter - corridorExtra(index),
    right: box.x + LANE_PADDING_X,
  }));
  const lastContentRight =
    (placedLanes[placedLanes.length - 1]?.box.x ?? DIAGRAM_MARGIN) +
    LANE_PADDING_X +
    LANE_CONTENT_WIDTH;
  corridors.push({
    left: lastContentRight,
    right: lastContentRight + gutter + corridorExtra(placedLanes.length),
  });

  return {
    // Whole numbers: the canvas is reported to the comment composer as pixels,
    // and half a pixel of diagram is not a thing a reviewer can be shown.
    width: Math.ceil(laneX - LANE_GAP + DIAGRAM_MARGIN),
    height: Math.ceil(laneBottom + DIAGRAM_MARGIN),
    lanes: placedLanes,
    nodes: placedNodes,
    grid: { rows: gridRows, corridors, laneBottom, deadFromRow: seating.deadFromRow },
  };
};

/**
 * The lane's own name over its band. Lanes never widen to fit their
 * headers — that would put content in charge of where the next lane
 * starts — so a header longer than the band gives up its tail instead.
 */
export const laneHeaderText = (lane: Lane): string => {
  const full = (
    lane.subtitle === undefined ? lane.label : `${lane.label} · ${lane.subtitle}`
  ).toUpperCase();

  return truncateTracked(full, LANE_LABEL_SIZE, LANE_LABEL_TRACKING, LANE_CONTENT_WIDTH);
};

const ELLIPSIS = "…";

/** `truncate`, but counting the extra step letter-spacing puts after each glyph. */
const truncateTracked = (
  text: string,
  fontSize: number,
  tracking: number,
  maxWidth: number,
): string => {
  const width = (value: string) => trackedWidth(value, "sans-bold", fontSize, tracking);
  if (width(text) <= maxWidth) return text;

  const characters = [...text];
  let kept = 0;
  while (kept < characters.length) {
    const next = characters.slice(0, kept + 1).join("") + ELLIPSIS;
    if (width(next) > maxWidth) break;
    kept += 1;
  }

  return kept === 0 ? ELLIPSIS : characters.slice(0, kept).join("").trimEnd() + ELLIPSIS;
};

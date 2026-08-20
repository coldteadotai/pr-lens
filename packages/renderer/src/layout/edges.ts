import type { GraphEdge } from "@coldtea/pr-lens-schema";
import { assertNever } from "@coldtea/pr-lens-schema";
import { EDGE_SLACK_MIN, EDGE_SLACK_RATIO, LANE_GAP } from "../design.js";
import { boxCentre, coord, type Box, type Point, type Side } from "../geometry.js";
import type { PlacedLane, PlacedNode } from "./architecture.js";

/**
 * A route, kept as its own segments rather than as a path string, because the
 * label pill has to be placed on a point of it after the fact.
 */
type Segment =
  | { kind: "line"; to: Point }
  | { kind: "cubic"; first: Point; second: Point; to: Point };

export type Curve = { from: Point; segments: Segment[] };

export type RoutedEdge = { edge: GraphEdge; path: string; curve: Curve };

const segmentStart = (curve: Curve, index: number): Point =>
  index === 0 ? curve.from : (curve.segments[index - 1]?.to ?? curve.from);

const pointOnSegment = (from: Point, segment: Segment, t: number): Point => {
  switch (segment.kind) {
    case "line":
      return { x: from.x + (segment.to.x - from.x) * t, y: from.y + (segment.to.y - from.y) * t };
    case "cubic": {
      const inverse = 1 - t;
      const weights = [inverse ** 3, 3 * inverse ** 2 * t, 3 * inverse * t ** 2, t ** 3];
      const points = [from, segment.first, segment.second, segment.to];
      return {
        x: points.reduce((sum, point, index) => sum + point.x * (weights[index] ?? 0), 0),
        y: points.reduce((sum, point, index) => sum + point.y * (weights[index] ?? 0), 0),
      };
    }
    default:
      return assertNever(segment, "Unhandled path segment");
  }
};

/** A point at `t` of the whole route, with every segment weighted equally. */
const pointAt = (curve: Curve, t: number): Point => {
  const count = curve.segments.length;
  const scaled = Math.min(Math.max(t, 0), 1) * count;
  const index = Math.min(Math.floor(scaled), count - 1);
  const segment = curve.segments[index];
  if (segment === undefined) return curve.from;
  return pointOnSegment(segmentStart(curve, index), segment, scaled - index);
};

const pathOf = (curve: Curve): string =>
  `M${coord(curve.from.x)},${coord(curve.from.y)}` +
  curve.segments
    .map((segment) => {
      switch (segment.kind) {
        case "line":
          return ` L${coord(segment.to.x)},${coord(segment.to.y)}`;
        case "cubic":
          return (
            ` C${coord(segment.first.x)},${coord(segment.first.y)}` +
            ` ${coord(segment.second.x)},${coord(segment.second.y)}` +
            ` ${coord(segment.to.x)},${coord(segment.to.y)}`
          );
        default:
          return assertNever(segment, "Unhandled path segment");
      }
    })
    .join("");

/** Which face of each card the arrow leaves from and arrives at. */
const sidesFor = (from: PlacedNode, to: PlacedNode): [Side, Side] => {
  if (from.laneIndex !== to.laneIndex)
    return from.laneIndex < to.laneIndex ? ["right", "left"] : ["left", "right"];
  if (to.row > from.row) return ["bottom", "top"];
  if (to.row < from.row) return ["top", "bottom"];
  return boxCentre(to.box).x > boxCentre(from.box).x ? ["right", "left"] : ["left", "right"];
};

const along = (side: Side, point: Point): number =>
  side === "top" || side === "bottom" ? point.x : point.y;

const pointOnSide = (box: Box, side: Side, fraction: number): Point => {
  switch (side) {
    case "top":
      return { x: box.x + box.width * fraction, y: box.y };
    case "bottom":
      return { x: box.x + box.width * fraction, y: box.y + box.height };
    case "left":
      return { x: box.x, y: box.y + box.height * fraction };
    case "right":
      return { x: box.x + box.width, y: box.y + box.height * fraction };
  }
};

const offsetAlong = (point: Point, side: Side, distance: number): Point => {
  switch (side) {
    case "top":
      return { x: point.x, y: point.y - distance };
    case "bottom":
      return { x: point.x, y: point.y + distance };
    case "left":
      return { x: point.x - distance, y: point.y };
    case "right":
      return { x: point.x + distance, y: point.y };
  }
};

type PortRequest = { key: string; nodeId: string; side: Side; toward: number; order: number };

/**
 * Where an arrow meets a card.
 *
 * Arrows sharing one face are spread evenly across it rather than stacked on
 * its midpoint, and they are spread in the order of where they are headed, so
 * a fan of edges opens out instead of crossing itself on the way.
 */
const portsFor = (
  requests: readonly PortRequest[],
  nodes: ReadonlyMap<string, PlacedNode>,
): Map<string, Point> => {
  const grouped = new Map<string, PortRequest[]>();
  for (const request of requests) {
    const face = `${request.nodeId} ${request.side}`;
    const bucket = grouped.get(face);
    if (bucket === undefined) grouped.set(face, [request]);
    else bucket.push(request);
  }

  const ports = new Map<string, Point>();
  for (const bucket of grouped.values()) {
    const head = bucket[0];
    if (head === undefined) continue;
    const placed = nodes.get(head.nodeId);
    if (placed === undefined) continue;

    const ordered = [...bucket].sort((a, b) => a.toward - b.toward || a.order - b.order);
    ordered.forEach((request, index) => {
      ports.set(request.key, pointOnSide(placed.box, head.side, (index + 1) / (ordered.length + 1)));
    });
  }

  return ports;
};

const SELF_LOOP_REACH = 30;
const SELF_LOOP_SPREAD = 11;

/**
 * A node that calls itself gets a loop off its right face. There is no second
 * card to aim at, so the loop is drawn at a fixed size rather than derived
 * from a distance that is zero.
 */
const selfLoop = (box: Box): Curve => {
  const top = { x: box.x + box.width, y: box.y + box.height / 3 };
  const bottom = { x: box.x + box.width, y: box.y + (box.height * 2) / 3 };
  return {
    from: top,
    segments: [
      {
        kind: "cubic",
        first: { x: top.x + SELF_LOOP_REACH, y: top.y - SELF_LOOP_SPREAD },
        second: { x: bottom.x + SELF_LOOP_REACH, y: bottom.y + SELF_LOOP_SPREAD },
        to: bottom,
      },
    ],
  };
};

const STRAIGHT_TOLERANCE = 0.5;

const isStraight = (from: Point, fromSide: Side, to: Point, toSide: Side): boolean => {
  const opposed =
    (fromSide === "bottom" && toSide === "top") ||
    (fromSide === "top" && toSide === "bottom") ||
    (fromSide === "right" && toSide === "left") ||
    (fromSide === "left" && toSide === "right");
  if (!opposed) return false;
  const drift = fromSide === "top" || fromSide === "bottom" ? from.x - to.x : from.y - to.y;
  return Math.abs(drift) < STRAIGHT_TOLERANCE;
};

/** How far outside its lane a long run swings, growing with the rows it skips. */
const channelReach = (rowSpan: number): number => LANE_GAP * 0.45 + rowSpan * 8;

/**
 * A route down its own lane, past the cards in between.
 *
 * Cards fill the width of their lane, so a straight drop would pass under
 * every one of them, and an arrow that disappears behind a card and reappears
 * below it reads as two arrows. This one leaves the lane, runs down the gap
 * beside it, and comes back in — visible for its whole length.
 */
const channelPastRows = (start: Point, end: Point, lane: Box, rowSpan: number): Curve => {
  const reach = channelReach(rowSpan);
  const outward = (start.x + end.x) / 2 >= lane.x + lane.width / 2;
  const x = outward ? lane.x + lane.width + reach : lane.x - reach;

  const middle = { x, y: (start.y + end.y) / 2 };
  const lead = Math.abs(end.y - start.y) * 0.3;

  return {
    from: start,
    segments: [
      {
        kind: "cubic",
        first: { x: start.x, y: start.y + lead },
        second: { x, y: middle.y - lead },
        to: middle,
      },
      {
        kind: "cubic",
        first: { x, y: middle.y + lead },
        second: { x: end.x, y: end.y - lead },
        to: end,
      },
    ],
  };
};

const grew = (box: Box, margin: number): Box => ({
  x: box.x - margin,
  y: box.y - margin,
  width: box.width + margin * 2,
  height: box.height + margin * 2,
});

const overlaps = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/** Points on the route to try for a label, working outward from the middle. */
const LABEL_SEARCH = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.2, 0.8];
const LABEL_CLEARANCE = 3;

/**
 * Where a label of a given size sits on a route without landing on anything.
 * Falls back to the middle when the route has no clear stretch: an overlapping
 * label still says what the edge carries, and a missing one does not.
 */
export const labelBoxOn = (
  curve: Curve,
  size: { width: number; height: number },
  obstacles: readonly Box[],
): Box => {
  const boxAt = (t: number): Box => {
    const point = pointAt(curve, t);
    return {
      x: point.x - size.width / 2,
      y: point.y - size.height / 2,
      width: size.width,
      height: size.height,
    };
  };

  for (const t of LABEL_SEARCH) {
    const candidate = boxAt(t);
    if (!obstacles.some((box) => overlaps(grew(candidate, LABEL_CLEARANCE), box))) return candidate;
  }
  return boxAt(0.5);
};

export const routeEdges = (
  edges: readonly GraphEdge[],
  placed: readonly PlacedNode[],
  lanes: readonly PlacedLane[],
): RoutedEdge[] => {
  const nodes = new Map(placed.map((node) => [node.node.id, node]));

  const drawable = edges.flatMap((edge, order) => {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (from === undefined || to === undefined) return [];
    return [{ edge, order, from, to, loops: edge.from === edge.to }];
  });

  const requests: PortRequest[] = [];
  for (const { edge, order, from, to, loops } of drawable) {
    if (loops) continue;
    const [fromSide, toSide] = sidesFor(from, to);
    requests.push({
      key: `${edge.id} out`,
      nodeId: edge.from,
      side: fromSide,
      toward: along(fromSide, boxCentre(to.box)),
      order,
    });
    requests.push({
      key: `${edge.id} in`,
      nodeId: edge.to,
      side: toSide,
      toward: along(toSide, boxCentre(from.box)),
      order,
    });
  }

  const ports = portsFor(requests, nodes);

  return drawable.map(({ edge, from, to, loops }) => {
    const curve = loops ? selfLoop(from.box) : routeBetween(edge, from, to, ports, lanes);
    return { edge, path: pathOf(curve), curve };
  });
};

const routeBetween = (
  edge: GraphEdge,
  from: PlacedNode,
  to: PlacedNode,
  ports: ReadonlyMap<string, Point>,
  lanes: readonly PlacedLane[],
): Curve => {
  const [fromSide, toSide] = sidesFor(from, to);
  const start = ports.get(`${edge.id} out`) ?? boxCentre(from.box);
  const end = ports.get(`${edge.id} in`) ?? boxCentre(to.box);

  const rowSpan = Math.abs(to.row - from.row);
  const lane = lanes[from.laneIndex]?.box;
  if (from.laneIndex === to.laneIndex && rowSpan > 1 && lane !== undefined)
    return channelPastRows(start, end, lane, rowSpan);

  if (isStraight(start, fromSide, end, toSide))
    return { from: start, segments: [{ kind: "line", to: end }] };

  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const slack = Math.max(EDGE_SLACK_MIN, distance * EDGE_SLACK_RATIO);

  return {
    from: start,
    segments: [
      {
        kind: "cubic",
        first: offsetAlong(start, fromSide, slack),
        second: offsetAlong(end, toSide, slack),
        to: end,
      },
    ],
  };
};

import type { GraphEdge } from "@coldtea/pr-lens-schema";
import { assertNever } from "@coldtea/pr-lens-schema";
import {
  BEND_RADIUS_MAX,
  LANE_BOTTOM_PADDING,
  PORT_INSET,
  PORT_PITCH,
  TRACK_CLEARANCE,
  TRACK_PITCH_MAX,
} from "../design.js";
import { boxCentre, coord, type Box, type Point, type Side } from "../geometry.js";
import type { ArchitectureLayout, LayoutGrid, PlacedLane, PlacedNode } from "./architecture.js";

/**
 * A route, kept as its own segments rather than as a path string, because the
 * label pill has to be placed on a point of it after the fact.
 */
type Segment =
  | { kind: "line"; to: Point }
  | { kind: "cubic"; first: Point; second: Point; to: Point };

export type Curve = { from: Point; segments: Segment[] };

export type RoutedEdge = {
  edge: GraphEdge;
  path: string;
  curve: Curve;
  /** Centre of the longest straight run — where this edge's label pill sits. */
  labelAnchor: Point | undefined;
};

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

/**
 * A box the route cannot leave. A cubic stays inside the hull of its own
 * control points, so taking every point of every segment is a bound rather
 * than an estimate — which is what the canvas needs, since a route that ran
 * off the edge would simply be clipped.
 */
export const curveBounds = (curve: Curve): Box => {
  const points: Point[] = [curve.from];
  for (const segment of curve.segments) {
    switch (segment.kind) {
      case "line":
        points.push(segment.to);
        break;
      case "cubic":
        points.push(segment.first, segment.second, segment.to);
        break;
      default:
        assertNever(segment, "Unhandled path segment");
    }
  }

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { x: left, y: top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
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

/**
 * The gaps a route travels through, in order. A corridor is the vertical
 * strip beside a lane's cards; a band is the horizontal strip between two
 * rows. Band `i` sits above row `i`; band 0 does not exist — that space is
 * the lane header — and the band after the last row is the sliver of lane
 * bottom padding, a last resort only.
 */
type Channel = { kind: "corridor"; index: number } | { kind: "band"; index: number };

type Route = {
  edge: GraphEdge;
  order: number;
  from: PlacedNode;
  to: PlacedNode;
  fromSide: Side;
  toSide: Side;
  channels: Channel[];
  /** Key of the shared-port group this route departs through, if any. */
  trunk: string | undefined;
};

const isDead = (placed: PlacedNode): boolean => placed.node.delta === "removed";

/**
 * A retired connection with a living end never threads the living graph: it
 * exits past the last lane and comes back. Only a connection wholly between
 * dead cards keeps its short run inside the dead band — that is the internal
 * structure of the retired path.
 */
const isExiled = (edge: GraphEdge, from: PlacedNode, to: PlacedNode): boolean =>
  !(isDead(from) && isDead(to)) && (edge.delta === "removed" || isDead(from) || isDead(to));

const clampBand = (index: number, grid: LayoutGrid): number =>
  Math.min(Math.max(index, 1), grid.rows.length);

/** The band a route leaves into, or arrives from, on its way up or down. */
const bandToward = (row: number, headingDown: boolean, grid: LayoutGrid): number =>
  clampBand(headingDown ? row + 1 : row, grid);

const bandApproaching = (row: number, fromAbove: boolean, grid: LayoutGrid): number =>
  clampBand(fromAbove ? row : row + 1, grid);

type Blocked = { left: boolean; right: boolean };

/** Which side faces a pair partner sits against. */
const blockedFaces = (placed: readonly PlacedNode[]): Map<string, Blocked> => {
  const blocked = new Map<string, Blocked>(
    placed.map(({ node }) => [node.id, { left: false, right: false }]),
  );
  for (const node of placed)
    for (const other of placed) {
      if (node === other || node.laneIndex !== other.laneIndex || node.row !== other.row) continue;
      const entry = blocked.get(node.node.id);
      if (entry === undefined) continue;
      if (other.box.x > node.box.x) entry.right = true;
      else entry.left = true;
    }
  return blocked;
};

/**
 * Sides and channels for one route — the whole shape of its journey, decided
 * from lane and row indices alone so that everything downstream (trunks,
 * ports, tracks) has firm ground to stand on.
 */
const planRoute = (
  from: PlacedNode,
  to: PlacedNode,
  lanes: readonly PlacedLane[],
  grid: LayoutGrid,
  blocked: ReadonlyMap<string, Blocked>,
): Pick<Route, "fromSide" | "toSide" | "channels"> => {
  const dLane = to.laneIndex - from.laneIndex;
  const dRow = to.row - from.row;

  if (dLane === 0 && dRow === 0) {
    const rightward = boxCentre(to.box).x > boxCentre(from.box).x;
    return {
      fromSide: rightward ? "right" : "left",
      toSide: rightward ? "left" : "right",
      channels: [],
    };
  }

  if (dLane === 0 && Math.abs(dRow) === 1)
    return {
      fromSide: dRow > 0 ? "bottom" : "top",
      toSide: dRow > 0 ? "top" : "bottom",
      channels: [{ kind: "band", index: Math.max(from.row, to.row) }],
    };

  if (dLane === 0) return planLaneSkip(from, to, lanes, grid, blocked);
  return planCrossLane(from, to, grid, blocked, dLane, dRow);
};

/**
 * Down (or up) the corridor beside the route's own lane, past the rows in
 * between: cards fill their lane's width, so a straight drop would vanish
 * behind every one of them. The corridor is picked on the side the endpoints
 * lean toward; a face a pair partner blocks pushes the route to the other
 * side, and a target reachable on neither side is entered from above or
 * below instead.
 */
const planLaneSkip = (
  from: PlacedNode,
  to: PlacedNode,
  lanes: readonly PlacedLane[],
  grid: LayoutGrid,
  blocked: ReadonlyMap<string, Blocked>,
): Pick<Route, "fromSide" | "toSide" | "channels"> => {
  const laneBox = lanes[from.laneIndex]?.box;
  const laneCentre = laneBox === undefined ? 0 : boxCentre(laneBox).x;
  const lean = (boxCentre(from.box).x + boxCentre(to.box).x) / 2 > laneCentre;

  const free = (placed: PlacedNode, side: "left" | "right"): boolean =>
    !(blocked.get(placed.node.id)?.[side] ?? false);

  const sides = lean ? (["right", "left"] as const) : (["left", "right"] as const);
  for (const side of sides) {
    if (!free(from, side) || !free(to, side)) continue;
    return {
      fromSide: side,
      toSide: side,
      channels: [{ kind: "corridor", index: from.laneIndex + (side === "right" ? 1 : 0) }],
    };
  }

  // No side serves both cards; leave on the free side and come in over the
  // target's top or bottom instead.
  for (const side of sides) {
    if (!free(from, side)) continue;
    const fromAbove = to.row > from.row;
    return {
      fromSide: side,
      toSide: fromAbove ? "top" : "bottom",
      channels: [
        { kind: "corridor", index: from.laneIndex + (side === "right" ? 1 : 0) },
        { kind: "band", index: bandApproaching(to.row, fromAbove, grid) },
      ],
    };
  }

  // A pair member always has its outward face free, so both sides blocked
  // cannot happen; the compiler still wants an answer.
  return {
    fromSide: "bottom",
    toSide: "top",
    channels: [{ kind: "band", index: bandToward(from.row, to.row > from.row, grid) }],
  };
};

const planCrossLane = (
  from: PlacedNode,
  to: PlacedNode,
  grid: LayoutGrid,
  blocked: ReadonlyMap<string, Blocked>,
  dLane: number,
  dRow: number,
): Pick<Route, "fromSide" | "toSide" | "channels"> => {
  const exitSide: Side = dLane > 0 ? "right" : "left";
  const entrySide: Side = dLane > 0 ? "left" : "right";
  const exitBlocked = blocked.get(from.node.id)?.[exitSide] ?? false;
  const entryBlocked = blocked.get(to.node.id)?.[entrySide] ?? false;

  const channels: Channel[] = [];
  let fromSide: Side = exitSide;
  if (exitBlocked) {
    fromSide = dRow < 0 ? "top" : "bottom";
    channels.push({ kind: "band", index: bandToward(from.row, dRow >= 0, grid) });
  }

  channels.push({ kind: "corridor", index: from.laneIndex + (dLane > 0 ? 1 : 0) });
  if (Math.abs(dLane) >= 2) {
    channels.push({ kind: "band", index: bandApproaching(to.row, dRow > 0, grid) });
    channels.push({ kind: "corridor", index: to.laneIndex + (dLane > 0 ? 0 : 1) });
  }

  let toSide: Side = entrySide;
  if (entryBlocked) {
    const fromAbove = dRow > 0 || (dRow === 0 && to.row >= 1);
    toSide = fromAbove ? "top" : "bottom";
    channels.push({ kind: "band", index: bandApproaching(to.row, fromAbove, grid) });
  }

  return { fromSide, toSide, channels };
};

/**
 * Out past the last lane, along the exile corridor, and back in — the shape
 * of every retired connection that still touches something alive. Both ends
 * attach to the right face — a route that leaves the graph and returns has
 * no business arriving at whichever face happened to be nearest — except
 * when a pair partner sits against that face: threading the partner would
 * break the one promise this plan exists to keep, so such an end goes over
 * its card's top or bottom into the band instead.
 */
const planExile = (
  from: PlacedNode,
  to: PlacedNode,
  grid: LayoutGrid,
  laneCount: number,
  blocked: ReadonlyMap<string, Blocked>,
): Pick<Route, "fromSide" | "toSide" | "channels"> => {
  const headingDown = to.row >= from.row;
  const channels: Channel[] = [];

  let fromSide: Side = "right";
  if (blocked.get(from.node.id)?.right ?? false) {
    const band = bandToward(from.row, headingDown, grid);
    fromSide = band <= from.row ? "top" : "bottom";
    channels.push({ kind: "band", index: band });
  } else if (from.laneIndex < laneCount - 1) {
    channels.push({ kind: "corridor", index: from.laneIndex + 1 });
    channels.push({ kind: "band", index: bandToward(from.row, headingDown, grid) });
  }

  channels.push({ kind: "corridor", index: laneCount });

  let toSide: Side = "right";
  if (blocked.get(to.node.id)?.right ?? false) {
    const band = bandApproaching(to.row, headingDown, grid);
    toSide = band <= to.row ? "top" : "bottom";
    channels.push({ kind: "band", index: band });
  } else if (to.laneIndex < laneCount - 1) {
    channels.push({ kind: "band", index: bandApproaching(to.row, headingDown, grid) });
    channels.push({ kind: "corridor", index: to.laneIndex + 1 });
  }

  return { fromSide, toSide, channels };
};

/**
 * Siblings that leave one card in the same direction carrying the same delta
 * share a single departure port. Sharing the port is the whole trick: give
 * each member its own and the group converges before it diverges — a bowtie
 * at the face, which is exactly the junction pinch this design retired. A
 * stem is never mixed-delta — the colour of a line is what it says changed —
 * and it only gathers siblings headed down (or up) the card's own lane: a
 * connection to another lane leaves through a side face and is travelling
 * somewhere else, not fanning out here.
 */
const trunkKey = (edge: GraphEdge, from: PlacedNode, to: PlacedNode): string | undefined => {
  if (from.laneIndex !== to.laneIndex) return undefined;
  const direction = Math.sign(to.row - from.row);
  return direction === 0 ? undefined : `${edge.from} ${edge.delta} ${direction}`;
};

/** A trunk only gathers same-lane siblings, so a member's target is always in its own lane. */
const planTrunkMember = (
  from: PlacedNode,
  to: PlacedNode,
  lanes: readonly PlacedLane[],
  grid: LayoutGrid,
  blocked: ReadonlyMap<string, Blocked>,
): Pick<Route, "fromSide" | "toSide" | "channels"> => {
  const headingDown = to.row > from.row;
  const home: Channel = { kind: "band", index: bandToward(from.row, headingDown, grid) };
  const fromSide: Side = headingDown ? "bottom" : "top";

  if (Math.abs(to.row - from.row) === 1)
    return { fromSide, toSide: headingDown ? "top" : "bottom", channels: [home] };

  const tail = planLaneSkip(from, to, lanes, grid, blocked);
  return { fromSide, toSide: tail.toSide, channels: [home, ...tail.channels] };
};

const sideAxis = (side: Side): "x" | "y" => {
  switch (side) {
    case "top":
    case "bottom":
      return "x";
    case "left":
    case "right":
      return "y";
    default:
      return assertNever(side, "Unhandled side");
  }
};

const faceSpan = (box: Box, side: Side): { from: number; to: number } => {
  switch (side) {
    case "top":
    case "bottom":
      return { from: box.x, to: box.x + box.width };
    case "left":
    case "right":
      return { from: box.y, to: box.y + box.height };
    default:
      return assertNever(side, "Unhandled side");
  }
};

const portPoint = (box: Box, side: Side, along: number): Point => {
  switch (side) {
    case "top":
      return { x: along, y: box.y };
    case "bottom":
      return { x: along, y: box.y + box.height };
    case "left":
      return { x: box.x, y: along };
    case "right":
      return { x: box.x + box.width, y: along };
    default:
      return assertNever(side, "Unhandled side");
  }
};

type ChannelSpan = { centre: number; room: number };

const corridorSpan = (grid: LayoutGrid, index: number): ChannelSpan => {
  const corridor = grid.corridors[index] ?? { left: 0, right: 0 };
  return {
    centre: (corridor.left + corridor.right) / 2,
    room: corridor.right - corridor.left - TRACK_CLEARANCE * 2,
  };
};

const bandSpan = (grid: LayoutGrid, index: number): ChannelSpan => {
  const above = grid.rows[index - 1];
  const below = grid.rows[index];
  const top = above === undefined ? 0 : above.top + above.height;
  const bottom = below === undefined ? top + LANE_BOTTOM_PADDING : below.top;
  return { centre: (top + bottom) / 2, room: bottom - top - TRACK_CLEARANCE * 2 };
};

const channelSpan = (grid: LayoutGrid, channel: Channel): ChannelSpan => {
  switch (channel.kind) {
    case "corridor":
      return corridorSpan(grid, channel.index);
    case "band":
      return bandSpan(grid, channel.index);
    default:
      return assertNever(channel, "Unhandled channel");
  }
};

/**
 * Positions spread around a centre. The step divides the room by the traffic
 * rather than growing with it, so a busy gap packs tighter instead of
 * spilling; a quiet one never spreads past the cap.
 */
const spread = (centre: number, room: number, count: number, cap: number): number[] => {
  const pitch = count > 1 ? Math.min(cap, room / (count - 1)) : 0;
  return Array.from({ length: count }, (_, index) => centre + (index - (count - 1) / 2) * pitch);
};

/**
 * Waypoints for one route: the port, one turn per channel, and a final
 * perpendicular approach to the far port. Consecutive collinear points merge,
 * which is what lets a snapped neighbour pair come out as two points — a
 * dead-straight line — from the same machinery as everything else.
 */
const buildPoints = (
  route: Route,
  fromPort: Point,
  toPort: Point,
  trackOf: (index: number) => number,
): Point[] => {
  const points: Point[] = [fromPort];
  let x = fromPort.x;
  let y = fromPort.y;

  route.channels.forEach((channel, index) => {
    switch (channel.kind) {
      case "corridor":
        x = trackOf(index);
        break;
      case "band":
        y = trackOf(index);
        break;
      default:
        assertNever(channel, "Unhandled channel");
    }
    points.push({ x, y });
  });

  switch (sideAxis(route.toSide)) {
    case "y":
      points.push({ x, y: toPort.y });
      break;
    case "x":
      points.push({ x: toPort.x, y });
      break;
  }
  points.push(toPort);

  return simplify(points);
};

const simplify = (points: readonly Point[]): Point[] => {
  const kept: Point[] = [];
  for (const point of points) {
    const last = kept[kept.length - 1];
    if (last !== undefined && last.x === point.x && last.y === point.y) continue;
    const previous = kept[kept.length - 2];
    if (
      last !== undefined &&
      previous !== undefined &&
      ((previous.x === last.x && last.x === point.x) ||
        (previous.y === last.y && last.y === point.y))
    )
      kept.pop();
    kept.push(point);
  }
  return kept;
};

const KAPPA = 0.5523;

/**
 * The polyline as one continuous line: long runs stay dead straight and only
 * the turns curve, each bend sized by the shorter of its two legs. Deriving
 * the radius from the longer leg is the known failure — it balloons a route
 * with one short leg clear out of the corridor the planner put it in.
 */
const curveThrough = (points: readonly Point[]): Curve => {
  const first = points[0] ?? { x: 0, y: 0 };
  const segments: Segment[] = [];

  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const vertex = points[index];
    const next = points[index + 1];
    if (previous === undefined || vertex === undefined || next === undefined) continue;

    const inLength = Math.hypot(vertex.x - previous.x, vertex.y - previous.y);
    const outLength = Math.hypot(next.x - vertex.x, next.y - vertex.y);
    const radius = Math.min(BEND_RADIUS_MAX, Math.min(inLength, outLength) / 2);
    const inDir = { x: (vertex.x - previous.x) / inLength, y: (vertex.y - previous.y) / inLength };
    const outDir = { x: (next.x - vertex.x) / outLength, y: (next.y - vertex.y) / outLength };

    const arrive = { x: vertex.x - inDir.x * radius, y: vertex.y - inDir.y * radius };
    const leave = { x: vertex.x + outDir.x * radius, y: vertex.y + outDir.y * radius };
    const start = segments.length === 0 ? first : (segments[segments.length - 1]?.to ?? first);
    if (Math.hypot(arrive.x - start.x, arrive.y - start.y) > 0.01)
      segments.push({ kind: "line", to: arrive });
    segments.push({
      kind: "cubic",
      first: { x: arrive.x + inDir.x * radius * KAPPA, y: arrive.y + inDir.y * radius * KAPPA },
      second: { x: leave.x - outDir.x * radius * KAPPA, y: leave.y - outDir.y * radius * KAPPA },
      to: leave,
    });
  }

  const last = points[points.length - 1];
  if (last !== undefined) {
    const start = segments.length === 0 ? first : (segments[segments.length - 1]?.to ?? first);
    if (segments.length === 0 || Math.hypot(last.x - start.x, last.y - start.y) > 0.01)
      segments.push({ kind: "line", to: last });
  }

  return { from: first, segments };
};

/** The midpoint of the longest straight run, or the route's middle if it only bends. */
const labelAnchorOf = (curve: Curve): Point => {
  let best: { length: number; middle: Point } | undefined;
  curve.segments.forEach((segment, index) => {
    if (segment.kind !== "line") return;
    const start = segmentStart(curve, index);
    const length = Math.hypot(segment.to.x - start.x, segment.to.y - start.y);
    if (best === undefined || length > best.length)
      best = {
        length,
        middle: { x: (start.x + segment.to.x) / 2, y: (start.y + segment.to.y) / 2 },
      };
  });
  return best?.middle ?? pointAt(curve, 0.5);
};

export const routeEdges = (
  edges: readonly GraphEdge[],
  layout: ArchitectureLayout,
): RoutedEdge[] => {
  const first = routePass(edges, layout, new Set());
  const braiding = braidingTrunks(first.branches);
  return braiding.size === 0 ? first.routed : routePass(edges, layout, braiding).routed;
};

type Pass = {
  routed: RoutedEdge[];
  /** Per trunk group, each member's waypoints minus the shared head segment. */
  branches: Map<string, Point[][]>;
};

const routePass = (
  edges: readonly GraphEdge[],
  layout: ArchitectureLayout,
  blockedTrunks: ReadonlySet<string>,
): Pass => {
  const nodes = new Map(layout.nodes.map((node) => [node.node.id, node]));
  const blocked = blockedFaces(layout.nodes);
  const laneCount = layout.lanes.length;
  const grid = layout.grid;

  const drawable = edges.flatMap((edge, order) => {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (from === undefined || to === undefined) return [];
    return [{ edge, order, from, to }];
  });

  const loops = new Set(drawable.filter(({ edge }) => edge.from === edge.to).map(({ edge }) => edge.id));

  const trunkCounts = new Map<string, number>();
  for (const { edge, from, to } of drawable) {
    if (loops.has(edge.id) || isExiled(edge, from, to) || isDead(from)) continue;
    const key = trunkKey(edge, from, to);
    if (key === undefined || blockedTrunks.has(key)) continue;
    trunkCounts.set(key, (trunkCounts.get(key) ?? 0) + 1);
  }

  const routes: Route[] = drawable
    .filter(({ edge }) => !loops.has(edge.id))
    .map(({ edge, order, from, to }) => {
      if (isExiled(edge, from, to))
        return {
          edge,
          order,
          from,
          to,
          trunk: undefined,
          ...planExile(from, to, grid, laneCount, blocked),
        };

      const key = isDead(from) ? undefined : trunkKey(edge, from, to);
      const trunk = key !== undefined && (trunkCounts.get(key) ?? 0) >= 2 ? key : undefined;
      if (trunk !== undefined)
        return { edge, order, from, to, trunk, ...planTrunkMember(from, to, layout.lanes, grid, blocked) };

      return { edge, order, from, to, trunk: undefined, ...planRoute(from, to, layout.lanes, grid, blocked) };
    });

  const ports = allocatePorts(routes, grid);
  snapNeighbours(routes, ports);
  const tracks = allocateTracks(routes, ports, grid);

  const branches = new Map<string, Point[][]>();
  const routedById = new Map<string, RoutedEdge>();

  for (const route of routes) {
    const points = buildPoints(
      route,
      resolvedPort(ports, fromSlot(route), route.from.box, route.fromSide),
      resolvedPort(ports, toSlot(route), route.to.box, route.toSide),
      (index) => tracks.get(`${route.edge.id}#${index}`) ?? 0,
    );

    if (route.trunk !== undefined) {
      const list = branches.get(route.trunk) ?? [];
      list.push(points.slice(1));
      branches.set(route.trunk, list);
    }

    const curve = curveThrough(points);
    routedById.set(route.edge.id, {
      edge: route.edge,
      path: pathOf(curve),
      curve,
      labelAnchor: route.edge.label === undefined ? undefined : labelAnchorOf(curve),
    });
  }

  const routed = drawable.map(({ edge, from }) => {
    const known = routedById.get(edge.id);
    if (known !== undefined) return known;
    const curve = selfLoop(from.box);
    return {
      edge,
      path: pathOf(curve),
      curve,
      labelAnchor: edge.label === undefined ? undefined : labelAnchorOf(curve),
    };
  });

  return { routed, branches };
};

type Port = { along: number };

const resolvedPort = (
  ports: ReadonlyMap<string, Port>,
  slot: string,
  box: Box,
  side: Side,
): Point => {
  const span = faceSpan(box, side);
  return portPoint(box, side, ports.get(slot)?.along ?? (span.from + span.to) / 2);
};

const fromSlot = (route: Route): string =>
  `${route.from.node.id} ${route.fromSide} ${route.trunk ?? `${route.edge.id}>`}`;

const toSlot = (route: Route): string => `${route.to.node.id} ${route.toSide} ${route.edge.id}<`;

/**
 * Where the arrows meet the cards: every face spreads its ports on a fixed
 * pitch in a fixed order — the order of where each route is headed — and a
 * trunk group takes a single slot for all of its members.
 */
const allocatePorts = (routes: readonly Route[], grid: LayoutGrid): Map<string, Port> => {
  type Demand = { slot: string; box: Box; side: Side; toward: number; order: number };
  const byFace = new Map<string, Map<string, Demand>>();

  const register = (slot: string, placed: PlacedNode, side: Side, toward: number, order: number) => {
    const face = `${placed.node.id} ${side}`;
    const demands = byFace.get(face) ?? new Map<string, Demand>();
    const known = demands.get(slot);
    if (known === undefined) demands.set(slot, { slot, box: placed.box, side, toward, order });
    else {
      // A trunk slot is asked for once per member; it aims at their middle.
      known.toward = (known.toward + toward) / 2;
      known.order = Math.min(known.order, order);
    }
    byFace.set(face, demands);
  };

  for (const route of routes) {
    register(fromSlot(route), route.from, route.fromSide, departureToward(route, grid), route.order);
    register(toSlot(route), route.to, route.toSide, approachToward(route, grid), route.order);
  }

  const ports = new Map<string, Port>();
  for (const demands of byFace.values()) {
    const ordered = [...demands.values()].sort((a, b) => a.toward - b.toward || a.order - b.order);
    const head = ordered[0];
    if (head === undefined) continue;
    const span = faceSpan(head.box, head.side);
    const room = span.to - span.from - PORT_INSET * 2;
    const positions = spread((span.from + span.to) / 2, room, ordered.length, PORT_PITCH);
    ordered.forEach((demand, index) => {
      ports.set(demand.slot, { along: positions[index] ?? (span.from + span.to) / 2 });
    });
  }

  return ports;
};

/** The first coordinate along the face's axis this route will head for. */
const departureToward = (route: Route, grid: LayoutGrid): number => {
  const axis = sideAxis(route.fromSide);
  for (const channel of route.channels) {
    if (axis === "y" && channel.kind === "band") return channelSpan(grid, channel).centre;
    if (axis === "x" && channel.kind === "corridor") return channelSpan(grid, channel).centre;
  }
  const target = boxCentre(route.to.box);
  return axis === "x" ? target.x : target.y;
};

const approachToward = (route: Route, grid: LayoutGrid): number => {
  const axis = sideAxis(route.toSide);
  for (let index = route.channels.length - 1; index >= 0; index -= 1) {
    const channel = route.channels[index];
    if (channel === undefined) continue;
    if (axis === "y" && channel.kind === "band") return channelSpan(grid, channel).centre;
    if (axis === "x" && channel.kind === "corridor") return channelSpan(grid, channel).centre;
  }
  const source = boxCentre(route.from.box);
  return axis === "x" ? source.x : source.y;
};

const opposedSide = (side: Side): Side => {
  switch (side) {
    case "top":
      return "bottom";
    case "bottom":
      return "top";
    case "left":
      return "right";
    case "right":
      return "left";
    default:
      return assertNever(side, "Unhandled side");
  }
};

/**
 * Ports fan out on a fixed pitch, so two neighbouring cards almost never
 * produce ports that happen to line up — a straightness test on endpoints
 * would simply never fire. Aligned neighbours get pulled into line instead:
 * both ends move to the mean of their allocated positions, clamped into the
 * overlap of the two faces. Trunked members are left alone — a route sharing
 * a stem is travelling with others by definition — and a pair of faces that
 * barely overlap keeps its allocated ports.
 */
const snapNeighbours = (routes: readonly Route[], ports: Map<string, Port>): void => {
  for (const route of routes) {
    if (route.trunk !== undefined) continue;
    if (opposedSide(route.fromSide) !== route.toSide) continue;
    if (route.channels.length > 1) continue;

    const fromSpan = faceSpan(route.from.box, route.fromSide);
    const toSpan = faceSpan(route.to.box, route.toSide);
    const low = Math.max(fromSpan.from, toSpan.from) + PORT_INSET;
    const high = Math.min(fromSpan.to, toSpan.to) - PORT_INSET;
    if (low > high) continue;

    const fromPort = ports.get(fromSlot(route));
    const toPort = ports.get(toSlot(route));
    if (fromPort === undefined || toPort === undefined) continue;
    const snapped = Math.min(Math.max((fromPort.along + toPort.along) / 2, low), high);
    ports.set(fromSlot(route), { along: snapped });
    ports.set(toSlot(route), { along: snapped });
  }
};

/**
 * Every run through a gap gets its own track. Traffic in one gap is spread
 * around its centre, ordered by heading first — outbound before returning —
 * which is what keeps a bidirectional pair, and the labels riding each half,
 * apart.
 */
const allocateTracks = (
  routes: readonly Route[],
  ports: ReadonlyMap<string, Port>,
  grid: LayoutGrid,
): Map<string, number> => {
  type Demand = { key: string; heading: number; at: number; nest: number; order: number };
  const byChannel = new Map<string, { span: ChannelSpan; demands: Demand[] }>();

  for (const route of routes) {
    const from = resolvedPort(ports, fromSlot(route), route.from.box, route.fromSide);
    const to = resolvedPort(ports, toSlot(route), route.to.box, route.toSide);
    const approx = buildApprox(route, from, to, grid);

    route.channels.forEach((channel, index) => {
      const run = approx[index];
      if (run === undefined) return;
      const key = `${channel.kind} ${channel.index}`;
      const entry = byChannel.get(key) ?? { span: channelSpan(grid, channel), demands: [] };
      entry.demands.push({
        key: `${route.edge.id}#${index}`,
        heading: run.heading,
        at: run.at,
        nest: run.nest,
        order: route.order,
      });
      byChannel.set(key, entry);
    });
  }

  const tracks = new Map<string, number>();
  for (const { span, demands } of byChannel.values()) {
    const ordered = [...demands].sort(
      (a, b) => b.heading - a.heading || a.at - b.at || a.nest - b.nest || a.order - b.order,
    );
    const positions = spread(span.centre, span.room, ordered.length, TRACK_PITCH_MAX);
    ordered.forEach((demand, index) => {
      tracks.set(demand.key, positions[index] ?? span.centre);
    });
  }

  return tracks;
};

/**
 * The direction, starting coordinate and nesting key of each channel run,
 * taken from a dry run over channel centres. Only the ordering reads these,
 * so the centre is close enough — the real track offsets shift a run by less
 * than a pitch.
 *
 * The nesting key makes runs that start together — a stem's branches leaving
 * one shared port — come out nested instead of braided: the run travelling
 * farther takes the track on the far side from where its exit turns off, so
 * a short branch's turn is never crossed by a long sibling passing over it.
 */
const buildApprox = (
  route: Route,
  from: Point,
  to: Point,
  grid: LayoutGrid,
): { heading: number; at: number; nest: number }[] => {
  const coordinates: Point[] = [from];
  let x = from.x;
  let y = from.y;
  for (const channel of route.channels) {
    switch (channel.kind) {
      case "corridor":
        x = channelSpan(grid, channel).centre;
        break;
      case "band":
        y = channelSpan(grid, channel).centre;
        break;
      default:
        assertNever(channel, "Unhandled channel");
    }
    coordinates.push({ x, y });
  }
  switch (sideAxis(route.toSide)) {
    case "y":
      coordinates.push({ x, y: to.y });
      break;
    case "x":
      coordinates.push({ x: to.x, y });
      break;
  }
  coordinates.push(to);

  return route.channels.map((channel, index) => {
    const here = coordinates[index + 1] ?? from;
    const next = coordinates[index + 2] ?? to;
    const after = coordinates[index + 3] ?? to;
    switch (channel.kind) {
      case "corridor": {
        const length = Math.abs(next.y - here.y);
        return {
          heading: Math.sign(next.y - here.y),
          at: here.y,
          nest: after.x > next.x ? -length : length,
        };
      }
      case "band": {
        const length = Math.abs(next.x - here.x);
        return {
          heading: Math.sign(next.x - here.x),
          at: here.x,
          nest: after.y > next.y ? -length : length,
        };
      }
      default:
        return assertNever(channel, "Unhandled channel");
    }
  });
};

/**
 * Which trunk groups actually braid, judged on the geometry that was drawn
 * rather than predicted from endpoints: a predicate on endpoints either
 * rejects fans whose lines never come near each other, or — once the port is
 * shared — never fires at all. Touching at a shared point is not a crossing;
 * running along one another is.
 */
const braidingTrunks = (branches: ReadonlyMap<string, Point[][]>): Set<string> => {
  const braiding = new Set<string>();
  for (const [key, members] of branches) {
    if (members.length < 2) continue;
    outer: for (let a = 0; a < members.length; a += 1)
      for (let b = a + 1; b < members.length; b += 1) {
        if (polylinesCross(members[a] ?? [], members[b] ?? [])) {
          braiding.add(key);
          break outer;
        }
      }
  }
  return braiding;
};

const polylinesCross = (a: readonly Point[], b: readonly Point[]): boolean => {
  for (let i = 0; i + 1 < a.length; i += 1)
    for (let j = 0; j + 1 < b.length; j += 1) {
      const a1 = a[i];
      const a2 = a[i + 1];
      const b1 = b[j];
      const b2 = b[j + 1];
      if (a1 === undefined || a2 === undefined || b1 === undefined || b2 === undefined) continue;
      if (segmentsCross(a1, a2, b1, b2)) return true;
    }
  return false;
};

const EPSILON = 0.01;

/** Proper crossing or collinear overlap of two axis-aligned segments. */
const segmentsCross = (a1: Point, a2: Point, b1: Point, b2: Point): boolean => {
  const aHorizontal = Math.abs(a1.y - a2.y) < EPSILON;
  const bHorizontal = Math.abs(b1.y - b2.y) < EPSILON;

  if (aHorizontal !== bHorizontal) {
    const [h1, h2, v1, v2] = aHorizontal ? [a1, a2, b1, b2] : [b1, b2, a1, a2];
    const x = v1.x;
    const y = h1.y;
    return (
      Math.min(h1.x, h2.x) + EPSILON < x &&
      x < Math.max(h1.x, h2.x) - EPSILON &&
      Math.min(v1.y, v2.y) + EPSILON < y &&
      y < Math.max(v1.y, v2.y) - EPSILON
    );
  }

  if (aHorizontal) {
    if (Math.abs(a1.y - b1.y) > EPSILON) return false;
    return (
      Math.min(Math.max(a1.x, a2.x), Math.max(b1.x, b2.x)) -
        Math.max(Math.min(a1.x, a2.x), Math.min(b1.x, b2.x)) >
      EPSILON
    );
  }
  if (Math.abs(a1.x - b1.x) > EPSILON) return false;
  return (
    Math.min(Math.max(a1.y, a2.y), Math.max(b1.y, b2.y)) -
      Math.max(Math.min(a1.y, a2.y), Math.min(b1.y, b2.y)) >
    EPSILON
  );
};

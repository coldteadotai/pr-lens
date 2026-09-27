import { assertNever } from "@coldtea/pr-lens-schema";
import {
  PILL_CARD_CLEARANCE,
  PILL_CLEARANCE,
  PILL_HEIGHT,
  PILL_PADDING_X,
  PILL_TEXT_SIZE,
} from "../design.js";
import { boundsOf, gapBetween, inflate } from "../bounds.js";
import type { Box, Point } from "../geometry.js";
import { measure } from "../text.js";
import type { Curve, RoutedEdge } from "./edges.js";

type Size = { width: number; height: number };

export const pillSize = (label: string): Size => ({
  width: measure(label, "sans-bold", PILL_TEXT_SIZE) + PILL_PADDING_X * 2,
  height: PILL_HEIGHT,
});

/** A straight run of a route, described by its slide axis. */
type Run = {
  axis: "x" | "y";
  /** The coordinate the run holds fixed — y of a horizontal run, x of a vertical one. */
  cross: number;
  lo: number;
  hi: number;
  /** Distance along the whole route to where the run starts. */
  arcStart: number;
  /** Whether the route travels this run from `lo` to `hi`. */
  forward: boolean;
};

type Leg = { a: Point; b: Point };

type Piece = { bounds: Box; legs: Leg[] };

type Traced = {
  runs: Run[];
  /** A bend's hull and chords, so a search can discard it in one test. */
  pieces: Piece[];
  /** Arc distance to the middle of the longest run, where a lone label sits. */
  preferred: number;
  end: Point;
};

const EPSILON = 0.01;
const CUBIC_STEPS = 8;

/** How far inside the pill its own line must pass, clear of the rounded end. */
const THREAD_INSET = 10;
const OFFSET_STEP = 10;
/** A pill that cannot sit on its line may sit beside it, this far off. */
const BESIDE_GAP = 3;
/** Closer than this costs, but is allowed. */
const SOFT_CARD_GAP = 12;
const SOFT_PILL_GAP = 10;
/** Spots a cramped label tries when a neighbour makes way. */
const REPAIR_OPTIONS = 6;
/** A pill this close to its own route's end is sitting on the arrowhead. */
const ARROW_REACH = 12;

// Costs are pixels of travel from the preferred spot: a pill slides 400px
// along its line rather than lie across another, 250px rather than leave it.
const COST_OFFSET = 1.5;
const COST_BESIDE = 250;
const COST_FOREIGN_LINE = 400;
const COST_OWN_ARROW = 150;
const COST_CARD_NEAR = 4;
const COST_PILL_NEAR = 3;
const COST_OVERHANG = 3;

const cubicPoint = (from: Point, first: Point, second: Point, to: Point, t: number): Point => {
  const u = 1 - t;
  return {
    x: u ** 3 * from.x + 3 * u * u * t * first.x + 3 * u * t * t * second.x + t ** 3 * to.x,
    y: u ** 3 * from.y + 3 * u * u * t * first.y + 3 * u * t * t * second.y + t ** 3 * to.y,
  };
};

const trace = (curve: Curve): Traced => {
  const runs: Run[] = [];
  const pieces: Piece[] = [];
  let arc = 0;
  let longest: { length: number; middle: number } | undefined;
  let start = curve.from;

  for (const segment of curve.segments) {
    switch (segment.kind) {
      case "line": {
        const end = segment.to;
        const horizontal = Math.abs(end.y - start.y) < EPSILON;
        const vertical = Math.abs(end.x - start.x) < EPSILON;
        const length = Math.hypot(end.x - start.x, end.y - start.y);
        if (horizontal || vertical) {
          const [from, to] = horizontal ? [start.x, end.x] : [start.y, end.y];
          runs.push({
            axis: horizontal ? "x" : "y",
            cross: horizontal ? start.y : start.x,
            lo: Math.min(from, to),
            hi: Math.max(from, to),
            arcStart: arc,
            forward: to >= from,
          });
          if (longest === undefined || length > longest.length)
            longest = { length, middle: arc + length / 2 };
        }
        pieces.push({ bounds: boundsOf([start, end]), legs: [{ a: start, b: end }] });
        arc += length;
        break;
      }
      case "cubic": {
        const legs: Leg[] = [];
        pieces.push({ bounds: boundsOf([start, segment.first, segment.second, segment.to]), legs });
        let previous = start;
        for (let step = 1; step <= CUBIC_STEPS; step += 1) {
          const t = step / CUBIC_STEPS;
          const point = cubicPoint(start, segment.first, segment.second, segment.to, t);
          legs.push({ a: previous, b: point });
          arc += Math.hypot(point.x - previous.x, point.y - previous.y);
          previous = point;
        }
        break;
      }
      default:
        assertNever(segment, "Unhandled path segment");
    }
    start = segment.to;
  }

  if (runs.length === 0) {
    const middle = runThroughMiddle(pieces, arc / 2);
    if (middle !== undefined) runs.push(middle);
  }
  return { runs, pieces, preferred: longest?.middle ?? arc / 2, end: start };
};

/** A self-loop has no straight run, so it gets a zero-length one at its middle. */
const runThroughMiddle = (pieces: readonly Piece[], halfway: number): Run | undefined => {
  let travelled = 0;
  for (const { legs } of pieces)
    for (const { a, b } of legs) {
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (travelled + length < halfway || length === 0) {
        travelled += length;
        continue;
      }
      const t = (halfway - travelled) / length;
      const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
      const along = horizontal ? point.x : point.y;
      return {
        axis: horizontal ? "x" : "y",
        cross: horizontal ? point.y : point.x,
        lo: along,
        hi: along,
        arcStart: halfway,
        forward: true,
      };
    }
  return undefined;
};

const centred = (centre: Point, size: Size): Box => ({
  x: centre.x - size.width / 2,
  y: centre.y - size.height / 2,
  width: size.width,
  height: size.height,
});

/** Strict, so exactly `clearance` of air is enough. */
const tooClose = (a: Box, b: Box, clearance: number): boolean =>
  a.x < b.x + b.width + clearance &&
  b.x < a.x + a.width + clearance &&
  a.y < b.y + b.height + clearance &&
  b.y < a.y + a.height + clearance;

const overlaps = (a: Box, b: Box): boolean => tooClose(a, b, 0);

const legCrosses = ({ a, b }: Leg, box: Box): boolean => {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const checks: [number, number][] = [
    [-dx, a.x - box.x],
    [dx, box.x + box.width - a.x],
    [-dy, a.y - box.y],
    [dy, box.y + box.height - a.y],
  ];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q <= 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 >= t1) return false;
  }
  return true;
};

type Placement = { box: Box; cost: number };

type ForeignPiece = Piece & { id: string };

/** Where a pill's centre may sit across a run, and what leaving the line costs. */
const crossOffsets = (run: Run, size: Size): { offset: number; penalty: number }[] => {
  const halfCross = (run.axis === "x" ? size.height : size.width) / 2;
  const reach = Math.max(0, halfCross - THREAD_INSET);
  const beside = halfCross + BESIDE_GAP;
  const both = (distance: number, penalty: number) => [
    { offset: -distance, penalty },
    { offset: distance, penalty },
  ];
  const offsets = [{ offset: 0, penalty: 0 }];
  for (let distance = OFFSET_STEP; distance < reach; distance += OFFSET_STEP)
    offsets.push(...both(distance, distance * COST_OFFSET));
  if (reach > 0) offsets.push(...both(reach, reach * COST_OFFSET));
  offsets.push(...both(beside, COST_BESIDE + beside * COST_OFFSET));
  return offsets;
};

type Span = [alongLo: number, alongHi: number, crossLo: number, crossHi: number];

const spanOn = (box: Box, axis: "x" | "y"): Span =>
  axis === "x"
    ? [box.x, box.x + box.width, box.y, box.y + box.height]
    : [box.y, box.y + box.height, box.x, box.x + box.width];

const runBounds = (run: Run): Box =>
  run.axis === "x"
    ? { x: run.lo, y: run.cross, width: run.hi - run.lo, height: 0 }
    : { x: run.cross, y: run.lo, width: 0, height: run.hi - run.lo };

/** A run and the cards and lines within a pill's reach of it, gathered once. */
type Surroundings = {
  run: Run;
  region: Box;
  obstacles: Box[];
  pieces: ForeignPiece[];
};

type Label = {
  id: string;
  own: Traced;
  size: Size;
  anchor: Point;
  around: Surroundings[];
};

type Scene = {
  obstacles: readonly Box[];
  /** The lanes' extent; a pill reaching past it grows the canvas. */
  frame: Box | undefined;
};

const crowding = (
  box: Box,
  label: Label,
  frame: Box | undefined,
  around: Surroundings,
  pills: readonly Box[],
): number => {
  let cost = 0;

  for (const obstacle of around.obstacles) {
    const gap = gapBetween(box, obstacle);
    if (gap < SOFT_CARD_GAP) cost += (SOFT_CARD_GAP - gap) * COST_CARD_NEAR;
  }
  for (const other of pills) {
    const gap = gapBetween(box, other);
    if (gap < SOFT_PILL_GAP) cost += (SOFT_PILL_GAP - gap) * COST_PILL_NEAR;
  }

  // A pill over another route's line reads as that route's label.
  const inner = inflate(box, -1);
  const covered = new Set<string>();
  for (const { id, bounds, legs } of around.pieces)
    if (!covered.has(id) && overlaps(bounds, box) && legs.some((leg) => legCrosses(leg, inner)))
      covered.add(id);
  cost += covered.size * COST_FOREIGN_LINE;

  if (frame !== undefined)
    cost +=
      (Math.max(0, frame.x - box.x) +
        Math.max(0, box.x + box.width - (frame.x + frame.width)) +
        Math.max(0, frame.y - box.y) +
        Math.max(0, box.y + box.height - (frame.y + frame.height))) *
      COST_OVERHANG;

  const reach = inflate(box, ARROW_REACH);
  const { end } = label.own;
  const onArrow =
    end.x > reach.x && end.x < reach.x + reach.width && end.y > reach.y && end.y < reach.y + reach.height;
  if (onArrow) cost += COST_OWN_ARROW;

  return cost;
};

type Candidate = { box: Box; bound: number; around: Surroundings; pills: Box[] };

/**
 * The `limit` cheapest distinct placements the route offers, cheapest first;
 * empty when it has no room at all.
 */
const rankOnRoute = (
  label: Label,
  scene: Scene,
  settled: ReadonlyMap<string, Box>,
  limit: number,
): Placement[] => {
  const { own, size } = label;
  const settledPills = [...settled].filter(([id]) => id !== label.id).map(([, box]) => box);

  const candidates: Candidate[] = [];
  for (const around of label.around) {
    const { run } = around;
    const pills = settledPills.filter((box) => overlaps(box, around.region));
    const lines = around.pieces.map(({ bounds }) => spanOn(bounds, run.axis));

    const arcAt = (position: number): number =>
      run.arcStart + (run.forward ? position - run.lo : run.hi - position);
    const intoRun = own.preferred - run.arcStart;
    const preferredAlong = Math.min(
      Math.max(run.forward ? run.lo + intoRun : run.hi - intoRun, run.lo),
      run.hi,
    );
    const halfAlong = (run.axis === "x" ? size.width : size.height) / 2;
    const halfCross = (run.axis === "x" ? size.height : size.width) / 2;
    const blocker = (clearance: number, soft: number) => (box: Box) => ({
      span: spanOn(box, run.axis),
      clearance,
      soft,
    });
    const blockers = [
      ...around.obstacles.map(blocker(PILL_CARD_CLEARANCE, SOFT_CARD_GAP)),
      ...pills.map(blocker(PILL_CLEARANCE, SOFT_PILL_GAP)),
    ];
    const breaks: number[] = [];
    const breakAt = (position: number) => {
      if (position >= run.lo - EPSILON && position <= run.hi + EPSILON) breaks.push(position);
    };

    for (const { offset, penalty } of crossOffsets(run, size)) {
      const centreCross = run.cross + offset;
      const low = centreCross - halfCross;
      const high = centreCross + halfCross;
      const hard: { from: number; to: number }[] = [];
      breaks.length = 0;
      breakAt(preferredAlong);
      breakAt(run.lo);
      breakAt(run.hi);

      for (const { span: [alongLo, alongHi, crossLo, crossHi], clearance, soft } of blockers) {
        if (low >= crossHi + soft || high <= crossLo - soft) continue;
        breakAt(alongLo - soft - halfAlong);
        breakAt(alongHi + soft + halfAlong);
        if (low >= crossHi + clearance || high <= crossLo - clearance) continue;
        const from = alongLo - clearance - halfAlong;
        const to = alongHi + clearance + halfAlong;
        hard.push({ from, to });
        breakAt(from);
        breakAt(to);
      }
      for (const [alongLo, alongHi, crossLo, crossHi] of lines) {
        if (low > crossHi || high < crossLo) continue;
        breakAt(alongLo - halfAlong - 1);
        breakAt(alongHi + halfAlong + 1);
      }

      hard.sort((a, b) => a.from - b.from);
      let reachedTo = Number.NEGATIVE_INFINITY;
      let next = 0;
      let previous: number | undefined;
      for (const position of Float64Array.from(breaks).sort()) {
        if (position === previous) continue;
        previous = position;
        // Intervals starting before this point are folded into `reachedTo`.
        while (next < hard.length && (hard[next]?.from ?? Number.POSITIVE_INFINITY) < position) {
          reachedTo = Math.max(reachedTo, hard[next]?.to ?? reachedTo);
          next += 1;
        }
        if (position < reachedTo) continue;
        const centre =
          run.axis === "x" ? { x: position, y: centreCross } : { x: centreCross, y: position };
        candidates.push({
          box: centred(centre, size),
          bound: Math.abs(arcAt(position) - own.preferred) + penalty,
          around,
          pills,
        });
      }
    }
  }

  // Once a bound alone exceeds the worst kept placement, nothing later can win.
  candidates.sort((a, b) => a.bound - b.bound || a.box.y - b.box.y || a.box.x - b.box.x);
  const ranked: Placement[] = [];
  for (const { box, bound, around, pills } of candidates) {
    const worst = ranked[ranked.length - 1];
    if (ranked.length === limit && worst !== undefined && bound >= worst.cost - EPSILON) break;
    if (ranked.some((kept) => kept.box.x === box.x && kept.box.y === box.y)) continue;
    const cost = bound + crowding(box, label, scene.frame, around, pills);
    const at = ranked.findIndex((kept) => cost < kept.cost - EPSILON);
    ranked.splice(at === -1 ? ranked.length : at, 0, { box, cost });
    if (ranked.length > limit) ranked.pop();
  }
  return ranked;
};

/** Last resort, off the line: the layout widens the gap before a drawing lands here. */
const nearestClear = (
  label: Label,
  scene: Scene,
  settled: ReadonlyMap<string, Box>,
): Box => {
  const { anchor, size } = label;
  const pills = [...settled].filter(([id]) => id !== label.id).map(([, box]) => box);
  const clear = (box: Box) =>
    !scene.obstacles.some((obstacle) => tooClose(box, obstacle, PILL_CLEARANCE)) &&
    !pills.some((other) => tooClose(box, other, PILL_CLEARANCE));
  const stepY = size.height + PILL_CLEARANCE;
  const stepX = 8;
  for (let ring = 0; ; ring += 1) {
    const found: { box: Box; distance: number }[] = [];
    for (let j = -ring; j <= ring; j += 1)
      for (let i = -ring * 4; i <= ring * 4; i += 1) {
        if (Math.max(Math.abs(j), Math.ceil(Math.abs(i) / 4)) !== ring) continue;
        const box = centred({ x: anchor.x + i * stepX, y: anchor.y + j * stepY }, size);
        if (clear(box)) found.push({ box, distance: Math.hypot(i * stepX, j * stepY) });
      }
    found.sort((a, b) => a.distance - b.distance || a.box.y - b.box.y || a.box.x - b.box.x);
    const first = found[0];
    if (first !== undefined) return first.box;
  }
};

export type LabelPlacement = {
  boxes: Map<string, Box>;
  /** Pill widths of the labels with no room on or beside their line. */
  cramped: Map<string, number>;
};

/**
 * Each label takes the cheapest spot on or beside its own route that keeps
 * clear of cards, badges and other pills. A label with room at the middle of
 * its longest run stays exactly there.
 */
export const placeLabelPills = (
  routed: readonly RoutedEdge[],
  obstacles: readonly Box[],
  frame?: Box,
): LabelPlacement => {
  const traced = routed.map((route) => ({ route, traced: trace(route.curve) }));
  const pieces: ForeignPiece[] = traced.flatMap(({ route, traced: { pieces } }) =>
    pieces.map((piece) => ({ ...piece, id: route.edge.id })),
  );
  const scene: Scene = { obstacles, frame };

  const labels: Label[] = traced.flatMap(({ route, traced: own }) => {
    const { edge, labelAnchor } = route;
    if (edge.label === undefined || labelAnchor === undefined) return [];
    const size = pillSize(edge.label);
    const reach = Math.max(size.width, size.height) + SOFT_CARD_GAP + BESIDE_GAP;
    const around = own.runs.map((run) => {
      const region = inflate(runBounds(run), reach);
      return {
        run,
        region,
        obstacles: obstacles.filter((box) => overlaps(box, region)),
        pieces: pieces.filter((piece) => piece.id !== edge.id && overlaps(piece.bounds, region)),
      };
    });
    return [{ id: edge.id, own, size, anchor: labelAnchor, around }];
  });

  const boxes = new Map<string, Box>();
  const costs = new Map<string, number>();
  /** So a label can tell whether anything near it moved. */
  const moves: { id: string; boxes: Box[] }[] = [];
  const placedAt = new Map<string, number>();

  const place = (label: Label): Placement => {
    const [found] = rankOnRoute(label, scene, boxes, 1);
    return found ?? { box: nearestClear(label, scene, boxes), cost: Number.POSITIVE_INFINITY };
  };
  const keep = (id: string, placement: Placement) => {
    const before = boxes.get(id);
    moves.push({ id, boxes: before === undefined ? [placement.box] : [before, placement.box] });
    placedAt.set(id, moves.length);
    boxes.set(id, placement.box);
    costs.set(id, placement.cost);
  };
  const isCramped = (id: string) => costs.get(id) === Number.POSITIVE_INFINITY;
  const unsettled = (label: Label) =>
    moves
      .slice(placedAt.get(label.id) ?? 0)
      .some(
        ({ id, boxes: moved }) =>
          id !== label.id &&
          moved.some((box) => label.around.some(({ region }) => overlaps(box, region))),
      );

  for (const label of labels) keep(label.id, place(label));

  // A label placed early could not see the ones after it.
  for (const label of labels) {
    const current = costs.get(label.id) ?? 0;
    if (current < EPSILON || !unsettled(label)) continue;
    const placement = place(label);
    if (placement.cost < current - EPSILON) keep(label.id, placement);
  }

  // A cramped label was usually beaten to the only room by a neighbour that
  // had somewhere else to go: swap them when both still fit.
  const repair = (label: Label, other: Label, regions: readonly Box[]): boolean => {
    const mine = boxes.get(label.id);
    const theirs = boxes.get(other.id);
    if (mine === undefined || theirs === undefined) return false;
    if (!regions.some((region) => overlaps(theirs, region))) return false;

    boxes.delete(other.id);
    for (const option of rankOnRoute(label, scene, boxes, REPAIR_OPTIONS)) {
      boxes.set(label.id, option.box);
      const [moved] = rankOnRoute(other, scene, boxes, 1);
      if (moved === undefined) continue;
      keep(label.id, option);
      keep(other.id, moved);
      return true;
    }
    boxes.set(label.id, mine);
    boxes.set(other.id, theirs);
    return false;
  };
  for (const label of labels) {
    if (!isCramped(label.id)) continue;
    const reach = label.size.width + SOFT_CARD_GAP + BESIDE_GAP;
    const regions = label.around.map(({ run }) => inflate(runBounds(run), reach));
    for (const other of labels)
      if (other.id !== label.id && !isCramped(other.id) && repair(label, other, regions)) break;
  }

  return {
    boxes,
    cramped: new Map(
      labels.filter(({ id }) => isCramped(id)).map(({ id, size }) => [id, size.width]),
    ),
  };
};

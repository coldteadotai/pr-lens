import type { GraphDoc } from "@coldtea/pr-lens-schema";
import type { Box, RenderAtlas } from "../src/index.js";

/** Ways the drawn arrows can mislead a reader about what joins what. */

type Point = { x: number; y: number };

/** `at` is the fixed coordinate; `from`..`to` spans the other axis. */
type Leg = { axis: "x" | "y"; at: number; from: number; to: number };

type Traced = { legs: Leg[]; points: Point[]; end: Point };

/** Closer than this, two lines read as one. */
const SAME_LINE = 1.5;

/** Closer than this end to end, two runs read as one arrow. */
const JOIN_GAP = 12;

/** This close to a card's edge, a run looks attached. */
const HUGS = 3;

/** Closer than this, two heads read as one. */
const HEADS_APART = 4;

const CURVE_SAMPLES = 12;

const cubic = (p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point => {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
};

export const trace = (path: string): Traced => {
  const legs: Leg[] = [];
  const points: Point[] = [];
  let at: Point = { x: 0, y: 0 };
  for (const [, command = "", rest = ""] of path.matchAll(/([MLC])([^MLC]*)/g)) {
    const numbers = [...rest.matchAll(/-?\d+(?:\.\d+)?/g)].map(([value]) => Number(value));
    const pts: Point[] = [];
    for (let i = 0; i + 1 < numbers.length; i += 2) pts.push({ x: numbers[i] ?? 0, y: numbers[i + 1] ?? 0 });
    switch (command) {
      case "M":
        at = pts[0] ?? at;
        points.push(at);
        break;
      case "L":
        for (const next of pts) {
          if (Math.abs(next.x - at.x) < 0.5) legs.push({ axis: "x", at: at.x, from: Math.min(at.y, next.y), to: Math.max(at.y, next.y) });
          else if (Math.abs(next.y - at.y) < 0.5) legs.push({ axis: "y", at: at.y, from: Math.min(at.x, next.x), to: Math.max(at.x, next.x) });
          const steps = Math.max(1, Math.ceil(Math.hypot(next.x - at.x, next.y - at.y)));
          for (let s = 1; s <= steps; s++) points.push({ x: at.x + ((next.x - at.x) * s) / steps, y: at.y + ((next.y - at.y) * s) / steps });
          at = next;
        }
        break;
      case "C":
        for (let i = 0; i + 2 < pts.length; i += 3) {
          const [c1, c2, end] = [pts[i], pts[i + 1], pts[i + 2]];
          if (c1 === undefined || c2 === undefined || end === undefined) break;
          for (let s = 1; s <= CURVE_SAMPLES; s++) points.push(cubic(at, c1, c2, end, s / CURVE_SAMPLES));
          at = end;
        }
        break;
      default:
        throw new Error(`unexpected path command ${command}`);
    }
  }
  return { legs, points, end: at };
};

export type Arrow = { id: string; from: string; to: string; path: string };

export type Violation =
  | { kind: "shared-track"; a: string; b: string; at: string }
  | { kind: "crosses-card"; arrow: string; card: string }
  | { kind: "hugs-card"; arrow: string; card: string }
  | { kind: "heads-together"; a: string; b: string; card: string };

const describeLeg = (leg: Leg): string =>
  leg.axis === "x" ? `x=${leg.at} y ${leg.from}..${leg.to}` : `y=${leg.at} x ${leg.from}..${leg.to}`;

/** `merged`: the data model trunks arrivals at one table under a single head. */
export type Picture = { arrows: Arrow[]; cards: Record<string, Box>; merged: boolean };

export const arrowsOf = (doc: GraphDoc, lens: string, atlas: RenderAtlas): Picture => {
  const pick = (id: string, from: string, to: string): Arrow[] => {
    const route = atlas.routes[id];
    return route === undefined ? [] : [{ id, from, to, path: route.path }];
  };
  if (lens === "data-model")
    return {
      arrows: (doc.dataModel?.relations ?? []).flatMap((relation) => pick(relation.id, relation.from.table, relation.to.table)),
      cards: atlas.tables,
      merged: true,
    };
  return { arrows: doc.edges.flatMap((edge) => pick(edge.id, edge.from, edge.to)), cards: atlas.nodes, merged: false };
};

export const violations = ({ arrows, cards, merged }: Picture): Violation[] => {
  const traced = new Map(arrows.map((arrow) => [arrow.id, trace(arrow.path)]));
  const found: Violation[] = [];

  for (const [i, a] of arrows.entries())
    for (const b of arrows.slice(i + 1)) {
      // Siblings from one card share a trunk on purpose.
      if (a.from === b.from || (merged && a.to === b.to)) continue;
      const legsA = traced.get(a.id)?.legs ?? [];
      const legsB = traced.get(b.id)?.legs ?? [];
      const shared = legsA.flatMap((la) =>
        legsB.filter(
          (lb) =>
            la.axis === lb.axis &&
            Math.abs(la.at - lb.at) <= SAME_LINE &&
            Math.max(la.from, lb.from) - Math.min(la.to, lb.to) < JOIN_GAP,
        ).map((lb) => `${describeLeg(la)} / ${describeLeg(lb)}`),
      );
      if (shared[0] !== undefined) found.push({ kind: "shared-track", a: a.id, b: b.id, at: shared[0] });
    }

  for (const arrow of arrows) {
    const path = traced.get(arrow.id);
    if (path === undefined) continue;
    for (const [card, box] of Object.entries(cards)) {
      if (card === arrow.from || card === arrow.to) continue;
      const inside = path.points.some((p) => p.x > box.x + 1 && p.x < box.x + box.width - 1 && p.y > box.y + 1 && p.y < box.y + box.height - 1);
      if (inside) {
        found.push({ kind: "crosses-card", arrow: arrow.id, card });
        continue;
      }
      const hugs = path.legs.some((leg) => {
        const sides = leg.axis === "x" ? [box.x, box.x + box.width] : [box.y, box.y + box.height];
        const span = leg.axis === "x" ? [box.y, box.y + box.height] : [box.x, box.x + box.width];
        const along = Math.min(leg.to, span[1] ?? 0) - Math.max(leg.from, span[0] ?? 0);
        return along > 6 && sides.some((side) => Math.abs(leg.at - side) <= HUGS);
      });
      if (hugs) found.push({ kind: "hugs-card", arrow: arrow.id, card });
    }
  }

  for (const [i, a] of arrows.entries())
    for (const b of arrows.slice(i + 1)) {
      if (a.to !== b.to || merged) continue;
      const ea = traced.get(a.id)?.end;
      const eb = traced.get(b.id)?.end;
      if (ea !== undefined && eb !== undefined && Math.hypot(ea.x - eb.x, ea.y - eb.y) < HEADS_APART)
        found.push({ kind: "heads-together", a: a.id, b: b.id, card: a.to });
    }

  return found;
};

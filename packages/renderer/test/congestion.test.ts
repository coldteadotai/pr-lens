import type { GraphDoc, GraphEdge } from "@coldtea/pr-lens-schema";
import { parseGraphDoc } from "@coldtea/pr-lens-schema";
import { describe, expect, it } from "vitest";
import {
  PILL_CARD_CLEARANCE,
  TRACK_CLEARANCE,
  TRACK_PITCH_MAX,
  TRACK_PITCH_MIN,
} from "../src/design.js";
import { gapBetween } from "../src/bounds.js";
import type { Box, Point } from "../src/geometry.js";
import { occupiedBoxes } from "../src/layout/architecture.js";
import { relieveCongestion } from "../src/layout/congestion.js";
import { channelTraffic, chooseRetiredRoutes } from "../src/layout/edges.js";
import { placeLabelPills } from "../src/layout/labels.js";
import { render, THEMES } from "../src/index.js";
import { expectGolden } from "./goldens.js";
import { fixture, tiers } from "./tiers.js";

const scoped = (doc: GraphDoc) => ({
  lanes: doc.lanes,
  nodes: doc.nodes,
  edges: doc.edges,
  flows: doc.flows,
});

const issueFixtures = ["label-clearance", "short-connection", "removed-route"].map((name) => ({
  name,
  doc: fixture(`${name}.json`),
}));

const stress = tiers.filter(({ name }) => name.startsWith("tier4") || name.startsWith("tier5"));

describe("the stress fixtures render the bytes their review saw", () => {
  for (const { name, doc } of stress)
    for (const theme of THEMES)
      it(`${name}, ${theme}`, () => {
        const { svg } = render(doc, { lens: "architecture", theme });
        expectGolden(`${name}.architecture.${theme}.svg`, svg);
      });
});

describe("the stress fixtures draw the same bytes twice", () => {
  for (const { name, doc } of stress)
    it(name, () => {
      const draw = () => render(doc, { lens: "architecture", theme: "dark" }).svg;
      expect(draw()).toBe(draw());
    });
});

describe("no two label pills intersect, and every label appears exactly once", () => {
  for (const { name, doc } of tiers)
    it(name, () => {
      const { svg } = render(doc, { lens: "architecture", theme: "dark" });
      const pills = [
        ...svg.matchAll(
          /class="lpill" x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"/g,
        ),
      ].map(([, x, y, width, height]) => ({
        x: Number(x),
        y: Number(y),
        width: Number(width),
        height: Number(height),
      }));

      expect(pills.length).toBe(doc.edges.filter((edge) => edge.label !== undefined).length);

      pills.forEach((a, i) => {
        for (const b of pills.slice(i + 1)) {
          const apart =
            a.x + a.width <= b.x ||
            b.x + b.width <= a.x ||
            a.y + a.height <= b.y ||
            b.y + b.height <= a.y;
          expect(apart, `pill at ${a.x},${a.y} intersects pill at ${b.x},${b.y}`).toBe(true);
        }
      });
    });
});

/** How far a box sits from a straight leg: zero when the leg runs through it. */
const boxToLeg = (box: Box, from: Point, to: Point): number => {
  let t0 = 0;
  let t1 = 1;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const checks: [number, number][] = [
    [-dx, from.x - box.x],
    [dx, box.x + box.width - from.x],
    [-dy, from.y - box.y],
    [dy, box.y + box.height - from.y],
  ];
  let crosses = true;
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) crosses = false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
  }
  if (crosses && t0 <= t1) return 0;

  const toPoint = (point: Point) =>
    Math.hypot(
      Math.max(box.x - point.x, 0, point.x - (box.x + box.width)),
      Math.max(box.y - point.y, 0, point.y - (box.y + box.height)),
    );
  let nearest = Number.POSITIVE_INFINITY;
  for (let step = 0; step <= 64; step += 1)
    nearest = Math.min(nearest, toPoint({ x: from.x + (dx * step) / 64, y: from.y + (dy * step) / 64 }));
  return nearest;
};

/** A pill threaded by its line, or at worst sitting just beside it. */
const BESIDE_TOLERANCE = 4;

describe("every pill stays with its own line", () => {
  for (const { name, doc } of [...tiers, ...issueFixtures])
    it(name, () => {
      const { routed, pills } = relieveCongestion(scoped(doc), doc.layout);
      for (const { edge, curve } of routed) {
        const box = pills.get(edge.id);
        if (box === undefined) continue;
        let start = curve.from;
        let nearest = Number.POSITIVE_INFINITY;
        for (const segment of curve.segments) {
          nearest = Math.min(nearest, boxToLeg(box, start, segment.to));
          start = segment.to;
        }
        expect(nearest, `the ${edge.id} pill drifted from its line`).toBeLessThanOrEqual(
          BESIDE_TOLERANCE,
        );
      }
    });
});

describe("every pill keeps clear of every card and badge", () => {
  for (const { name, doc } of [...tiers, ...issueFixtures])
    it(name, () => {
      const { layout, pills } = relieveCongestion(scoped(doc), doc.layout);
      for (const [id, pill] of pills)
        for (const box of occupiedBoxes(layout.nodes))
          expect(gapBetween(pill, box), `the ${id} pill crowds a card`).toBeGreaterThanOrEqual(
            PILL_CARD_CLEARANCE,
          );
    });
});

describe("the labels from issue 30", () => {
  const pillOf = (doc: GraphDoc, id: string) => {
    const { layout, routed, pills } = relieveCongestion(scoped(doc), doc.layout);
    return { layout, routed, pill: pills.get(id) };
  };

  it("gives the label under a card room to read as the line's, not the card's", () => {
    const { layout, pill } = pillOf(fixture("label-clearance.json"), "write");
    const runner = layout.nodes.find(({ node }) => node.id === "runner")?.box;
    expect(pill).toBeDefined();
    expect(runner).toBeDefined();
    if (pill === undefined || runner === undefined) return;
    expect(pill.y - (runner.y + runner.height)).toBeGreaterThanOrEqual(12);
  });

  it("widens a corridor too narrow for the label of the straight line across it", () => {
    const doc = fixture("short-connection.json");
    const { routed, pill } = pillOf(doc, "formats-request");
    const route = routed.find(({ edge }) => edge.id === "formats-request");
    expect(pill).toBeDefined();
    expect(route).toBeDefined();
    if (pill === undefined || route === undefined) return;
    expect(route.curve.segments).toHaveLength(1);
    expect(route.curve.from.y).toBeGreaterThan(pill.y);
    expect(route.curve.from.y).toBeLessThan(pill.y + pill.height);
  });
});

describe("label settling", () => {
  it("threads a self-loop label on its loop, clear of its own card", () => {
    const doc = parseGraphDoc({
      schemaVersion: "0.1.0",
      kind: "graph",
      title: "Self-loop label",
      lenses: ["architecture"],
      provenance: {
        repo: { owner: "coldteadotai", name: "pr-lens" },
        base: { sha: "1111111" },
        head: { sha: "2222222" },
      },
      lanes: [{ id: "one", label: "One" }],
      nodes: [{ id: "a", label: "a", kind: "function", delta: "unchanged", lane: "one" }],
      edges: [{ id: "a-to-a", from: "a", to: "a", kind: "call", delta: "unchanged", label: "retry" }],
    });

    const { layout, routed, pills } = relieveCongestion(scoped(doc), doc.layout);
    const loop = routed.find(({ edge }) => edge.id === "a-to-a");
    const box = pills.get("a-to-a");
    const card = layout.nodes[0]?.box;
    expect(loop?.labelAnchor).toBeDefined();
    expect(box).toBeDefined();
    expect(card).toBeDefined();
    if (loop?.labelAnchor === undefined || box === undefined || card === undefined) return;
    expect(box.x).toBeLessThan(loop.labelAnchor.x);
    expect(box.x + box.width).toBeGreaterThan(loop.labelAnchor.x);
    expect(box.y).toBeLessThan(loop.labelAnchor.y);
    expect(box.y + box.height).toBeGreaterThan(loop.labelAnchor.y);
    expect(gapBetween(box, card)).toBeGreaterThanOrEqual(PILL_CARD_CLEARANCE);
  });

  it("keeps a colliding label on its own longest run instead of hopping to a shorter one", () => {
    const edge = (id: string): GraphEdge => ({
      id,
      from: "a",
      to: "b",
      kind: "call",
      delta: "unchanged",
      emphasis: "normal",
      animated: false,
      files: [],
      label: "aa",
    });
    // A 100px anchor run, then a 40px tail a migrating pill would find room on.
    const curveAt = (y: number) => ({
      from: { x: 0, y },
      segments: [
        { kind: "line" as const, to: { x: 100, y } },
        { kind: "line" as const, to: { x: 100, y: y + 40 } },
      ],
    });
    const routes = [
      { id: "first", y: 0 },
      { id: "second", y: 16 },
    ].map(({ id, y }) => ({
      edge: edge(id),
      path: "",
      curve: curveAt(y),
      labelAnchor: { x: 50, y },
    }));

    const pills = placeLabelPills(routes, []).boxes;
    const first = pills.get("first");
    const second = pills.get("second");
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) return;
    expect(first.x + first.width / 2).toBe(50);
    expect(first.y + first.height / 2).toBe(0);
    // Nudged along the horizontal run, not resettled on the vertical tail.
    expect(second.y + second.height / 2).toBe(16);
    expect(second.x + second.width / 2).not.toBe(50);
  });
});

describe("no track pitch below the floor", () => {
  const pitchOf = (width: number, count: number): number =>
    Math.min(TRACK_PITCH_MAX, (width - TRACK_CLEARANCE * 2) / (count - 1));

  for (const { name, doc } of tiers)
    it(name, () => {
      const { layout } = relieveCongestion(scoped(doc), doc.layout);
      const traffic = channelTraffic(doc.edges, layout, chooseRetiredRoutes(doc.edges, layout));
      const { rows, corridors, laneBottom } = layout.grid;

      for (const [index, count] of traffic.corridors) {
        if (count < 2) continue;
        const corridor = corridors[index];
        expect(corridor).toBeDefined();
        if (corridor === undefined) continue;
        expect(
          pitchOf(corridor.right - corridor.left, count),
          `corridor ${index} pitch`,
        ).toBeGreaterThanOrEqual(TRACK_PITCH_MIN);
      }

      for (const [index, count] of traffic.bands) {
        if (count < 2) continue;
        const above = rows[index - 1];
        expect(above).toBeDefined();
        if (above === undefined) continue;
        const bottom = rows[index]?.top ?? laneBottom;
        expect(
          pitchOf(bottom - (above.top + above.height), count),
          `band ${index} pitch`,
        ).toBeGreaterThanOrEqual(TRACK_PITCH_MIN);
      }
    });
});

import type { GraphDoc, GraphEdge } from "@coldtea/pr-lens-schema";
import { parseGraphDoc } from "@coldtea/pr-lens-schema";
import { describe, expect, it } from "vitest";
import { PILL_HEIGHT, TRACK_CLEARANCE, TRACK_PITCH_MAX, TRACK_PITCH_MIN } from "../src/design.js";
import type { Point } from "../src/geometry.js";
import { relieveCongestion } from "../src/layout/congestion.js";
import { channelTraffic } from "../src/layout/edges.js";
import { placeLabelPills } from "../src/layout/labels.js";
import { render, THEMES } from "../src/index.js";
import { expectGolden } from "./goldens.js";
import { tiers } from "./tiers.js";

const scoped = (doc: GraphDoc) => ({
  lanes: doc.lanes,
  nodes: doc.nodes,
  edges: doc.edges,
  flows: doc.flows,
});

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

const distanceToLeg = (point: Point, from: Point, to: Point): number => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.min(Math.max(((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared, 0), 1);
  return Math.hypot(point.x - (from.x + dx * t), point.y - (from.y + dy * t));
};

describe("every pill stays with its own line", () => {
  for (const { name, doc } of tiers)
    it(name, () => {
      const { routed } = relieveCongestion(scoped(doc), doc.layout);
      const pills = placeLabelPills(routed);
      for (const { edge, curve } of routed) {
        const box = pills.get(edge.id);
        if (box === undefined) continue;
        const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        let start = curve.from;
        let nearest = Number.POSITIVE_INFINITY;
        for (const segment of curve.segments) {
          nearest = Math.min(nearest, distanceToLeg(centre, start, segment.to));
          start = segment.to;
        }
        expect(nearest, `the ${edge.id} pill drifted from its line`).toBeLessThanOrEqual(
          PILL_HEIGHT,
        );
      }
    });
});

describe("label settling", () => {
  it("leaves a clear self-loop label exactly on its anchor", () => {
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

    const { routed } = relieveCongestion(scoped(doc), doc.layout);
    const loop = routed.find(({ edge }) => edge.id === "a-to-a");
    const box = placeLabelPills(routed).get("a-to-a");
    expect(loop?.labelAnchor).toBeDefined();
    expect(box).toBeDefined();
    if (loop?.labelAnchor === undefined || box === undefined) return;
    expect(box.x + box.width / 2).toBe(loop.labelAnchor.x);
    expect(box.y + box.height / 2).toBe(loop.labelAnchor.y);
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
    // Two identical L-shaped routes: a 100px horizontal anchor run, then a
    // 40px vertical tail a migrating pill would find room on.
    const curve = {
      from: { x: 0, y: 0 },
      segments: [
        { kind: "line" as const, to: { x: 100, y: 0 } },
        { kind: "line" as const, to: { x: 100, y: 40 } },
      ],
    };
    const routes = ["first", "second"].map((id) => ({
      edge: edge(id),
      path: "",
      curve,
      labelAnchor: { x: 50, y: 0 },
    }));

    const pills = placeLabelPills(routes);
    const first = pills.get("first");
    const second = pills.get("second");
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) return;
    expect(first.x + first.width / 2).toBe(50);
    expect(first.y + first.height / 2).toBe(0);
    // Nudged along the horizontal run, not resettled on the vertical tail.
    expect(second.y + second.height / 2).toBe(0);
    expect(second.x + second.width / 2).not.toBe(50);
  });
});

describe("no track pitch below the floor", () => {
  const pitchOf = (width: number, count: number): number =>
    Math.min(TRACK_PITCH_MAX, (width - TRACK_CLEARANCE * 2) / (count - 1));

  for (const { name, doc } of tiers)
    it(name, () => {
      const { layout } = relieveCongestion(scoped(doc), doc.layout);
      const traffic = channelTraffic(doc.edges, layout);
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

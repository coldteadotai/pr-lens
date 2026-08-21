import { postmarkRefactorGraph } from "@coldtea/pr-lens-schema/examples";
import { describe, expect, it } from "vitest";
import { render, THEMES } from "../src/index.js";
import { layoutArchitecture } from "../src/layout/architecture.js";
import { routeEdges } from "../src/layout/edges.js";
import { denseGraph } from "./dense.js";

const layoutOf = (doc: typeof denseGraph) =>
  layoutArchitecture(
    { lanes: doc.lanes, nodes: doc.nodes, edges: doc.edges, flows: doc.flows },
    doc.layout,
  );

const routesOf = (doc: typeof denseGraph) => routeEdges(doc.edges, layoutOf(doc));

const isStraight = (path: string): boolean => /^M[-\d.,]+ L[-\d.,]+$/.test(path);

describe("the right line for the job, on the reference pull request", () => {
  const routed = routesOf(postmarkRefactorGraph);
  const pathOf = (id: string) => routed.find(({ edge }) => edge.id === id)?.path ?? "";

  it("draws aligned neighbours dead straight", () => {
    for (const id of [
      "composer-to-queue",
      "firestore-to-bulk",
      "bulk-to-firestore",
      "process-to-single",
      "suppressions-to-postmark",
    ])
      expect(isStraight(pathOf(id)), `${id} should be straight`).toBe(true);
  });

  it("keeps the curves for the routes that travel", () => {
    for (const id of ["queue-to-firestore", "queue-to-lib", "bulk-to-postmark"])
      expect(isStraight(pathOf(id)), `${id} should curve`).toBe(false);
  });

  it("fans the sendBroadcastBulk stem out of one shared port", () => {
    const starts = ["bulk-to-payload", "bulk-to-suppressions", "bulk-to-lib"].map(
      (id) => pathOf(id).match(/^M([-\d.]+,[-\d.]+)/)?.[1],
    );
    expect(new Set(starts).size).toBe(1);
  });
});

describe("the dead band and its exile corridor", () => {
  const layout = layoutOf(denseGraph);
  const routed = routeEdges(denseGraph.edges, layout);
  const lastContentRight = Math.max(...layout.nodes.map(({ box }) => box.x + box.width));
  const boundsOf = (id: string) => {
    const route = routed.find(({ edge }) => edge.id === id);
    const xs: number[] = [];
    for (const match of (route?.path ?? "").matchAll(/([-\d.]+),[-\d.]+/g))
      xs.push(Number(match[1]));
    return { left: Math.min(...xs), right: Math.max(...xs) };
  };

  it("drops removed cards below everything alive", () => {
    const deadFrom = layout.grid.deadFromRow ?? Number.NaN;
    for (const placed of layout.nodes) {
      if (placed.node.delta === "removed") expect(placed.row).toBeGreaterThanOrEqual(deadFrom);
      else expect(placed.row).toBeLessThan(deadFrom);
    }
  });

  it("exiles a removed edge with a living endpoint past the last lane, in both directions", () => {
    expect(boundsOf("gateway-to-poller").right).toBeGreaterThan(lastContentRight);
    expect(boundsOf("queue-to-blobs").right).toBeGreaterThan(lastContentRight);
  });

  it("keeps the dead-to-dead edge inside the dead band", () => {
    const laneLeft = 456;
    const { left, right } = boundsOf("poller-to-queue");
    expect(left).toBeGreaterThanOrEqual(laneLeft);
    expect(right).toBeLessThanOrEqual(laneLeft + 372);
  });
});

describe("labels", () => {
  const labelled = (doc: typeof denseGraph) =>
    doc.edges.filter((edge) => edge.label !== undefined).length;

  for (const [name, doc] of [
    ["the reference pull request", postmarkRefactorGraph],
    ["the dense synthetic", denseGraph],
  ] as const) {
    it(`gives every labelled edge of ${name} exactly one pill`, () => {
      const { svg } = render(doc, { lens: "architecture", theme: "dark" });
      expect((svg.match(/class="lpill"/g) ?? []).length).toBe(labelled(doc));
    });
  }

  it("pins each dense label to its own edge exactly once", () => {
    const { svg } = render(denseGraph, { lens: "architecture", theme: "dark" });
    for (const label of ["fast path", "backpressure", "emit stats", "drain", "flush blobs"])
      expect((svg.match(new RegExp(`>${label}<`, "g")) ?? []).length).toBe(1);
  });
});

describe("the dense synthetic stays inside its canvas", () => {
  for (const theme of THEMES) {
    it(`in ${theme}`, () => {
      const { svg, width, height } = render(denseGraph, { lens: "architecture", theme });
      const shift = svg.match(/transform="translate\((-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\)"/);
      const dx = Number(shift?.[1] ?? 0);
      const dy = Number(shift?.[2] ?? 0);
      for (const path of svg.matchAll(/<path class="(?:glow|edge)[^"]*"[^>]*? d="([^"]+)"/g)) {
        const numbers = (path[1] ?? "").match(/-?\d+(?:\.\d+)?/g) ?? [];
        for (let index = 0; index + 1 < numbers.length; index += 2) {
          expect(Number(numbers[index]) + dx).toBeGreaterThanOrEqual(0);
          expect(Number(numbers[index]) + dx).toBeLessThanOrEqual(width);
          expect(Number(numbers[index + 1]) + dy).toBeGreaterThanOrEqual(0);
          expect(Number(numbers[index + 1]) + dy).toBeLessThanOrEqual(height);
        }
      }
    });
  }

  it("draws the same bytes twice", () => {
    const draw = () => render(denseGraph, { lens: "architecture", theme: "dark" }).svg;
    expect(draw()).toBe(draw());
  });
});

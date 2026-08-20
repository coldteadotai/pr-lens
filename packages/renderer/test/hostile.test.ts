import type { Flow, GraphDoc, GraphNode } from "@coldtea/pr-lens-schema";
import { parseGraphDoc } from "@coldtea/pr-lens-schema";
import { minimalGraph, postmarkRefactorGraph } from "@coldtea/pr-lens-schema/examples";
import { describe, expect, it } from "vitest";
import { render, renderAll, renderAssetFileName, renderAssetId } from "../src/index.js";
import { layoutArchitecture } from "../src/layout/architecture.js";

const node = (id: string, lane: string, label = id): GraphNode => ({
  id,
  label,
  kind: "other",
  delta: "unchanged",
  lane,
  files: [],
  badges: [],
});

const edge = (from: string, to: string) => ({
  id: `${from}-${to}`,
  from,
  to,
  kind: "call" as const,
  delta: "unchanged" as const,
  emphasis: "normal" as const,
  animated: false,
  files: [],
});

const graph = (over: Partial<GraphDoc>): GraphDoc =>
  parseGraphDoc({ ...JSON.parse(JSON.stringify(minimalGraph)), ...over });

/**
 * Every path coordinate the document writes, as numbers. Enough to check that
 * nothing was drawn outside the canvas, which would simply be clipped away.
 */
const drawnPoints = (svg: string): { x: number; y: number }[] => {
  const points: { x: number; y: number }[] = [];
  for (const path of svg.matchAll(/ d="([^"]+)"/g)) {
    const numbers = (path[1] ?? "").match(/-?\d+(?:\.\d+)?/g) ?? [];
    for (let index = 0; index + 1 < numbers.length; index += 2)
      points.push({ x: Number(numbers[index]), y: Number(numbers[index + 1]) });
  }
  return points;
};

const viewBoxOf = (svg: string): { width: number; height: number } => {
  const found = svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
  return { width: Number(found?.[1] ?? 0), height: Number(found?.[2] ?? 0) };
};

describe("a view id is not a file path", () => {
  const hostile = "a/../../elsewhere";

  it("cannot put a separator or a dot segment in an asset's name", () => {
    const address = { lens: "architecture" as const, theme: "dark" as const, view: hostile };
    const name = renderAssetFileName(address, "0123456789abcdef");
    expect(name).not.toContain("/");
    expect(name).not.toContain("..");
    expect(name.split("-")[0]).not.toBe("");
  });

  it("gives two different ids two different names", () => {
    const dark = { lens: "architecture" as const, theme: "dark" as const };
    expect(renderAssetId({ ...dark, view: "a/b" })).not.toBe(renderAssetId({ ...dark, view: "a_sb" }));
    expect(renderAssetId({ ...dark, view: "a.b" })).not.toBe(renderAssetId({ ...dark, view: "a_db" }));
  });

  it("keeps an ordinary id readable", () => {
    expect(renderAssetId({ lens: "architecture", theme: "dark", view: "new-batch-path" })).toBe(
      "new-batch-path-dark",
    );
  });

  it("holds for a document the contract accepts", () => {
    const doc = graph({
      views: [
        {
          id: hostile,
          title: "Escape",
          lens: "architecture",
          scope: { kind: "all" },
          defaultOpen: false,
          children: [],
        },
      ],
    });
    for (const { asset } of renderAll(doc).assets) {
      expect(asset.path).not.toContain("/");
      expect(asset.path).not.toContain("..");
    }
  });
});

describe("characters XML has no spelling for", () => {
  const NUL = "\u0000";
  const VERTICAL_TAB = "\u000B";
  const NON_CHARACTER = "\uFFFE";

  it("are dropped rather than written into the document", () => {
    const doc = graph({ title: `safe${NUL}title`, summary: `a${VERTICAL_TAB}b` });
    const { svg } = render(doc, { lens: "architecture", theme: "dark" });
    expect(svg).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/u);
    expect(svg).toContain("safetitle");
  });

  it("are dropped from attribute values too", () => {
    const doc = graph({ title: `aria${NON_CHARACTER}label` });
    const { svg } = render(doc, { lens: "architecture", theme: "dark" });
    expect(svg).toContain('aria-label="arialabel"');
  });

  it("leave a well-formed astral character whole", () => {
    const doc = graph({
      nodes: [{ ...node("health-route", "api", "ship it \u{1F680}"), delta: "modified" }],
    });
    const { svg } = render(doc, { lens: "architecture", theme: "dark" });
    expect(svg).toContain("\u{1F680}");
  });

  it("takes a lone surrogate out", () => {
    const doc = graph({ title: "half\uD800done" });
    const { svg } = render(doc, { lens: "architecture", theme: "dark" });
    expect(svg).toContain("halfdone");
    expect(svg).not.toMatch(/[\uD800-\uDFFF]/u);
  });
});

describe("nothing is drawn outside the canvas", () => {
  it("when a route has to swing past the lane it belongs to", () => {
    const doc = graph({
      lanes: [{ id: "one", label: "One" }],
      nodes: [node("a", "one"), node("b", "one"), node("c", "one")],
      edges: [edge("a", "b"), edge("b", "c"), edge("a", "c")],
    });
    const { svg, width, height } = render(doc, { lens: "architecture", theme: "dark" });
    const box = viewBoxOf(svg);

    expect(box).toEqual({ width, height });
    for (const point of drawnPoints(svg)) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(width);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(height);
    }
  });

  it("when a self-message loops off the last column", () => {
    const doc = parseGraphDoc({
      ...JSON.parse(JSON.stringify(postmarkRefactorGraph)),
      views: [],
      flows: [
        {
          id: "loop",
          title: "Loop",
          participants: [{ node: "queue-route" }, { node: "postmark" }],
          messages: [
            { id: "out", from: "queue-route", to: "postmark", label: "call", delta: "added" },
            {
              id: "think",
              from: "postmark",
              to: "postmark",
              label: "a rather long aside about what it does while it has the call",
              kind: "self",
              delta: "added",
            },
          ],
        },
      ],
    });
    const { svg, width, height } = render(doc, { lens: "data-flow", theme: "dark" });

    expect(viewBoxOf(svg)).toEqual({ width, height });
    for (const point of drawnPoints(svg)) {
      expect(point.x).toBeLessThanOrEqual(width);
      expect(point.y).toBeLessThanOrEqual(height);
    }
  });
});

describe("a long flow still animates in order", () => {
  const messages = Array.from({ length: 64 }, (_, index) => ({
    id: `step-${index}`,
    from: index % 2 === 0 ? "queue-route" : "postmark",
    to: index % 2 === 0 ? "postmark" : "queue-route",
    label: `step ${index}`,
    delta: "added" as const,
  }));

  const doc = parseGraphDoc({
    ...JSON.parse(JSON.stringify(postmarkRefactorGraph)),
    views: [],
    flows: [
      {
        id: "long",
        title: "Long",
        participants: [{ node: "queue-route" }, { node: "postmark" }],
        messages,
      },
    ],
  });

  const { svg } = render(doc, { lens: "data-flow", theme: "dark" });
  const starts = [...svg.matchAll(/keyPoints="0;0;1;1" keyTimes="0;([\d.]+);/g)].map((found) =>
    Number(found[1]),
  );

  it("gives every step its own moment", () => {
    expect(starts).toHaveLength(64);
    for (let index = 1; index < starts.length; index += 1)
      expect(starts[index] ?? 0).toBeGreaterThan(starts[index - 1] ?? 0);
  });

  it("keeps every key time inside the cycle, in order", () => {
    for (const found of svg.matchAll(/keyTimes="([^"]+)"/g)) {
      const times = (found[1] ?? "").split(";").map(Number);
      expect(times[0]).toBe(0);
      expect(times[times.length - 1]).toBe(1);
      for (let index = 1; index < times.length; index += 1)
        expect(times[index] ?? 0).toBeGreaterThanOrEqual(times[index - 1] ?? 0);
    }
  });
});

describe("lane widths", () => {
  const layoutOf = (doc: GraphDoc) =>
    layoutArchitecture(
      { lanes: doc.lanes, nodes: doc.nodes, edges: doc.edges, flows: doc.flows },
      doc.layout,
    );

  const retitled = (label: string): GraphDoc =>
    parseGraphDoc({
      ...JSON.parse(JSON.stringify(postmarkRefactorGraph)),
      nodes: JSON.parse(JSON.stringify(postmarkRefactorGraph.nodes)).map((entry: GraphNode) =>
        entry.id === "broadcast-composer" ? { ...entry, label } : entry,
      ),
    });

  it("absorb an ordinary rename without moving another lane", () => {
    const before = layoutOf(postmarkRefactorGraph);
    const after = layoutOf(retitled("Broadcast composer v2"));
    expect(after.lanes.map(({ box }) => box.x)).toEqual(before.lanes.map(({ box }) => box.x));
  });

  it("are never wider than the widest card a lane may hold", () => {
    const stretched = layoutOf(retitled("B".repeat(120)));
    const web = stretched.lanes.find(({ lane }) => lane.id === "web");
    expect(web?.box.width).toBeLessThanOrEqual(300 + 16 * 2 + 16);
  });
});

describe("ordering does not depend on the machine's locale", () => {
  it("sorts groups by code unit, so capitals come first", () => {
    const doc = graph({
      lanes: [{ id: "one", label: "One" }],
      nodes: [
        { ...node("lower", "one"), group: "alpha" },
        { ...node("upper", "one"), group: "Beta" },
      ],
      edges: [],
    });
    const placed = layoutArchitecture(
      { lanes: doc.lanes, nodes: doc.nodes, edges: doc.edges, flows: doc.flows as Flow[] },
      doc.layout,
    );
    expect(placed.nodes.map(({ node: placedNode }) => placedNode.id)).toEqual(["upper", "lower"]);
  });
});

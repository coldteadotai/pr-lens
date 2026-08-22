import type { Flow, GraphDoc, GraphNode, ViewInput } from "@coldtea/pr-lens-schema";
import {
  MAX_RENDER_ASSETS,
  MAX_VIEWS,
  parseGraphDoc,
  parseRenderManifest,
} from "@coldtea/pr-lens-schema";
import { minimalGraph, postmarkRefactorGraph } from "@coldtea/pr-lens-schema/examples";
import { describe, expect, it } from "vitest";
import { FLOW_PULSE_STAGGER, PULSE_DURATION } from "../src/design.js";
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
 * Every routed-edge coordinate the document writes, as numbers, with the
 * canvas shift added back. Enough to check that no route was drawn outside
 * the canvas, which would simply be clipped away. Only paths classed as
 * edges count: card glyphs use relative commands, and naive number-pairing
 * would read an `l8,-6` as an absolute point far off the canvas.
 */
const drawnPoints = (svg: string): { x: number; y: number }[] => {
  const shift = svg.match(/transform="translate\((-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\)"/);
  const dx = Number(shift?.[1] ?? 0);
  const dy = Number(shift?.[2] ?? 0);

  const points: { x: number; y: number }[] = [];
  for (const path of svg.matchAll(/<path class="(?:glow|edge|msg)[^"]*"[^>]*? d="([^"]+)"/g)) {
    const numbers = (path[1] ?? "").match(/-?\d+(?:\.\d+)?/g) ?? [];
    for (let index = 0; index + 1 < numbers.length; index += 2)
      points.push({ x: Number(numbers[index]) + dx, y: Number(numbers[index + 1]) + dy });
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

  it("stays a legal id however long the view id was", () => {
    const longest = `a${"_".repeat(127)}`;
    const doc = graph({
      views: [
        {
          id: longest,
          title: "Long",
          lens: "architecture",
          scope: { kind: "all" },
          defaultOpen: false,
          children: [],
        },
      ],
    });
    const { manifest } = renderAll(doc);

    for (const asset of manifest.assets) {
      expect(asset.id.length).toBeLessThanOrEqual(128);
      expect(asset.id).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/);
    }
    expect(() => parseRenderManifest(JSON.parse(JSON.stringify(manifest)))).not.toThrow();
  });

  it("still tells two long view ids apart", () => {
    const dark = { lens: "architecture" as const, theme: "dark" as const };
    const stem = "a" + "_".repeat(100);
    expect(renderAssetId({ ...dark, view: `${stem}one` })).not.toBe(
      renderAssetId({ ...dark, view: `${stem}two` }),
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
  const motions = [...svg.matchAll(/<animateMotion dur="([\d.]+)s"(?: begin="(-?[\d.]+)s")?/g)].map(
    (found) => ({ duration: Number(found[1]), begin: Number(found[2] ?? 0) }),
  );

  /** How far into its own turn a step's pulse already is when the drawing loads. */
  const phase = (index: number): number => {
    const motion = motions[index];
    if (motion === undefined) throw new Error(`no pulse for step ${index}`);
    return (motion.duration + motion.begin) % motion.duration;
  };

  it("gives every step a pulse of its own", () => {
    expect(motions).toHaveLength(64);
  });

  it("rides each step one stagger behind the step above it", () => {
    for (let index = 1; index < motions.length; index += 1)
      expect((phase(index) - phase(index - 1) + PULSE_DURATION) % PULSE_DURATION).toBeCloseTo(
        FLOW_PULSE_STAGGER,
        1,
      );
  });

  it("starts every pulse already under way", () => {
    // An animation has no effect before it begins, so a dot held back by a
    // positive delay would sit at the canvas origin, in the corner, until its
    // turn came. Sixty-four of them would be a blot on every load.
    for (const motion of motions) {
      expect(motion.begin).toBeLessThanOrEqual(0);
      expect(motion.begin).toBeGreaterThan(-motion.duration);
    }
  });
});

describe("columns", () => {
  const layoutOf = (doc: GraphDoc) =>
    layoutArchitecture(
      { lanes: doc.lanes, nodes: doc.nodes, edges: doc.edges, flows: doc.flows },
      doc.layout,
    );

  const withNode = (extra: Record<string, unknown>): GraphDoc =>
    parseGraphDoc({
      ...JSON.parse(JSON.stringify(postmarkRefactorGraph)),
      nodes: [...JSON.parse(JSON.stringify(postmarkRefactorGraph.nodes)), extra],
    });

  const retitled = (label: string): GraphDoc =>
    parseGraphDoc({
      ...JSON.parse(JSON.stringify(postmarkRefactorGraph)),
      nodes: JSON.parse(JSON.stringify(postmarkRefactorGraph.nodes)).map((entry: GraphNode) =>
        entry.id === "broadcast-composer" ? { ...entry, label } : entry,
      ),
    });

  const columnsOf = (doc: GraphDoc) =>
    layoutOf(doc).lanes.map(({ lane, box }) => `${lane.id}@${box.x}+${box.width}`);

  const base = columnsOf(postmarkRefactorGraph);

  it("are the same width whatever a lane happens to hold", () => {
    const widths = new Set(layoutOf(postmarkRefactorGraph).lanes.map(({ box }) => box.width));
    expect(widths.size).toBe(1);
  });

  it("do not move when a card is retitled", () => {
    expect(columnsOf(retitled("B".repeat(120)))).toEqual(base);
  });

  it("do not move when a node is added to an earlier lane", () => {
    const enlarged = withNode({
      id: "postmark-webhooks",
      label: "W".repeat(120),
      kind: "external",
      delta: "added",
      lane: "web",
      files: [],
      badges: [],
    });
    expect(columnsOf(enlarged)).toEqual(base);
  });

  it("leaves every card in a later lane exactly where it was", () => {
    const enlarged = withNode({
      id: "postmark-webhooks",
      label: "W".repeat(120),
      kind: "external",
      delta: "added",
      lane: "web",
      files: [],
      badges: [],
    });
    const before = new Map(
      layoutOf(postmarkRefactorGraph).nodes.map(({ node: entry, box }) => [entry.id, box]),
    );
    const after = new Map(layoutOf(enlarged).nodes.map(({ node: entry, box }) => [entry.id, box]));

    for (const entry of postmarkRefactorGraph.nodes)
      if (entry.lane !== "web") expect(after.get(entry.id)).toEqual(before.get(entry.id));
  });

  it("gives a lane header that does not fit the band its tail back", () => {
    const doc = parseGraphDoc({
      ...JSON.parse(JSON.stringify(postmarkRefactorGraph)),
      lanes: JSON.parse(JSON.stringify(postmarkRefactorGraph.lanes)).map((lane: { id: string }) =>
        lane.id === "web" ? { ...lane, label: "N".repeat(110), subtitle: "Vercel" } : lane,
      ),
    });
    expect(columnsOf(doc)).toEqual(base);
    expect(render(doc, { lens: "architecture", theme: "dark" }).svg).toContain("…");
  });
});

describe("ordering does not depend on the machine's locale", () => {
  it("never compares group names, only their equality: document order decides", () => {
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
    expect(placed.nodes.map(({ node: placedNode }) => placedNode.id)).toEqual(["lower", "upper"]);
    expect(placed.nodes.map(({ row }) => row)).toEqual([0, 1]);
  });
});

describe("a view tree deeper than a manifest can describe", () => {
  const nested = (count: number): ViewInput[] => {
    let children: ViewInput[] = [];
    for (let index = count - 1; index >= 0; index -= 1)
      children = [
        { id: `v${index}`, title: `v${index}`, lens: "architecture", scope: { kind: "all" }, children },
      ];
    return children;
  };

  const withViews = (count: number): GraphDoc =>
    parseGraphDoc({ ...JSON.parse(JSON.stringify(minimalGraph)), views: nested(count) });

  /**
   * One view past what the contract allows. It cannot be parsed — that is the
   * point of the contract's cap — so it is built by extending a document that
   * was, which is exactly how a caller reaches this state: the cap lives in a
   * refinement, and a refinement does not survive into the inferred type.
   */
  const beyondTheCap = (): GraphDoc => {
    const parsed = withViews(MAX_VIEWS);
    return {
      ...parsed,
      views: [
        ...parsed.views,
        {
          id: "one-too-many",
          title: "One too many",
          lens: "architecture",
          scope: { kind: "all" },
          defaultOpen: false,
          children: [],
        },
      ],
    };
  };

  it("renders the largest tree the contract allows, and the manifest round-trips", () => {
    const { assets, manifest } = renderAll(withViews(MAX_VIEWS));
    expect(assets).toHaveLength(MAX_RENDER_ASSETS);
    expect(() => parseRenderManifest(JSON.parse(JSON.stringify(manifest)))).not.toThrow();
  });

  it("refuses a hand-built tree past it rather than returning a manifest the contract rejects", () => {
    expect(() => renderAll(beyondTheCap())).toThrowError(
      expect.objectContaining({ code: "TOO_MANY_ASSETS" }),
    );
  });

  it("counts the pictures asked for, not the views, so one theme still renders that tree", () => {
    const { assets } = renderAll(beyondTheCap(), { themes: ["light"] });
    expect(assets).toHaveLength(MAX_VIEWS + 1);
  });

  it("agrees with the contract about where the limit is", () => {
    const asset = {
      id: "a",
      lens: "architecture",
      theme: "light",
      mediaType: "image/svg+xml",
      contentHash: "0123456789abcdef",
      bytes: 1,
      width: 1,
      height: 1,
      path: "a.svg",
    };
    const manifest = (count: number) => ({
      schemaVersion: "0.1.0",
      kind: "render-manifest",
      graph: { contentHash: "0123456789abcdef" },
      renderer: { name: "x", version: "1" },
      assets: Array.from({ length: count }, () => asset),
    });

    expect(() => parseRenderManifest(manifest(MAX_RENDER_ASSETS))).not.toThrow();
    expect(() => parseRenderManifest(manifest(MAX_RENDER_ASSETS + 1))).toThrow();
  });

  it("is a cap the contract enforces, so a parsed document can never reach the guard", () => {
    expect(() => withViews(MAX_VIEWS + 1)).toThrowError(
      expect.objectContaining({ code: "INVALID_DOCUMENT" }),
    );
  });
});

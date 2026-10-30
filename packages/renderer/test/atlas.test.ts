import type { GraphDoc, Lens } from "@coldtea/pr-lens-schema";
import { assertNever, parseGraphDoc } from "@coldtea/pr-lens-schema";
import { postmarkRefactorGraph } from "@coldtea/pr-lens-schema/examples";
import { describe, expect, it } from "vitest";
import { union } from "../src/bounds.js";
import { FLOW_MAX_PULSES_PER_MESSAGE, TABLE_ROW_HEIGHT } from "../src/design.js";
import { render, THEMES, type Box, type RenderAtlas } from "../src/index.js";
import { layoutDataFlow } from "../src/layout/dataflow.js";
import { resolveScope, type ScopedGraph } from "../src/scope.js";
import { tiers } from "./tiers.js";
import { oneStoreGraph } from "./one-store.js";

/** Every lens a document declares that it can actually draw something in. */
const drawableLenses = (doc: GraphDoc): Lens[] =>
  doc.lenses.filter((lens) => {
    switch (lens) {
      case "architecture":
        return true;
      case "data-flow":
        return doc.flows.length > 0;
      case "data-model":
        return doc.dataModel !== undefined;
      default:
        return assertNever(lens, "Unhandled lens");
    }
  });

const wholeDocument = (doc: GraphDoc): ScopedGraph => resolveScope(doc, { kind: "all" });

/**
 * Exactly what a lens is answerable for. The architecture lens draws the graph
 * and no flow; the data-flow lens draws the flows and the columns heading
 * them, which is a slice of the nodes and none of the lanes or edges.
 */
const expectedKeys = (
  lens: Lens,
  graph: ScopedGraph,
): { lanes: string[]; nodes: string[]; edges: string[]; messages: Record<string, string[]>; tables: string[] } => {
  switch (lens) {
    case "architecture":
      return {
        lanes: graph.lanes.map((lane) => lane.id),
        nodes: graph.nodes.map((node) => node.id),
        edges: graph.edges.map((edge) => edge.id),
        messages: {},
        tables: [],
      };
    case "data-model":
      return {
        lanes: graph.stores.map((store) => store.id),
        nodes: [],
        edges: graph.relations.map((relation) => relation.id),
        messages: {},
        tables: graph.tables.map((table) => table.id),
      };
    case "data-flow":
      return {
        lanes: [],
        nodes: [
          ...new Set(
            graph.flows.flatMap((flow) =>
              flow.participants.map((participant) => participant.node),
            ),
          ),
        ],
        edges: [],
        messages: Object.fromEntries(
          graph.flows.map((flow) => [flow.id, flow.messages.map((message) => message.id)]),
        ),
        tables: [],
      };
    default:
      return assertNever(lens, "Unhandled lens");
  }
};

const sorted = (ids: readonly string[]): string[] => [...ids].sort();

const isDrawn = (box: Box): boolean =>
  Number.isFinite(box.x) && Number.isFinite(box.y) && box.width >= 0 && box.height >= 0;

describe("the atlas is as deterministic as the drawing", () => {
  it("across two renders of the same document", () => {
    const first = render(postmarkRefactorGraph, { lens: "architecture", theme: "dark" });
    const second = render(postmarkRefactorGraph, { lens: "architecture", theme: "dark" });

    expect(second.svg).toBe(first.svg);
    expect(JSON.stringify(second.atlas)).toBe(JSON.stringify(first.atlas));
  });

  it("across a round trip through JSON", () => {
    const reparsed = parseGraphDoc(JSON.parse(JSON.stringify(postmarkRefactorGraph)));
    const drawn = render(reparsed, { lens: "data-flow", theme: "dark" });
    const reference = render(postmarkRefactorGraph, { lens: "data-flow", theme: "dark" });

    expect(JSON.stringify(drawn.atlas)).toBe(JSON.stringify(reference.atlas));
  });

  for (const lens of ["architecture", "data-flow"] as const)
    it(`does not move when the theme changes, in the ${lens} lens`, () => {
      const atlases = THEMES.map(
        (theme) => JSON.stringify(render(postmarkRefactorGraph, { lens, theme }).atlas),
      );
      expect(new Set(atlases).size).toBe(1);
    });
});

describe("every drawn thing has a box, and nothing else does", () => {
  for (const { name, doc } of tiers)
    for (const lens of drawableLenses(doc))
      it(`${name}, ${lens}`, () => {
        const { atlas } = render(doc, { lens, theme: "dark" });
        const expected = expectedKeys(lens, wholeDocument(doc));

        expect(sorted(Object.keys(atlas.lanes))).toEqual(sorted(expected.lanes));
        expect(sorted(Object.keys(atlas.nodes))).toEqual(sorted(expected.nodes));
        expect(sorted(Object.keys(atlas.edges))).toEqual(sorted(expected.edges));
        expect(sorted(Object.keys(atlas.messages))).toEqual(sorted(Object.keys(expected.messages)));
        expect(sorted(Object.keys(atlas.tables))).toEqual(sorted(expected.tables));

        for (const [flow, steps] of Object.entries(expected.messages))
          expect(sorted(Object.keys(atlas.messages[flow] ?? {}))).toEqual(sorted(steps));

        for (const box of everyBox(atlas)) expect(isDrawn(box)).toBe(true);
      });

  it("covers a drill-down view rather than the whole document", () => {
    const { atlas } = render(postmarkRefactorGraph, {
      lens: "architecture",
      theme: "dark",
      view: "new-batch-path",
    });
    const view = postmarkRefactorGraph.views[0]?.children[0];
    if (view === undefined) throw new Error("the reference document lost its drill-down view");

    expect(sorted(Object.keys(atlas.nodes))).toEqual(
      sorted(resolveScope(postmarkRefactorGraph, view.scope).nodes.map((node) => node.id)),
    );
  });
});

const everyBox = (atlas: RenderAtlas): Box[] => [
  ...Object.values(atlas.lanes),
  ...Object.values(atlas.nodes),
  ...Object.values(atlas.edges),
  ...Object.values(atlas.messages).flatMap((flow) => Object.values(flow)),
  ...Object.values(atlas.tables),
];

/**
 * The cards as the file actually carries them, moved onto the canvas the way
 * the painting is. The atlas would be worth nothing if it could drift from
 * the drawing it describes, so it is checked against the bytes.
 */
const cardRects = (svg: string): string[] => {
  const shift = /<g transform="translate\((-?[\d.]+),(-?[\d.]+)\)">/.exec(svg);
  const shiftX = Number(shift?.[1] ?? 0);
  const shiftY = Number(shift?.[2] ?? 0);

  return [
    ...svg.matchAll(
      /<rect class="card[^"]*" x="(-?[\d.]+)" y="(-?[\d.]+)" width="(-?[\d.]+)" height="(-?[\d.]+)"/g,
    ),
  ].map(
    ([, x, y, width, height]) =>
      `${Number(x) + shiftX},${Number(y) + shiftY},${Number(width)},${Number(height)}`,
  );
};

const atlasRects = (boxes: Record<string, Box>): string[] =>
  Object.values(boxes).map((box) => `${box.x},${box.y},${box.width},${box.height}`);

describe("the atlas agrees with the SVG", () => {
  it("in the architecture lens", () => {
    const { svg, atlas } = render(postmarkRefactorGraph, {
      lens: "architecture",
      theme: "dark",
      view: "overview",
    });
    expect(sorted(cardRects(svg))).toEqual(sorted(atlasRects(atlas.nodes)));
  });

  it("in the data-flow lens", () => {
    const { svg, atlas } = render(postmarkRefactorGraph, {
      lens: "data-flow",
      theme: "dark",
      view: "send-pipeline-view",
    });
    expect(sorted(cardRects(svg))).toEqual(sorted(atlasRects(atlas.nodes)));
  });
});

/**
 * Two flows, one participant, two cards. A step focusing that node means both
 * of them, so its box has to hold both.
 */
const stackedFlows = (): GraphDoc =>
  parseGraphDoc({
    ...JSON.parse(JSON.stringify(postmarkRefactorGraph)),
    views: [],
    layout: undefined,
    flows: [
      {
        id: "first",
        title: "First",
        participants: [{ node: "queue-route" }, { node: "broadcast-queue" }],
        messages: [
          { id: "enqueue", from: "queue-route", to: "broadcast-queue", label: "enqueue", delta: "added" },
        ],
      },
      {
        id: "second",
        title: "Second",
        participants: [{ node: "broadcast-queue" }, { node: "postmark" }],
        messages: [
          { id: "post", from: "broadcast-queue", to: "postmark", label: "post", delta: "added" },
        ],
      },
    ],
    walkthrough: undefined,
  });

describe("a node drawn twice", () => {
  it("gets the box covering both of its cards", () => {
    const doc = stackedFlows();
    const layout = layoutDataFlow(doc.flows, doc.nodes, FLOW_MAX_PULSES_PER_MESSAGE);
    const cards = layout.flows.flatMap((flow) =>
      flow.participants
        .filter((participant) => participant.node.id === "broadcast-queue")
        .map((participant) => participant.card),
    );
    expect(cards).toHaveLength(2);

    const { atlas } = render(doc, { lens: "data-flow", theme: "dark" });
    const shared = atlas.nodes["broadcast-queue"];
    if (shared === undefined) throw new Error("the stacked flows lost their shared participant");

    const both = union(cards);
    expect(shared.width).toBeCloseTo(both?.width ?? 0, 2);
    expect(shared.height).toBeCloseTo(both?.height ?? 0, 2);
  });

  it("keys the two flows' steps apart", () => {
    const { atlas } = render(stackedFlows(), { lens: "data-flow", theme: "dark" });
    expect(Object.keys(atlas.messages)).toEqual(["first", "second"]);
    expect(Object.keys(atlas.messages["first"] ?? {})).toEqual(["enqueue"]);
    expect(Object.keys(atlas.messages["second"] ?? {})).toEqual(["post"]);
  });
});

describe("the rows of a table card", () => {
  const { atlas } = render(oneStoreGraph, { lens: "data-model", theme: "light" });

  it("places every drawn column inside its card, one row height tall, in the card's order", () => {
    for (const table of oneStoreGraph.dataModel?.tables ?? []) {
      const card = atlas.tables[table.id];
      const rows = atlas.columns[table.id];
      if (card === undefined || rows === undefined) throw new Error(`no card for ${table.id}`);

      const names = table.columns.map((column) => column.name);
      let previousTop = -Infinity;
      for (const [name, row] of Object.entries(rows)) {
        expect(names).toContain(name);
        expect(row.x).toBe(card.x);
        expect(row.width).toBe(card.width);
        expect(row.height).toBe(TABLE_ROW_HEIGHT);
        expect(row.y).toBeGreaterThan(card.y);
        expect(row.y + row.height).toBeLessThanOrEqual(card.y + card.height);
        expect(row.y).toBeGreaterThan(previousTop);
        previousTop = row.y;
      }
    }
  });

  it("draws the other lenses with no rows at all", () => {
    expect(render(oneStoreGraph, { lens: "architecture", theme: "light" }).atlas.columns).toEqual({});
  });
});

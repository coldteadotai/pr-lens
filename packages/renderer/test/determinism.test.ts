import type { GraphDoc, GraphNode } from "@coldtea/pr-lens-schema";
import { parseGraphDoc } from "@coldtea/pr-lens-schema";
import { postmarkRefactorGraph } from "@coldtea/pr-lens-schema/examples";
import { describe, expect, it } from "vitest";
import { layoutArchitecture } from "../src/layout/architecture.js";
import { rankNodes } from "../src/layout/rank.js";
import { render } from "../src/index.js";

const draw = (doc: GraphDoc): string => render(doc, { lens: "architecture", theme: "dark" }).svg;

const layoutOf = (doc: GraphDoc) =>
  layoutArchitecture(
    { lanes: doc.lanes, nodes: doc.nodes, edges: doc.edges, flows: doc.flows },
    doc.layout,
  );

const boxes = (doc: GraphDoc): Map<string, string> =>
  new Map(
    layoutOf(doc).nodes.map(({ node, box }) => [
      node.id,
      `${box.x},${box.y},${box.width},${box.height}`,
    ]),
  );

describe("the same document draws the same bytes", () => {
  it("across two calls", () => {
    expect(draw(postmarkRefactorGraph)).toBe(draw(postmarkRefactorGraph));
  });

  it("across a round trip through JSON", () => {
    const reparsed = parseGraphDoc(JSON.parse(JSON.stringify(postmarkRefactorGraph)));
    expect(draw(reparsed)).toBe(draw(postmarkRefactorGraph));
  });

  it("however the input's keys were ordered", () => {
    const reversedKeys = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reversedKeys);
      if (value === null || typeof value !== "object") return value;
      return Object.fromEntries(
        Object.entries(value)
          .reverse()
          .map(([key, nested]) => [key, reversedKeys(nested)]),
      );
    };
    const shuffled = parseGraphDoc(reversedKeys(JSON.parse(JSON.stringify(postmarkRefactorGraph))));
    expect(draw(shuffled)).toBe(draw(postmarkRefactorGraph));
  });

  it("when a field this lens never draws changes", () => {
    const annotated: GraphDoc = {
      ...postmarkRefactorGraph,
      nodes: postmarkRefactorGraph.nodes.map((node) => ({
        ...node,
        summary: "Rewritten prose that only the drill-down body ever shows.",
      })),
    };
    expect(draw(annotated)).toBe(draw(postmarkRefactorGraph));
  });
});

describe("a small change to the graph is a small change to the picture", () => {
  const extra: GraphNode = {
    id: "postmark-webhooks",
    label: "Postmark webhooks",
    kind: "external",
    delta: "added",
    lane: "external",
    files: [],
    badges: [],
  };

  const enlarged = parseGraphDoc({
    ...JSON.parse(JSON.stringify(postmarkRefactorGraph)),
    nodes: [...JSON.parse(JSON.stringify(postmarkRefactorGraph.nodes)), extra],
  });

  it("leaves every card in an earlier lane exactly where it was", () => {
    const before = boxes(postmarkRefactorGraph);
    const after = boxes(enlarged);
    const untouched = postmarkRefactorGraph.nodes.filter((node) => node.lane !== "external");

    for (const node of untouched) expect(after.get(node.id)).toBe(before.get(node.id));
  });

  it("seats the unconnected newcomer in its lane's empty top row and moves nothing", () => {
    const before = layoutOf(postmarkRefactorGraph).nodes.find(({ node }) => node.id === "postmark");
    const after = layoutOf(enlarged).nodes.find(({ node }) => node.id === "postmark");
    const added = layoutOf(enlarged).nodes.find(({ node }) => node.id === "postmark-webhooks");
    expect(before?.row).toBe(5);
    expect(after?.row).toBe(5);
    expect(added?.row).toBe(0);
  });
});

describe("ranking", () => {
  const nodes = (ids: readonly string[]): GraphNode[] =>
    ids.map((id) => ({
      id,
      label: id,
      kind: "other",
      delta: "unchanged",
      lane: "one",
      files: [],
      badges: [],
    }));

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

  it("puts every node below the ones that feed it", () => {
    const ranks = rankNodes(nodes(["a", "b", "c"]), [edge("a", "b"), edge("b", "c")], {});
    expect([ranks.get("a"), ranks.get("b"), ranks.get("c")]).toEqual([0, 1, 2]);
  });

  it("still ranks a cycle, by dropping the edge that closes it", () => {
    const ranks = rankNodes(
      nodes(["a", "b", "c"]),
      [edge("a", "b"), edge("b", "c"), edge("c", "a")],
      {},
    );
    expect([ranks.get("a"), ranks.get("b"), ranks.get("c")]).toEqual([0, 1, 2]);
  });

  it("lets a hint push a node further down", () => {
    const ranks = rankNodes(nodes(["a", "b"]), [edge("a", "b")], { b: 5 });
    expect(ranks.get("b")).toBe(5);
  });

  it("does not let a hint lift a node above what feeds it", () => {
    const ranks = rankNodes(nodes(["a", "b"]), [edge("a", "b")], { a: 3, b: 0 });
    expect(ranks.get("a")).toBe(3);
    expect(ranks.get("b")).toBe(4);
  });
});

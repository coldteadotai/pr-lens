import { parseConfig, type ConfigInput } from "@coldtea/pr-lens-schema";
import { postmarkRefactorGraph } from "@coldtea/pr-lens-schema/examples";
import { expect, test } from "vitest";
import { applyCorrections } from "../src/corrections.js";

const config = (map: NonNullable<ConfigInput["map"]>) =>
  parseConfig({ schemaVersion: "0.1.0", map });

const corrected = (map: NonNullable<ConfigInput["map"]>) => {
  const { result, warnings } = applyCorrections(postmarkRefactorGraph, config(map));
  if (!result.ok) throw result.error;
  return { graph: result.value, warnings };
};

test("a rename matched by path survives the model choosing another label", () => {
  const { graph } = corrected({
    rename: [{ match: "functions/src/broadcast/sendBroadcastBulk.ts", to: "Broadcast sender" }],
  });

  expect(graph.nodes.find((node) => node.id === "send-broadcast-bulk")?.label).toBe("Broadcast sender");
});

test("an id: selector addresses exactly one node", () => {
  const { graph } = corrected({ rename: [{ match: "id:postmark", to: "Postmark API" }] });

  expect(graph.nodes.find((node) => node.id === "postmark")?.label).toBe("Postmark API");
  expect(graph.nodes.filter((node) => node.label === "Postmark API")).toHaveLength(1);
});

test("excluding a node takes the edges that hung from it", () => {
  const { graph } = corrected({ exclude: ["functions/src/broadcast/**"] });

  const ids = graph.nodes.map((node) => node.id);
  expect(ids).not.toContain("send-broadcast-bulk");
  expect(graph.edges.every((edge) => ids.includes(edge.from) && ids.includes(edge.to))).toBe(true);
});

test("a lane pin moves a node between declared lanes", () => {
  const lane = postmarkRefactorGraph.lanes[0]?.id;
  if (lane === undefined) throw new Error("the golden lost its lanes");

  const { graph, warnings } = corrected({ lane: [{ match: "id:postmark", lane }] });

  expect(graph.nodes.find((node) => node.id === "postmark")?.lane).toBe(lane);
  expect(warnings).toEqual([]);
});

test("a pin into a lane the document never declared is skipped, and said out loud", () => {
  const { graph, warnings } = corrected({ lane: [{ match: "id:postmark", lane: "invented" }] });

  expect(graph.nodes.find((node) => node.id === "postmark")?.lane).toBe(
    postmarkRefactorGraph.nodes.find((node) => node.id === "postmark")?.lane,
  );
  expect(warnings).toEqual([
    "lane 'id:postmark' moves nodes into lane 'invented', which the document does not declare — skipped",
  ]);
});

test("a correction that matches nothing is reported rather than swallowed", () => {
  const { warnings } = corrected({ rename: [{ match: "src/gone.ts", to: "Gone" }] });

  expect(warnings).toEqual(["rename 'src/gone.ts' matched no node"]);
});

test("a group correction clusters nodes inside their lane", () => {
  const { graph } = corrected({ group: [{ match: "packages/broadcast-lib/**", group: "broadcast-lib" }] });

  const grouped = graph.nodes.filter((node) => node.group === "broadcast-lib");
  expect(grouped.length).toBeGreaterThan(0);
});

test("a document with no corrections comes back untouched", () => {
  const { graph, warnings } = corrected({});

  expect(graph).toEqual(postmarkRefactorGraph);
  expect(warnings).toEqual([]);
});

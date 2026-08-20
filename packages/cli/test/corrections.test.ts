import { parseConfig, type ConfigInput } from "@coldtea/pr-lens-schema";
import { postmarkRefactorGraph } from "@coldtea/pr-lens-schema/examples";
import { expect, test } from "vitest";
import { unmatchedCorrections } from "../src/corrections.js";

const node = postmarkRefactorGraph.nodes.find((candidate) => candidate.id === "send-broadcast-bulk");
if (node === undefined) throw new Error("the golden lost the node these tests are about");

const warnings = (map: NonNullable<ConfigInput["map"]>) =>
  unmatchedCorrections(postmarkRefactorGraph, parseConfig({ schemaVersion: "0.1.0", map }));

test("a selector that matches nothing is named", () => {
  expect(warnings({ rename: [{ match: "src/moved-away.ts", to: "Gone" }] })).toEqual([
    "rename 'src/moved-away.ts' changed nothing — no node in this document matches it",
  ]);
});

test("a rename to the label inference already chose is a correction, not a dead one", () => {
  expect(warnings({ rename: [{ match: `id:${node.id}`, to: node.label }] })).toEqual([]);
});

test("a lane pin into the lane a node already sits in is holding that node there", () => {
  expect(warnings({ lane: [{ match: `id:${node.id}`, lane: node.lane }] })).toEqual([]);
});

test("a group rule a node already agrees with is not a rule to delete", () => {
  const grouped = {
    ...postmarkRefactorGraph,
    nodes: postmarkRefactorGraph.nodes.map((candidate) =>
      candidate.id === node.id ? { ...candidate, group: "broadcast-lib" } : candidate,
    ),
  };

  expect(
    unmatchedCorrections(
      grouped,
      parseConfig({
        schemaVersion: "0.1.0",
        map: { group: [{ match: `id:${node.id}`, group: "broadcast-lib" }] },
      }),
    ),
  ).toEqual([]);
});

test("an exclusion that matches is silent, and one that matches nothing is not", () => {
  expect(warnings({ exclude: [`id:${node.id}`] })).toEqual([]);
  expect(warnings({ exclude: ["**/*.rb"] })).toEqual([
    "exclude '**/*.rb' changed nothing — no node in this document matches it",
  ]);
});

test("a document with nothing to say about is silent", () => {
  expect(warnings({})).toEqual([]);
});

test("the probe cannot collide with what a document already holds", () => {
  const collides = {
    ...postmarkRefactorGraph,
    nodes: postmarkRefactorGraph.nodes.map((candidate) =>
      candidate.id === node.id ? { ...candidate, label: "pr-lens-probe" } : candidate,
    ),
  };

  expect(
    unmatchedCorrections(
      collides,
      parseConfig({
        schemaVersion: "0.1.0",
        map: { rename: [{ match: `id:${node.id}`, to: "pr-lens-probe" }] },
      }),
    ),
  ).toEqual([]);
});

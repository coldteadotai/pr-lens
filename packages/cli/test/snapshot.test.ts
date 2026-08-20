import { graphSnapshotIssues, parseGraphDoc } from "@coldtea/pr-lens-schema";
import { postmarkRefactorGraph } from "@coldtea/pr-lens-schema/examples";
import { expect, test } from "vitest";
import { toStoredMap } from "../src/snapshot.js";

const SHA = "b71e0d4a9c3f5e28d17046b8ac9f52e310d7c6b4";

const exported = () =>
  toStoredMap(postmarkRefactorGraph, {
    id: "coldteadotai/pr-lens",
    sha: SHA,
    generatedAt: "2026-08-20T21:00:00.000Z",
  });

test("the exported map is a map the contract will store", () => {
  const result = exported();
  if (!result.ok) throw result.error;

  expect(graphSnapshotIssues(result.value)).toEqual([]);
  expect(result.value.provenance.base.sha).toBe(SHA);
  expect(result.value.provenance.head.sha).toBe(SHA);
  expect(result.value.id).toBe("coldteadotai/pr-lens");
});

test("what the change deleted is gone, and what survived is no longer annotated", () => {
  const result = exported();
  if (!result.ok) throw result.error;

  const ids = result.value.nodes.map((node) => node.id);
  expect(ids).not.toContain("process-broadcast");
  expect(ids).not.toContain("send-single-email");
  expect(ids).toContain("send-broadcast-bulk");

  expect(result.value.nodes.every((node) => node.delta === "unchanged")).toBe(true);
  expect(result.value.edges.every((edge) => edge.delta === "unchanged")).toBe(true);
  expect(result.value.flows.every((flow) => flow.delta === "unchanged")).toBe(true);
});

test("edges the deleted nodes hung from go with them, rather than dangling", () => {
  const result = exported();
  if (!result.ok) throw result.error;

  const edgeIds = result.value.edges.map((edge) => edge.id);
  expect(edgeIds).not.toContain("firestore-to-process");
  expect(edgeIds).not.toContain("process-to-single");
  expect(edgeIds).not.toContain("single-to-postmark");
});

test("line counts describe a diff, so they do not follow the map", () => {
  const result = exported();
  if (!result.ok) throw result.error;

  expect(postmarkRefactorGraph.stats).toBeDefined();
  expect(result.value.stats).toBeUndefined();
});

test("a map has to name its commit in full, and says so when it cannot", () => {
  const result = toStoredMap(postmarkRefactorGraph, {
    id: "coldteadotai/pr-lens",
    sha: "b71e0d4",
    generatedAt: "2026-08-20T21:00:00.000Z",
  });

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe("NOT_A_SNAPSHOT");
});

test("exporting a map is idempotent: exporting one again changes nothing", () => {
  const first = exported();
  if (!first.ok) throw first.error;

  const second = toStoredMap(first.value, {
    id: "coldteadotai/pr-lens",
    sha: SHA,
    generatedAt: "2026-08-20T21:00:00.000Z",
  });
  if (!second.ok) throw second.error;

  expect(second.value).toEqual(first.value);
});

test("a flow whose every step the change deleted does not survive as an empty column", () => {
  const graph = structuredClone(postmarkRefactorGraph);
  const flow = graph.flows[0];
  if (flow === undefined) throw new Error("the golden lost its flow");

  const withRemovedSteps = parseGraphDoc({
    ...graph,
    flows: [{ ...flow, messages: flow.messages.map((message) => ({ ...message, delta: "removed" })) }],
  });

  const result = toStoredMap(withRemovedSteps, {
    id: "coldteadotai/pr-lens",
    sha: SHA,
    generatedAt: "2026-08-20T21:00:00.000Z",
  });
  if (!result.ok) throw result.error;

  expect(result.value.flows).toEqual([]);
  expect(result.value.views.map((view) => view.id)).not.toContain("send-pipeline-view");
});

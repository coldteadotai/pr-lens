import { describe, expect, it } from "vitest";
import { applyPatch } from "../src/apply.js";
import { minimalGraph, postmarkRefactorGraph, postmarkRefactorPatch } from "../src/examples/index.js";
import { graphIntegrityIssues } from "../src/integrity.js";
import type { PatchOp } from "../src/patch.js";

const apply = (ops: readonly PatchOp[], graph = postmarkRefactorGraph) => applyPatch(graph, ops);

const expectApplied = (ops: readonly PatchOp[], graph = postmarkRefactorGraph) => {
  const result = apply(ops, graph);
  if (!result.ok) throw result.error;
  return result.value;
};

const expectRejected = (ops: readonly PatchOp[], graph = postmarkRefactorGraph) => {
  const result = apply(ops, graph);
  if (result.ok) throw new Error("expected the patch to be rejected");
  return result.error;
};

describe("applying a patch", () => {
  it("folds the golden patch into the baseline and leaves it whole", () => {
    const patched = expectApplied(postmarkRefactorPatch.ops);

    expect(patched.nodes.map((node) => node.id)).not.toContain("process-broadcast");
    expect(patched.nodes.map((node) => node.id)).not.toContain("send-single-email");
    expect(patched.nodes.find(({ id }) => id === "send-broadcast-bulk")?.delta).toBe("unchanged");
    expect(patched.edges.find(({ id }) => id === "bulk-to-postmark")?.emphasis).toBe("normal");
    expect(patched.stats?.chips).toEqual([{ label: "Batch size", value: "500", tone: "neutral" }]);
    expect(graphIntegrityIssues(patched)).toEqual([]);
  });

  it("leaves the input document untouched", () => {
    const before = JSON.stringify(postmarkRefactorGraph);
    expectApplied(postmarkRefactorPatch.ops);
    expect(JSON.stringify(postmarkRefactorGraph)).toBe(before);
  });

  it("takes the edges of a removed node with it", () => {
    const patched = expectApplied([{ op: "remove_node", id: "send-single-email" }]);
    expect(patched.edges.map((edge) => edge.id)).not.toContain("single-to-postmark");
    expect(patched.edges.map((edge) => edge.id)).not.toContain("process-to-single");
  });

  it("takes the flow steps of a removed participant with it", () => {
    const patched = expectApplied([{ op: "remove_node", id: "postmark" }]);
    const flow = patched.flows.find(({ id }) => id === "send-pipeline");
    expect(flow?.participants.map((participant) => participant.node)).toEqual([
      "queue-route",
      "broadcast-queue",
      "send-broadcast-bulk",
    ]);
    expect(flow?.messages.map((message) => message.id)).toEqual([
      "enqueue",
      "trigger",
      "write-results",
    ]);
  });

  it("drops a flow left with too few participants to describe a pipeline", () => {
    const patched = expectApplied([
      { op: "remove_node", id: "postmark" },
      { op: "remove_node", id: "send-broadcast-bulk" },
      { op: "remove_node", id: "broadcast-queue" },
    ]);
    expect(patched.flows).toEqual([]);
    expect(graphIntegrityIssues(patched)).toEqual([]);
  });

  it("prunes removed ids out of the drill-down tree", () => {
    const patched = expectApplied([{ op: "remove_node", id: "process-broadcast" }]);
    const retired = patched.views[0]?.children.find(({ id }) => id === "retired-path");
    expect(retired?.scope.nodes).toEqual(["send-single-email"]);
    expect(retired?.scope.edges).toEqual(["single-to-postmark"]);
  });

  it("merges only the fields an update names", () => {
    const patched = expectApplied([
      { op: "update_node", id: "queue-route", patch: { delta: "unchanged" } },
    ]);
    const node = patched.nodes.find(({ id }) => id === "queue-route");
    expect(node?.delta).toBe("unchanged");
    expect(node?.label).toBe("POST /api/broadcasts/queue");
    expect(node?.files).toHaveLength(1);
  });

  it("refuses to add an id that is already taken", () => {
    const existing = postmarkRefactorGraph.lanes[0]!;
    const error = expectRejected([{ op: "add_lane", lane: existing }]);
    expect(error.code).toBe("PATCH_CONFLICT");
    expect(error.message).toContain("lane 'web' already exists");
  });

  it("refuses to update something that is not there", () => {
    const error = expectRejected([{ op: "update_edge", id: "nope", patch: { delta: "unchanged" } }]);
    expect(error.code).toBe("PATCH_CONFLICT");
    expect(error.message).toContain("unknown edge 'nope'");
  });

  it("refuses to remove a lane that still holds nodes", () => {
    const error = expectRejected([{ op: "remove_lane", id: "web" }]);
    expect(error.code).toBe("PATCH_CONFLICT");
    expect(error.message).toContain("still holds node 'broadcast-composer'");
  });

  it("refuses to add a node into a lane that does not exist", () => {
    const error = expectRejected([
      {
        op: "add_node",
        node: {
          id: "orphan",
          label: "Orphan",
          kind: "module",
          delta: "added",
          lane: "nowhere",
          files: [],
          badges: [],
        },
      },
    ]);
    expect(error.code).toBe("BROKEN_REFERENCE");
    expect(error.message).toContain("unknown lane 'nowhere'");
  });

  it("stops at the first conflict and reports which operation failed", () => {
    const error = expectRejected(
      [
        { op: "remove_node", id: "health-route" },
        { op: "remove_node", id: "health-route" },
      ],
      minimalGraph,
    );
    expect(error.message).toMatch(/^ops\[1\]:/);
  });
});

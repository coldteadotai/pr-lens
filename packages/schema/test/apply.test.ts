import { describe, expect, it } from "vitest";
import { applyPatch, applyPatchDoc } from "../src/apply.js";
import {
  broadcastBaselineGraph,
  broadcastBaselinePatch,
  minimalGraph,
  postmarkRefactorGraph,
} from "../src/examples/index.js";
import { graphIntegrityIssues } from "../src/integrity.js";
import type { PatchDoc, PatchOp } from "../src/patch.js";
import { safeParseGraphDoc } from "../src/validate.js";

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
  it("leaves the input document untouched", () => {
    const before = JSON.stringify(broadcastBaselineGraph);
    applyPatchDoc(broadcastBaselineGraph, broadcastBaselinePatch);
    expect(JSON.stringify(broadcastBaselineGraph)).toBe(before);
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
    if (retired?.scope.kind !== "selection") throw new Error("expected a selection scope");
    expect(retired.scope.nodes).toEqual(["send-single-email"]);
    expect(retired.scope.edges).toEqual(["single-to-postmark"]);
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

  it("drops a view whose selection loses its last element", () => {
    const patched = expectApplied([
      { op: "remove_node", id: "process-broadcast" },
      { op: "remove_node", id: "send-single-email" },
    ]);
    const titles = patched.views[0]?.children.map((child) => child.id);
    expect(titles).toEqual(["new-batch-path"]);
  });

  it("takes removed nodes out of the layout hints", () => {
    const patched = expectApplied([{ op: "remove_node", id: "postmark" }]);
    expect(patched.layout?.rank).toEqual({ "queue-route": 0, "send-broadcast-bulk": 1 });
    expect(graphIntegrityIssues(patched)).toEqual([]);
  });

  it("refuses a patch that would empty the document", () => {
    const error = expectRejected([{ op: "remove_node", id: "health-route" }], minimalGraph);
    expect(error.code).toBe("INVALID_DOCUMENT");
  });

  it("refuses a flow whose steps run between non-participants", () => {
    const error = expectRejected([
      {
        op: "add_flow",
        flow: {
          id: "stray",
          title: "Stray",
          delta: "unchanged",
          participants: [{ node: "queue-route" }, { node: "postmark" }],
          messages: [
            {
              id: "stray-step",
              from: "queue-route",
              to: "broadcast-queue",
              label: "somewhere else",
              kind: "sync",
              delta: "unchanged",
              animated: true,
              files: [],
            },
          ],
        },
      },
    ]);
    expect(error.code).toBe("BROKEN_REFERENCE");
    expect(error.message).toContain("not a participant");
  });

  it("refuses an update that strands the steps of a flow it rewrites", () => {
    const error = expectRejected([
      {
        op: "update_flow",
        id: "send-pipeline",
        patch: { participants: [{ node: "queue-route" }, { node: "broadcast-queue" }] },
      },
    ]);
    expect(error.code).toBe("BROKEN_REFERENCE");
  });

  it("hands back a document that parses", () => {
    const patched = expectApplied([{ op: "remove_node", id: "send-single-email" }]);
    expect(safeParseGraphDoc(patched).ok).toBe(true);
  });
});

describe("applying a patch document", () => {
  const applied = () => {
    const result = applyPatchDoc(broadcastBaselineGraph, broadcastBaselinePatch);
    if (!result.ok) throw result.error;
    return result.value;
  };

  it("carries the baseline map from the base commit to the head commit", () => {
    const patched = applied();

    expect(patched.provenance.base.sha).toBe(broadcastBaselineGraph.provenance.head.sha);
    expect(patched.provenance.head.sha).toBe(broadcastBaselinePatch.target.toSha);
    expect(graphIntegrityIssues(patched)).toEqual([]);
  });

  it("leaves the map describing a system, not a change", () => {
    const patched = applied();
    const deltas = new Set([
      ...patched.nodes.map((node) => node.delta),
      ...patched.edges.map((edge) => edge.delta),
      ...patched.flows.map((flow) => flow.delta),
    ]);
    expect([...deltas]).toEqual(["unchanged"]);
  });

  it("swaps the single-send path for the batch path", () => {
    const nodeIds = applied().nodes.map((node) => node.id);

    expect(nodeIds).toContain("send-broadcast-bulk");
    expect(nodeIds).toContain("build-bulk-payload");
    expect(nodeIds).toContain("get-suppressed-emails");
    expect(nodeIds).toContain("broadcast-lib");
    expect(nodeIds).not.toContain("process-broadcast");
    expect(nodeIds).not.toContain("send-single-email");
  });

  it("replaces the flow rather than leaving the old steps behind", () => {
    const flow = applied().flows.find(({ id }) => id === "send-pipeline");
    expect(flow?.participants.map((participant) => participant.node)).toContain(
      "send-broadcast-bulk",
    );
    expect(flow?.messages.map((message) => message.id)).toEqual([
      "enqueue",
      "trigger",
      "suppressions-request",
      "suppressions-response",
      "batch-post",
      "batch-results",
      "write-results",
    ]);
  });

  it("refuses a patch aimed at a different stored graph", () => {
    const patch: PatchDoc = {
      ...broadcastBaselinePatch,
      target: { ...broadcastBaselinePatch.target, graphId: "some-other-map" },
    };
    const result = applyPatchDoc(broadcastBaselineGraph, patch);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PATCH_CONFLICT");
    expect(result.error.message).toContain("some-other-map");
  });

  it("refuses to apply the same patch twice", () => {
    const result = applyPatchDoc(applied(), broadcastBaselinePatch);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PATCH_CONFLICT");
    expect(result.error.issues[0]?.message).toBe("stale baseline");
  });
});

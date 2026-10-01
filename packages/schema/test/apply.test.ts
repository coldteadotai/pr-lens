import { describe, expect, it } from "vitest";
import { applyPatch, applyPatchDoc } from "../src/apply.js";
import {
  broadcastBaselineGraph,
  broadcastBaselinePatch,
  minimalGraph,
  postmarkRefactorGraph,
} from "../src/examples/index.js";
import { postmarkRefactorGraphInput } from "../src/examples/postmark-refactor.js";
import type { GraphDoc, GraphDocInput } from "../src/graph.js";
import { graphIntegrityIssues, graphSnapshotIssues } from "../src/integrity.js";
import type { PatchDoc, PatchOp } from "../src/patch.js";
import { parseGraphDoc, safeParseGraphDoc } from "../src/validate.js";

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

    expect(patched.provenance.head.sha).toBe(broadcastBaselinePatch.target.toSha);
    expect(patched.provenance.base.sha).toBe(patched.provenance.head.sha);
    expect(graphIntegrityIssues(patched)).toEqual([]);
  });

  it("leaves the map describing a system, not a change", () => {
    const patched = applied();
    const deltas = new Set([
      ...patched.lanes.map((lane) => lane.delta ?? "unchanged"),
      ...patched.nodes.map((node) => node.delta),
      ...patched.edges.map((edge) => edge.delta),
      ...patched.flows.flatMap((flow) => [
        flow.delta,
        ...flow.messages.map((message) => message.delta),
      ]),
    ]);
    expect([...deltas]).toEqual(["unchanged"]);
    expect(graphSnapshotIssues(patched)).toEqual([]);
  });

  it("refuses a patch that would leave a change annotation in the map", () => {
    const patch: PatchDoc = {
      ...broadcastBaselinePatch,
      ops: [{ op: "update_node", id: "queue-route", patch: { delta: "modified" } }],
    };
    const result = applyPatchDoc(broadcastBaselineGraph, patch);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_A_SNAPSHOT");
    expect(result.error.message).toContain("node 'queue-route' is marked 'modified'");
  });

  it("refuses a patch whose new flow carries change annotations in its steps", () => {
    const source = broadcastBaselineGraph.flows[0]!;
    const patch: PatchDoc = {
      ...broadcastBaselinePatch,
      ops: [
        { op: "remove_flow", id: source.id },
        {
          op: "add_flow",
          flow: {
            ...source,
            messages: source.messages.map((message, index) =>
              index === 0 ? { ...message, delta: "added" } : message,
            ),
          },
        },
      ],
    };
    const result = applyPatchDoc(broadcastBaselineGraph, patch);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_A_SNAPSHOT");
    expect(result.error.message).toContain("step 'enqueue'");
  });

  it("refuses to patch a map that is already mid change", () => {
    const midChange: GraphDoc = {
      ...broadcastBaselineGraph,
      nodes: broadcastBaselineGraph.nodes.map((node) =>
        node.id === "queue-route" ? { ...node, delta: "modified" } : node,
      ),
    };
    const result = applyPatchDoc(midChange, broadcastBaselinePatch);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_A_SNAPSHOT");
  });

  it("refuses a map that records only an abbreviated commit", () => {
    const abbreviated: GraphDoc = {
      ...broadcastBaselineGraph,
      provenance: {
        ...broadcastBaselineGraph.provenance,
        base: { ...broadcastBaselineGraph.provenance.base, sha: "3f5c1ab" },
        head: { ...broadcastBaselineGraph.provenance.head, sha: "3f5c1ab" },
      },
    };
    const result = applyPatchDoc(abbreviated, broadcastBaselinePatch);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_A_SNAPSHOT");
    expect(result.error.message).toContain("records the commit it reflects in full");
  });

  it("refuses a map with no id, which no patch could name", () => {
    const { id, ...unidentified } = broadcastBaselineGraph;
    const result = applyPatchDoc(unidentified, broadcastBaselinePatch);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_A_SNAPSHOT");
    expect(result.error.message).toContain("needs an id");
  });

  it("refuses to launder a contaminated map by patching the annotation away", () => {
    const midChange: GraphDoc = {
      ...broadcastBaselineGraph,
      nodes: broadcastBaselineGraph.nodes.map((node) =>
        node.id === "queue-route" ? { ...node, delta: "modified" } : node,
      ),
    };
    const patch: PatchDoc = {
      ...broadcastBaselinePatch,
      ops: [{ op: "update_node", id: "queue-route", patch: { delta: "unchanged" } }],
    };
    const result = applyPatchDoc(midChange, patch);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_A_SNAPSHOT");
    expect(result.error.message).toContain("the graph being patched is not a stored map");
  });

  it("refuses a map whose provenance straddles two commits", () => {
    const straddling: GraphDoc = {
      ...broadcastBaselineGraph,
      provenance: {
        ...broadcastBaselineGraph.provenance,
        base: {
          ...broadcastBaselineGraph.provenance.base,
          sha: "0000000000000000000000000000000000000000",
        },
      },
    };
    const result = applyPatchDoc(straddling, broadcastBaselinePatch);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_A_SNAPSHOT");
    expect(result.error.message).toContain("reflects one commit");
  });

  it("refuses a patch that describes no transition, even when it never went through a parser", () => {
    const standingStill: PatchDoc = {
      ...broadcastBaselinePatch,
      target: {
        ...broadcastBaselinePatch.target,
        toSha: broadcastBaselinePatch.target.fromSha,
      },
      ops: [{ op: "set_stats", stats: { chips: [] } }],
    };

    for (const attempt of [1, 2]) {
      const result = applyPatchDoc(broadcastBaselineGraph, standingStill);
      expect(result.ok, `attempt ${attempt}`).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("PATCH_CONFLICT");
      expect(result.error.issues[0]?.message).toBe("no transition");
    }
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

  it("keeps the map readable as a snapshot of one commit", () => {
    const patched = applied();
    expect(patched.provenance.base).toEqual(patched.provenance.head);
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

const withSteps = (steps: NonNullable<GraphDocInput["walkthrough"]>["steps"]): GraphDoc =>
  parseGraphDoc({ ...postmarkRefactorGraphInput, walkthrough: { steps } });

const stepIds = (graph: GraphDoc): string[] | undefined =>
  graph.walkthrough?.steps.map((step) => step.id);

describe("carrying a walkthrough through a patch", () => {
  it("drops the members a step focused and keeps the step", () => {
    const patched = expectApplied([{ op: "remove_node", id: "postmark" }]);
    const step = patched.walkthrough?.steps.find(({ id }) => id === "batches-of-500");

    if (step?.focus.kind !== "selection") throw new Error("expected a selection focus");
    expect(step.focus.nodes).toEqual(["send-broadcast-bulk", "build-bulk-payload"]);
  });

  it("drops a cite of something that goes, and a detail left with nothing to open", () => {
    const graph = withSteps([
      {
        id: "one",
        heading: "One",
        body: "One call per batch.",
        stage: { kind: "view", view: "overview" },
        detail: {
          text: "The sender posts a batch to Postmark.",
          cites: [
            { text: "The sender", ref: { kind: "node", node: "send-broadcast-bulk" } },
            { text: "Postmark", ref: { kind: "node", node: "postmark" } },
          ],
        },
      },
      {
        id: "two",
        heading: "Two",
        body: "A result comes back for every message.",
        stage: { kind: "view", view: "overview" },
        detail: {
          text: "Postmark answers for every message.",
          cites: [{ text: "Postmark", ref: { kind: "node", node: "postmark" } }],
        },
      },
    ]);

    const patched = expectApplied([{ op: "remove_node", id: "postmark" }], graph);
    const [one, two] = patched.walkthrough?.steps ?? [];

    expect(one?.detail).toEqual({
      text: "The sender posts a batch to Postmark.",
      cites: [{ text: "The sender", ref: { kind: "node", node: "send-broadcast-bulk" } }],
    });
    expect(two?.body).toBe("A result comes back for every message.");
    expect(two).not.toHaveProperty("detail");
  });

  it("drops a step whose focus loses its last member", () => {
    const patched = expectApplied([{ op: "remove_node", id: "postmark" }]);

    expect(stepIds(patched)).toEqual([
      "batches-of-500",
      "suppression-first",
      "old-path-goes-dark",
      "sequence-start-to-finish",
      "blast-radius",
    ]);
  });

  it("drops the steps staged on a flow that goes", () => {
    const patched = expectApplied([{ op: "remove_flow", id: "send-pipeline" }]);

    expect(stepIds(patched)).toEqual([
      "batches-of-500",
      "suppression-first",
      "old-path-goes-dark",
      "blast-radius",
    ]);
  });

  it("drops a step staged on a view the prune took with it", () => {
    const graph = withSteps([
      {
        id: "retired",
        heading: "What was retired",
        body: "The path that went dark.",
        stage: { kind: "view", view: "retired-path" },
      },
      {
        id: "overview",
        heading: "Blast radius",
        body: "Everything the change touched.",
        stage: { kind: "view", view: "overview" },
      },
      {
        id: "pipeline",
        heading: "The sequence",
        body: "Start to finish, in order.",
        stage: { kind: "flow", flow: "send-pipeline" },
      },
    ]);

    const patched = expectApplied(
      [
        { op: "remove_node", id: "process-broadcast" },
        { op: "remove_node", id: "send-single-email" },
      ],
      graph,
    );

    expect(patched.views[0]?.children.map(({ id }) => id)).not.toContain("retired-path");
    expect(stepIds(patched)).toEqual(["overview", "pipeline"]);
  });

  it("keeps a tour cut to two steps", () => {
    const graph = withSteps([
      { id: "one", heading: "One", body: "The first stop.", stage: { kind: "view", view: "overview" } },
      { id: "two", heading: "Two", body: "The second stop.", stage: { kind: "view", view: "overview" } },
      {
        id: "three",
        heading: "Three",
        body: "The third stop.",
        stage: { kind: "flow", flow: "send-pipeline" },
      },
    ]);

    const patched = expectApplied([{ op: "remove_flow", id: "send-pipeline" }], graph);
    expect(stepIds(patched)).toEqual(["one", "two"]);
  });

  it("drops a tour cut below two steps, which is a caption rather than a walk", () => {
    const graph = withSteps([
      { id: "one", heading: "One", body: "The first stop.", stage: { kind: "view", view: "overview" } },
      {
        id: "two",
        heading: "Two",
        body: "The second stop.",
        stage: { kind: "flow", flow: "send-pipeline" },
      },
    ]);

    const patched = expectApplied([{ op: "remove_flow", id: "send-pipeline" }], graph);
    expect(patched.walkthrough).toBeUndefined();
  });

  /**
   * Two flows, each carrying a step called `shared`. Flow step ids are only
   * unique within their own flow, so this document is valid, and a tour of it
   * can only be pruned by asking which flow the stage draws.
   */
  const sharedStepIds = (): GraphDoc =>
    parseGraphDoc({
      ...postmarkRefactorGraphInput,
      views: [],
      flows: [
        {
          id: "first",
          title: "First",
          participants: [{ node: "queue-route" }, { node: "broadcast-queue" }, { node: "send-broadcast-bulk" }],
          messages: [
            { id: "shared", from: "queue-route", to: "broadcast-queue", label: "enqueue", delta: "added" },
            { id: "keep", from: "broadcast-queue", to: "send-broadcast-bulk", label: "trigger", delta: "added" },
          ],
        },
        {
          id: "second",
          title: "Second",
          participants: [{ node: "broadcast-queue" }, { node: "postmark" }],
          messages: [
            { id: "shared", from: "broadcast-queue", to: "postmark", label: "post", delta: "added" },
          ],
        },
      ],
      walkthrough: {
        steps: [
          {
            id: "over-first",
            heading: "Over the first flow",
            body: "Two of its steps.",
            stage: { kind: "flow", flow: "first" },
            focus: { kind: "selection", messages: ["shared", "keep"] },
          },
          {
            id: "over-second",
            heading: "Over the second flow",
            body: "All of it.",
            stage: { kind: "flow", flow: "second" },
          },
        ],
      },
    });

  it("measures a focused flow step against the flow on the stage, not the document", () => {
    const patched = expectApplied([{ op: "remove_node", id: "queue-route" }], sharedStepIds());
    const step = patched.walkthrough?.steps.find(({ id }) => id === "over-first");

    if (step?.focus.kind !== "selection") throw new Error("expected a selection focus");
    expect(step.focus.messages).toEqual(["keep"]);
    expect(graphIntegrityIssues(patched)).toEqual([]);
  });

  it("drops a step whose stage stops drawing the flow its focus came from", () => {
    const graph = parseGraphDoc({
      ...postmarkRefactorGraphInput,
      views: [
        {
          id: "both",
          title: "Both flows",
          lens: "data-flow",
          scope: { kind: "selection", flows: ["first", "second"] },
        },
      ],
      flows: [
        {
          id: "first",
          title: "First",
          participants: [{ node: "queue-route" }, { node: "broadcast-queue" }],
          messages: [
            { id: "only-in-first", from: "queue-route", to: "broadcast-queue", label: "enqueue", delta: "added" },
          ],
        },
        {
          id: "second",
          title: "Second",
          participants: [{ node: "broadcast-queue" }, { node: "postmark" }],
          messages: [
            { id: "only-in-second", from: "broadcast-queue", to: "postmark", label: "post", delta: "added" },
          ],
        },
      ],
      walkthrough: {
        steps: [
          {
            id: "the-first",
            heading: "The first flow",
            body: "One step of it.",
            stage: { kind: "view", view: "both" },
            focus: { kind: "selection", messages: ["only-in-first"] },
          },
          {
            id: "the-second",
            heading: "The second flow",
            body: "One step of it.",
            stage: { kind: "view", view: "both" },
            focus: { kind: "selection", messages: ["only-in-second"] },
          },
          {
            id: "everything",
            heading: "Everything",
            body: "Both flows at once.",
            stage: { kind: "view", view: "both" },
          },
        ],
      },
    });

    const patched = expectApplied([{ op: "remove_flow", id: "first" }], graph);

    expect(patched.views.map(({ id }) => id)).toEqual(["both"]);
    expect(stepIds(patched)).toEqual(["the-second", "everything"]);
  });

  it("prunes the steps an update takes out of a flow it rewrites", () => {
    const flow = postmarkRefactorGraph.flows[0]!;
    const patched = expectApplied([
      {
        op: "update_flow",
        id: "send-pipeline",
        patch: {
          messages: flow.messages.filter(
            ({ id }) => id !== "batch-post" && id !== "batch-results",
          ),
        },
      },
    ]);

    expect(stepIds(patched)).not.toContain("four-batch-calls");
    expect(graphIntegrityIssues(patched)).toEqual([]);
  });

  it("hands back a document whose walkthrough still points at what is left", () => {
    const patched = expectApplied([{ op: "remove_node", id: "postmark" }]);

    expect(graphIntegrityIssues(patched)).toEqual([]);
    expect(safeParseGraphDoc(patched).ok).toBe(true);
  });

  it("refuses to store a map that carries a walkthrough", () => {
    const issues = graphSnapshotIssues({
      ...broadcastBaselineGraph,
      walkthrough: {
        steps: [
          { id: "one", heading: "One", body: "The first stop.", focus: { kind: "all" } },
          { id: "two", heading: "Two", body: "The second stop.", focus: { kind: "all" } },
        ],
      },
    });

    expect(issues.map((issue) => issue.code)).toEqual(["NOT_A_SNAPSHOT"]);
    expect(issues[0]?.message).toContain("a walkthrough narrates a change");
  });
});

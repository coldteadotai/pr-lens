import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { broadcastBaselineGraph, goldenDocuments, postmarkRefactorGraph } from "../src/examples/index.js";
import { DELTAS } from "../src/primitives.js";
import { buildExamples, buildJsonSchemas } from "../scripts/artifacts.js";

const packageRoot = join(import.meta.dirname, "..");

describe("golden documents", () => {
  it("exercises every delta state", () => {
    const deltas = new Set(postmarkRefactorGraph.nodes.map((node) => node.delta));
    expect([...deltas].sort()).toEqual([...DELTAS].sort());
  });

  it("keeps the hero edge singular", () => {
    const hero = postmarkRefactorGraph.edges.filter((edge) => edge.emphasis === "hero");
    expect(hero.map((edge) => edge.id)).toEqual(["bulk-to-postmark"]);
    expect(hero[0]?.label).toBe("500 msgs/call");
  });

  it("models the send pipeline as an ordered four-participant flow", () => {
    const flow = postmarkRefactorGraph.flows.find(({ id }) => id === "send-pipeline");
    expect(flow?.participants.map((participant) => participant.node)).toEqual([
      "queue-route",
      "broadcast-queue",
      "send-broadcast-bulk",
      "postmark",
    ]);
    expect(flow?.messages.map((message) => message.id)).toEqual([
      "enqueue",
      "trigger",
      "suppressions-request",
      "suppressions-response",
      "batch-post",
      "batch-results",
      "write-results",
    ]);
    expect(flow?.messages.find(({ id }) => id === "batch-post")?.repeat).toBe(4);
    expect(flow?.messages.filter((message) => message.kind === "return")).toHaveLength(2);
  });

  it("declares both lenses across its drill-down tree", () => {
    const lenses = new Set(
      postmarkRefactorGraph.views.flatMap((view) => [
        view.lens,
        ...view.children.map((child) => child.lens),
      ]),
    );
    expect([...lenses].sort()).toEqual(["architecture", "data-flow"]);
  });

  it("describes a system rather than a change in the stored baseline", () => {
    const deltas = new Set([
      ...broadcastBaselineGraph.nodes.map((node) => node.delta),
      ...broadcastBaselineGraph.edges.map((edge) => edge.delta),
      ...broadcastBaselineGraph.flows.map((flow) => flow.delta),
    ]);
    expect([...deltas]).toEqual(["unchanged"]);
    expect(broadcastBaselineGraph.provenance.head.sha).toBe(
      broadcastBaselineGraph.provenance.base.sha,
    );
  });
});

describe("published artifacts", () => {
  it.each([...Object.keys(goldenDocuments)])("examples/%s is up to date", async (file) => {
    const onDisk = await readFile(join(packageRoot, "examples", file), "utf8");
    expect(onDisk).toBe(buildExamples().get(file));
  });

  it.each([...buildJsonSchemas().keys()])("json-schema/%s is up to date", async (file) => {
    const onDisk = await readFile(join(packageRoot, "json-schema", file), "utf8");
    expect(onDisk).toBe(buildJsonSchemas().get(file));
  });
});

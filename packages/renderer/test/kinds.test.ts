import { parseGraphDoc } from "@coldtea/pr-lens-schema";
import { describe, expect, it } from "vitest";
import { FLOW_MAX_PULSES_PER_MESSAGE } from "../src/design.js";
import { layoutDataFlow, MESSAGE_PITCH } from "../src/layout/dataflow.js";
import { render, THEMES } from "../src/index.js";
import { expectGolden } from "./goldens.js";
import { mixedKindsGraph } from "./mixed-kinds.js";

const flow = mixedKindsGraph.flows[0];
if (flow === undefined) throw new Error("mixed-kinds fixture lost its flow");

const layout = layoutDataFlow(mixedKindsGraph.flows, mixedKindsGraph.nodes, FLOW_MAX_PULSES_PER_MESSAGE);
const placedFlow = layout.flows[0];
if (placedFlow === undefined) throw new Error("mixed-kinds layout lost its flow");

const yOf = (id: string): number => {
  const placed = placedFlow.messages.find(({ message }) => message.id === id);
  if (placed === undefined) throw new Error(`no message '${id}' in the mixed-kinds fixture`);
  return placed.y;
};

const activationsOf = (node: string) => {
  const index = flow.participants.findIndex((participant) => participant.node === node);
  const participant = placedFlow.participants[index];
  if (participant === undefined) throw new Error(`no participant '${node}' in the mixed-kinds fixture`);
  return participant.activations;
};

describe("mixed message kinds", () => {
  for (const theme of THEMES) {
    it(`draws the mixed sync/async fixture, ${theme}`, () => {
      const { svg } = render(mixedKindsGraph, { lens: "data-flow", theme });
      expectGolden(`mixed-kinds.data-flow.${theme}.svg`, svg);
    });
  }

  const kindOnly = (kind: "sync" | "async") =>
    parseGraphDoc({
      ...JSON.parse(JSON.stringify(mixedKindsGraph)),
      flows: [
        {
          id: "one-call",
          title: "One call",
          participants: [{ node: "api" }, { node: "store" }],
          messages: [
            { id: "call", from: "api", to: "store", label: "call", kind, delta: "added" },
          ],
        },
      ],
    });

  it("draws sync and async differently, all else equal", () => {
    const sync = render(kindOnly("sync"), { lens: "data-flow", theme: "dark" }).svg;
    const async = render(kindOnly("async"), { lens: "data-flow", theme: "dark" }).svg;
    expect(sync).not.toBe(async);
  });

  it("gives a waited-on call the filled head and fire-and-forget the open one", () => {
    const sync = render(kindOnly("sync"), { lens: "data-flow", theme: "dark" }).svg;
    const async = render(kindOnly("async"), { lens: "data-flow", theme: "dark" }).svg;
    expect(sync).toContain('class="msg edge-added msg-strong" d="M');
    expect(sync).toContain('marker-end="url(#mk-added)"');
    expect(async).toContain('marker-end="url(#mko-added)"');
    expect(async).not.toContain('marker-end="url(#mk-added)"');
  });

  it("keeps a return dashed", () => {
    const { svg } = render(mixedKindsGraph, { lens: "data-flow", theme: "dark" });
    expect(svg).toContain('class="msg edge-modified msg-return"');
    expect(svg).toMatch(/\.msg-return\{stroke-dasharray/);
  });
});

describe("activation bars", () => {
  it("activates a sync receiver from the call to its answering return", () => {
    expect(activationsOf("worker")).toEqual([{ top: yOf("place-order"), bottom: yOf("confirm") }]);
    expect(activationsOf("store")).toContainEqual({ top: yOf("persist"), bottom: yOf("ack") });
  });

  it("holds an unanswered call's bar to the receiver's last involvement", () => {
    expect(activationsOf("store")).toContainEqual({
      top: yOf("warm"),
      bottom: yOf("warm") + MESSAGE_PITCH / 3,
    });
  });

  it("implies no activation for async or return messages", () => {
    expect(activationsOf("api")).toEqual([]);

    const auditY = yOf("audit");
    const notifyY = yOf("notify");
    expect(
      activationsOf("store").some((bar) => bar.top <= auditY && auditY <= bar.bottom),
    ).toBe(false);
    expect(
      activationsOf("worker").some((bar) => bar.top <= notifyY && notifyY <= bar.bottom),
    ).toBe(false);
  });

  it("stops a return's arrow at the bar it closes", () => {
    const { svg } = render(mixedKindsGraph, { lens: "data-flow", theme: "dark" });
    const worker = placedFlow.participants[1];
    if (worker === undefined) throw new Error("no worker column");
    // The bar spans the return's row, so the return departs from its edge.
    expect(svg).toContain(`M${worker.centreX - 6},${yOf("confirm")} L`);
  });
});

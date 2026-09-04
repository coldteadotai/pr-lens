import { minimalGraph, postmarkRefactorGraph } from "@coldtea/pr-lens-schema/examples";
import { describe, expect, it } from "vitest";
import { renderMermaid } from "../src/index.js";

describe("Mermaid projection", () => {
  it("projects one architecture view without pulling in nodes outside its scope", () => {
    const diagram = renderMermaid(postmarkRefactorGraph, {
      lens: "architecture",
      view: "new-batch-path",
    });

    expect(diagram).toMatch(/^flowchart LR\n/);
    expect(diagram).toContain('subgraph lane0["Cloud Functions / Firebase"]');
    expect(diagram).toContain("sendBroadcastBulk (added)");
    expect(diagram).toContain("500 msgs/call (added)");
    expect(diagram).not.toContain("processBroadcast");
    expect(diagram).not.toContain("animate");
  });

  it("projects a data-flow view in message order", () => {
    const diagram = renderMermaid(postmarkRefactorGraph, {
      lens: "data-flow",
      view: "send-pipeline-view",
    });

    expect(diagram).toMatch(/^sequenceDiagram\n/);
    expect(diagram).toContain('participant p0 as "queue route"');
    expect(diagram).toContain('participant p3 as "Postmark"');

    const enqueue = diagram.indexOf("enqueue broadcast job (modified)");
    const trigger = diagram.indexOf("onWrite trigger (added)");
    const response = diagram.indexOf("suppressed addresses (added)");
    expect(enqueue).toBeGreaterThan(-1);
    expect(trigger).toBeGreaterThan(enqueue);
    expect(response).toBeGreaterThan(trigger);
    expect(diagram).toContain("p3-->>p2: suppressed addresses (added)");
    expect(diagram).toContain("recipients; four for this 2,000-recipient broadcast.");
  });

  it("escapes labels before placing them in Mermaid syntax", () => {
    const diagram = renderMermaid(
      {
        ...minimalGraph,
        lanes: minimalGraph.lanes.map((lane) => ({ ...lane, label: 'API"] --> injected["' })),
        nodes: minimalGraph.nodes.map((node) => ({
          ...node,
          label: 'health | "unsafe" <node>',
        })),
      },
      { lens: "architecture" },
    );

    expect(diagram).not.toContain('"] --> injected["');
    expect(diagram).not.toContain('"unsafe"');
    expect(diagram).toContain("&quot;");
    expect(diagram).toContain("&#124;");
    expect(diagram).toContain("&lt;node&gt;");
  });

  it("is byte-for-byte deterministic", () => {
    const first = renderMermaid(postmarkRefactorGraph, {
      lens: "architecture",
      view: "overview",
    });
    const second = renderMermaid(postmarkRefactorGraph, {
      lens: "architecture",
      view: "overview",
    });

    expect(second).toBe(first);
  });
});

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Config, GraphDoc } from "@coldtea/pr-lens-schema";
import { parseConfig, parseGraphDoc } from "@coldtea/pr-lens-schema";
import { minimalGraph, postmarkRefactorGraph } from "@coldtea/pr-lens-schema/examples";
import { describe, expect, it } from "vitest";
import {
  applyCorrections,
  canonicalJson,
  contentHash,
  PrLensRenderError,
  RENDERER_NAME,
  RENDERER_VERSION,
  render,
  renderAssetFileName,
  renderAssetId,
  resolveScope,
} from "../src/index.js";
import { matchesGlob } from "../src/glob.js";
import { measure, truncate } from "../src/text.js";
import { TITLE_SIZE_MIN, TITLE_SIZE_SMALL } from "../src/design.js";

const corrections = (map: Partial<Config["map"]>): Config["map"] =>
  parseConfig({ schemaVersion: "0.1.0", map }).map;

describe("text measurement", () => {
  it("grows with the string", () => {
    expect(measure("mm", "sans", 13)).toBeGreaterThan(measure("ii", "sans", 13));
  });

  it("scales with the font size, to the hundredth it rounds to", () => {
    expect(measure("hello", "sans", 26)).toBeCloseTo(measure("hello", "sans", 13) * 2, 1);
  });

  it("gives the same answer every time", () => {
    expect(measure("sendBroadcastBulk", "sans-bold", 13)).toBe(
      measure("sendBroadcastBulk", "sans-bold", 13),
    );
  });

  it("charges every monospace character the same", () => {
    expect(measure("iiii", "mono", 10)).toBe(measure("mmmm", "mono", 10));
  });
});

describe("truncation", () => {
  it("leaves a string that fits alone", () => {
    expect(truncate("short", "sans", 13, 500)).toBe("short");
  });

  it("fits what it returns inside the room it was given", () => {
    const shortened = truncate("getSuppressedEmailsForBroadcast", "sans-bold", 13, 80);
    expect(shortened.endsWith("…")).toBe(true);
    expect(measure(shortened, "sans-bold", 13)).toBeLessThanOrEqual(80);
  });

  it("does not split a character in two", () => {
    expect([...truncate("🐢🐢🐢🐢🐢🐢", "sans", 13, 20)]).not.toContain("�");
  });

  it("gives back an ellipsis when there is room for nothing else", () => {
    expect(truncate("anything", "sans", 13, 1)).toBe("…");
  });
});

describe("fitting a title to its card", () => {
  const pairedLane = (...labels: readonly string[]): GraphDoc =>
    parseGraphDoc({
      ...minimalGraph,
      nodes: labels.map((label, index) => ({
        id: `n${index}`,
        label,
        kind: "service",
        delta: "modified",
        lane: "api",
        files: [],
        badges: [],
      })),
    });

  /** The `font-size` every card title was set at, in the order they are drawn. */
  const titleSizes = (svg: string): number[] =>
    [...svg.matchAll(/class="ntitle"[^>]*font-size="([\d.]+)"/g)].map((match) =>
      Number(match[1]),
    );

  it("sets a name that overruns its card a step smaller rather than cutting it", () => {
    const { svg } = render(pairedLane("Cancellations Service", "Billing"), {
      lens: "architecture",
      theme: "dark",
    });

    expect(svg).toContain("Cancellations Service");
    expect(svg).not.toContain("…");
    expect(titleSizes(svg)[0]).toBeLessThan(TITLE_SIZE_SMALL);
  });

  it("leaves a name that already fits at the size its card earned", () => {
    const { svg } = render(pairedLane("Billing", "Search"), {
      lens: "architecture",
      theme: "dark",
    });

    expect(titleSizes(svg)).toEqual([TITLE_SIZE_SMALL, TITLE_SIZE_SMALL]);
  });

  it("cuts a name that is still too long at the smallest size it may be set", () => {
    const { svg } = render(
      pairedLane("Cancellations and Refunds Reconciliation Service", "Billing"),
      { lens: "architecture", theme: "dark" },
    );

    expect(svg).toContain("…");
    expect(titleSizes(svg)[0]).toBe(TITLE_SIZE_MIN);
  });
});

describe("selector globs", () => {
  it("matches a literal path", () => {
    expect(matchesGlob("src/index.ts", "src/index.ts")).toBe(true);
  });

  it("keeps a single star inside one segment", () => {
    expect(matchesGlob("src/*.ts", "src/index.ts")).toBe(true);
    expect(matchesGlob("src/*.ts", "src/deep/index.ts")).toBe(false);
  });

  it("lets a double star cross directories", () => {
    expect(matchesGlob("src/**/*.ts", "src/deep/nested/index.ts")).toBe(true);
  });

  it("treats regular expression syntax as literal text", () => {
    expect(matchesGlob("src/a+b.ts", "src/aaab.ts")).toBe(false);
    expect(matchesGlob("src/a+b.ts", "src/a+b.ts")).toBe(true);
  });
});

describe("map corrections", () => {
  it("renames by node id", () => {
    const corrected = applyCorrections(
      postmarkRefactorGraph,
      corrections({ rename: [{ match: "id:postmark", to: "Postmark (email)" }] }),
    );
    expect(corrected.nodes.find((node) => node.id === "postmark")?.label).toBe("Postmark (email)");
  });

  it("renames by the paths a node is backed by", () => {
    const corrected = applyCorrections(
      postmarkRefactorGraph,
      corrections({ rename: [{ match: "packages/broadcast-lib/**", to: "shared" }] }),
    );
    const renamed = corrected.nodes.filter((node) => node.label === "shared").map((node) => node.id);
    expect(renamed).toEqual(["build-bulk-payload", "get-suppressed-emails", "broadcast-lib"]);
  });

  it("takes every edge that touched an excluded node with it", () => {
    const corrected = applyCorrections(
      postmarkRefactorGraph,
      corrections({ exclude: ["id:postmark"] }),
    );
    expect(corrected.nodes.some((node) => node.id === "postmark")).toBe(false);
    expect(corrected.edges.some((edge) => edge.from === "postmark" || edge.to === "postmark")).toBe(
      false,
    );
  });

  it("drops a flow that lost too many participants to make sense", () => {
    const corrected = applyCorrections(
      postmarkRefactorGraph,
      corrections({ exclude: ["id:postmark", "id:broadcast-queue", "id:send-broadcast-bulk"] }),
    );
    expect(corrected.flows).toHaveLength(0);
  });

  it("takes a view's dangling ids out, and the view when nothing is left", () => {
    const corrected = applyCorrections(
      postmarkRefactorGraph,
      corrections({ exclude: ["id:process-broadcast", "id:send-single-email"] }),
    );
    const retired = corrected.views[0]?.children.find((view) => view.id === "retired-path");
    expect(retired).toBeUndefined();
  });

  it("moves a node into a lane the document never declared", () => {
    const corrected = applyCorrections(
      postmarkRefactorGraph,
      corrections({ lane: [{ match: "id:broadcast-lib", lane: "shared" }] }),
    );
    expect(corrected.lanes.some((lane) => lane.id === "shared" && lane.label === "shared")).toBe(
      true,
    );
    expect(corrected.nodes.find((node) => node.id === "broadcast-lib")?.lane).toBe("shared");
  });

  it("refuses to draw a document its own config emptied", () => {
    expect(() => applyCorrections(minimalGraph, corrections({ exclude: ["**"] }))).toThrowError(
      expect.objectContaining({ code: "NOTHING_TO_RENDER" }),
    );
  });

  it("is applied before layout when render is given a config", () => {
    const config = parseConfig({
      schemaVersion: "0.1.0",
      map: { rename: [{ match: "id:postmark", to: "Mailer" }] },
    });
    expect(render(postmarkRefactorGraph, { lens: "architecture", theme: "dark", config }).svg)
      .toContain("Mailer");
  });
});

describe("view scoping", () => {
  it("pulls in both ends of every edge it names", () => {
    const view = postmarkRefactorGraph.views[0]?.children.find(
      (child) => child.id === "retired-path",
    );
    const scoped = resolveScope(postmarkRefactorGraph, view?.scope ?? { kind: "all" });
    expect(scoped.nodes.map((node) => node.id)).toContain("broadcast-queue");
    expect(scoped.lanes.map((lane) => lane.id)).toEqual(["functions", "external"]);
  });

  it("draws exactly the edges a selection names", () => {
    const view = postmarkRefactorGraph.views[0]?.children.find(
      (child) => child.id === "retired-path",
    );
    const scoped = resolveScope(postmarkRefactorGraph, view?.scope ?? { kind: "all" });
    expect(scoped.edges.map((edge) => edge.id)).toEqual([
      "firestore-to-process",
      "process-to-single",
      "single-to-postmark",
    ]);
  });

  it("derives the edges when a selection names none", () => {
    const scoped = resolveScope(postmarkRefactorGraph, {
      kind: "selection",
      lanes: [],
      nodes: ["send-broadcast-bulk", "postmark"],
      edges: [],
      flows: [],
    });
    expect(scoped.edges.map((edge) => edge.id)).toEqual(["bulk-to-postmark"]);
  });
});

describe("addresses", () => {
  it("hashes the same bytes to the same name", () => {
    expect(contentHash("<svg/>")).toBe(contentHash("<svg/>"));
    expect(contentHash("<svg/>")).not.toBe(contentHash("<svg />"));
    expect(contentHash("<svg/>")).toMatch(/^[0-9a-f]{32}$/);
  });

  it("sorts object keys before hashing a document", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("names an asset after its view, or its lens when there is no view", () => {
    expect(renderAssetId({ lens: "architecture", theme: "dark", view: "overview" })).toBe(
      "overview-dark",
    );
    expect(renderAssetId({ lens: "data-flow", theme: "light", view: undefined })).toBe(
      "data-flow-light",
    );
  });

  it("builds a file name from the id and the hash", () => {
    expect(
      renderAssetFileName({ lens: "architecture", theme: "dark", view: "overview" }, "abc123"),
    ).toBe("overview-dark-abc123.svg");
  });
});

describe("the version in the manifest", () => {
  it("matches the package it came from", () => {
    const manifestPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
    const pkg = parsed as { name: string; version: string };
    expect(RENDERER_NAME).toBe(pkg.name);
    expect(RENDERER_VERSION).toBe(pkg.version);
  });
});

describe("errors", () => {
  it("carries a code a caller can switch on", () => {
    const doc: GraphDoc = minimalGraph;
    try {
      render(doc, { lens: "data-flow", theme: "dark" });
      expect.unreachable("expected a refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(PrLensRenderError);
      if (error instanceof PrLensRenderError) expect(error.code).toBe("LENS_NOT_DECLARED");
    }
  });
});

describe("layout hints survive a correction", () => {
  it("lose the entries that named something the overlay removed", () => {
    const corrected = applyCorrections(
      postmarkRefactorGraph,
      corrections({ exclude: ["id:send-broadcast-bulk"] }),
    );
    expect(corrected.layout?.rank).toBeDefined();
    expect(Object.keys(corrected.layout?.rank ?? {})).not.toContain("send-broadcast-bulk");
  });

  it("leave a document the contract still accepts", () => {
    const corrected = applyCorrections(
      postmarkRefactorGraph,
      corrections({ exclude: ["id:send-broadcast-bulk", "id:postmark", "id:queue-route"] }),
    );
    expect(() => parseGraphDoc(JSON.parse(JSON.stringify(corrected)))).not.toThrow();
  });

  it("keep the entries that still name something", () => {
    const corrected = applyCorrections(postmarkRefactorGraph, corrections({}));
    expect(corrected.layout?.rank).toEqual(postmarkRefactorGraph.layout?.rank);
    expect(corrected.layout?.laneOrder).toEqual(postmarkRefactorGraph.layout?.laneOrder);
  });
});

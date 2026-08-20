import {
  broadcastBaselineGraph,
  minimalGraph,
  postmarkRefactorGraph,
} from "@coldtea/pr-lens-schema/examples";
import { parseRenderManifest } from "@coldtea/pr-lens-schema";
import { describe, expect, it } from "vitest";
import { PrLensRenderError, render, renderAll, THEMES } from "../src/index.js";
import { expectGolden } from "./goldens.js";

describe("golden renders", () => {
  for (const theme of THEMES) {
    it(`draws the reference pull request in the architecture lens, ${theme}`, () => {
      const { svg } = render(postmarkRefactorGraph, { lens: "architecture", theme, view: "overview" });
      expectGolden(`postmark-refactor.architecture.${theme}.svg`, svg);
    });

    it(`draws the reference pull request in the data-flow lens, ${theme}`, () => {
      const { svg } = render(postmarkRefactorGraph, {
        lens: "data-flow",
        theme,
        view: "send-pipeline-view",
      });
      expectGolden(`postmark-refactor.data-flow.${theme}.svg`, svg);
    });
  }

  it("draws a drill-down section on its own", () => {
    const { svg } = render(postmarkRefactorGraph, {
      lens: "architecture",
      theme: "dark",
      view: "new-batch-path",
    });
    expectGolden("postmark-refactor.new-batch-path.dark.svg", svg);
  });

  it("draws a diagram where nothing changed", () => {
    const { svg } = render(broadcastBaselineGraph, { lens: "architecture", theme: "dark" });
    expectGolden("broadcast-baseline.architecture.dark.svg", svg);
  });

  it("draws a single node", () => {
    const { svg } = render(minimalGraph, { lens: "architecture", theme: "light" });
    expectGolden("minimal.architecture.light.svg", svg);
  });
});

describe("the rendered document", () => {
  const { svg } = render(postmarkRefactorGraph, { lens: "architecture", theme: "dark" });

  it("is self-contained", () => {
    expect(svg).not.toMatch(/<script/i);
    expect(svg).not.toMatch(/<image/i);
    expect(svg).not.toMatch(/href/i);
    expect(svg).not.toMatch(/@import|url\(\s*['"]?https?:/i);
    expect(svg).not.toMatch(/var\(--/);
    expect(svg.match(/https?:\/\/[^"]*/g)).toEqual(["http://www.w3.org/2000/svg"]);
  });

  it("animates with SMIL rather than script", () => {
    expect(svg).toContain("<animateMotion");
  });

  it("declares its own size", () => {
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 \d/);
  });

  it("escapes text that would otherwise close a tag", () => {
    const hostile = {
      ...postmarkRefactorGraph,
      title: '</svg><script>alert("x")</script>',
      nodes: postmarkRefactorGraph.nodes.map((node, index) =>
        index === 0 ? { ...node, label: "a < b & c" } : node,
      ),
    };
    const drawn = render(hostile, { lens: "architecture", theme: "dark" }).svg;
    expect(drawn).not.toContain("<script>");
    expect(drawn).toContain("a &lt; b &amp; c");
  });
});

describe("refusals", () => {
  it("names a view it cannot find", () => {
    expect(() => render(postmarkRefactorGraph, { lens: "architecture", theme: "dark", view: "nope" }))
      .toThrowError(expect.objectContaining({ code: "UNKNOWN_VIEW" }));
  });

  it("refuses a lens the document does not declare", () => {
    expect(() => render(minimalGraph, { lens: "data-flow", theme: "dark" })).toThrowError(
      expect.objectContaining({ code: "LENS_NOT_DECLARED" }),
    );
  });

  it("refuses the data-flow lens with no flow in scope", () => {
    expect(() =>
      render(postmarkRefactorGraph, { lens: "data-flow", theme: "dark", view: "new-batch-path" }),
    ).toThrowError(expect.objectContaining({ code: "NO_FLOW_IN_SCOPE" }));
  });

  it("throws the renderer's own error type", () => {
    expect(() => render(minimalGraph, { lens: "data-flow", theme: "dark" })).toThrowError(
      PrLensRenderError,
    );
  });
});

describe("renderAll", () => {
  const { assets, manifest } = renderAll(postmarkRefactorGraph);

  it("renders every declared view in both themes", () => {
    expect(assets.map(({ asset }) => asset.id)).toEqual([
      "overview-light",
      "overview-dark",
      "new-batch-path-light",
      "new-batch-path-dark",
      "retired-path-light",
      "retired-path-dark",
      "send-pipeline-view-light",
      "send-pipeline-view-dark",
    ]);
  });

  it("addresses every asset by the hash of its own bytes", () => {
    for (const { asset, svg } of assets) {
      expect(asset.bytes).toBe(Buffer.byteLength(svg, "utf8"));
      expect(asset.path).toBe(`${asset.id}-${asset.contentHash}.svg`);
    }
  });

  it("falls back to one diagram per lens when there are no views", () => {
    const { assets: bare } = renderAll({ ...postmarkRefactorGraph, views: [] });
    expect(bare.map(({ asset }) => asset.id)).toEqual([
      "architecture-light",
      "architecture-dark",
      "data-flow-light",
      "data-flow-dark",
    ]);
  });

  it("skips the data-flow lens when the document carries no flow", () => {
    const { assets: bare } = renderAll({
      ...postmarkRefactorGraph,
      views: [],
      flows: [],
    });
    expect(bare.map(({ asset }) => asset.lens)).toEqual(["architecture", "architecture"]);
  });

  it("produces a manifest the contract accepts", () => {
    expect(() => parseRenderManifest(JSON.parse(JSON.stringify(manifest)))).not.toThrow();
    expect(manifest.graph.contentHash).toMatch(/^[0-9a-f]{32}$/);
    expect(manifest.assets).toHaveLength(assets.length);
  });
});

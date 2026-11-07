import { parseGraphDoc, type GraphDoc, type GraphDocInput } from "@coldtea/pr-lens-schema";
import { billingOrgGraph, minimalGraph, postmarkRefactorGraph } from "@coldtea/pr-lens-schema/examples";
import { describe, expect, it } from "vitest";
import { planTiles, render, renderAll, renderWalkthroughEmbed, THEME_PAIR } from "../src/index.js";
import { expectGolden } from "./goldens.js";
import { fixture } from "./tiers.js";

/** PR #124 of pr-lens-app: three architecture views, one flow on its own, six steps that skip the second view. */
const pr124 = fixture("pr-124.graph.json");

const embedOf = (doc: GraphDoc, theme: "light" | "dark") => {
  const result = renderWalkthroughEmbed(doc, { theme });
  if (result.type !== "rendered") throw new Error(`expected an embed, got ${JSON.stringify(result)}`);
  return result.embed;
};

describe("the walkthrough embed", () => {
  for (const theme of THEME_PAIR) {
    it(`plays pull request 124's tour, ${theme}`, () => {
      expectGolden(`pr-124.walkthrough.${theme}.svg`, embedOf(pr124, theme).svg);
    });

    it(`draws the same bytes twice, ${theme}`, () => {
      expect(embedOf(pr124, theme).svg).toBe(embedOf(pr124, theme).svg);
    });
  }

  it("is one picture per half of the pair, 870 wide, with the alert above a 340 stage", () => {
    const embed = embedOf(pr124, "dark");
    expect(embed.width).toBe(870);
    // Two body lines on the longest caption: 86 of alert, 16 of gap, 340 of stage.
    expect(embed.height).toBe(86 + 16 + 340);
    expect(embed.steps).toBe(6);
    expect(embed.svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 870 442"/);
    expect(embed.svg).toContain('aria-label="Walkthrough of Per-seat billing replaces metered credits, in six steps"');
  });

  it("says nothing for a document with no walkthrough", () => {
    expect(renderWalkthroughEmbed(minimalGraph, { theme: "dark" })).toEqual({ type: "absent" });
    expect(renderAll(minimalGraph).walkthrough).toEqual({ type: "absent" });
    expect(renderAll(minimalGraph).manifest.walkthrough).toEqual([]);
  });

  it("carries only the tiles the tour visits", () => {
    const { svg } = embedOf(pr124, "dark");
    // Four tiles are planned; the tour never stops on the seat admission view.
    expect(svg).toContain('<svg x="0" y="40"');
    expect(svg).not.toContain('<svg x="1870" y="40"');
    expect(svg).toContain('<svg x="3391" y="40"');
    expect(svg).toContain('<svg x="4413" y="40"');
  });

  it("nests each tile as its painting alone, under one copy of the markers", () => {
    const { svg } = embedOf(pr124, "dark");
    expect(svg.match(/ id="mk-added"/g)).toHaveLength(1);
    expect(svg).toContain('marker-end="url(#mk-added)"');
    expect(svg).not.toContain('id="dots"');
    expect(svg).not.toContain('rx="12" fill="#0d1117"');
    expect(svg).not.toContain("<title>");
    expect(svg).not.toContain("<desc>");
  });

  it("takes a tile the caller already drew instead of drawing it again", () => {
    const tile = render(pr124, { lens: "architecture", theme: "dark", view: "architecture-overview" });
    const marked = { ...tile, body: `<!--given-->${tile.body}` };
    const given = renderWalkthroughEmbed(pr124, { theme: "dark", tiles: new Map([["view:architecture-overview", marked]]) });
    expect(given.type === "rendered" && given.embed.svg).toContain("<!--given-->");
  });

  it("tunes the focus per theme: a dimmer mask on dark, a raised card on light", () => {
    const dark = embedOf(pr124, "dark").svg;
    const light = embedOf(pr124, "light").svg;
    expect(dark).toContain('fill="#fff" fill-opacity=".24"');
    expect(dark).not.toContain('id="lift"');
    expect(dark).toContain('stroke="rgba(230,237,243,.34)"');
    expect(light).toContain('fill="#fff" fill-opacity=".42"');
    expect(light).toContain('filter="url(#lift)"');
    expect(light).toContain('stroke="rgba(31,35,40,.5)"');
  });

  it("plays the tour twice and rests on its last step, which is also the reduced-motion still", () => {
    const { svg } = embedOf(pr124, "dark");
    expect(svg).toContain("animation-iteration-count:2");
    expect(svg.match(/<g class="a" style="animation-name:h\d" opacity="0">/g)).toHaveLength(5);
    expect(svg).toContain('<g class="a" style="animation-name:h5"><text');
    expect(svg).toContain("@media (prefers-reduced-motion: reduce){.a,.bar{animation:none!important}}");
    expect(svg).toContain(".moving{x:0.0px;y:0.0px;width:1708.0px;height:740.0px}");
  });

  it("is self-contained and script-free, as a comment image has to be", () => {
    const { svg } = embedOf(pr124, "light");
    expect(svg).not.toMatch(/<script/i);
    expect(svg).not.toMatch(/<image/i);
    expect(svg).not.toMatch(/href/i);
    expect(svg).not.toMatch(/@import|url\(\s*['"]?https?:/i);
  });

  it("wraps a long body onto two balanced lines and keeps a short one on one", () => {
    const { svg } = embedOf(pr124, "dark");
    expect(svg).toContain('y="52" font-size="16" fill="#f0f6fc">Users now choose between Essentials and Team with a</text>');
    expect(svg).toContain('y="74" font-size="16" fill="#f0f6fc">starting seat count rather than subscribing to metered credits.</text>');
    expect(svg).toContain(">Monthly spending caps and per-credit charges are deleted in favour of fixed seat counts.</text>");
  });

  it("refuses a tour pointing at something its stage does not draw, rather than guessing", () => {
    const doc = parseGraphDoc({
      ...JSON.parse(JSON.stringify(postmarkRefactorGraph)),
      walkthrough: {
        steps: [
          // The retired path draws only the two removed nodes, not the bulk sender.
          { id: "wrong", heading: "Pointing elsewhere", body: "A line.", stage: { kind: "view", view: "retired-path" }, focus: { kind: "selection", nodes: ["send-broadcast-bulk"] } },
          { id: "fine", heading: "The whole thing", body: "A line.", focus: { kind: "all" } },
        ],
      },
    });
    expect(renderWalkthroughEmbed(doc, { theme: "dark" })).toMatchObject({
      type: "unresolvable",
      issues: [{ code: "FOCUS_NOT_DRAWN", stepId: "wrong" }],
    });
    expect(renderAll(doc).walkthrough.type).toBe("unresolvable");
    expect(renderAll(doc).manifest.walkthrough).toEqual([]);
  });
});

describe("renderAll and the walkthrough", () => {
  it("lists the embed beside the view assets, one per half of the pair", () => {
    const { walkthrough, manifest } = renderAll(postmarkRefactorGraph);
    expect(walkthrough.type).toBe("rendered");
    const steps = postmarkRefactorGraph.walkthrough?.steps.length;
    expect(manifest.walkthrough.map((asset) => [asset.id, asset.theme, asset.steps])).toEqual([
      ["walkthrough-light", "light", steps],
      ["walkthrough-dark", "dark", steps],
    ]);
    for (const asset of manifest.walkthrough) {
      expect(asset.path).toBe(`${asset.id}-${asset.contentHash}.svg`);
      expect(asset.width).toBe(870);
    }
  });

  it("gives a neutral render no embed, since the embed has no page of its own to sit on", () => {
    const { walkthrough, manifest } = renderAll(postmarkRefactorGraph, { themes: ["neutral"] });
    expect(walkthrough).toEqual({ type: "absent" });
    expect(manifest.walkthrough).toEqual([]);
  });

  it("renders the embed in the one theme a single-theme render asked for", () => {
    const { manifest } = renderAll(postmarkRefactorGraph, { themes: ["dark"] });
    expect(manifest.walkthrough.map((asset) => asset.theme)).toEqual(["dark"]);
  });
});

describe("a tour through the data model", () => {
  const withModelView = (): GraphDoc => {
    const base: GraphDocInput = JSON.parse(JSON.stringify(billingOrgGraph));
    const table = base.dataModel?.tables[0]?.id;
    if (table === undefined) throw new Error("the billing example carries a data model");
    return parseGraphDoc({
      ...base,
      views: [...(base.views ?? []), { id: "model", title: "The model", lens: "data-model" }],
      walkthrough: {
        steps: [
          { id: "whole-model", heading: "The tables this change touches", body: "Every table, with the keys between them.", stage: { kind: "view", view: "model" }, focus: { kind: "all" } },
          { id: "one-table", heading: "One table in particular", body: "The subscription row that now carries a seat count.", stage: { kind: "view", view: "model" }, focus: { kind: "selection", tables: [table] } },
          { id: "the-map", heading: "And the services around it", body: "The whole architecture, for the way out.", focus: { kind: "all" } },
        ],
      },
    });
  };

  it("plays over the data-model view, focusing a table by its drawn box", () => {
    const doc = withModelView();
    const result = renderWalkthroughEmbed(doc, { theme: "dark" });
    expect(result.type).toBe("rendered");
    expect(renderAll(doc).manifest.walkthrough.map((asset) => asset.steps)).toEqual([3, 3]);
  });

  it("draws the whole data model as a tile when the lens has no view of its own", () => {
    const { walkthrough, ...bare } = JSON.parse(JSON.stringify(billingOrgGraph)) as GraphDocInput;
    expect(walkthrough).toBeDefined();
    const doc = parseGraphDoc({ ...bare, views: [] });
    expect(planTiles(doc).map((tile) => tile.id)).toContain("lens:data-model");
  });
});

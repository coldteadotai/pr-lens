import { parseGraphDoc, type GraphDoc, type GraphDocInput } from "@coldtea/pr-lens-schema";
import { postmarkRefactorGraph } from "@coldtea/pr-lens-schema/examples";
import { describe, expect, it } from "vitest";
import {
  emptyAtlas,
  planTiles,
  renderFlow,
  resolveWalkthrough,
  stageOfTile,
  tileForStage,
  tileIdForFlow,
  tileIdForView,
  walkthroughRefusal,
  WHOLE_MAP_TILE_ID,
  type RenderAtlas,
  type ResolvedStep,
  type WalkthroughIssue,
  type WalkthroughResolution,
  type WalkthroughTile,
} from "../src/index.js";

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

const atlasOf = (over: Partial<RenderAtlas>): RenderAtlas => ({ ...emptyAtlas(), ...over });

const MAP_ATLAS = atlasOf({
  lanes: { web: box(0, 0, 400, 120) },
  nodes: { "queue-route": box(40, 40, 100, 60), "send-broadcast-bulk": box(200, 40, 100, 60) },
  edges: { "firestore-to-bulk": box(140, 60, 60, 20) },
});

const FLOW_ATLAS = atlasOf({
  messages: { "send-pipeline": { "batch-post": box(10, 100, 300, 38), "batch-results": box(10, 138, 300, 38) } },
});

const mapTile = (atlas: RenderAtlas | undefined): WalkthroughTile => ({
  id: WHOLE_MAP_TILE_ID,
  hero: true,
  ...(atlas === undefined ? {} : { atlas }),
});

const flowTile: WalkthroughTile = { id: tileIdForFlow("send-pipeline"), hero: false, atlas: FLOW_ATLAS };

const TILES: WalkthroughTile[] = [mapTile(MAP_ATLAS), flowTile];

type Step = NonNullable<GraphDocInput["walkthrough"]>["steps"][number];

const LINE = "One line under the heading, the same on every step here.";

const reference = (): GraphDocInput => JSON.parse(JSON.stringify(postmarkRefactorGraph));

const bare = (): GraphDocInput => {
  const { walkthrough, ...rest } = reference();
  return { ...rest, views: [] };
};

const docWith = (steps: Omit<Step, "body">[], over: Partial<GraphDocInput> = {}): GraphDoc =>
  parseGraphDoc({
    ...reference(),
    views: [],
    ...over,
    walkthrough: { steps: steps.map((step) => ({ ...step, body: LINE })) },
  });

const stepsOf = (resolution: WalkthroughResolution): ResolvedStep[] => {
  if (resolution.type !== "resolved") throw new Error(`expected a resolved walkthrough, got ${JSON.stringify(resolution)}`);
  return resolution.steps;
};

const twoSteps = (step: Omit<Step, "body">): Omit<Step, "body">[] => [
  step,
  { id: "closing", heading: "And that is the change", focus: { kind: "all" } },
];

describe("resolveWalkthrough", () => {
  it("says nothing about a document that carries no walkthrough", () => {
    const { walkthrough, ...rest } = reference();
    expect(walkthrough).toBeDefined();
    expect(resolveWalkthrough(parseGraphDoc(rest), TILES)).toEqual({ type: "absent" });
  });

  it("falls back to the picture the reader arrives on when a step names no stage", () => {
    const resolution = resolveWalkthrough(docWith(twoSteps({ id: "opening", heading: "Everything at once" })), TILES);

    expect(resolution).toEqual({
      type: "resolved",
      steps: [
        { id: "opening", heading: "Everything at once", body: LINE, tileId: WHOLE_MAP_TILE_ID, focus: { kind: "whole" } },
        { id: "closing", heading: "And that is the change", body: LINE, tileId: WHOLE_MAP_TILE_ID, focus: { kind: "whole" } },
      ],
    });
  });

  it("takes a view stage to that view's own tile", () => {
    const doc = docWith(twoSteps({ id: "drill", heading: "The new path", stage: { kind: "view", view: "inner" } }), {
      views: [{ id: "inner", title: "Inner", lens: "architecture", scope: { kind: "selection", nodes: ["queue-route"] } }],
    });
    const tiles: WalkthroughTile[] = [{ id: tileIdForView("inner"), hero: true, atlas: MAP_ATLAS }];

    expect(stepsOf(resolveWalkthrough(doc, tiles))[0]).toMatchObject({ id: "drill", tileId: tileIdForView("inner") });
  });

  it("takes a flow stage to that flow's own tile", () => {
    const doc = docWith(twoSteps({ id: "sequence", heading: "Start to finish", stage: { kind: "flow", flow: "send-pipeline" } }));

    expect(stepsOf(resolveWalkthrough(doc, TILES))[0]).toMatchObject({ id: "sequence", tileId: tileIdForFlow("send-pipeline") });
  });

  it("takes a flow stage to the data-flow view that draws it when the flow has no tile", () => {
    const doc = docWith(twoSteps({ id: "sequence", heading: "Start to finish", stage: { kind: "flow", flow: "send-pipeline" } }), {
      views: [{ id: "pipeline", title: "Pipeline", lens: "data-flow", scope: { kind: "selection", flows: ["send-pipeline"] } }],
    });
    const tiles: WalkthroughTile[] = [{ id: tileIdForView("pipeline"), hero: true, atlas: FLOW_ATLAS }];

    expect(stepsOf(resolveWalkthrough(doc, tiles))[0]).toMatchObject({ id: "sequence", tileId: tileIdForView("pipeline") });
  });

  it("refuses a stage the surface never drew", () => {
    const doc = docWith(twoSteps({ id: "sequence", heading: "Start to finish", stage: { kind: "flow", flow: "send-pipeline" } }));

    expect(resolveWalkthrough(doc, [mapTile(MAP_ATLAS)])).toEqual({
      type: "unresolvable",
      issues: [
        {
          code: "STAGE_NOT_ON_CANVAS",
          stepId: "sequence",
          detail: 'plays over flow "send-pipeline", which the canvas does not draw',
        },
      ],
    });
  });

  it("leaves a whole-diagram focus whole, and never asks for an atlas to do it", () => {
    const doc = docWith(twoSteps({ id: "opening", heading: "Everything at once", focus: { kind: "all" } }));

    expect(stepsOf(resolveWalkthrough(doc, [mapTile(undefined)]))[0]).toMatchObject({ id: "opening", focus: { kind: "whole" } });
  });

  it("unions the boxes of everything a selection names, with air around them", () => {
    const doc = docWith(
      twoSteps({
        id: "both-ends",
        heading: "Both ends of the call",
        focus: { kind: "selection", nodes: ["queue-route", "send-broadcast-bulk"], edges: ["firestore-to-bulk"] },
      }),
    );

    // 40..300 across and 40..100 down, with 16 units of air on every side.
    expect(stepsOf(resolveWalkthrough(doc, TILES))[0]?.focus).toEqual({ kind: "region", rect: box(24, 24, 292, 92) });
  });

  it("reads flow steps under the flow on the stage", () => {
    const doc = docWith(
      twoSteps({
        id: "two-rows",
        heading: "Two rows of the sequence",
        stage: { kind: "flow", flow: "send-pipeline" },
        focus: { kind: "selection", messages: ["batch-post", "batch-results"] },
      }),
    );

    expect(stepsOf(resolveWalkthrough(doc, TILES))[0]).toMatchObject({
      tileId: tileIdForFlow("send-pipeline"),
      focus: { kind: "region", rect: box(-6, 84, 332, 108) },
    });
  });

  it("refuses a selection naming something the diagram never drew", () => {
    const doc = docWith(twoSteps({ id: "missing", heading: "Where is it", focus: { kind: "selection", nodes: ["postmark"] } }));

    expect(resolveWalkthrough(doc, TILES)).toEqual({
      type: "unresolvable",
      issues: [
        { code: "FOCUS_NOT_DRAWN", stepId: "missing", detail: 'focuses node "postmark", which the diagram it plays over does not draw' },
      ],
    });
  });

  it("refuses a selection on a picture stored without its geometry", () => {
    const doc = docWith(twoSteps({ id: "no-atlas", heading: "Where is it", focus: { kind: "selection", nodes: ["queue-route"] } }));

    expect(resolveWalkthrough(doc, [mapTile(undefined)])).toMatchObject({
      type: "unresolvable",
      issues: [{ code: "ATLAS_MISSING", stepId: "no-atlas" }],
    });
  });

  it("reports every step that is wrong, in step order, and gives the same answer twice", () => {
    const doc = docWith([
      { id: "fine", heading: "This one is fine" },
      { id: "gone", heading: "This one is not", focus: { kind: "selection", nodes: ["postmark"] } },
      { id: "elsewhere", heading: "Nor this", stage: { kind: "flow", flow: "send-pipeline" }, focus: { kind: "selection", messages: ["write-results"] } },
    ]);

    const first = resolveWalkthrough(doc, TILES);
    expect(first).toEqual(resolveWalkthrough(doc, TILES));
    expect(first).toMatchObject({
      type: "unresolvable",
      issues: [
        { code: "FOCUS_NOT_DRAWN", stepId: "gone" },
        { code: "FOCUS_NOT_DRAWN", stepId: "elsewhere" },
      ],
    });
  });
});

describe("tiles and stages", () => {
  it("finds the tile a stage plays over, and the hero for no stage", () => {
    const doc = docWith(twoSteps({ id: "opening", heading: "Everything at once" }));
    expect(tileForStage(doc, undefined, TILES)?.id).toBe(WHOLE_MAP_TILE_ID);
    expect(tileForStage(doc, { kind: "flow", flow: "send-pipeline" }, TILES)?.id).toBe(tileIdForFlow("send-pipeline"));
    expect(tileForStage(doc, { kind: "view", view: "nowhere" }, TILES)).toBeUndefined();
  });

  it("reads a stage back out of a tile id", () => {
    expect(stageOfTile(tileIdForView("overview"))).toEqual({ kind: "view", view: "overview" });
    expect(stageOfTile(tileIdForFlow("send-pipeline"))).toEqual({ kind: "flow", flow: "send-pipeline" });
    expect(stageOfTile(WHOLE_MAP_TILE_ID)).toBeNull();
  });
});

describe("planTiles", () => {
  it("leads with the hero, then its drill-downs in tree order, then the data-flow views", () => {
    const tiles = planTiles(postmarkRefactorGraph);

    expect(tiles.map((tile) => tile.id)).toEqual([
      "view:overview",
      "view:new-batch-path",
      "view:retired-path",
      "view:send-pipeline-view",
    ]);
    expect(tiles.map((tile) => tile.hero)).toEqual([true, false, false, false]);
    expect(tiles.map((tile) => tile.lens)).toEqual(["architecture", "architecture", "architecture", "data-flow"]);
  });

  it("promotes the view the document opens on, wherever it sits in the tree", () => {
    const doc = parseGraphDoc({
      ...bare(),
      views: [
        {
          id: "root",
          title: "Root",
          lens: "architecture",
          children: [
            { id: "inner", title: "Inner", lens: "architecture", defaultOpen: true, scope: { kind: "selection", nodes: ["queue-route"] } },
          ],
        },
      ],
    });

    expect(planTiles(doc).map((tile) => [tile.id, tile.hero])).toEqual([
      ["view:inner", true],
      ["view:root", false],
      ["flow:send-pipeline", false],
    ]);
  });

  it("draws the whole map and one tile per flow for a document with no views", () => {
    const doc = parseGraphDoc(bare());
    const tiles = planTiles(doc);

    expect(tiles.map((tile) => [tile.id, tile.lens, tile.hero])).toEqual([
      [WHOLE_MAP_TILE_ID, "architecture", true],
      ["flow:send-pipeline", "data-flow", false],
    ]);
    expect(tiles[0]?.title).toBe(doc.title);
    expect(tiles[1]?.title).toBe(doc.flows[0]?.title);
  });

  it("draws one sequence on its own under the flow's own title", () => {
    const doc = parseGraphDoc(bare());
    const flow = doc.flows[0];
    if (flow === undefined) throw new Error("the reference document carries a flow");
    const { svg, atlas } = renderFlow(doc, flow, "dark");
    expect(svg).toContain(`<title>${flow.title}</title>`);
    expect(Object.keys(atlas.messages)).toEqual([flow.id]);
  });
});

describe("walkthroughRefusal", () => {
  const issue = (stepId: string): WalkthroughIssue => ({ code: "FOCUS_NOT_DRAWN", stepId, detail: "focuses nothing drawn" });

  it("names the first step that is wrong", () => {
    expect(walkthroughRefusal([issue("gone")])).toBe(
      'This document\'s walkthrough does not fit the diagrams it draws. Step "gone" focuses nothing drawn.',
    );
  });

  it("counts the other steps, and counts a step once however many things it names", () => {
    expect(walkthroughRefusal([issue("gone"), issue("gone"), issue("elsewhere")])).toContain("One other step has the same trouble.");
    expect(walkthroughRefusal([issue("a"), issue("b"), issue("c")])).toContain("2 other steps have the same trouble.");
  });
});

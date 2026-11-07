import type { Flow, GraphDoc, Lens, View } from "@coldtea/pr-lens-schema";
import { render, type RenderedSvg } from "../render.js";
import { flattenViews } from "../scope.js";
import type { Theme } from "../theme.js";
import { tileIdForFlow, tileIdForView, WHOLE_MAP_TILE_ID, WHOLE_MODEL_TILE_ID } from "./tile-ids.js";

/** The strip's tiles in order: hero, other architecture views, data-flow views, data-model views. */
export type TilePlan = {
  id: string;
  title: string;
  lens: Lens;
  hero: boolean;
  draw: (theme: Theme) => RenderedSvg;
};

const viewTile = (doc: GraphDoc, view: View, hero: boolean): TilePlan => ({
  id: tileIdForView(view.id),
  title: view.title,
  lens: view.lens,
  hero,
  draw: (theme) => render(doc, { lens: view.lens, theme, view: view.id }),
});

const wholeMapTile = (doc: GraphDoc): TilePlan => ({
  id: WHOLE_MAP_TILE_ID,
  title: doc.title,
  lens: "architecture",
  hero: true,
  draw: (theme) => render(doc, { lens: "architecture", theme }),
});

const flowTiles = (doc: GraphDoc): TilePlan[] =>
  doc.flows.map((flow) => ({
    id: tileIdForFlow(flow.id),
    title: flow.title,
    lens: "data-flow",
    hero: false,
    draw: (theme) => renderFlow(doc, flow, theme),
  }));

const wholeModelTile = (doc: GraphDoc): TilePlan => ({
  id: WHOLE_MODEL_TILE_ID,
  title: doc.title,
  lens: "data-model",
  hero: false,
  draw: (theme) => render(doc, { lens: "data-model", theme }),
});

export function planTiles(doc: GraphDoc): TilePlan[] {
  const placed = flattenViews(doc.views);

  const architecture = placed.filter((view) => view.lens === "architecture");
  const heroIndex = Math.max(architecture.findIndex((view) => view.defaultOpen), 0);
  const architectureTiles =
    architecture.length > 0
      ? [
          ...architecture.slice(heroIndex, heroIndex + 1).map((view) => viewTile(doc, view, true)),
          ...architecture.filter((_, index) => index !== heroIndex).map((view) => viewTile(doc, view, false)),
        ]
      : doc.lenses.includes("architecture")
        ? [wholeMapTile(doc)]
        : [];

  const dataFlow = placed.filter((view) => view.lens === "data-flow");
  const dataFlowTiles =
    dataFlow.length > 0
      ? dataFlow.map((view) => viewTile(doc, view, false))
      : doc.lenses.includes("data-flow")
        ? flowTiles(doc)
        : [];

  const dataModel = placed.filter((view) => view.lens === "data-model");
  const dataModelTiles =
    dataModel.length > 0
      ? dataModel.map((view) => viewTile(doc, view, false))
      : doc.lenses.includes("data-model") && doc.dataModel !== undefined
        ? [wholeModelTile(doc)]
        : [];

  const tiles = [...architectureTiles, ...dataFlowTiles, ...dataModelTiles];
  // A step without a stage plays over whatever leads the strip.
  return tiles.map((tile, index) => ({ ...tile, hero: index === 0 }));
}

/** The only view on the copy it is attached to, so a fixed id cannot collide. */
const FLOW_VIEW_ID = "pr-lens-flow";

/** One sequence on its own. The renderer narrows to a flow only through a view scoped to it. */
export function renderFlow(doc: GraphDoc, flow: Flow, theme: Theme): RenderedSvg {
  const scoped: GraphDoc = {
    ...doc,
    views: [
      {
        id: FLOW_VIEW_ID,
        title: flow.title,
        lens: "data-flow",
        ...(flow.summary === undefined ? {} : { summary: flow.summary }),
        scope: { kind: "selection", lanes: [], nodes: [], edges: [], flows: [flow.id], tables: [] },
        defaultOpen: false,
        children: [],
      },
    ],
  };

  return render(scoped, { lens: "data-flow", theme, view: FLOW_VIEW_ID });
}

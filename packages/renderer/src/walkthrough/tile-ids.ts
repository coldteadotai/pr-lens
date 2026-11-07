import type { StepStage } from "@coldtea/pr-lens-schema";

/** The one spelling of every tile id. Kept apart from the drawing so a browser can read one back. */
const VIEW_PREFIX = "view:";
const FLOW_PREFIX = "flow:";

export const tileIdForView = (viewId: string): string => `${VIEW_PREFIX}${viewId}`;
export const tileIdForFlow = (flowId: string): string => `${FLOW_PREFIX}${flowId}`;
export const WHOLE_MAP_TILE_ID = "lens:architecture";
export const WHOLE_MODEL_TILE_ID = "lens:data-model";

/** The stage a tile stands for. A whole lens drawn without a view has none. */
export function stageOfTile(tileId: string): StepStage | null {
  if (tileId.startsWith(VIEW_PREFIX)) return { kind: "view", view: tileId.slice(VIEW_PREFIX.length) };
  if (tileId.startsWith(FLOW_PREFIX)) return { kind: "flow", flow: tileId.slice(FLOW_PREFIX.length) };
  return null;
}

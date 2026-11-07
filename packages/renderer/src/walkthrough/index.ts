/** The walkthrough's pure half. Nothing here draws or touches node, so a browser bundle can import it. */
export {
  easeInOut,
  flightFor,
  frame,
  interpolateFlight,
  lerpRect,
  type Flight,
  type FlightPath,
  type FramingPolicy,
  type Stage,
  type Viewport,
} from "./camera.js";

export {
  CAPTION_ROOM,
  MAX_SCALE,
  MIN_SCALE,
  stripLayout,
  stripRect,
  TILE_GAP,
  tileRect,
  type Sized,
  type StripBox,
  type StripLayout,
} from "./layout.js";

export {
  resolveWalkthrough,
  tileForStage,
  walkthroughRefusal,
  type ResolvedFocus,
  type ResolvedStep,
  type WalkthroughIssue,
  type WalkthroughResolution,
  type WalkthroughTile,
} from "./resolve.js";

export { stageOfTile, tileIdForFlow, tileIdForView, WHOLE_MAP_TILE_ID, WHOLE_MODEL_TILE_ID } from "./tile-ids.js";

export type { Box } from "../geometry.js";
export type { RenderAtlas } from "../atlas.js";

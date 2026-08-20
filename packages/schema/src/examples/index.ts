import { parseConfig, parseGraphDoc, parsePatchDoc, parseRenderManifest } from "../validate.js";
import { broadcastBaselineGraphInput, broadcastBaselinePatchInput } from "./baseline.js";
import { minimalGraphInput } from "./minimal.js";
import {
  exampleConfigInput,
  postmarkRefactorGraphInput,
  postmarkRefactorManifestInput,
} from "./postmark-refactor.js";

export const postmarkRefactorGraph = parseGraphDoc(postmarkRefactorGraphInput);
export const postmarkRefactorManifest = parseRenderManifest(postmarkRefactorManifestInput);
export const broadcastBaselineGraph = parseGraphDoc(broadcastBaselineGraphInput);
export const broadcastBaselinePatch = parsePatchDoc(broadcastBaselinePatchInput);
export const exampleConfig = parseConfig(exampleConfigInput);
export const minimalGraph = parseGraphDoc(minimalGraphInput);

/** Every golden, keyed by the filename it is published under in `examples/`. */
export const goldenDocuments = {
  "postmark-refactor.graph.json": postmarkRefactorGraph,
  "postmark-refactor.render-manifest.json": postmarkRefactorManifest,
  "broadcast-baseline.graph.json": broadcastBaselineGraph,
  "broadcast-baseline.patch.json": broadcastBaselinePatch,
  "pr-lens.config.json": exampleConfig,
  "minimal.graph.json": minimalGraph,
} as const;

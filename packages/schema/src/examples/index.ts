import { parseConfig, parseGraphDoc, parsePatchDoc, parseRenderManifest } from "../validate.js";
import { minimalGraphInput } from "./minimal.js";
import {
  exampleConfigInput,
  postmarkRefactorGraphInput,
  postmarkRefactorManifestInput,
  postmarkRefactorPatchInput,
} from "./postmark-refactor.js";

export const postmarkRefactorGraph = parseGraphDoc(postmarkRefactorGraphInput);
export const postmarkRefactorPatch = parsePatchDoc(postmarkRefactorPatchInput);
export const postmarkRefactorManifest = parseRenderManifest(postmarkRefactorManifestInput);
export const exampleConfig = parseConfig(exampleConfigInput);
export const minimalGraph = parseGraphDoc(minimalGraphInput);

/** Every golden, keyed by the filename it is published under in `examples/`. */
export const goldenDocuments = {
  "postmark-refactor.graph.json": postmarkRefactorGraph,
  "postmark-refactor.patch.json": postmarkRefactorPatch,
  "postmark-refactor.render-manifest.json": postmarkRefactorManifest,
  "pr-lens.config.json": exampleConfig,
  "minimal.graph.json": minimalGraph,
} as const;

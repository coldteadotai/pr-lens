export { SCHEMA_VERSION, type SchemaVersion } from "./version.js";

export {
  Delta,
  DELTAS,
  FileRef,
  Id,
  Label,
  Lens,
  LENSES,
  SchemaVersionField,
  Sha,
  Summary,
} from "./primitives.js";

export {
  EdgeEmphasis,
  EdgeKind,
  Flow,
  FlowMessage,
  FlowParticipant,
  GraphDoc,
  GraphEdge,
  GraphNode,
  Lane,
  LayoutHints,
  MessageKind,
  NodeKind,
  Provenance,
  StatChip,
  Stats,
  View,
  ViewScope,
  type GraphDocInput,
  type ViewInput,
} from "./graph.js";

export {
  EdgePatch,
  FlowPatch,
  LanePatch,
  NodePatch,
  PatchDoc,
  PatchOp,
  PATCH_OPS,
  type PatchDocInput,
} from "./patch.js";

export { Config, MapCorrections, Selector, type ConfigInput } from "./config.js";

export { RenderAsset, RenderManifest, type RenderManifestInput } from "./manifest.js";

export {
  formatIssues,
  PrLensSchemaError,
  type Parsed,
  type SchemaErrorCode,
  type SchemaIssue,
} from "./errors.js";

export { graphIntegrityIssues } from "./integrity.js";

export {
  parseConfig,
  parseGraphDoc,
  parsePatchDoc,
  parseRenderManifest,
  safeParseConfig,
  safeParseGraphDoc,
  safeParsePatchDoc,
  safeParseRenderManifest,
} from "./validate.js";

export { applyPatch, applyPatchDoc } from "./apply.js";

export { assertNever } from "./utils.js";

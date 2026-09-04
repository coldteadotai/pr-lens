export { RENDERER_NAME, RENDERER_VERSION } from "./version.js";

export {
  render,
  renderAll,
  type RenderAllOptions,
  type RenderAllResult,
  type RenderedAsset,
  type RenderedSvg,
  type RenderOptions,
} from "./render.js";

export { PrLensRenderError, type RenderErrorCode } from "./errors.js";

export { paletteFor, THEMES, type Palette, type Theme } from "./theme.js";

export {
  buildManifest,
  canonicalJson,
  contentHash,
  CONTENT_HASH_LENGTH,
  graphContentHash,
  renderAssetFileName,
  renderAssetId,
  type AssetAddress,
} from "./manifest.js";

export { applyCorrections } from "./corrections.js";

export { renderMermaid, type MermaidRenderOptions } from "./mermaid.js";

export { findView, flattenViews, resolveScope, type ScopedGraph } from "./scope.js";

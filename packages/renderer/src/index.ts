export { RENDERER_NAME, RENDERER_VERSION } from "./version.js";

export { render, type RenderedSvg, type RenderOptions } from "./render.js";

export {
  renderAll,
  type RenderAllOptions,
  type RenderAllResult,
  type RenderedAsset,
  type RenderedWalkthrough,
  type RenderedWalkthroughs,
  type RenderThemes,
} from "./render-all.js";

export {
  EMBED_WIDTH,
  renderWalkthroughEmbed,
  walkthroughLabel,
  type WalkthroughEmbed,
  type WalkthroughEmbedOptions,
  type WalkthroughEmbedResult,
} from "./walkthrough/embed.js";

export { planTiles, renderFlow, type TilePlan } from "./walkthrough/tiles.js";

export * from "./walkthrough/index.js";

export { emptyAtlas, type RenderAtlas } from "./atlas.js";

export { PrLensRenderError, type RenderErrorCode } from "./errors.js";

export type { Box } from "./geometry.js";

export { isPairTheme, paletteFor, THEMES, THEME_PAIR, type PairTheme, type Palette, type Theme } from "./theme.js";

export {
  assetIdentity,
  buildManifest,
  canonicalJson,
  contentHash,
  CONTENT_HASH_LENGTH,
  graphContentHash,
  renderAssetFileName,
  renderAssetId,
  walkthroughAssetFileName,
  walkthroughAssetId,
  type AssetAddress,
} from "./manifest.js";

export { applyCorrections } from "./corrections.js";

export { findView, flattenViews, resolveScope, type ScopedGraph } from "./scope.js";

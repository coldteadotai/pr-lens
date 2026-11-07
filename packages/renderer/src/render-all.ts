import type {
  Config,
  GraphDoc,
  Lens,
  RenderAsset,
  RenderManifest,
  View,
  WalkthroughAsset,
} from "@coldtea/pr-lens-schema";
import { assertNever, MAX_RENDER_ASSETS } from "@coldtea/pr-lens-schema";
import { PrLensRenderError } from "./errors.js";
import {
  assetIdentity,
  buildManifest,
  renderAssetFileName,
  renderAssetId,
  walkthroughAssetFileName,
  walkthroughAssetId,
} from "./manifest.js";
import { prepare, render, type RenderedSvg } from "./render.js";
import { flattenViews } from "./scope.js";
import { isPairTheme, THEME_PAIR } from "./theme.js";
import {
  renderWalkthroughEmbed,
  type WalkthroughEmbed,
} from "./walkthrough/embed.js";
import type { WalkthroughIssue } from "./walkthrough/resolve.js";
import { tileIdForView } from "./walkthrough/tile-ids.js";

/** The pair, one half of it, or neutral. Never all three: the view cap assumes two assets per view. */
export type RenderThemes =
  | readonly ["light", "dark"]
  | readonly ["light"]
  | readonly ["dark"]
  | readonly ["neutral"];

export type RenderAllOptions = {
  config?: Config;
  /** The pair by default. */
  themes?: RenderThemes;
};

export type RenderedAsset = RenderedSvg & { asset: RenderAsset };

export type RenderedWalkthrough = WalkthroughEmbed & {
  asset: WalkthroughAsset;
};

/** `absent` for a neutral render too: the embed has no single-image form. */
export type RenderedWalkthroughs =
  | { type: "absent" }
  | { type: "unresolvable"; issues: WalkthroughIssue[] }
  | { type: "rendered"; assets: RenderedWalkthrough[] };

export type RenderAllResult = {
  assets: RenderedAsset[];
  walkthrough: RenderedWalkthroughs;
  manifest: RenderManifest;
};

/** Every drill-down section in every theme asked for, or one diagram per lens when there are none. */
export const renderAll = (
  doc: GraphDoc,
  options: RenderAllOptions = {},
): RenderAllResult => {
  const prepared = prepare(doc, options.config);
  const themes = options.themes ?? THEME_PAIR;

  const targets: { lens: Lens; view: View | undefined }[] =
    prepared.views.length > 0
      ? flattenViews(prepared.views)
          .filter((view) => prepared.lenses.includes(view.lens))
          .map((view) => ({ lens: view.lens, view }))
      : prepared.lenses
          .filter((lens) => {
            switch (lens) {
              case "architecture":
                return true;
              case "data-flow":
                return prepared.flows.length > 0;
              case "data-model":
                return prepared.dataModel !== undefined;
              default:
                return assertNever(lens, "Unhandled lens");
            }
          })
          .map((lens) => ({ lens, view: undefined }));

  // Only a hand-built document can reach this: the contract's cap is a refinement, which the type does not carry.
  if (targets.length * themes.length > MAX_RENDER_ASSETS)
    throw new PrLensRenderError(
      "TOO_MANY_ASSETS",
      `this document asks for ${targets.length * themes.length} pictures across ${targets.length} views ` +
        `and ${themes.length} themes, and a render manifest carries at most ${MAX_RENDER_ASSETS}`,
    );

  const assets: RenderedAsset[] = [];

  for (const target of targets)
    for (const theme of themes) {
      const rendered = render(prepared, {
        lens: target.lens,
        theme,
        view: target.view?.id,
      });
      const address = { lens: target.lens, theme, view: target.view?.id };
      const identity = assetIdentity(rendered.svg);

      assets.push({
        ...rendered,
        asset: {
          id: renderAssetId(address),
          lens: target.lens,
          theme,
          view: target.view?.id,
          mediaType: "image/svg+xml",
          ...identity,
          width: rendered.width,
          height: rendered.height,
          animated: rendered.animated,
          path: renderAssetFileName(address, identity.contentHash),
        },
      });
    }

  if (assets.length === 0)
    throw new PrLensRenderError(
      "NOTHING_TO_RENDER",
      "this document declares no renderable view",
    );

  const walkthrough = renderWalkthroughs(prepared, themes, assets);
  const walkthroughAssets =
    walkthrough.type === "rendered"
      ? walkthrough.assets.map(({ asset }) => asset)
      : [];

  return {
    assets,
    walkthrough,
    manifest: buildManifest(
      prepared,
      assets.map(({ asset }) => asset),
      walkthroughAssets,
    ),
  };
};

/** Hands the views just drawn to the embed, which then draws only flow and whole-model tiles. */
const renderWalkthroughs = (
  doc: GraphDoc,
  themes: RenderThemes,
  drawn: readonly RenderedAsset[],
): RenderedWalkthroughs => {
  const assets: RenderedWalkthrough[] = [];

  for (const theme of themes.filter(isPairTheme)) {
    const tiles = new Map(
      drawn.flatMap((asset) =>
        asset.theme === theme && asset.view !== undefined
          ? [[tileIdForView(asset.view), asset]]
          : [],
      ),
    );
    const result = renderWalkthroughEmbed(doc, { theme, tiles });
    switch (result.type) {
      case "absent":
      case "unresolvable":
        return result;
      case "rendered": {
        const identity = assetIdentity(result.embed.svg);
        assets.push({
          ...result.embed,
          asset: {
            id: walkthroughAssetId(theme),
            theme,
            mediaType: "image/svg+xml",
            ...identity,
            width: result.embed.width,
            height: result.embed.height,
            steps: result.embed.steps,
            path: walkthroughAssetFileName(theme, identity.contentHash),
          },
        });
        break;
      }
      default:
        return assertNever(result, "Unhandled walkthrough embed result");
    }
  }

  return assets.length === 0
    ? { type: "absent" }
    : { type: "rendered", assets };
};

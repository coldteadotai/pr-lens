import type { Config, GraphDoc, Lens, RenderAsset, RenderManifest, View, ViewScope } from "@coldtea/pr-lens-schema";
import { assertNever, MAX_RENDER_ASSETS } from "@coldtea/pr-lens-schema";
import { applyCorrections } from "./corrections.js";
import { PrLensRenderError } from "./errors.js";
import { buildManifest, contentHash, renderAssetFileName, renderAssetId } from "./manifest.js";
import { findView, flattenViews, resolveScope, type ScopedGraph } from "./scope.js";
import { paletteFor, THEMES, type Theme } from "./theme.js";
import { paintArchitecture } from "./svg/architecture.js";
import { paintDataFlow } from "./svg/dataflow.js";
import { svgDocument } from "./svg/document.js";

export type RenderOptions = {
  lens: Lens;
  theme: Theme;
  /** Id of the drill-down section to draw. Omitted renders the whole document. */
  view?: string;
  /** The repository's corrections, applied as an overlay before layout. */
  config?: Config;
};

export type RenderedSvg = {
  svg: string;
  width: number;
  height: number;
  lens: Lens;
  theme: Theme;
  view: string | undefined;
  animated: boolean;
};

const WHOLE_DOCUMENT: ViewScope = { kind: "all" };

const prepare = (doc: GraphDoc, config: Config | undefined): GraphDoc =>
  config === undefined ? doc : applyCorrections(doc, config.map);

const paint = (
  lens: Lens,
  graph: ScopedGraph,
  doc: GraphDoc,
  theme: Theme,
): { width: number; height: number; body: string; animated: boolean } => {
  const palette = paletteFor(theme);

  switch (lens) {
    case "architecture": {
      if (graph.nodes.length === 0)
        throw new PrLensRenderError("NOTHING_TO_RENDER", "no nodes are in scope for this view");
      const painting = paintArchitecture(graph, doc.layout, palette);
      return { ...painting, animated: graph.edges.some((edge) => edge.animated) };
    }
    case "data-flow": {
      if (graph.flows.length === 0)
        throw new PrLensRenderError("NO_FLOW_IN_SCOPE", "the data-flow lens needs a flow to draw");
      const painting = paintDataFlow(graph.flows, doc.nodes, palette);
      return {
        ...painting,
        animated: graph.flows.some((flow) => flow.messages.some((message) => message.animated)),
      };
    }
    default:
      return assertNever(lens, "Unhandled lens");
  }
};

/**
 * A schema-valid document in, one self-contained SVG out.
 *
 * Nothing here reads a clock, a file or a random number: the same document
 * and options produce the same bytes, on any machine, in any order. That is
 * what lets a render be addressed by its own hash, and what keeps a diagram
 * from rearranging itself between two pushes that barely changed anything.
 */
export const render = (doc: GraphDoc, options: RenderOptions): RenderedSvg => {
  const prepared = prepare(doc, options.config);

  if (!prepared.lenses.includes(options.lens))
    throw new PrLensRenderError(
      "LENS_NOT_DECLARED",
      `this document does not declare the '${options.lens}' lens`,
    );

  const view =
    options.view === undefined ? undefined : requireView(prepared.views, options.view);
  const scope = view?.scope ?? WHOLE_DOCUMENT;
  const graph = resolveScope(prepared, scope);

  const { width, height, body, animated } = paint(options.lens, graph, prepared, options.theme);

  const svg = svgDocument({
    width,
    height,
    palette: paletteFor(options.theme),
    title: view?.title ?? prepared.title,
    description: view?.summary ?? prepared.summary,
    body,
  });

  return { svg, width, height, lens: options.lens, theme: options.theme, view: view?.id, animated };
};

const requireView = (views: readonly View[], id: string): View => {
  const view = findView(views, id);
  if (view === undefined)
    throw new PrLensRenderError("UNKNOWN_VIEW", `this document has no view '${id}'`);
  return view;
};

export type RenderAllOptions = {
  config?: Config;
  /** Which halves of the theme pair to produce. Both, by default. */
  themes?: readonly Theme[];
};

export type RenderedAsset = RenderedSvg & { asset: RenderAsset };

export type RenderAllResult = {
  assets: RenderedAsset[];
  manifest: RenderManifest;
};

/**
 * Every drill-down section a comment will show, in both themes.
 *
 * A document with no sections still renders: it gets one diagram per lens it
 * declares, which is what a comment falls back to when extraction found
 * nothing worth splitting into a tree.
 */
export const renderAll = (doc: GraphDoc, options: RenderAllOptions = {}): RenderAllResult => {
  const prepared = prepare(doc, options.config);
  const themes = options.themes ?? THEMES;

  const targets: { lens: Lens; view: View | undefined }[] =
    prepared.views.length > 0
      ? flattenViews(prepared.views)
          .filter((view) => prepared.lenses.includes(view.lens))
          .map((view) => ({ lens: view.lens, view }))
      : prepared.lenses
          .filter((lens) => lens !== "data-flow" || prepared.flows.length > 0)
          .map((lens) => ({ lens, view: undefined }));

  /**
   * The contract caps a view tree at the number of views a two-theme render
   * fits inside a manifest, so a parsed document cannot reach this. A
   * hand-built one can: the cap lives in a refinement, and a refinement does
   * not survive into the inferred type. This is a postcondition on what is
   * about to be produced rather than a re-reading of what came in — the count
   * depends on how many themes the caller asked for, which no document knows.
   */
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
      const hash = contentHash(rendered.svg);

      assets.push({
        ...rendered,
        asset: {
          id: renderAssetId(address),
          lens: target.lens,
          theme,
          view: target.view?.id,
          mediaType: "image/svg+xml",
          contentHash: hash,
          bytes: Buffer.byteLength(rendered.svg, "utf8"),
          width: rendered.width,
          height: rendered.height,
          animated: rendered.animated,
          path: renderAssetFileName(address, hash),
        },
      });
    }

  if (assets.length === 0)
    throw new PrLensRenderError("NOTHING_TO_RENDER", "this document declares no renderable view");

  return { assets, manifest: buildManifest(prepared, assets.map(({ asset }) => asset)) };
};

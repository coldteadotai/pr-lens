import type { Config, GraphDoc, Lens, View, ViewScope } from "@coldtea/pr-lens-schema";
import { assertNever } from "@coldtea/pr-lens-schema";
import type { RenderAtlas } from "./atlas.js";
import { applyCorrections } from "./corrections.js";
import { PrLensRenderError } from "./errors.js";
import { findView, resolveScope, type ScopedGraph } from "./scope.js";
import { paletteFor, type Theme } from "./theme.js";
import { paintArchitecture } from "./svg/architecture.js";
import { paintDataFlow } from "./svg/dataflow.js";
import { paintDataModel } from "./svg/datamodel.js";
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
  /** The painting alone, for a document that nests this picture under its own defs and ground. */
  body: string;
  width: number;
  height: number;
  lens: Lens;
  theme: Theme;
  view: string | undefined;
  animated: boolean;
  /** Where every lane, node, edge and flow step of this picture landed. */
  atlas: RenderAtlas;
};

const WHOLE_DOCUMENT: ViewScope = { kind: "all" };

export const prepare = (doc: GraphDoc, config: Config | undefined): GraphDoc =>
  config === undefined ? doc : applyCorrections(doc, config.map);

const paint = (
  lens: Lens,
  graph: ScopedGraph,
  doc: GraphDoc,
  theme: Theme,
): { width: number; height: number; body: string; animated: boolean; atlas: RenderAtlas } => {
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
    case "data-model": {
      if (graph.tables.length === 0)
        throw new PrLensRenderError("NOTHING_TO_RENDER", "no tables are in scope for this view");
      return { ...paintDataModel(graph, palette), animated: false };
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

  const { width, height, body, animated, atlas } = paint(
    options.lens,
    graph,
    prepared,
    options.theme,
  );

  const svg = svgDocument({
    width,
    height,
    palette: paletteFor(options.theme),
    title: view?.title ?? prepared.title,
    description: view?.summary ?? prepared.summary,
    body,
  });

  return {
    svg,
    body,
    width,
    height,
    lens: options.lens,
    theme: options.theme,
    view: view?.id,
    animated,
    atlas,
  };
};

const requireView = (views: readonly View[], id: string): View => {
  const view = findView(views, id);
  if (view === undefined)
    throw new PrLensRenderError("UNKNOWN_VIEW", `this document has no view '${id}'`);
  return view;
};

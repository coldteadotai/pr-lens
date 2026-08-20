import { assertNever } from "@coldtea/pr-lens-schema";
import type { GraphDoc, Lens, RenderAsset, RenderManifest, View } from "@coldtea/pr-lens-schema";
import { PrLensCliError } from "./errors.js";

/**
 * How the comment is recognised on a second run, so a pull request keeps one
 * PR Lens comment instead of collecting one per push. Nothing else may spell
 * this string: a marker that drifts orphans every comment already posted.
 */
export const COMMENT_MARKER = "<!-- pr-lens -->";

const PROJECT_URL = "https://github.com/coldteadotai/pr-lens";
const COLDTEA_URL = "https://coldtea.ai";

export type CommentOptions = {
  graph: GraphDoc;
  manifest: RenderManifest;
  /** Prefix for assets the manifest records as local paths, e.g. a raw content URL. */
  assetBaseUrl: string | undefined;
  branding: boolean;
};

const escape = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/**
 * Model-authored prose, rendered as the words it is.
 *
 * Every string in the document was written by a model reading a diff, and a
 * pull request can carry whatever text an author likes into that diff. So
 * none of it may reach GitHub as markup: escaping the HTML is only half the
 * job, because markdown would still turn `[Security update](http://…)` into a
 * link that looks like ours. Each string therefore lands inside an HTML
 * element — inside one, markdown is not parsed at all — on a single line, so
 * a blank line cannot end the block and let the rest through.
 *
 * The zero-width space after an @ or a # is the last piece: those are matched
 * after markdown, on the rendered text, and would otherwise notify a person
 * or cross-link an issue on the say-so of a diff.
 */
const text = (value: string): string =>
  escape(value.replace(/\s+/g, " ").trim()).replace(/([@#])(?=[\w-])/g, "$1&#8203;");

const href = (asset: RenderAsset, assetBaseUrl: string | undefined): string => {
  if (asset.url !== undefined) return asset.url;
  if (asset.path === undefined || assetBaseUrl === undefined)
    throw new PrLensCliError(
      "USAGE",
      `asset '${asset.id}' is a local file, so the comment has nowhere to point`,
      "pass --asset-base-url with the location the rendered SVGs are published at",
    );

  return `${assetBaseUrl.replace(/\/+$/, "")}/${asset.path.replace(/^\/+/, "")}`;
};

type ThemePair = { light: RenderAsset | undefined; dark: RenderAsset | undefined };

const pairsByLens = (assets: readonly RenderAsset[]): Map<Lens, ThemePair> => {
  const pairs = new Map<Lens, ThemePair>();
  for (const asset of assets) {
    const pair = pairs.get(asset.lens) ?? { light: undefined, dark: undefined };
    pairs.set(asset.lens, { ...pair, [asset.theme]: asset });
  }
  return pairs;
};

/**
 * A `<picture>` is what makes one comment readable in both GitHub themes: the
 * dark source is swapped in by the browser, with the light asset as the `img`
 * every other reader — email, mobile, an old client — falls back to.
 *
 * The whole thing is a link to the image itself, because a comment column is
 * about 830 pixels wide and a diagram of a system with several lanes is
 * several times that. It arrives scaled to fit, which is right for scanning,
 * and one click gives a reader the size the labels were drawn at.
 */
const picture = (pair: ThemePair, alt: string, assetBaseUrl: string | undefined): string => {
  const fallback = pair.light ?? pair.dark;
  if (fallback === undefined) return "";

  const source = escape(href(fallback, assetBaseUrl));
  const image = `<img alt="${text(alt)}" src="${source}" width="${fallback.width}">`;

  const shown =
    pair.dark === undefined || pair.light === undefined
      ? image
      : [
          "<picture>",
          `  <source media="(prefers-color-scheme: dark)" srcset="${escape(href(pair.dark, assetBaseUrl))}">`,
          `  ${image}`,
          "</picture>",
        ].join("\n");

  return `<a href="${source}">${shown}</a>`;
};

const lensLabel = (lens: Lens): string => {
  switch (lens) {
    case "architecture":
      return "Architecture";
    case "data-flow":
      return "Data flow";
    default:
      return assertNever(lens, "Unhandled lens");
  }
};

const statsLine = (graph: GraphDoc): string => {
  const { stats } = graph;
  if (stats === undefined) return "";

  const chips = [
    stats.filesChanged === undefined
      ? undefined
      : `${stats.filesChanged} ${stats.filesChanged === 1 ? "file" : "files"}`,
    stats.additions === undefined ? undefined : `+${stats.additions}`,
    stats.deletions === undefined ? undefined : `−${stats.deletions}`,
    ...stats.chips.map((chip) => `${chip.label} ${chip.value}`),
  ].filter((chip): chip is string => chip !== undefined);

  return `<p>${chips.map((chip) => `<code>${text(chip)}</code>`).join(" · ")}</p>`;
};

const viewSection = (
  view: View,
  assets: Map<string, RenderAsset[]>,
  assetBaseUrl: string | undefined,
): string => {
  const own = assets.get(view.id) ?? [];
  const pair = pairsByLens(own).get(view.lens);

  const body = [
    view.summary === undefined ? "" : `<p>${text(view.summary)}</p>`,
    pair === undefined ? "" : picture(pair, view.title, assetBaseUrl),
    ...view.children.map((child) => viewSection(child, assets, assetBaseUrl)),
  ].filter((part) => part !== "");

  return [
    `<details${view.defaultOpen ? " open" : ""}>`,
    `<summary><b>${text(view.title)}</b></summary>`,
    "",
    ...body.flatMap((part) => [part, ""]),
    "</details>",
  ].join("\n");
};

/** Assets keyed by the view they belong to; the root render has no view. */
const ROOT = "";

const byView = (manifest: RenderManifest): Map<string, RenderAsset[]> => {
  const grouped = new Map<string, RenderAsset[]>();
  for (const asset of manifest.assets) {
    const key = asset.view ?? ROOT;
    grouped.set(key, [...(grouped.get(key) ?? []), asset]);
  }
  return grouped;
};

export const composeComment = (options: CommentOptions): string => {
  const { graph, manifest, assetBaseUrl, branding } = options;
  const assets = byView(manifest);
  const roots = pairsByLens(assets.get(ROOT) ?? []);

  const diagrams = graph.lenses.flatMap((lens) => {
    const pair = roots.get(lens);
    return pair === undefined ? [] : [picture(pair, `${graph.title} — ${lensLabel(lens)}`, assetBaseUrl)];
  });

  const footer = branding
    ? `<sub>◈ Rendered by <a href="${PROJECT_URL}">PR Lens</a> · from the team behind <a href="${COLDTEA_URL}">Coldtea</a></sub>`
    : "";

  return [
    COMMENT_MARKER,
    `<h3>${text(graph.title)}</h3>`,
    graph.summary === undefined ? "" : `<p>${text(graph.summary)}</p>`,
    statsLine(graph),
    ...diagrams,
    ...graph.views.map((view) => viewSection(view, assets, assetBaseUrl)),
    footer === "" ? "" : "---",
    footer,
  ]
    .filter((block) => block !== "")
    .join("\n\n")
    .concat("\n");
};

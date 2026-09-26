import {
  assertNever,
  surfaceFor,
  type CommentSurface,
  type MarkdownDialect,
  type Provider,
} from "@coldtea/pr-lens-schema";
import type { GraphDoc, Lens, RenderAsset, RenderManifest, View } from "@coldtea/pr-lens-schema";
import { PrLensCliError } from "./errors.js";

/**
 * How the comment is recognised on a second run, so a pull request keeps one
 * PR Lens comment instead of collecting one per push. Nothing else may spell
 * this string: a marker that drifts orphans every comment already posted.
 */
export const COMMENT_MARKER = "<!-- pr-lens -->";

/**
 * Bitbucket renders no HTML, and an HTML comment there risks appearing as
 * text. A link-reference definition is the markdown-native invisible line:
 * consumed by the renderer, still greppable in the source.
 */
const BITBUCKET_COMMENT_MARKER = "[pr-lens]: #pr-lens";

export const commentMarker = (target: Provider): string => {
  switch (target) {
    case "github":
    case "gitlab":
      return COMMENT_MARKER;
    case "bitbucket":
      return BITBUCKET_COMMENT_MARKER;
    default:
      return assertNever(target, "Unhandled provider");
  }
};

const PROJECT_URL = "https://github.com/coldteadotai/pr-lens";
const COLDTEA_URL = "https://coldtea.ai";

export type CommentOptions = {
  graph: GraphDoc;
  manifest: RenderManifest;
  /** Prefix for assets the manifest records as local paths, e.g. a raw content URL. */
  assetBaseUrl: string | undefined;
  branding: boolean;
  /** Which forge will render the comment. Defaults to GitHub, today's output. */
  target?: Provider;
};

const escape = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/**
 * Which characters, at the start of a rendered word, a forge turns into a
 * notification or a cross-link after markdown has run. GitHub reads @ and #;
 * GitLab additionally reads ! (merge requests), ~ (labels), % (milestones),
 * $ (snippets) and & (epics). The guard is a zero-width space after the
 * sigil, so a diff's say-so never pages a person or links an issue.
 */
const sigilsFor = (dialect: Exclude<MarkdownDialect, "python-markdown">): RegExp => {
  switch (dialect) {
    case "gfm":
      return /([@#])(?=[\w-])/g;
    // The lookahead runs on the escaped string, so a quoted reference like
    // ~"multi word" appears as ~&quot;… — matched as the entity.
    case "glfm":
      return /([@#!~%$])(?=[\w-]|&quot;)/g;
    default:
      return assertNever(dialect, "Unhandled dialect");
  }
};

/**
 * Model-authored prose, rendered as the words it is.
 *
 * Every string in the document was written by a model reading a diff, and a
 * pull request can carry whatever text an author likes into that diff. So
 * none of it may reach the forge as markup: escaping the HTML is only half
 * the job, because markdown would still turn `[Security update](http://…)`
 * into a link that looks like ours. Each string therefore lands inside an
 * HTML element — inside one, markdown is not parsed at all — on a single
 * line, so a blank line cannot end the block and let the rest through.
 *
 * The zero-width space after a reference sigil is the last piece: those are
 * matched after markdown, on the rendered text, and would otherwise notify a
 * person or cross-link an issue on the say-so of a diff. GitLab's & becomes
 * &amp; during escaping, so its guard runs on the entity.
 */
const text = (value: string, dialect: Exclude<MarkdownDialect, "python-markdown">): string => {
  const guarded = escape(value.replace(/\s+/g, " ").trim()).replace(sigilsFor(dialect), "$1&#8203;");
  return dialect === "glfm" ? guarded.replace(/&amp;(?=[\w-]|&quot;)/g, "&amp;&#8203;") : guarded;
};

/**
 * The same job for a forge that renders no HTML: there is no element to hide
 * inside, so every character Python-Markdown can act on is backslash-escaped
 * instead — its documented escapable set. What that set cannot cover is
 * broken with a zero-width space instead: doubled tildes (strikethrough via
 * the del extension), reference sigils, and an opening `<`, which is not
 * escapable and would otherwise hand a raw tag to whatever HTML subset the
 * forge's renderer lets through. An entity would risk rendering as text on
 * a forge that escapes ampersands, so the space is the literal character.
 */
const proseMd = (value: string): string =>
  value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\\`*_{}[\]()>#+\-.!]/g, "\\$&")
    .replace(/~~/g, "~\u200B~")
    .replace(/<(?=[A-Za-z/!?])/g, "<\u200B")
    .replace(/([@#])(?=[\w-])/g, "$1\u200B");

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

/** A bare markdown destination: the characters that would end or nest it are percent-encoded. */
const hrefMd = (asset: RenderAsset, assetBaseUrl: string | undefined): string =>
  href(asset, assetBaseUrl).replace(/[<>() ]/g, (found) => `%${found.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);

type ThemePair = {
  light: RenderAsset | undefined;
  dark: RenderAsset | undefined;
  neutral: RenderAsset | undefined;
};

const EMPTY_PAIR: ThemePair = { light: undefined, dark: undefined, neutral: undefined };

const pairsByLens = (assets: readonly RenderAsset[]): Map<Lens, ThemePair> => {
  const pairs = new Map<Lens, ThemePair>();
  for (const asset of assets) {
    const pair = pairs.get(asset.lens) ?? EMPTY_PAIR;
    pairs.set(asset.lens, { ...pair, [asset.theme]: asset });
  }
  return pairs;
};

/**
 * The one asset a single-image surface shows.
 *
 * `neutral` first, because it is the render made for exactly this and reads
 * on a light page and a dark one alike. Falling back to a half of the pair is
 * for a manifest rendered before neutral existed, or one rendered `--theme
 * light` by hand: better a diagram tuned for the wrong ground than no
 * diagram, but it is a fallback and not the intent.
 */
const single = (pair: ThemePair): RenderAsset | undefined =>
  pair.neutral ?? pair.light ?? pair.dark;

/**
 * A `<picture>` is what makes one comment readable in both GitHub themes: the
 * dark source is swapped in by the browser, with the light asset as the `img`
 * every other reader — email, mobile, an old client — falls back to.
 *
 * GitLab strips `picture` and `source`, so there one image stands alone
 * rather than trusting a sanitizer to unwrap gracefully — and that image is
 * the neutral render, which reads on either ground, instead of a half of the
 * pair that reads well on one.
 *
 * The whole thing is a link to the image itself, because a comment column is
 * about 830 pixels wide and a diagram of a system with several lanes is
 * several times that. It arrives scaled to fit, which is right for scanning,
 * and one click gives a reader the size the labels were drawn at.
 */
const picture = (
  pair: ThemePair,
  alt: string,
  assetBaseUrl: string | undefined,
  surface: HtmlSurface,
): string => {
  // A paired surface shows the light half as the `img` every non-swapping
  // client falls back to; a single-image surface shows the neutral render.
  const paired = surface.themeStrategy === "pair" && pair.light !== undefined && pair.dark !== undefined;
  const shownAsset = paired ? pair.light : single(pair);
  if (shownAsset === undefined) return "";

  const source = escape(href(shownAsset, assetBaseUrl));
  const image = `<img alt="${text(alt, surface.dialect)}" src="${source}" width="${shownAsset.width}">`;

  const shown =
    !paired || pair.dark === undefined
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

const statChips = (graph: GraphDoc): string[] => {
  const { stats } = graph;
  if (stats === undefined) return [];

  return [
    stats.filesChanged === undefined
      ? undefined
      : `${stats.filesChanged} ${stats.filesChanged === 1 ? "file" : "files"}`,
    stats.additions === undefined ? undefined : `+${stats.additions}`,
    stats.deletions === undefined ? undefined : `−${stats.deletions}`,
    ...stats.chips.map((chip) => `${chip.label} ${chip.value}`),
  ].filter((chip): chip is string => chip !== undefined);
};

const statsLine = (graph: GraphDoc, surface: HtmlSurface): string => {
  const chips = statChips(graph);
  if (chips.length === 0) return "";
  return `<p>${chips.map((chip) => `<code>${text(chip, surface.dialect)}</code>`).join(" · ")}</p>`;
};

const viewSection = (
  view: View,
  assets: Map<string, RenderAsset[]>,
  assetBaseUrl: string | undefined,
  surface: HtmlSurface,
): string => {
  const own = assets.get(view.id) ?? [];
  const pair = pairsByLens(own).get(view.lens);

  const body = [
    view.summary === undefined ? "" : `<p>${text(view.summary, surface.dialect)}</p>`,
    pair === undefined ? "" : picture(pair, view.title, assetBaseUrl, surface),
    ...view.children.map((child) => viewSection(child, assets, assetBaseUrl, surface)),
  ].filter((part) => part !== "");

  return [
    `<details${view.defaultOpen ? " open" : ""}>`,
    `<summary><b>${text(view.title, surface.dialect)}</b></summary>`,
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

/** The two HTML-rendering surfaces differ only in theme pairing and sigils. */
type HtmlSurface = {
  dialect: Exclude<MarkdownDialect, "python-markdown">;
  themeStrategy: CommentSurface["themeStrategy"];
};

const composeHtml = (
  options: CommentOptions,
  surface: HtmlSurface,
  marker: string,
  keptViews: number,
): string => {
  const { graph, manifest, assetBaseUrl, branding } = options;
  const assets = byView(manifest);
  const roots = pairsByLens(assets.get(ROOT) ?? []);

  const diagrams = graph.lenses.flatMap((lens) => {
    const pair = roots.get(lens);
    return pair === undefined
      ? []
      : [picture(pair, `${graph.title} — ${lensLabel(lens)}`, assetBaseUrl, surface)];
  });

  const omitted = graph.views.length - keptViews;
  const footer = branding
    ? `<sub>◈ Rendered by <a href="${PROJECT_URL}">PR Lens</a> · from the team behind <a href="${COLDTEA_URL}">Coldtea</a></sub>`
    : "";

  return [
    marker,
    `<h3>${text(graph.title, surface.dialect)}</h3>`,
    graph.summary === undefined ? "" : `<p>${text(graph.summary, surface.dialect)}</p>`,
    statsLine(graph, surface),
    ...diagrams,
    ...graph.views.slice(0, keptViews).map((view) => viewSection(view, assets, assetBaseUrl, surface)),
    omitted === 0
      ? ""
      : `<sub>${omitted} drill-down ${omitted === 1 ? "section" : "sections"} did not fit this comment.</sub>`,
    footer === "" ? "" : "---",
    footer,
  ]
    .filter((block) => block !== "")
    .join("\n\n")
    .concat("\n");
};

const diagramMd = (pair: ThemePair, alt: string, assetBaseUrl: string | undefined): string => {
  // With no HTML there is no theme pairing at all, so the neutral render is
  // the only one that serves a reader whichever theme they are in.
  const shown = single(pair);
  if (shown === undefined) return "";

  const source = hrefMd(shown, assetBaseUrl);
  return `[![${proseMd(alt)}](${source})](${source})`;
};

/** The drill-down tree flattened: with no collapsible to nest in, order carries the hierarchy. */
const viewSectionsMd = (
  views: readonly View[],
  assets: Map<string, RenderAsset[]>,
  assetBaseUrl: string | undefined,
): string[] =>
  views.flatMap((view) => {
    const pair = pairsByLens(assets.get(view.id) ?? []).get(view.lens);
    return [
      `**${proseMd(view.title)}**`,
      ...(view.summary === undefined ? [] : [proseMd(view.summary)]),
      ...(pair === undefined ? [] : [diagramMd(pair, view.title, assetBaseUrl)]),
      ...viewSectionsMd(view.children, assets, assetBaseUrl),
    ];
  });

const composeMarkdown = (options: CommentOptions, marker: string, keptViews: number): string => {
  const { graph, manifest, assetBaseUrl, branding } = options;
  const assets = byView(manifest);
  const roots = pairsByLens(assets.get(ROOT) ?? []);

  const diagrams = graph.lenses.flatMap((lens) => {
    const pair = roots.get(lens);
    return pair === undefined ? [] : [diagramMd(pair, `${graph.title} — ${lensLabel(lens)}`, assetBaseUrl)];
  });

  const chips = statChips(graph);
  const omitted = graph.views.length - keptViews;

  return [
    marker,
    `### ${proseMd(graph.title)}`,
    graph.summary === undefined ? "" : proseMd(graph.summary),
    chips.length === 0 ? "" : chips.map((chip) => proseMd(chip)).join(" · "),
    ...diagrams,
    ...viewSectionsMd(graph.views.slice(0, keptViews), assets, assetBaseUrl),
    omitted === 0
      ? ""
      : `*${omitted} drill-down ${omitted === 1 ? "section" : "sections"} did not fit this comment.*`,
    branding
      ? `*Rendered by [PR Lens](${PROJECT_URL}) · from the team behind [Coldtea](${COLDTEA_URL})*`
      : "",
  ]
    .filter((block) => block !== "")
    .join("\n\n")
    .concat("\n");
};

export const composeComment = (options: CommentOptions): string => {
  const target = options.target ?? "github";
  const surface = surfaceFor(target);
  const marker = commentMarker(target);

  const compose = (keptViews: number): string => {
    switch (surface.dialect) {
      case "gfm":
      case "glfm":
        return composeHtml(
          options,
          { dialect: surface.dialect, themeStrategy: surface.themeStrategy },
          marker,
          keptViews,
        );
      case "python-markdown":
        return composeMarkdown(options, marker, keptViews);
      default:
        return assertNever(surface.dialect, "Unhandled dialect");
    }
  };

  // A body over the forge's limit would be rejected outright, so trailing
  // drill-down sections are shed until it fits: the headline, the numbers and
  // the root diagrams are worth more than the deepest view.
  for (let keptViews = options.graph.views.length; ; keptViews -= 1) {
    const body = compose(keptViews);
    if (body.length <= surface.maxChars || keptViews === 0) return body;
  }
};

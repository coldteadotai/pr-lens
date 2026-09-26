import { parseGraphDoc, parseRenderManifest, type RenderManifestInput } from "@coldtea/pr-lens-schema";
import { minimalGraph, postmarkRefactorGraph, postmarkRefactorManifest } from "@coldtea/pr-lens-schema/examples";
import { expect, test } from "vitest";
import { COMMENT_MARKER, commentMarker, composeComment } from "../src/comment.js";

const localManifest = (assets: RenderManifestInput["assets"]) =>
  parseRenderManifest({
    schemaVersion: "0.1.0",
    kind: "render-manifest",
    graph: { contentHash: "6a1f0b8c7d2e4359" },
    renderer: { name: "@coldtea/pr-lens-renderer", version: "0.1.0" },
    assets,
  });

const asset = (overrides: Partial<RenderManifestInput["assets"][number]>) => ({
  id: "architecture-light",
  lens: "architecture" as const,
  theme: "light" as const,
  mediaType: "image/svg+xml" as const,
  contentHash: "0c9d2e6b1a4f7385",
  bytes: 4096,
  width: 1280,
  height: 720,
  path: "architecture-light.svg",
  ...overrides,
});

test("the comment opens with the marker that lets a second run find it", () => {
  const body = composeComment({
    graph: postmarkRefactorGraph,
    manifest: postmarkRefactorManifest,
    assetBaseUrl: undefined,
    branding: true,
  });

  expect(body.split("\n")[0]).toBe(COMMENT_MARKER);
  expect(body).toContain(postmarkRefactorGraph.title);
});

test("a light and a dark render become one picture, so both GitHub themes read", () => {
  const body = composeComment({
    graph: minimalGraph,
    manifest: localManifest([
      asset({}),
      asset({ id: "architecture-dark", theme: "dark", path: "architecture-dark.svg" }),
    ]),
    assetBaseUrl: "https://raw.githubusercontent.com/o/r/pr-lens/",
    branding: true,
  });

  expect(body).toContain('<source media="(prefers-color-scheme: dark)"');
  expect(body).toContain("https://raw.githubusercontent.com/o/r/pr-lens/architecture-dark.svg");
  expect(body).toContain('<img alt="Touch the health check — Architecture"');
});

test("a diagram wider than a comment column is one click from its full size", () => {
  const body = composeComment({
    graph: minimalGraph,
    manifest: localManifest([
      asset({}),
      asset({ id: "architecture-dark", theme: "dark", path: "architecture-dark.svg" }),
    ]),
    assetBaseUrl: "https://example.com/a",
    branding: true,
  });

  expect(body).toContain('<a href="https://example.com/a/architecture-light.svg"><picture>');
  expect(body).toContain("</picture></a>");
});

test("a single theme is an img, not a picture with one source", () => {
  const body = composeComment({
    graph: minimalGraph,
    manifest: localManifest([asset({})]),
    assetBaseUrl: "https://example.com/a",
    branding: true,
  });

  expect(body).not.toContain("<picture>");
  expect(body).toContain('src="https://example.com/a/architecture-light.svg"');
});

test("a local render with nowhere to point says which flag is missing", () => {
  expect(() =>
    composeComment({
      graph: minimalGraph,
      manifest: localManifest([asset({})]),
      assetBaseUrl: undefined,
      branding: true,
    }),
  ).toThrow(expect.objectContaining({ code: "USAGE" }));
});

test("branding is one line, and it comes off", () => {
  const options = {
    graph: postmarkRefactorGraph,
    manifest: postmarkRefactorManifest,
    assetBaseUrl: undefined,
  };

  expect(composeComment({ ...options, branding: true })).toContain("Rendered by");
  expect(composeComment({ ...options, branding: false })).not.toContain("Rendered by");
});

test("model-authored text cannot smuggle markup into the comment", () => {
  const graph = { ...minimalGraph, title: '<img src=x onerror="alert(1)">' };

  const body = composeComment({
    graph,
    manifest: localManifest([asset({})]),
    assetBaseUrl: "https://example.com/a",
    branding: true,
  });

  expect(body).not.toContain("<img src=x");
  expect(body).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
});

/**
 * Markdown is not parsed inside an HTML element, so the defence is structural:
 * every line carrying model-authored text has to be one.
 */
const linesCarrying = (body: string, needle: string): string[] =>
  body.split("\n").filter((line) => line.includes(needle));

const INJECTIONS = [
  ["a disguised link", "[Security update](https://attacker.example/phish)", "attacker.example"],
  ["an image", "![](https://attacker.example/tracker.png)", "attacker.example"],
  ["a code fence", "```\nrm -rf /\n```", "```"],
  ["a heading", "# Not our heading", "Not our heading"],
] as const;

test.each(INJECTIONS)("%s in a title never lands in a markdown context", (_what, payload, needle) => {
  const body = composeComment({
    graph: { ...minimalGraph, title: payload },
    manifest: localManifest([asset({})]),
    assetBaseUrl: "https://example.com/a",
    branding: true,
  });

  const carrying = linesCarrying(body, needle);
  expect(carrying.length).toBeGreaterThan(0);
  for (const line of carrying) expect(line.startsWith("<")).toBe(true);
});

test("a summary, a chip and a view are held to the same rule as the title", () => {
  const payload = "[click me](https://attacker.example) @ohansemmanuel";

  const body = composeComment({
    graph: {
      ...minimalGraph,
      summary: payload,
      stats: { chips: [{ label: payload, value: "1", tone: "neutral" }] },
      views: [
        {
          id: "v1",
          title: payload,
          lens: "architecture",
          summary: payload,
          scope: { kind: "all" },
          defaultOpen: false,
          children: [],
        },
      ],
    },
    manifest: localManifest([asset({})]),
    assetBaseUrl: "https://example.com/a",
    branding: true,
  });

  const carrying = linesCarrying(body, "attacker.example");
  expect(carrying).toHaveLength(4);
  for (const line of carrying) expect(line.startsWith("<")).toBe(true);
});

test("a mention in model prose does not notify the person it names", () => {
  const body = composeComment({
    graph: { ...minimalGraph, summary: "asked @ohansemmanuel about #12" },
    manifest: localManifest([asset({})]),
    assetBaseUrl: "https://example.com/a",
    branding: true,
  });

  expect(body).not.toContain("@ohansemmanuel");
  expect(body).not.toContain("#12");
  expect(body).toContain("@&#8203;ohansemmanuel");
  expect(body).toContain("#&#8203;12");
});

test("a newline in model prose cannot break out of the element that contains it", () => {
  const body = composeComment({
    graph: { ...minimalGraph, summary: "first line\n\n### heading that is not ours" },
    manifest: localManifest([asset({})]),
    assetBaseUrl: "https://example.com/a",
    branding: true,
  });

  expect(body).toContain("<p>first line ### heading that is not ours</p>");
});

test("the drill-down tree keeps its nesting and its open sections", () => {
  const body = composeComment({
    graph: postmarkRefactorGraph,
    manifest: postmarkRefactorManifest,
    assetBaseUrl: undefined,
    branding: true,
  });

  expect(body).toContain("<details open>");
  expect(body).toContain("<summary><b>The new batch path</b></summary>");
});

test("omitting the target composes exactly what github got before it existed", () => {
  const options = {
    graph: postmarkRefactorGraph,
    manifest: postmarkRefactorManifest,
    assetBaseUrl: undefined,
    branding: true,
  };

  expect(composeComment(options)).toBe(composeComment({ ...options, target: "github" }));
});

test("gitlab never receives a picture element, only one image", () => {
  const body = composeComment({
    graph: minimalGraph,
    manifest: localManifest([
      asset({}),
      asset({ id: "architecture-dark", theme: "dark", path: "architecture-dark.svg" }),
    ]),
    assetBaseUrl: "https://example.com/a",
    branding: true,
    target: "gitlab",
  });

  expect(body).not.toContain("<picture>");
  expect(body).not.toContain("prefers-color-scheme");
  expect(body).toContain('src="https://example.com/a/architecture-light.svg"');
  expect(body.split("\n")[0]).toBe(COMMENT_MARKER);
});

test("gitlab reference sigils in model prose are disarmed like mentions", () => {
  const body = composeComment({
    graph: { ...minimalGraph, summary: "see !42 and ~bug and %v1 and $9 and &epic1" },
    manifest: localManifest([asset({})]),
    assetBaseUrl: "https://example.com/a",
    branding: true,
    target: "gitlab",
  });

  expect(body).toContain("!&#8203;42");
  expect(body).toContain("~&#8203;bug");
  expect(body).toContain("%&#8203;v1");
  expect(body).toContain("$&#8203;9");
  expect(body).toContain("&amp;&#8203;epic1");
});

test("gitlab quoted references are disarmed too, entity and all", () => {
  const body = composeComment({
    graph: { ...minimalGraph, summary: 'apply ~"multi word" then %"v1.0 beta" and &"big epic"' },
    manifest: localManifest([asset({})]),
    assetBaseUrl: "https://example.com/a",
    branding: true,
    target: "gitlab",
  });

  expect(body).toContain("~&#8203;&quot;multi word&quot;");
  expect(body).toContain("%&#8203;&quot;v1.0 beta&quot;");
  expect(body).toContain("&amp;&#8203;&quot;big epic&quot;");
});

test("bitbucket gets a markdown-native marker, since an HTML comment could show", () => {
  expect(commentMarker("bitbucket")).toBe("[pr-lens]: #pr-lens");
  expect(commentMarker("github")).toBe(COMMENT_MARKER);
  expect(commentMarker("gitlab")).toBe(COMMENT_MARKER);
});

test("a bitbucket comment carries no HTML at all", () => {
  const body = composeComment({
    graph: postmarkRefactorGraph,
    manifest: postmarkRefactorManifest,
    assetBaseUrl: undefined,
    branding: true,
    target: "bitbucket",
  });

  expect(body.split("\n")[0]).toBe("[pr-lens]: #pr-lens");
  expect(body).not.toMatch(/<[a-z]/i);
  expect(body).toContain("**");
  expect(body).toContain("Rendered by [PR Lens]");
});

// With no HTML to hide inside, safety on bitbucket means the payload's own
// markdown syntax arrives backslashed and its dangerous form never survives.
test.each([
  ["a disguised link", "[Security update](https://attacker.example/phish)", "\\[Security update\\]", "](https://attacker.example"],
  ["an image", "![](https://attacker.example/tracker.png)", "\\!\\[\\]", "](https://attacker.example"],
  ["a code fence", "```\nrm -rf /\n```", "\\`\\`\\`", "\n```"],
  ["a heading", "# Not our heading", "\\# Not our heading", "\n# Not our heading"],
  ["a raw HTML tag", '<a href="https://attacker.example">click</a>', "<\u200Ba href=", '<a href="https://attacker.example"'],
])("%s in a title is escaped on the bitbucket surface", (_what, payload, escaped, survivingForm) => {
  const body = composeComment({
    graph: { ...minimalGraph, title: payload },
    manifest: localManifest([asset({})]),
    assetBaseUrl: "https://example.com/a",
    branding: true,
    target: "bitbucket",
  });

  expect(body).toContain(escaped);
  expect(body).not.toContain(survivingForm);
});

test("python-markdown specialties are disarmed: wikilinks, footnotes, strikethrough, mentions", () => {
  const body = composeComment({
    graph: {
      ...minimalGraph,
      summary: "see [[wiki]] and [^note] and ~~gone~~ and @ohansemmanuel and #12",
    },
    manifest: localManifest([asset({})]),
    assetBaseUrl: "https://example.com/a",
    branding: true,
    target: "bitbucket",
  });

  expect(body).toContain("\\[\\[wiki\\]\\]");
  expect(body).toContain("\\[^note\\]");
  expect(body).toContain("~\u200B~gone~\u200B~");
  expect(body).toContain("@\u200Bohansemmanuel");
  expect(body).not.toContain("@ohansemmanuel");
});

test("a body past the forge's limit sheds trailing sections, never the headline", () => {
  const view = (index: number) => ({
    id: `v${index}`,
    title: `Section ${index}`,
    lens: "architecture" as const,
    summary: "x".repeat(1_900),
    scope: { kind: "all" as const },
    defaultOpen: false,
    children: [],
  });

  const graph = parseGraphDoc({
    ...minimalGraph,
    views: Array.from({ length: 20 }, (_, index) => view(index)),
  });

  const body = composeComment({
    graph,
    manifest: localManifest([asset({})]),
    assetBaseUrl: "https://example.com/a",
    branding: true,
    target: "bitbucket",
  });

  expect(body.length).toBeLessThanOrEqual(32_768);
  expect(body).toContain(minimalGraph.title);
  expect(body).toContain("did not fit this comment");
});

/**
 * A single-image surface used to be handed the light render, which put a
 * glaring white rectangle in front of every dark-mode reader on GitLab and
 * Bitbucket. The neutral render exists for exactly this, and these pin that
 * each forge is offered the asset made for it.
 */
const neutralAsset = asset({
  id: "architecture-neutral",
  theme: "neutral",
  path: "architecture-neutral.svg",
});

const allThree = () =>
  localManifest([
    asset({}),
    asset({ id: "architecture-dark", theme: "dark", path: "architecture-dark.svg" }),
    neutralAsset,
  ]);

test("GitLab gets the neutral render, not a half of the pair", () => {
  const body = composeComment({
    graph: minimalGraph,
    manifest: allThree(),
    assetBaseUrl: "https://gitlab.com/o/r/-/raw/pr-lens",
    branding: true,
    target: "gitlab",
  });

  expect(body).toContain("architecture-neutral.svg");
  expect(body).not.toContain("architecture-light.svg");
  // GitLab strips picture/source, so shipping one would be shipping nothing.
  expect(body).not.toContain("<picture>");
});

test("Bitbucket gets the neutral render through a markdown image", () => {
  const body = composeComment({
    graph: minimalGraph,
    manifest: allThree(),
    assetBaseUrl: "https://bitbucket.org/o/r/downloads",
    branding: true,
    target: "bitbucket",
  });

  expect(body).toContain("architecture-neutral.svg");
  expect(body).not.toContain("architecture-light.svg");
  expect(body).not.toContain("<img");
});

test("GitHub still pairs light and dark, and ignores a neutral render it does not need", () => {
  const body = composeComment({
    graph: minimalGraph,
    manifest: allThree(),
    assetBaseUrl: "https://example.com/a",
    branding: true,
    target: "github",
  });

  expect(body).toContain('<source media="(prefers-color-scheme: dark)"');
  expect(body).toContain("architecture-light.svg");
  expect(body).toContain("architecture-dark.svg");
  expect(body).not.toContain("architecture-neutral.svg");
});

test("a single-image surface still shows something when only the pair was rendered", () => {
  // An older manifest, or one rendered --theme light by hand. A diagram tuned
  // for the wrong ground beats no diagram, but it is the fallback.
  const body = composeComment({
    graph: minimalGraph,
    manifest: localManifest([
      asset({}),
      asset({ id: "architecture-dark", theme: "dark", path: "architecture-dark.svg" }),
    ]),
    assetBaseUrl: "https://gitlab.com/o/r/-/raw/pr-lens",
    branding: true,
    target: "gitlab",
  });

  expect(body).toContain("architecture-light.svg");
  expect(body).not.toContain("<picture>");
});

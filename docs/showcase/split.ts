import { SANS_STACK } from "../../packages/renderer/src/text.js";
import type { GraphDoc } from "../../packages/schema/src/index.js";
import { escapeXml } from "../../packages/renderer/src/svg/primitives.js";
import type { RenderedSvg, Theme } from "../../packages/renderer/src/index.js";
import { parseGraphDoc, SCHEMA_VERSION } from "../../packages/schema/src/index.js";

/**
 * The README's proof that a render reads in both themes: one small change,
 * drawn once per theme and cut down the middle. Four cards in one lane is
 * enough to show every delta colour and one pulse, and small enough that both
 * halves stay legible at the width GitHub gives an image.
 */
export const splitGraph: GraphDoc = parseGraphDoc({
  schemaVersion: SCHEMA_VERSION,
  kind: "graph",
  title: "Send a welcome email on signup",
  summary: "Signup hands the welcome email to a new service and drops the inline mailer.",
  lenses: ["architecture"],
  provenance: {
    repo: { owner: "acme", name: "webapp" },
    base: { sha: "0000000" },
    head: { sha: "1111111" },
  },
  lanes: [{ id: "mail", label: "Mail", order: 0 }],
  nodes: [
    {
      id: "signup-route",
      label: "POST /signup",
      kind: "route",
      delta: "modified",
      lane: "mail",
      files: [{ path: "app/api/signup/route.ts" }],
    },
    {
      id: "users",
      label: "users",
      kind: "datastore",
      delta: "unchanged",
      lane: "mail",
      subtitle: "Postgres",
    },
    {
      id: "welcome-service",
      label: "welcome-service",
      kind: "service",
      delta: "added",
      lane: "mail",
      files: [{ path: "services/welcome.ts" }],
    },
    {
      id: "legacy-mailer",
      label: "legacy-mailer",
      kind: "service",
      delta: "removed",
      lane: "mail",
      files: [{ path: "services/legacy-mailer.ts" }],
    },
  ],
  edges: [
    {
      id: "signup-to-users",
      from: "signup-route",
      to: "users",
      kind: "data",
      delta: "unchanged",
      label: "create",
    },
    {
      id: "signup-to-welcome",
      from: "signup-route",
      to: "welcome-service",
      kind: "call",
      delta: "added",
      emphasis: "hero",
      animated: true,
      label: "send welcome",
    },
    {
      id: "signup-to-legacy",
      from: "signup-route",
      to: "legacy-mailer",
      kind: "call",
      delta: "removed",
      label: "send welcome",
    },
  ],
});

/** Where the seam crosses the top and bottom edges, as fractions of the width. */
const SEAM_TOP = 0.56;
const SEAM_BOTTOM = 0.44;

/**
 * Two renders of the same document, one per theme, cut along one diagonal
 * into a single picture: dark on the left, light on the right. Layout is
 * theme-blind, so every card and route lines up with itself across the seam
 * and the cut reads as one diagram lit two ways.
 *
 * Each half keeps its own dot pattern and arrowheads, so its ids are suffixed
 * to keep the two themes from sharing whichever definitions came first.
 */
export const splitThemes = (halves: Record<Theme, RenderedSvg>): string => {
  const { width, height } = halves.dark;
  if (halves.light.width !== width || halves.light.height !== height)
    throw new Error("the two themes rendered at different sizes");

  const topX = round2(width * SEAM_TOP);
  const bottomX = round2(width * SEAM_BOTTOM);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${splitGraph.title}, drawn in the dark theme on the left and the light theme on the right">`,
    `<defs>`,
    `<clipPath id="seam-dark"><polygon points="0,0 ${topX},0 ${bottomX},${height} 0,${height}"/></clipPath>`,
    `<clipPath id="seam-light"><polygon points="${topX},0 ${width},0 ${width},${height} ${bottomX},${height}"/></clipPath>`,
    `</defs>`,
    half(halves.dark, "dark"),
    half(halves.light, "light"),
    `</svg>`,
  ].join("\n");
};

const half = (diagram: RenderedSvg, theme: Theme): string => {
  const opening = diagram.svg.indexOf(">") + 1;
  const closing = diagram.svg.lastIndexOf("</svg>");
  const body = diagram.svg
    .slice(opening, closing)
    .replace(/<title>[^<]*<\/title>\n?/, "")
    .replace(/<desc>[^<]*<\/desc>\n?/, "")
    .replace(/id="([^"]+)"/g, (_, id: string) => `id="${id}-${theme}"`)
    .replace(/url\(#([^)]+)\)/g, (_, id: string) => `url(#${id}-${theme})`);

  // The input root is removed above, so its inherited font belongs on this group.
  return `<g id="${theme}" clip-path="url(#seam-${theme})" font-family="${escapeXml(SANS_STACK)}">\n${body}\n</g>`;
};

const round2 = (value: number): number => Math.round(value * 100) / 100;

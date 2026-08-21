import type { GraphDoc } from "../../packages/schema/src/index.js";
import type { Theme } from "../../packages/renderer/src/index.js";
import { measure, MONO_STACK, SANS_STACK } from "../../packages/renderer/src/text.js";
import { escapeXml, lines, tag, textNode, wrap } from "../../packages/renderer/src/svg/primitives.js";

/**
 * Wraps a rendered diagram in a drawn GitHub-comment card, so the README can
 * show not just what a render looks like but where it lives. One
 * self-contained SVG comes back — the diagram is nested whole, so its SMIL
 * pulses keep playing inside the frame.
 *
 * The card's text is the real composer's: the strings here mirror
 * pr-lens-app's `composeComment` (heading, stats chips, lens titles and
 * captions, the Drill down row, the View checkboxes, the footer) so the
 * mockup is an honest preview of the comment the app posts. The chrome —
 * avatar, header row, badges — follows the validated prototype's comment
 * card.
 */

type FramePalette = {
  page: string;
  surface: string;
  surface2: string;
  border: string;
  foreground: string;
  muted: string;
  purple: string;
  codeBg: string;
  check: string;
};

const FRAME_DARK: FramePalette = {
  page: "#0d1117",
  surface: "#161b22",
  surface2: "#1c2128",
  border: "#30363d",
  foreground: "#e6edf3",
  muted: "#9198a1",
  purple: "#ab7df8",
  codeBg: "rgba(110,118,129,.18)",
  check: "#1f6feb",
};

const FRAME_LIGHT: FramePalette = {
  page: "#ffffff",
  surface: "#ffffff",
  surface2: "#f6f8fa",
  border: "#d1d9e0",
  foreground: "#1f2328",
  muted: "#59636e",
  purple: "#8250df",
  codeBg: "rgba(175,184,193,.2)",
  check: "#1f6feb",
};

const framePalette = (theme: Theme): FramePalette =>
  theme === "dark" ? FRAME_DARK : FRAME_LIGHT;

const MARGIN = 16;
const AVATAR = 40;
const AVATAR_GAP = 16;
const CARD_WIDTH = 960;
const PAD = 16;
const HEADER_HEIGHT = 36;
const CONTENT_WIDTH = CARD_WIDTH - PAD * 2;
const CARD_X = MARGIN + AVATAR + AVATAR_GAP;

const round2 = (value: number): number => Math.round(value * 100) / 100;

export type FramedDiagram = { svg: string; width: number; height: number };

/** One lens section of the comment: a diagram when the lens drew one, the composer's caption either way. */
export type FrameSection = {
  title: "Architecture" | "Data flow";
  diagram?: FramedDiagram;
  /** The composer's italic caption line; segments in `code` render as chips. */
  caption: readonly { text: string; code?: boolean }[];
};

export type FrameInput = {
  doc: GraphDoc;
  sections: readonly FrameSection[];
  theme: Theme;
};

/** The headline counts the real comment's chips carry, per the app's docStats. */
const statsChips = (doc: GraphDoc): string[] => {
  const files = new Set<string>();
  let added = 0;
  let modified = 0;
  let removed = 0;
  for (const node of doc.nodes) {
    for (const file of node.files) files.add(file.path);
    if (node.delta === "added") added += 1;
    if (node.delta === "modified") modified += 1;
    if (node.delta === "removed") removed += 1;
  }
  return [
    `+${added} new`,
    `~${modified} changed`,
    `-${removed} removed`,
    `${doc.flows.length} flows`,
    `${files.size} files`,
  ];
};

/**
 * Re-seats a rendered diagram inside the frame by rewriting the root tag's
 * placement attributes; the document body is carried over byte-for-byte, so
 * the SMIL clock inside it is untouched.
 */
const nestDiagram = (diagram: FramedDiagram, x: number, y: number): { markup: string; height: number } => {
  const height = round2((diagram.height * CONTENT_WIDTH) / diagram.width);
  const opening = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${diagram.width} ${diagram.height}" width="${diagram.width}" height="${diagram.height}"`;
  if (!diagram.svg.startsWith(opening))
    throw new Error("diagram does not open with the renderer's known root tag");
  const placed =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${diagram.width} ${diagram.height}" ` +
    `x="${x}" y="${y}" width="${CONTENT_WIDTH}" height="${height}"` +
    diagram.svg.slice(opening.length);
  return { markup: placed, height };
};

type Run = { text: string; face: "sans" | "sans-bold" | "mono"; size: number; fill: string; chip?: boolean; italic?: boolean };

/** Lays runs left to right on one baseline; a chip run gets a code-span box. */
const paintRuns = (x: number, baseline: number, runs: readonly Run[], palette: FramePalette): string => {
  const parts: string[] = [];
  let cursor = x;
  for (const run of runs) {
    const width = measure(run.text, run.face, run.size);
    const family = run.face === "mono" ? MONO_STACK : SANS_STACK;
    const weight = run.face === "sans-bold" ? 600 : 400;
    if (run.chip === true) {
      parts.push(
        tag("rect", {
          x: round2(cursor),
          y: round2(baseline - run.size - 1.5),
          width: round2(width + 12),
          height: run.size + 6,
          rx: 6,
          fill: palette.codeBg,
        }),
      );
    }
    parts.push(
      textNode(
        {
          x: round2(cursor + (run.chip === true ? 6 : 0)),
          y: baseline,
          fill: run.fill,
          style:
            `font-family:${family};font-size:${run.size}px;font-weight:${weight}` +
            (run.italic === true ? ";font-style:italic" : ""),
        },
        run.text,
      ),
    );
    cursor += width + (run.chip === true ? 12 : 0);
  }
  return lines(parts);
};

const runWidth = (runs: readonly Run[]): number =>
  runs.reduce((total, run) => total + measure(run.text, run.face, run.size) + (run.chip === true ? 12 : 0), 0);

const CHECKBOXES: readonly { label: string; checked: boolean }[] = [
  { label: "Architecture lens", checked: true },
  { label: "Data flow lens", checked: true },
  { label: "Expand every detail", checked: false },
  { label: "Show unchanged neighbours", checked: false },
];

const checkbox = (x: number, y: number, checked: boolean, palette: FramePalette): string => {
  const box = tag("rect", {
    x,
    y,
    width: 14,
    height: 14,
    rx: 3,
    fill: checked ? palette.check : "none",
    stroke: checked ? palette.check : palette.border,
    "stroke-width": 1.2,
  });
  const mark = checked
    ? tag("path", {
        d: `M${x + 3.2},${y + 7.2} l2.7,2.7 l5,-5.4`,
        fill: "none",
        stroke: "#ffffff",
        "stroke-width": 1.8,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      })
    : "";
  return box + mark;
};

export const frameAsComment = (input: FrameInput): string => {
  const { doc, sections, theme } = input;
  const palette = framePalette(theme);
  const left = CARD_X + PAD;
  const parts: string[] = [];
  let y = MARGIN + HEADER_HEIGHT;

  const gap = (height: number): void => {
    y += height;
  };

  // ### ◈ PR Lens
  gap(PAD + 24);
  parts.push(
    paintRuns(left, y, [{ text: "◈ PR Lens", face: "sans-bold", size: 18, fill: palette.foreground }], palette),
  );
  gap(16);

  // The stats chips line, ` · `-separated, ending in `commit <sha>`.
  gap(18);
  {
    const runs: Run[] = [];
    for (const chip of statsChips(doc)) {
      runs.push({ text: chip, face: "mono", size: 12, fill: palette.foreground, chip: true });
      runs.push({ text: " · ", face: "sans", size: 12, fill: palette.muted });
    }
    runs.push({ text: "commit ", face: "sans", size: 12, fill: palette.muted });
    runs.push({
      text: doc.provenance.head.sha.slice(0, 7),
      face: "mono",
      size: 12,
      fill: palette.foreground,
      chip: true,
    });
    parts.push(paintRuns(left, y, runs, palette));
  }
  gap(10);

  for (const section of sections) {
    gap(26);
    parts.push(
      paintRuns(left, y, [{ text: section.title, face: "sans-bold", size: 14, fill: palette.foreground }], palette),
    );
    gap(12);
    if (section.diagram !== undefined) {
      const nested = nestDiagram(section.diagram, left, y);
      parts.push(nested.markup);
      gap(nested.height + 20);
    } else {
      gap(6);
    }
    parts.push(
      paintRuns(
        left,
        y,
        section.caption.map((segment) => ({
          text: segment.text,
          face: segment.code === true ? "mono" : "sans",
          size: 13,
          fill: palette.foreground,
          chip: segment.code === true,
          italic: segment.code !== true,
        })),
        palette,
      ),
    );
    gap(4);
  }

  // The Drill down details row, collapsed, as GitHub draws a <summary>.
  gap(26);
  parts.push(
    paintRuns(
      left,
      y,
      [
        { text: "▸ ", face: "sans", size: 13, fill: palette.muted },
        { text: "Drill down", face: "sans-bold", size: 14, fill: palette.foreground },
      ],
      palette,
    ),
  );
  gap(10);

  // **View** + the four checkbox lines.
  gap(24);
  parts.push(
    paintRuns(left, y, [{ text: "View", face: "sans-bold", size: 14, fill: palette.foreground }], palette),
  );
  gap(8);
  for (const option of CHECKBOXES) {
    gap(24);
    parts.push(checkbox(left, y - 12, option.checked, palette));
    parts.push(
      paintRuns(left + 22, y, [{ text: option.label, face: "sans", size: 13, fill: palette.foreground }], palette),
    );
  }
  gap(8);

  // --- then the footer, exactly the composer's FOOTER string.
  gap(18);
  parts.push(
    tag("line", { x1: left, y1: y, x2: CARD_X + CARD_WIDTH - PAD, y2: y, stroke: palette.border, "stroke-width": 1 }),
  );
  gap(24);
  parts.push(
    paintRuns(
      left,
      y,
      [{ text: "◈ Rendered by PR Lens · from the team behind Coldtea", face: "sans", size: 12.5, fill: palette.muted }],
      palette,
    ),
  );
  gap(PAD);

  const cardHeight = y - MARGIN;
  const totalWidth = CARD_X + CARD_WIDTH + MARGIN;
  const totalHeight = MARGIN + cardHeight + MARGIN;

  const header = lines([
    tag("path", {
      d:
        `M${CARD_X},${MARGIN + 8} a8,8 0 0 1 8,-8 h${CARD_WIDTH - 16} a8,8 0 0 1 8,8 ` +
        `v${HEADER_HEIGHT - 8} h-${CARD_WIDTH} Z`,
      fill: palette.surface2,
    }),
    tag("line", {
      x1: CARD_X,
      y1: MARGIN + HEADER_HEIGHT,
      x2: CARD_X + CARD_WIDTH,
      y2: MARGIN + HEADER_HEIGHT,
      stroke: palette.border,
      "stroke-width": 1,
    }),
    paintRuns(left, MARGIN + 23, headerRuns(palette), palette),
    badge(left + runWidth(headerRuns(palette)) + 10, MARGIN + 9, "Bot", palette.muted, palette),
    badge(
      left + runWidth(headerRuns(palette)) + 10 + badgeWidth("Bot") + 6,
      MARGIN + 9,
      "App",
      palette.purple,
      palette,
    ),
    paintRuns(
      CARD_X + CARD_WIDTH - PAD - measure("···", "sans-bold", 13),
      MARGIN + 23,
      [{ text: "···", face: "sans-bold", size: 13, fill: palette.muted }],
      palette,
    ),
  ]);

  const avatar = lines([
    wrap(
      "defs",
      {},
      wrap(
        "linearGradient",
        { id: "frame-avatar", x1: "0", y1: "0", x2: "1", y2: "1" },
        tag("stop", { offset: "0", "stop-color": "#6e40c9" }) +
          tag("stop", { offset: "1", "stop-color": "#388bfd" }),
      ),
    ),
    tag("rect", { x: MARGIN, y: MARGIN, width: AVATAR, height: AVATAR, rx: 8, fill: "url(#frame-avatar)" }),
    textNode(
      {
        x: MARGIN + AVATAR / 2,
        y: MARGIN + AVATAR / 2 + 6,
        fill: "#ffffff",
        "text-anchor": "middle",
        style: `font-family:${SANS_STACK};font-size:18px;font-weight:700`,
      },
      "◈",
    ),
  ]);

  return lines([
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${totalHeight}" ` +
      `width="${totalWidth}" height="${totalHeight}" role="img" ` +
      `aria-label="${escapeXml(`PR Lens comment preview — ${doc.title}`)}">`,
    wrap("title", {}, escapeXml(`PR Lens comment preview — ${doc.title}`)),
    tag("rect", { x: 0, y: 0, width: totalWidth, height: totalHeight, fill: palette.page }),
    avatar,
    tag("rect", {
      x: CARD_X,
      y: MARGIN,
      width: CARD_WIDTH,
      height: cardHeight,
      rx: 8,
      fill: palette.surface,
      stroke: palette.border,
      "stroke-width": 1,
    }),
    header,
    lines(parts),
    tag("rect", {
      x: CARD_X,
      y: MARGIN,
      width: CARD_WIDTH,
      height: cardHeight,
      rx: 8,
      fill: "none",
      stroke: palette.border,
      "stroke-width": 1,
    }),
    "</svg>",
  ]);
};

/** The words render without their boundary spaces; the blank run walks the cursor instead. */
const headerRuns = (palette: FramePalette): Run[] => [
  { text: "pr-lens", face: "sans-bold", size: 13, fill: palette.foreground },
  { text: "  ", face: "sans", size: 13, fill: palette.muted },
  { text: "bot commented 13 minutes ago", face: "sans", size: 13, fill: palette.muted },
];

const badgeWidth = (text: string): number => measure(text, "sans", 11) + 14;

const badge = (x: number, yTop: number, text: string, colour: string, palette: FramePalette): string =>
  lines([
    tag("rect", {
      x: round2(x),
      y: yTop,
      width: round2(badgeWidth(text)),
      height: 18,
      rx: 9,
      fill: "none",
      stroke: text === "App" ? colour : palette.border,
      "stroke-width": 1,
    }),
    textNode(
      {
        x: round2(x + badgeWidth(text) / 2),
        y: yTop + 13,
        fill: colour,
        "text-anchor": "middle",
        style: `font-family:${SANS_STACK};font-size:11px`,
      },
      text,
    ),
  ]);

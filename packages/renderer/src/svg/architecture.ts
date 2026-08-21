import type { GraphEdge, GraphNode, LayoutHints } from "@coldtea/pr-lens-schema";
import { assertNever } from "@coldtea/pr-lens-schema";
import {
  BADGE_GAP,
  BADGE_HEIGHT,
  BADGE_RADIUS,
  BADGE_RISE,
  CARD_PADDING_X,
  CARD_RADIUS,
  HERO_PULSE_COUNT,
  HERO_PULSE_DURATION,
  ICON_CHIP_GAP,
  ICON_CHIP_RADIUS,
  ICON_CHIP_SIZE,
  LANE_HEADER_BASELINE,
  LANE_PADDING_X,
  LANE_RADIUS,
  PILL_HEIGHT,
  PILL_PADDING_X,
  PILL_TEXT_SIZE,
  PULSE_DURATION,
  SUBTITLE_SIZE,
} from "../design.js";
import { canvasFor, union } from "../bounds.js";
import { DIAGRAM_MARGIN } from "../design.js";
import { coord, type Box } from "../geometry.js";
import {
  badgeRow,
  badgeWidth,
  cardBadges,
  deltaBadgeText,
  laneHeaderText,
  layoutArchitecture,
  type PlacedNode,
} from "../layout/architecture.js";
import { curveBounds, routeEdges, type RoutedEdge } from "../layout/edges.js";
import type { ScopedGraph } from "../scope.js";
import { measure, truncate } from "../text.js";
import type { Palette } from "../theme.js";
import { markerFor, shifted, toneColour, toneFor, type Tone } from "./document.js";
import { glyphGroup } from "./icons.js";
import { lines, tag, textNode, wrap } from "./primitives.js";

const badgeTone = (node: GraphNode, text: string): Tone =>
  text === deltaBadgeText(node.delta) ? toneFor(node.delta) : "neutral";

/** The badge row, laid left to right across the strip the layout reserved. */
const paintBadges = (placed: PlacedNode): string => {
  const row = badgeRow(placed);
  if (row === undefined) return "";

  let x = row.box.x;
  return lines(
    row.badges.map((text) => {
      const width = badgeWidth(text);
      const painted = wrap(
        "g",
        { class: `bdg bdg-${badgeTone(placed.node, text)}` },
        tag("rect", {
          x: coord(x),
          y: coord(row.box.y),
          width: coord(width),
          height: BADGE_HEIGHT,
          rx: BADGE_RADIUS,
        }) +
          textNode(
            {
              x: coord(x + width / 2),
              y: coord(row.box.y + BADGE_HEIGHT / 2 + 3),
              "text-anchor": "middle",
            },
            text,
          ),
      );
      x += width + BADGE_GAP;
      return painted;
    }),
  );
};

const cardOutlineClass = (node: GraphNode): string => {
  switch (node.delta) {
    case "added":
      return "card card-added";
    case "modified":
      return "card card-modified";
    case "removed":
    case "unchanged":
      return "card";
    default:
      return assertNever(node.delta, "Unhandled delta");
  }
};

const paintCard = (placed: PlacedNode): string => {
  const { node, box, showIcon, titleSize } = placed;
  const textX = box.x + CARD_PADDING_X + (showIcon ? ICON_CHIP_SIZE + ICON_CHIP_GAP : 0);
  const textWidth = box.x + box.width - CARD_PADDING_X - textX;
  const hasSubtitle = node.subtitle !== undefined;
  const titleBaseline = box.y + (hasSubtitle ? 27 : 31);

  const chip = showIcon
    ? tag("rect", {
        class: "chip",
        x: coord(box.x + CARD_PADDING_X),
        y: coord(box.y + (box.height - ICON_CHIP_SIZE) / 2),
        width: ICON_CHIP_SIZE,
        height: ICON_CHIP_SIZE,
        rx: ICON_CHIP_RADIUS,
      }) +
      glyphGroup(
        node.kind,
        box.x + CARD_PADDING_X + ICON_CHIP_SIZE / 2,
        box.y + box.height / 2,
      )
    : "";

  const title = textNode(
    {
      class: node.delta === "removed" ? "ntitle strike" : "ntitle",
      x: coord(textX),
      y: coord(titleBaseline),
      "font-size": titleSize,
    },
    truncate(node.label, "sans-bold", titleSize, textWidth),
  );

  const subtitle =
    node.subtitle === undefined
      ? ""
      : textNode(
          { class: "nsub", x: coord(textX), y: coord(box.y + 45) },
          truncate(node.subtitle, "mono", SUBTITLE_SIZE, textWidth),
        );

  const groupClass =
    node.delta === "removed" ? "cardsh ghost" : node.delta === "unchanged" ? "cardsh context" : "cardsh";

  return wrap(
    "g",
    { class: groupClass },
    lines([
      tag("rect", {
        class: cardOutlineClass(node),
        x: coord(box.x),
        y: coord(box.y),
        width: coord(box.width),
        height: coord(box.height),
        rx: CARD_RADIUS,
      }),
      chip,
      title,
      subtitle,
      paintBadges(placed),
    ]),
  );
};

const pulses = (edge: GraphEdge, path: string, palette: Palette): string => {
  if (!edge.animated) return "";
  const tone = toneFor(edge.delta);
  const hero = edge.emphasis === "hero";
  const count = hero ? HERO_PULSE_COUNT : 1;
  const duration = hero ? HERO_PULSE_DURATION : PULSE_DURATION;

  return lines(
    Array.from({ length: count }, (_, index) =>
      wrap(
        "circle",
        { r: hero ? 3 : 2.6, fill: toneColour(palette, tone) },
        tag("animateMotion", {
          dur: `${coord(duration)}s`,
          begin: index === 0 ? undefined : `${coord((duration / count) * index)}s`,
          repeatCount: "indefinite",
          path,
        }),
      ),
    ),
  );
};

/**
 * Paints one edge and the pill pinned to it. Every edge carries at most one
 * label, and the router already chose its place — the middle of the route's
 * longest straight run — so a reader traces a line to its own words.
 *
 * The line and the label come back separately because they belong to
 * different layers: a line passes behind a card, and a pill — which is opaque
 * precisely so that it can be read wherever it lands — passes in front of one.
 */
const paintEdge = (
  routed: RoutedEdge,
  palette: Palette,
): { markup: string; pill: string; label: Box | undefined } => {
  const { edge, path, curve, labelAnchor } = routed;
  const tone = toneFor(edge.delta);
  const hero = edge.emphasis === "hero";

  const classes = ["edge", `edge-${tone}`];
  if (hero) classes.push("hero");
  if (edge.emphasis === "muted") classes.push("faded");
  if (edge.delta === "unchanged") classes.push("context");

  const glow = hero
    ? tag("path", { class: "glow", stroke: toneColour(palette, tone), d: path })
    : "";

  const label =
    edge.label === undefined || labelAnchor === undefined
      ? undefined
      : centred(labelAnchor, {
          width: measure(edge.label, "sans-bold", PILL_TEXT_SIZE) + PILL_PADDING_X * 2,
          height: PILL_HEIGHT,
        });

  return {
    markup: lines([
      glow,
      tag("path", { class: classes.join(" "), d: path, "marker-end": markerFor(tone) }),
      pulses(edge, path, palette),
    ]),
    pill:
      label === undefined || edge.label === undefined
        ? ""
        : paintLabelPill(edge.label, label, tone),
    label,
  };
};

const centred = (anchor: { x: number; y: number }, size: { width: number; height: number }): Box => ({
  x: anchor.x - size.width / 2,
  y: anchor.y - size.height / 2,
  width: size.width,
  height: size.height,
});

const paintLabelPill = (text: string, box: Box, tone: Tone): string =>
  wrap(
    "g",
    {},
    tag("rect", {
      class: "lpill",
      x: coord(box.x),
      y: coord(box.y),
      width: coord(box.width),
      height: coord(box.height),
      rx: box.height / 2,
    }) +
      textNode(
        {
          class: tone === "neutral" ? "ltext" : `ltext ltext-${tone}`,
          x: coord(box.x + box.width / 2),
          y: coord(box.y + box.height / 2 + 3.5),
          "text-anchor": "middle",
        },
        text,
      ),
  );

export type ArchitecturePainting = { width: number; height: number; body: string };

export const paintArchitecture = (
  graph: ScopedGraph,
  hints: LayoutHints | undefined,
  palette: Palette,
): ArchitecturePainting => {
  const layout = layoutArchitecture(graph, hints);
  const routed = routeEdges(graph.edges, layout);

  const drawn: Box[] = layout.nodes.flatMap((node) => {
    const row = badgeRow(node);
    return row === undefined ? [node.box] : [node.box, row.box];
  });
  const edgeMarkup: string[] = [];
  const pillMarkup: string[] = [];
  for (const edge of routed) {
    const { markup, pill, label } = paintEdge(edge, palette);
    edgeMarkup.push(markup);
    pillMarkup.push(pill);
    if (label !== undefined) drawn.push(label);
  }

  const lanes = layout.lanes.map(({ lane, box }) =>
    lines([
      tag("rect", {
        class: "lanebox",
        x: coord(box.x),
        y: coord(box.y),
        width: coord(box.width),
        height: coord(box.height),
        rx: LANE_RADIUS,
      }),
      textNode(
        { class: "lanelabel", x: coord(box.x + LANE_PADDING_X), y: LANE_HEADER_BASELINE },
        laneHeaderText(lane),
      ),
    ]),
  );

  const canvas = canvasFor(
    layout,
    union([
      ...layout.lanes.map(({ box }) => box),
      ...drawn,
      ...routed.map(({ curve }) => curveBounds(curve)),
    ]),
    DIAGRAM_MARGIN,
  );

  const painted = lines([
    wrap("g", {}, lines(lanes)),
    wrap("g", {}, lines(edgeMarkup)),
    wrap("g", {}, lines(layout.nodes.map(paintCard))),
    wrap("g", {}, lines(pillMarkup)),
  ]);

  return {
    width: canvas.width,
    height: canvas.height,
    body: shifted(canvas, painted),
  };
};

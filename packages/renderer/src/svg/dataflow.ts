import type { Flow, FlowMessage, GraphNode, MessageKind } from "@coldtea/pr-lens-schema";
import { assertNever } from "@coldtea/pr-lens-schema";
import {
  DIAGRAM_MARGIN,
  FLOW_MAX_PULSES_PER_MESSAGE,
  FLOW_PULSE_STAGGER,
  LANE_RADIUS,
  PILL_HEIGHT,
  PILL_PADDING_X,
  PILL_TEXT_SIZE,
  TITLE_SIZE,
} from "../design.js";
import { canvasFor, union } from "../bounds.js";
import type { Box } from "../geometry.js";
import { measure } from "../text.js";
import { coord } from "../geometry.js";
import {
  ACTIVATION_HALF_WIDTH,
  FLOW_BAND_PAD_X,
  FLOW_BAND_PAD_Y,
  layoutDataFlow,
  MARKER_INSET,
  PARTICIPANT_TOP,
  SELF_LOOP_CORNER,
  SELF_LOOP_DROP,
  SELF_LOOP_EXTENT,
  SELF_LOOP_REACH,
  type FlowLayout,
  type PlacedMessage,
} from "../layout/dataflow.js";
import type { Palette } from "../theme.js";
import { paintCard, paintLabelPill } from "./architecture.js";
import { markerFor, openMarkerFor, shifted, toneColour, toneFor, type Tone } from "./document.js";
import { lines, tag, wrap } from "./primitives.js";
import { travellingPulses } from "./pulse.js";

/** Whether a message crosses to another column, and which way. */
const travelDirection = (kind: MessageKind, fromX: number, toX: number): -1 | 0 | 1 => {
  switch (kind) {
    case "self":
      return 0;
    case "sync":
    case "async":
    case "return":
      return toX >= fromX ? 1 : -1;
    default:
      return assertNever(kind, "Unhandled message kind");
  }
};

const messageClasses = (message: FlowMessage, tone: Tone): string => {
  const classes = ["msg", `edge-${tone}`];
  if (message.kind === "return") classes.push("msg-return");
  if (message.delta === "added") classes.push("msg-strong");
  return classes.join(" ");
};

/**
 * Fire-and-forget gets the open head; everything else keeps the filled one.
 *
 * Deliberate deviation from strict UML 2, which draws replies with an open
 * head as well: here each signal carries exactly one meaning, so a reader
 * needs no legend. The dashed stroke is already the whole mark of "this is
 * an answer", and the open head stays the exclusive mark of "nobody waits on
 * this". Open-headed returns would put the async signature on every reply
 * and dilute the one distinction the head shape exists to draw.
 */
const headFor = (kind: MessageKind, tone: Tone): string => {
  switch (kind) {
    case "async":
      return openMarkerFor(tone);
    case "sync":
    case "return":
    case "self":
      return markerFor(tone);
    default:
      return assertNever(kind, "Unhandled message kind");
  }
};

/** Whether an activation bar covers this column at this height. */
type ActiveAt = (node: string, y: number) => boolean;

const activationLookup = (layout: FlowLayout): ActiveAt => {
  const byNode = new Map(
    layout.participants.map((participant) => [participant.node.id, participant.activations]),
  );
  return (node, y) =>
    (byNode.get(node) ?? []).some((bar) => bar.top <= y && y <= bar.bottom);
};

type Ends = { start: number; end: number };

/**
 * Where an arrow starts and stops horizontally. An activated column is a bar,
 * not a line, so an arrow that touches one has to stop at its edge, and the
 * arrowhead needs room of its own on top of that.
 */
const endsFor = (
  placed: PlacedMessage,
  activeAt: ActiveAt,
  direction: -1 | 1,
): Ends => ({
  start:
    placed.fromX +
    direction * (activeAt(placed.message.from, placed.y) ? ACTIVATION_HALF_WIDTH : 0),
  end:
    placed.toX -
    direction *
      ((activeAt(placed.message.to, placed.y) ? ACTIVATION_HALF_WIDTH : 0) + MARKER_INSET),
});

const selfPath = (x: number, y: number, activated: boolean): string => {
  const start = x + (activated ? ACTIVATION_HALF_WIDTH : 0);
  return (
    `M${coord(start)},${coord(y)} h${coord(SELF_LOOP_REACH)} ` +
    `a${SELF_LOOP_CORNER},${SELF_LOOP_CORNER} 0 0 1 ${SELF_LOOP_CORNER},${SELF_LOOP_CORNER} ` +
    `v${coord(SELF_LOOP_DROP)} ` +
    `a${SELF_LOOP_CORNER},${SELF_LOOP_CORNER} 0 0 1 -${SELF_LOOP_CORNER},${SELF_LOOP_CORNER} ` +
    `h-${coord(SELF_LOOP_REACH - MARKER_INSET)}`
  );
};

/** How far a self message's pill stands off the loop it names. */
const SELF_PILL_GAP = 8;

const pillWidth = (label: string): number =>
  measure(label, "sans-bold", PILL_TEXT_SIZE) + PILL_PADDING_X * 2;

/** The pill of a straight message, settled onto the middle of its arrow. */
const pillBox = (placed: PlacedMessage, ends: Ends): Box => {
  const width = pillWidth(placed.label);
  return {
    x: (ends.start + ends.end) / 2 - width / 2,
    y: placed.y - PILL_HEIGHT / 2,
    width,
    height: PILL_HEIGHT,
  };
};

/** A self message's pill, beside the loop and centred on its height. */
const selfPillBox = (placed: PlacedMessage, activated: boolean): Box => ({
  x:
    placed.fromX +
    (activated ? ACTIVATION_HALF_WIDTH : 0) +
    SELF_LOOP_REACH +
    SELF_LOOP_CORNER +
    SELF_PILL_GAP,
  y: placed.y + SELF_LOOP_EXTENT / 2 - PILL_HEIGHT / 2,
  width: pillWidth(placed.label),
  height: PILL_HEIGHT,
});

/**
 * Pulses for one message: the architecture lens's travelling dot, riding a
 * step further behind the drawing's clock for every step above it. The
 * arrows never stop moving, and the wave still crosses them in the order the
 * steps happen.
 */
const pulsesFor = (placed: PlacedMessage, path: string, palette: Palette): string =>
  placed.message.animated
    ? travellingPulses({
        path,
        colour: toneColour(palette, toneFor(placed.message.delta)),
        count: placed.pulses,
        lag: placed.step * FLOW_PULSE_STAGGER,
      })
    : "";

/**
 * Paints one message and the pill that names it. Like an architecture edge
 * and its label, the two come back separately because they belong to
 * different layers: the pill is opaque precisely so it can be read wherever
 * it lands, so it passes in front of everything the arrows drew.
 */
const paintMessage = (
  placed: PlacedMessage,
  activeAt: ActiveAt,
  palette: Palette,
): { line: string; pill: string } => {
  const tone = toneFor(placed.message.delta);
  const direction = travelDirection(placed.message.kind, placed.fromX, placed.toX);
  const head = headFor(placed.message.kind, tone);

  if (direction === 0) {
    const activated = activeAt(placed.message.from, placed.y);
    const path = selfPath(placed.fromX, placed.y, activated);
    return {
      line: lines([
        tag("path", { class: messageClasses(placed.message, tone), d: path, "marker-end": head }),
        pulsesFor(placed, path, palette),
      ]),
      pill: paintLabelPill(placed.label, selfPillBox(placed, activated), tone),
    };
  }

  const ends = endsFor(placed, activeAt, direction);
  const path = `M${coord(ends.start)},${coord(placed.y)} L${coord(ends.end)},${coord(placed.y)}`;

  return {
    line: lines([
      tag("path", { class: messageClasses(placed.message, tone), d: path, "marker-end": head }),
      pulsesFor(placed, path, palette),
    ]),
    pill: paintLabelPill(placed.label, pillBox(placed, ends), tone),
  };
};

/**
 * The ground under one column: a band in the lane language, holding the
 * card, its lifeline and its activation bars with the same breathing room a
 * lane keeps around its cards.
 */
const bandBox = (centreX: number, columnWidth: number, layout: FlowLayout): Box => {
  const top = layout.top + PARTICIPANT_TOP - FLOW_BAND_PAD_Y;
  return {
    x: centreX - columnWidth / 2 - FLOW_BAND_PAD_X,
    y: top,
    width: columnWidth + FLOW_BAND_PAD_X * 2,
    height: layout.top + layout.height + FLOW_BAND_PAD_Y - top,
  };
};

const paintFlow = (layout: FlowLayout, columnWidth: number, palette: Palette): string => {
  const activeAt = activationLookup(layout);

  const lifelineBottom = layout.top + layout.height;

  const bands = layout.participants.map((participant) => {
    const box = bandBox(participant.centreX, columnWidth, layout);
    return tag("rect", {
      class: "lanebox",
      x: coord(box.x),
      y: coord(box.y),
      width: coord(box.width),
      height: coord(box.height),
      rx: LANE_RADIUS,
    });
  });

  const columns = layout.participants.map((participant) =>
    lines([
      tag("line", {
        class: "lifeline",
        x1: coord(participant.centreX),
        y1: coord(layout.lifelineTop),
        x2: coord(participant.centreX),
        y2: coord(lifelineBottom),
      }),
      ...participant.activations.map((bar) =>
        tag("rect", {
          class: "actbar",
          x: coord(participant.centreX - ACTIVATION_HALF_WIDTH),
          y: coord(bar.top),
          width: ACTIVATION_HALF_WIDTH * 2,
          height: coord(bar.bottom - bar.top),
          rx: 4,
        }),
      ),
    ]),
  );

  const cards = layout.participants.map((participant, index) =>
    paintCard({
      node: participant.node,
      box: participant.card,
      showIcon: true,
      titleSize: TITLE_SIZE,
      row: 0,
      laneIndex: index,
    }),
  );

  const lineMarkup: string[] = [];
  const pillMarkup: string[] = [];
  for (const message of layout.messages) {
    const { line, pill } = paintMessage(message, activeAt, palette);
    lineMarkup.push(line);
    pillMarkup.push(pill);
  }

  return lines([
    wrap("g", {}, lines(bands)),
    wrap("g", {}, lines(columns)),
    wrap("g", {}, lines(cards)),
    wrap("g", {}, lines(lineMarkup)),
    wrap("g", {}, lines(pillMarkup)),
  ]);
};

/**
 * The room a flow's own drawing takes. The bands already hold the cards and
 * columns, but a pill is centred on its arrow and a self message's sits off
 * to the right of one, so either can reach past what the layout sized the
 * canvas from.
 */
const flowBounds = (layout: FlowLayout, columnWidth: number): Box[] => {
  const activeAt = activationLookup(layout);

  const bands = layout.participants.map((participant) =>
    bandBox(participant.centreX, columnWidth, layout),
  );

  const pills = layout.messages.map((placed) => {
    const direction = travelDirection(placed.message.kind, placed.fromX, placed.toX);

    if (direction === 0) return selfPillBox(placed, activeAt(placed.message.from, placed.y));
    return pillBox(placed, endsFor(placed, activeAt, direction));
  });

  const loops = layout.messages
    .filter((placed) => placed.message.kind === "self")
    .map((placed) => ({
      x: placed.fromX,
      y: placed.y,
      width: SELF_LOOP_REACH + SELF_LOOP_CORNER + ACTIVATION_HALF_WIDTH,
      height: SELF_LOOP_DROP + SELF_LOOP_CORNER * 2,
    }));

  return [...bands, ...pills, ...loops];
};

export type DataFlowPainting = { width: number; height: number; body: string };

export const paintDataFlow = (
  flows: readonly Flow[],
  nodes: readonly GraphNode[],
  palette: Palette,
): DataFlowPainting => {
  const layout = layoutDataFlow(flows, nodes, FLOW_MAX_PULSES_PER_MESSAGE);

  const canvas = canvasFor(
    layout,
    union(layout.flows.flatMap((flow) => flowBounds(flow, layout.columnWidth))),
    DIAGRAM_MARGIN,
  );

  return {
    width: canvas.width,
    height: canvas.height,
    body: shifted(
      canvas,
      lines(layout.flows.map((flow) => paintFlow(flow, layout.columnWidth, palette))),
    ),
  };
};

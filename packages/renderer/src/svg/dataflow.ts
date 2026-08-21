import type { Flow, FlowMessage, GraphNode, MessageKind } from "@coldtea/pr-lens-schema";
import { assertNever } from "@coldtea/pr-lens-schema";
import {
  DIAGRAM_MARGIN,
  FLOW_CYCLE_DURATION,
  FLOW_MAX_PULSES_PER_MESSAGE,
  FLOW_PULSE_LEAD,
  FLOW_PULSE_MAX_TRAVEL,
  FLOW_PULSE_RAMP,
  FLOW_PULSE_TRAVEL,
} from "../design.js";
import { canvasFor, union } from "../bounds.js";
import type { Box } from "../geometry.js";
import { measure } from "../text.js";
import { coord } from "../geometry.js";
import {
  ACTIVATION_HALF_WIDTH,
  layoutDataFlow,
  LIFELINE_TOP,
  MARKER_INSET,
  PARTICIPANT_HEIGHT,
  PARTICIPANT_TOP,
  SELF_LOOP_CORNER,
  SELF_LOOP_DROP,
  SELF_LOOP_REACH,
  type FlowLayout,
  type PlacedMessage,
} from "../layout/dataflow.js";
import type { Palette } from "../theme.js";
import { markerFor, openMarkerFor, shifted, toneColour, toneFor, type Tone } from "./document.js";
import { lines, tag, textNode, wrap } from "./primitives.js";

/** A ratio inside the animation cycle, written to a fixed number of places. */
const ratio = (value: number): string => String(Math.round(value * 10000) / 10000);

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
    layout.flow.participants.map((participant, index) => [
      participant.node,
      layout.participants[index]?.activations ?? [],
    ]),
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

/**
 * Pulses for one message, placed in the message's own beats of the shared
 * cycle. Every pulse in the drawing runs on one clock, so the dots move in
 * the order the steps happen rather than all at once.
 */
const pulsesFor = (
  placed: PlacedMessage,
  path: string,
  slotCount: number,
  palette: Palette,
): string => {
  if (!placed.message.animated || slotCount === 0) return "";
  const colour = toneColour(palette, toneFor(placed.message.delta));
  const slotWidth = 1 / slotCount;
  const duration = `${coord(FLOW_CYCLE_DURATION)}s`;

  const lead = slotWidth * FLOW_PULSE_LEAD;
  const travel = Math.min(FLOW_PULSE_MAX_TRAVEL, slotWidth * FLOW_PULSE_TRAVEL);
  const ramp = slotWidth * FLOW_PULSE_RAMP;

  return lines(
    Array.from({ length: placed.slot.count }, (_, index) => {
      const start = (placed.slot.start + index) * slotWidth + lead;
      const finish = start + travel;

      return wrap(
        "circle",
        { r: 2.8, fill: colour, opacity: 0 },
        tag("animateMotion", {
          dur: duration,
          repeatCount: "indefinite",
          keyPoints: "0;0;1;1",
          keyTimes: `0;${ratio(start)};${ratio(finish)};1`,
          calcMode: "linear",
          path,
        }) +
          tag("animate", {
            attributeName: "opacity",
            dur: duration,
            repeatCount: "indefinite",
            values: "0;0;1;1;0;0",
            keyTimes: `0;${ratio(start)};${ratio(start + ramp)};${ratio(finish)};${ratio(finish + ramp)};1`,
          }),
      );
    }),
  );
};

const paintMessage = (
  placed: PlacedMessage,
  activeAt: ActiveAt,
  slotCount: number,
  palette: Palette,
): string => {
  const tone = toneFor(placed.message.delta);
  const direction = travelDirection(placed.message.kind, placed.fromX, placed.toX);
  const head = headFor(placed.message.kind, tone);

  if (direction === 0) {
    const path = selfPath(placed.fromX, placed.y, activeAt(placed.message.from, placed.y));
    return wrap(
      "g",
      {},
      lines([
        textNode(
          {
            class: "msg-label",
            x: coord(placed.fromX + ACTIVATION_HALF_WIDTH + 12),
            y: coord(placed.y - 8),
            "text-anchor": "start",
          },
          placed.label,
        ),
        tag("path", { class: messageClasses(placed.message, tone), d: path, "marker-end": head }),
        pulsesFor(placed, path, slotCount, palette),
      ]),
    );
  }

  const { start, end } = endsFor(placed, activeAt, direction);
  const path = `M${coord(start)},${coord(placed.y)} L${coord(end)},${coord(placed.y)}`;

  return wrap(
    "g",
    {},
    lines([
      textNode(
        { class: "msg-label", x: coord((start + end) / 2), y: coord(placed.y - 7) },
        placed.label,
      ),
      tag("path", { class: messageClasses(placed.message, tone), d: path, "marker-end": head }),
      pulsesFor(placed, path, slotCount, palette),
    ]),
  );
};

const paintFlow = (
  layout: FlowLayout,
  columnWidth: number,
  slotCount: number,
  palette: Palette,
): string => {
  const activeAt = activationLookup(layout);

  const lifelineBottom = layout.top + layout.height;

  const columns = layout.participants.map((participant) =>
    lines([
      tag("line", {
        class: "lifeline",
        x1: coord(participant.centreX),
        y1: coord(layout.top + LIFELINE_TOP),
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

  const cards = layout.participants.map((participant) =>
    lines([
      tag("rect", {
        class: "pcard",
        x: coord(participant.centreX - columnWidth / 2),
        y: coord(layout.top + PARTICIPANT_TOP),
        width: coord(columnWidth),
        height: PARTICIPANT_HEIGHT,
        rx: 8,
      }),
      textNode(
        {
          class: "ptitle",
          x: coord(participant.centreX),
          y: coord(layout.top + PARTICIPANT_TOP + 21),
        },
        participant.label,
      ),
    ]),
  );

  return lines([
    wrap("g", {}, lines(columns)),
    wrap("g", { class: "cardsh" }, lines(cards)),
    wrap(
      "g",
      {},
      lines(layout.messages.map((message) => paintMessage(message, activeAt, slotCount, palette))),
    ),
  ]);
};

const MESSAGE_LABEL_SIZE = 11;

/**
 * The room a flow's own drawing takes, labels included. A message label is
 * centred on its arrow and a self-message label runs off to the right of one,
 * so either can reach past the columns the layout sized the canvas from.
 */
const flowBounds = (layout: FlowLayout, columnWidth: number): Box[] => {
  const activeAt = activationLookup(layout);

  const columns = layout.participants.map((participant) => ({
    x: participant.centreX - columnWidth / 2,
    y: layout.top + PARTICIPANT_TOP,
    width: columnWidth,
    height: layout.top + layout.height - (layout.top + PARTICIPANT_TOP),
  }));

  const labels = layout.messages.map((placed) => {
    const width = measure(placed.label, "sans-bold", MESSAGE_LABEL_SIZE);
    const direction = travelDirection(placed.message.kind, placed.fromX, placed.toX);

    if (direction === 0)
      return {
        x: placed.fromX + ACTIVATION_HALF_WIDTH + 12,
        y: placed.y - 8 - MESSAGE_LABEL_SIZE,
        width,
        height: MESSAGE_LABEL_SIZE,
      };

    const { start, end } = endsFor(placed, activeAt, direction);
    return {
      x: (start + end) / 2 - width / 2,
      y: placed.y - 7 - MESSAGE_LABEL_SIZE,
      width,
      height: MESSAGE_LABEL_SIZE,
    };
  });

  const loops = layout.messages
    .filter((placed) => placed.message.kind === "self")
    .map((placed) => ({
      x: placed.fromX,
      y: placed.y,
      width: SELF_LOOP_REACH + SELF_LOOP_CORNER + ACTIVATION_HALF_WIDTH,
      height: SELF_LOOP_DROP + SELF_LOOP_CORNER * 2,
    }));

  return [...columns, ...labels, ...loops];
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
      lines(
        layout.flows.map((flow) => paintFlow(flow, layout.columnWidth, layout.slotCount, palette)),
      ),
    ),
  };
};

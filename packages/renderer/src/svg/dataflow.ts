import type { Flow, FlowMessage, GraphNode, MessageKind } from "@coldtea/pr-lens-schema";
import { assertNever } from "@coldtea/pr-lens-schema";
import {
  FLOW_CYCLE_DURATION,
  FLOW_MAX_PULSES_PER_MESSAGE,
  FLOW_PULSE_LEAD,
  FLOW_PULSE_TRAVEL,
} from "../design.js";
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
import { markerFor, toneColour, toneFor, type Tone } from "./document.js";
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

type Ends = { start: number; end: number };

/**
 * Where an arrow starts and stops horizontally. An activated column is a bar,
 * not a line, so an arrow that touches one has to stop at its edge, and the
 * arrowhead needs room of its own on top of that.
 */
const endsFor = (
  placed: PlacedMessage,
  activated: ReadonlySet<string>,
  direction: -1 | 1,
): Ends => ({
  start: placed.fromX + direction * (activated.has(placed.message.from) ? ACTIVATION_HALF_WIDTH : 0),
  end:
    placed.toX -
    direction * ((activated.has(placed.message.to) ? ACTIVATION_HALF_WIDTH : 0) + MARKER_INSET),
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

  return lines(
    Array.from({ length: placed.slot.count }, (_, index) => {
      const start = Math.min(
        (placed.slot.start + index) * slotWidth + FLOW_PULSE_LEAD,
        1 - FLOW_PULSE_TRAVEL - 0.02,
      );
      const finish = start + FLOW_PULSE_TRAVEL;

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
            keyTimes: `0;${ratio(start)};${ratio(start + 0.01)};${ratio(finish)};${ratio(finish + 0.01)};1`,
          }),
      );
    }),
  );
};

const paintMessage = (
  placed: PlacedMessage,
  activated: ReadonlySet<string>,
  slotCount: number,
  palette: Palette,
): string => {
  const tone = toneFor(placed.message.delta);
  const direction = travelDirection(placed.message.kind, placed.fromX, placed.toX);

  if (direction === 0) {
    const path = selfPath(placed.fromX, placed.y, activated.has(placed.message.from));
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
        tag("path", { class: messageClasses(placed.message, tone), d: path, "marker-end": markerFor(tone) }),
        pulsesFor(placed, path, slotCount, palette),
      ]),
    );
  }

  const { start, end } = endsFor(placed, activated, direction);
  const path = `M${coord(start)},${coord(placed.y)} L${coord(end)},${coord(placed.y)}`;

  return wrap(
    "g",
    {},
    lines([
      textNode(
        { class: "msg-label", x: coord((start + end) / 2), y: coord(placed.y - 7) },
        placed.label,
      ),
      tag("path", { class: messageClasses(placed.message, tone), d: path, "marker-end": markerFor(tone) }),
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
  const activated = new Set(
    layout.flow.participants
      .filter((_, index) => layout.participants[index]?.activation !== undefined)
      .map((participant) => participant.node),
  );

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
      participant.activation === undefined
        ? ""
        : tag("rect", {
            class: "actbar",
            x: coord(participant.centreX - ACTIVATION_HALF_WIDTH),
            y: coord(participant.activation.top),
            width: ACTIVATION_HALF_WIDTH * 2,
            height: coord(participant.activation.bottom - participant.activation.top),
            rx: 4,
          }),
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
      lines(layout.messages.map((message) => paintMessage(message, activated, slotCount, palette))),
    ),
  ]);
};

export type DataFlowPainting = { width: number; height: number; body: string };

export const paintDataFlow = (
  flows: readonly Flow[],
  nodes: readonly GraphNode[],
  palette: Palette,
): DataFlowPainting => {
  const layout = layoutDataFlow(flows, nodes, FLOW_MAX_PULSES_PER_MESSAGE);

  return {
    width: layout.width,
    height: layout.height,
    body: lines(
      layout.flows.map((flow) => paintFlow(flow, layout.columnWidth, layout.slotCount, palette)),
    ),
  };
};

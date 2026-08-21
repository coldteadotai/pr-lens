import type { Flow, FlowMessage, GraphNode } from "@coldtea/pr-lens-schema";
import { DIAGRAM_MARGIN } from "../design.js";
import { measure } from "../text.js";

export const PARTICIPANT_TOP = 18;
export const PARTICIPANT_HEIGHT = 34;
export const LIFELINE_TOP = 54;
export const FIRST_MESSAGE_Y = 95;
export const MESSAGE_PITCH = 38;
export const SELF_MESSAGE_PITCH = 54;
export const FLOW_BOTTOM_PADDING = 24;
export const FLOW_GAP = 40;

export const COLUMN_MIN_WIDTH = 150;
export const COLUMN_GAP = 80;
export const COLUMN_PADDING_X = 16;

/** Half the width of an activation bar, and how far it holds arrows off the lifeline. */
export const ACTIVATION_HALF_WIDTH = 6;
export const MARKER_INSET = 5;

export const SELF_LOOP_REACH = 52;
export const SELF_LOOP_DROP = 6;
export const SELF_LOOP_CORNER = 7;
/** How far below its own row a self-message loop reaches. */
export const SELF_LOOP_EXTENT = SELF_LOOP_DROP + SELF_LOOP_CORNER * 2;

export type ActivationBar = { top: number; bottom: number };

export type PlacedParticipant = {
  label: string;
  centreX: number;
  /** Spans where this column is working on a synchronous call it received. */
  activations: ActivationBar[];
};

export type PlacedMessage = {
  message: FlowMessage;
  /** The label as drawn, with a repeat count folded in when there is one. */
  label: string;
  y: number;
  fromX: number;
  toX: number;
  /** How many pulses ride this message per cycle, and where they sit in it. */
  slot: { start: number; count: number };
};

export type FlowLayout = {
  flow: Flow;
  top: number;
  height: number;
  participants: PlacedParticipant[];
  messages: PlacedMessage[];
};

export type DataFlowLayout = {
  width: number;
  height: number;
  /** One width for every column of every flow, so stacked flows line up. */
  columnWidth: number;
  flows: FlowLayout[];
  /** Length of the shared cycle every pulse in the drawing runs on. */
  slotCount: number;
};

const messagePitch = (message: FlowMessage): number =>
  message.kind === "self" ? SELF_MESSAGE_PITCH : MESSAGE_PITCH;

/**
 * A message occupies one beat of the cycle, except a repeated one, which
 * occupies a beat per pulse it draws — that is what makes four batched calls
 * read as four calls rather than as one that takes four times as long.
 */
export const pulseCount = (message: FlowMessage, cap: number): number =>
  Math.min(message.repeat ?? 1, cap);

const labelFor = (message: FlowMessage): string =>
  message.repeat === undefined || message.repeat === 1
    ? message.label
    : `${message.label} ×${message.repeat}`;

/**
 * A synchronous call is the one kind whose sender waits, so it is the one
 * kind that activates its receiver: the bar starts where the call arrives and
 * runs to the return that answers it — the first later `return` back to the
 * caller not already claimed by an earlier call. A call no return answers
 * keeps its receiver active through the receiver's last involvement, because
 * the diagram never shows the work finishing. Async and self messages
 * activate nothing: neither implies anyone is waiting.
 */
const activationsFor = (
  node: string,
  messages: readonly PlacedMessage[],
): ActivationBar[] => {
  const claimed = new Set<number>();
  const bars: ActivationBar[] = [];

  messages.forEach((placed, index) => {
    if (placed.message.kind !== "sync" || placed.message.to !== node) return;

    const answer = messages.findIndex(
      (candidate, position) =>
        position > index &&
        !claimed.has(position) &&
        candidate.message.kind === "return" &&
        candidate.message.from === node &&
        candidate.message.to === placed.message.from,
    );

    const answered = messages[answer];
    if (answer !== -1 && answered !== undefined) {
      claimed.add(answer);
      bars.push({ top: placed.y, bottom: answered.y });
      return;
    }

    const last = messages.reduce(
      (lowest, candidate, position) =>
        position >= index &&
        (candidate.message.from === node || candidate.message.to === node)
          ? Math.max(lowest, candidate.y)
          : lowest,
      placed.y,
    );
    bars.push({ top: placed.y, bottom: last + MESSAGE_PITCH / 3 });
  });

  return mergedBars(bars);
};

/**
 * Nested or unanswered calls can hand one column overlapping spans; a single
 * bar per busy stretch keeps the drawing readable. Bars arrive ordered by
 * top, because message y only ever grows.
 */
const mergedBars = (bars: readonly ActivationBar[]): ActivationBar[] => {
  const merged: ActivationBar[] = [];
  for (const bar of bars) {
    const current = merged[merged.length - 1];
    if (current !== undefined && bar.top <= current.bottom)
      current.bottom = Math.max(current.bottom, bar.bottom);
    else merged.push({ ...bar });
  }
  return merged;
};

const columnLabel = (
  participantLabel: string | undefined,
  node: GraphNode | undefined,
  fallback: string,
): string => participantLabel ?? node?.label ?? fallback;

export const layoutDataFlow = (
  flows: readonly Flow[],
  nodes: readonly GraphNode[],
  pulseCap: number,
): DataFlowLayout => {
  const byId = new Map(nodes.map((node) => [node.id, node]));

  const columnWidth = Math.max(
    COLUMN_MIN_WIDTH,
    ...flows.flatMap((flow) =>
      flow.participants.map(
        (participant) =>
          measure(columnLabel(participant.label, byId.get(participant.node), participant.node), "sans-bold", 12) +
          COLUMN_PADDING_X * 2,
      ),
    ),
  );

  let slotCount = 0;
  for (const flow of flows)
    for (const message of flow.messages) slotCount += pulseCount(message, pulseCap);

  let cursorY = 0;
  let slotCursor = 0;
  let width = 0;

  const placed = flows.map((flow) => {
    const centres = flow.participants.map(
      (_, index) => DIAGRAM_MARGIN + columnWidth / 2 + index * (columnWidth + COLUMN_GAP),
    );
    const centreOf = new Map(
      flow.participants.map((participant, index) => [participant.node, centres[index] ?? 0]),
    );

    let messageY = cursorY + FIRST_MESSAGE_Y;
    const messages: PlacedMessage[] = flow.messages.map((message) => {
      const y = messageY;
      messageY += messagePitch(message);
      const count = pulseCount(message, pulseCap);
      const slot = { start: slotCursor, count };
      slotCursor += count;
      return {
        message,
        label: labelFor(message),
        y,
        fromX: centreOf.get(message.from) ?? 0,
        toX: centreOf.get(message.to) ?? 0,
        slot,
      };
    });

    const participants = flow.participants.map((participant, index) => ({
      label: columnLabel(participant.label, byId.get(participant.node), participant.node),
      centreX: centres[index] ?? 0,
      activations: activationsFor(participant.node, messages),
    }));

    const drawn = messages.reduce(
      (lowest, placedMessage) =>
        Math.max(lowest, placedMessage.y + (placedMessage.message.kind === "self" ? SELF_LOOP_EXTENT : 0)),
      cursorY + FIRST_MESSAGE_Y,
    );
    const bottom = drawn + FLOW_BOTTOM_PADDING;
    const height = bottom - cursorY;
    const top = cursorY;
    cursorY = bottom + FLOW_GAP;
    width = Math.max(
      width,
      (centres[centres.length - 1] ?? 0) + columnWidth / 2 + DIAGRAM_MARGIN,
    );

    return { flow, top, height, participants, messages };
  });

  return {
    // Whole numbers, for the same reason the architecture canvas uses them.
    width: Math.ceil(width),
    height: Math.ceil(cursorY - FLOW_GAP + DIAGRAM_MARGIN),
    columnWidth,
    flows: placed,
    slotCount,
  };
};

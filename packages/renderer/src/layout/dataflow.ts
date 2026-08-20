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

export type PlacedParticipant = {
  label: string;
  centreX: number;
  /** Whether an activation bar runs down this column, and where. */
  activation: { top: number; bottom: number } | undefined;
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
 * A participant is drawn as active from its first involvement to its last,
 * but only when it both receives and sends: a column that only ever emits is
 * a caller, and one that only ever receives is a sink. Neither is doing work
 * the diagram can show the duration of.
 */
const activationFor = (
  node: string,
  messages: readonly PlacedMessage[],
): { top: number; bottom: number } | undefined => {
  const involved = messages.filter(
    ({ message }) => message.from === node || message.to === node,
  );
  if (involved.length === 0) return undefined;

  const receives = involved.some(({ message }) => message.to === node);
  const sends = involved.some(({ message }) => message.from === node);
  if (!receives || !sends) return undefined;

  const first = involved[0];
  const last = involved[involved.length - 1];
  if (first === undefined || last === undefined) return undefined;
  return { top: first.y - MESSAGE_PITCH / 3, bottom: last.y + MESSAGE_PITCH / 3 };
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
      activation: activationFor(participant.node, messages),
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

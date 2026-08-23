import type { Flow, FlowMessage, FlowParticipant, GraphNode } from "@coldtea/pr-lens-schema";
import {
  CARD_HEIGHT,
  CARD_HEIGHT_WITH_SUBTITLE,
  CARD_PADDING_X,
  DIAGRAM_MARGIN,
  ICON_CHIP_GAP,
  ICON_CHIP_SIZE,
  SUBTITLE_SIZE,
  TITLE_SIZE,
} from "../design.js";
import type { Box } from "../geometry.js";
import { measure } from "../text.js";

export const PARTICIPANT_TOP = 18;
/** The lifeline hangs just clear of the card that heads its column. */
export const LIFELINE_GAP = 2;
/** Where the first message sits below the top of the lifelines. */
export const FIRST_MESSAGE_DROP = 41;
export const MESSAGE_PITCH = 38;
export const SELF_MESSAGE_PITCH = 54;
export const FLOW_BOTTOM_PADDING = 24;
export const FLOW_GAP = 40;

export const COLUMN_MIN_WIDTH = 150;
export const COLUMN_GAP = 80;

/**
 * How far a column's band reaches beyond its cards, echoing the padding a
 * lane keeps around the cards it holds.
 */
export const FLOW_BAND_PAD_X = 12;
export const FLOW_BAND_PAD_Y = 12;

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
  /** The node this column stands for, its label swapped for the column's. */
  node: GraphNode;
  centreX: number;
  /** The node card heading the column, in the full card design system. */
  card: Box;
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
  /** Which beats of the drawing's cycle belong to this message, and how many. */
  slot: { start: number; count: number };
};

export type FlowLayout = {
  flow: Flow;
  top: number;
  height: number;
  /** Where the lifelines start — under the tallest card in the header row. */
  lifelineTop: number;
  participants: PlacedParticipant[];
  messages: PlacedMessage[];
};

export type DataFlowLayout = {
  width: number;
  height: number;
  /** One width for every column of every flow, so stacked flows line up. */
  columnWidth: number;
  flows: FlowLayout[];
  /** Beats in the shared cycle: one per pulse the drawing draws. */
  slotCount: number;
};

const messagePitch = (message: FlowMessage): number =>
  message.kind === "self" ? SELF_MESSAGE_PITCH : MESSAGE_PITCH;

/**
 * How many turns a message takes in the cycle: one per repeat, up to the cap,
 * so a repeated step crosses its own arrow several times running rather than
 * once.
 *
 * A step the document leaves unanimated takes none. Reserving a turn for one
 * that draws nothing would put a hole in the relay — the drawing would go
 * dark for the length of it, which is the very thing sharing a cycle is meant
 * to avoid. This is the one place that count is decided, so the schedule and
 * the painting cannot disagree about it.
 */
export const pulseCount = (message: FlowMessage, cap: number): number =>
  message.animated ? Math.min(message.repeat ?? 1, cap) : 0;

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

/**
 * The node a column stands for, as the card will show it: the column's own
 * shorter label wins over the node's, and a participant the graph no longer
 * carries still needs a card, so a placeholder node stands in for one.
 */
const participantNode = (
  participant: FlowParticipant,
  byId: ReadonlyMap<string, GraphNode>,
): GraphNode => {
  const node = byId.get(participant.node);
  if (node === undefined)
    return {
      id: participant.node,
      label: participant.label ?? participant.node,
      kind: "other",
      delta: "unchanged",
      lane: "",
      files: [],
      badges: [],
    };
  return participant.label === undefined ? node : { ...node, label: participant.label };
};

const cardHeight = (node: GraphNode): number =>
  node.subtitle === undefined ? CARD_HEIGHT : CARD_HEIGHT_WITH_SUBTITLE;

/** The width a column's card asks for: chip, title, and mono subtitle. */
const cardContentWidth = (node: GraphNode): number =>
  CARD_PADDING_X * 2 +
  ICON_CHIP_SIZE +
  ICON_CHIP_GAP +
  Math.max(
    measure(node.label, "sans-bold", TITLE_SIZE),
    node.subtitle === undefined ? 0 : measure(node.subtitle, "mono", SUBTITLE_SIZE),
  );

export const layoutDataFlow = (
  flows: readonly Flow[],
  nodes: readonly GraphNode[],
  pulseCap: number,
): DataFlowLayout => {
  const byId = new Map(nodes.map((node) => [node.id, node]));

  // A whole pixel: adding measured widths leaves floating-point dust, and a
  // card handed back exactly the width its title measured would round into
  // truncating that title.
  const columnWidth = Math.ceil(
    Math.max(
      COLUMN_MIN_WIDTH,
      ...flows.flatMap((flow) =>
        flow.participants.map((participant) => cardContentWidth(participantNode(participant, byId))),
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
    const columnNodes = flow.participants.map((participant) => participantNode(participant, byId));
    const centres = flow.participants.map(
      (_, index) => DIAGRAM_MARGIN + columnWidth / 2 + index * (columnWidth + COLUMN_GAP),
    );
    const centreOf = new Map(
      flow.participants.map((participant, index) => [participant.node, centres[index] ?? 0]),
    );

    const lifelineTop =
      cursorY + PARTICIPANT_TOP + Math.max(...columnNodes.map(cardHeight)) + LIFELINE_GAP;

    let messageY = lifelineTop + FIRST_MESSAGE_DROP;
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

    const participants = columnNodes.map((node, index) => {
      const centreX = centres[index] ?? 0;
      return {
        node,
        centreX,
        card: {
          x: centreX - columnWidth / 2,
          y: cursorY + PARTICIPANT_TOP,
          width: columnWidth,
          height: cardHeight(node),
        },
        activations: activationsFor(node.id, messages),
      };
    });

    const drawn = messages.reduce(
      (lowest, placedMessage) =>
        Math.max(lowest, placedMessage.y + (placedMessage.message.kind === "self" ? SELF_LOOP_EXTENT : 0)),
      lifelineTop + FIRST_MESSAGE_DROP,
    );
    const bottom = drawn + FLOW_BOTTOM_PADDING;
    const height = bottom - cursorY;
    const top = cursorY;
    cursorY = bottom + FLOW_GAP;
    width = Math.max(
      width,
      (centres[centres.length - 1] ?? 0) + columnWidth / 2 + DIAGRAM_MARGIN,
    );

    return { flow, top, height, lifelineTop, participants, messages };
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

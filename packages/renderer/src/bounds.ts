import type { Box } from "./geometry.js";

/** The smallest box containing all of them, or nothing when there are none. */
export const union = (boxes: readonly Box[]): Box | undefined => {
  const first = boxes[0];
  if (first === undefined) return undefined;

  let left = first.x;
  let top = first.y;
  let right = first.x + first.width;
  let bottom = first.y + first.height;

  for (const box of boxes) {
    left = Math.min(left, box.x);
    top = Math.min(top, box.y);
    right = Math.max(right, box.x + box.width);
    bottom = Math.max(bottom, box.y + box.height);
  }

  return { x: left, y: top, width: right - left, height: bottom - top };
};

export type Canvas = { width: number; height: number; shiftX: number; shiftY: number };

/**
 * A canvas big enough for everything that was drawn.
 *
 * Edge routes deliberately leave their lane, and a label pill can be pushed
 * past the last card in search of clear air, so the space the lanes occupy is
 * a floor rather than the answer. The canvas only ever grows: the margins the
 * design leaves above and beside the lanes are part of the design, not slack
 * to be reclaimed.
 */
export const canvasFor = (
  laid: { width: number; height: number },
  drawn: Box | undefined,
  margin: number,
): Canvas => {
  if (drawn === undefined) return { width: laid.width, height: laid.height, shiftX: 0, shiftY: 0 };

  const shiftX = Math.max(0, margin - drawn.x);
  const shiftY = Math.max(0, margin - drawn.y);

  return {
    width: Math.ceil(Math.max(laid.width, drawn.x + drawn.width + margin) + shiftX),
    height: Math.ceil(Math.max(laid.height, drawn.y + drawn.height + margin) + shiftY),
    shiftX,
    shiftY,
  };
};

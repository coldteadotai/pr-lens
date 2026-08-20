export type Point = { x: number; y: number };

export type Box = { x: number; y: number; width: number; height: number };

/** Which face of a box a line meets. */
export type Side = "top" | "right" | "bottom" | "left";

/**
 * Every coordinate the renderer writes goes through here. Floating point
 * arithmetic that differs in the last bit would otherwise change the bytes of
 * the document without changing the picture, and the render hash with it.
 */
export const coord = (value: number): string => {
  const rounded = Math.round(value * 100) / 100;
  const normalised = Object.is(rounded, -0) ? 0 : rounded;
  return String(normalised);
};

export const boxCentre = (box: Box): Point => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
});

import type { Box } from "../geometry.js";

/** One row, left to right, never stored. The canvas and the embed share it, so their cameras agree. */

/** Wide enough that two tiles never read as one picture. */
export const TILE_GAP = 162;

/** Room above each tile for its caption. */
export const CAPTION_ROOM = 40;

export type Sized = { id: string; width: number; height: number };

export type StripBox = Box & { id: string };

export type StripLayout = { boxes: StripBox[]; width: number; height: number };

export function stripLayout(tiles: readonly Sized[]): StripLayout {
  let cursor = 0;
  const boxes = tiles.map((tile) => {
    const box = { id: tile.id, x: cursor, y: CAPTION_ROOM, width: tile.width, height: tile.height };
    cursor += tile.width + TILE_GAP;
    return box;
  });

  return {
    boxes,
    width: Math.max(cursor - TILE_GAP, 0),
    height: CAPTION_ROOM + Math.max(0, ...tiles.map((tile) => tile.height)),
  };
}

/** A tile with the caption above it. */
export const tileRect = (box: StripBox): Box => ({
  x: box.x,
  y: box.y - CAPTION_ROOM,
  width: box.width,
  height: box.height + CAPTION_ROOM,
});

export const stripRect = (layout: StripLayout): Box => ({ x: 0, y: 0, width: layout.width, height: layout.height });

/** Enough to read a label on the widest render at a laptop's width. */
export const MAX_SCALE = 6;

/** Far enough out that thirty renders fit in a window. */
export const MIN_SCALE = 0.02;

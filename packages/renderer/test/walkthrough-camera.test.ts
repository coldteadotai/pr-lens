import { describe, expect, it } from "vitest";
import {
  CAPTION_ROOM,
  easeInOut,
  flightFor,
  frame,
  interpolateFlight,
  lerpRect,
  stripLayout,
  stripRect,
  TILE_GAP,
  tileRect,
  type Stage,
} from "../src/index.js";

const whole = (width: number, height: number): Stage => ({ left: 0, top: 0, width, height });

describe("stripLayout", () => {
  it("lays tiles left to right in one row, top-aligned, with a fixed gap", () => {
    const layout = stripLayout([
      { id: "a", width: 1000, height: 600 },
      { id: "b", width: 500, height: 300 },
      { id: "c", width: 800, height: 900 },
    ]);

    expect(layout.boxes.map((box) => [box.x, box.y])).toEqual([
      [0, CAPTION_ROOM],
      [1000 + TILE_GAP, CAPTION_ROOM],
      [1000 + TILE_GAP + 500 + TILE_GAP, CAPTION_ROOM],
    ]);
    expect(layout.width).toBe(1000 + 500 + 800 + TILE_GAP * 2);
    expect(layout.height).toBe(CAPTION_ROOM + 900);
  });

  it("is empty for no tiles", () => {
    expect(stripLayout([])).toEqual({ boxes: [], width: 0, height: CAPTION_ROOM });
  });

  it("includes the caption in what a tile means to fit to", () => {
    const layout = stripLayout([{ id: "a", width: 100, height: 50 }]);
    const [box] = layout.boxes;
    expect(box && tileRect(box)).toEqual({ x: 0, y: 0, width: 100, height: 50 + CAPTION_ROOM });
    expect(stripRect(layout)).toEqual({ x: 0, y: 0, width: 100, height: 50 + CAPTION_ROOM });
  });
});

describe("frame", () => {
  it("centres a rectangle at the largest scale that leaves the padding", () => {
    const viewport = frame({ kind: "diagram" }, { x: 200, y: 0, width: 1000, height: 500 }, whole(1160, 800));
    expect(viewport.scale).toBe(1);
    expect(viewport.x).toBe((1160 - 1000) / 2 - 200);
    expect(viewport.y).toBe((800 - 500) / 2);
  });

  it("never enlarges a diagram or the strip past natural size", () => {
    const small = { x: 0, y: 0, width: 100, height: 100 };
    expect(frame({ kind: "diagram" }, small, whole(2000, 2000)).scale).toBe(1);
    expect(frame({ kind: "strip" }, small, whole(2000, 2000)).scale).toBe(1);
  });

  it("lets a selection fill the stage, but never past twice natural size", () => {
    expect(frame({ kind: "selection" }, { x: 0, y: 0, width: 100, height: 100 }, whole(2000, 2000)).scale).toBe(2);
    expect(frame({ kind: "selection" }, { x: 0, y: 0, width: 2000, height: 100 }, whole(1200, 800)).scale).toBeCloseTo(
      0.544,
      3,
    );
  });

  it("zooms out as far as a wide strip needs", () => {
    const viewport = frame({ kind: "strip" }, { x: 0, y: 0, width: 20_000, height: 1000 }, whole(1200, 800));
    expect(viewport.scale).toBeCloseTo((1200 - 160) / 20_000, 6);
  });

  it("centres in the stage it is given, not in the window", () => {
    const rect = { x: 0, y: 0, width: 400, height: 400 };
    const beside = frame({ kind: "diagram" }, rect, { left: 400, top: 0, width: 1000, height: 800 });
    expect(beside.x).toBe(400 + (1000 - 400) / 2);
  });
});

describe("flightFor", () => {
  it("cuts when the reader has asked for less motion", () => {
    expect(flightFor(3, true)).toEqual({ kind: "cut" });
  });

  it("scales with the distance, between a floor and a ceiling", () => {
    expect(flightFor(0, false)).toEqual({ kind: "smooth", durationMs: 560 });
    expect(flightFor(2, false)).toEqual({ kind: "smooth", durationMs: 840 });
    expect(flightFor(99, false)).toEqual({ kind: "smooth", durationMs: 1500 });
  });
});

describe("interpolateFlight", () => {
  const stage = whole(1200, 800);

  it("starts where it started and ends where it was sent", () => {
    const from = { x: 0, y: 0, scale: 1 };
    const to = { x: -3000, y: -200, scale: 2 };
    const path = interpolateFlight(from, to, stage);

    for (const [at, expected] of [
      [0, from],
      [1, to],
    ] as const) {
      const viewport = path.at(at);
      expect(viewport.x).toBeCloseTo(expected.x, 6);
      expect(viewport.y).toBeCloseTo(expected.y, 6);
      expect(viewport.scale).toBeCloseTo(expected.scale, 6);
    }
  });

  it("pulls out over the strip on the way between two far-apart diagrams", () => {
    const path = interpolateFlight({ x: 0, y: 0, scale: 1 }, { x: -6000, y: 0, scale: 1 }, stage);
    expect(path.at(0.5).scale).toBeLessThan(0.5);
    expect(path.distance).toBeGreaterThan(1);
  });

  it("is a short hop when the camera stays put and only leans in", () => {
    const closer = { x: 600 - 600 * 1.2, y: 400 - 400 * 1.2, scale: 1.2 };
    const path = interpolateFlight({ x: 0, y: 0, scale: 1 }, closer, stage);
    expect(path.distance).toBeLessThan(0.2);
    expect(path.at(1).scale).toBeCloseTo(1.2, 6);
  });
});

describe("easing and the hole", () => {
  it("eases in and out around the middle", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(0.5)).toBe(0.5);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.25)).toBeLessThan(0.25);
    expect(easeInOut(0.75)).toBeGreaterThan(0.75);
  });

  it("lands the hole exactly on its target", () => {
    const from = { x: 0, y: 0, width: 10, height: 10 };
    const to = { x: 100, y: 50, width: 200, height: 80 };
    expect(lerpRect(from, to, 0)).toEqual(from);
    expect(lerpRect(from, to, 1)).toEqual(to);
    expect(lerpRect(from, to, 0.5)).toEqual({ x: 50, y: 25, width: 105, height: 45 });
  });
});

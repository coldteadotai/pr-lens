import { assertNever } from "@coldtea/pr-lens-schema";
import type { Box } from "../geometry.js";
import { MAX_SCALE, MIN_SCALE } from "./layout.js";

/** The canvas and the embed both frame steps here, so a step lands the same way in both. */
export type FramingPolicy = { kind: "strip" } | { kind: "diagram" } | { kind: "selection" } | { kind: "component" };

export type Flight = { kind: "cut" } | { kind: "smooth"; durationMs: number };

/** The transform a stage applies to the strip. Translate first, then scale. */
export type Viewport = { x: number; y: number; scale: number };

/** The part of the window the pictures get. */
export type Stage = { left: number; top: number; width: number; height: number };

type Framing = { maxScale: number; padding: number };

const framing = (policy: FramingPolicy): Framing => {
  switch (policy.kind) {
    // A small render is never enlarged to fill the window.
    case "strip":
    case "diagram":
      return { maxScale: 1, padding: 80 };
    // A selection fills the stage. It is already padded, so it gets less air.
    case "selection":
      return { maxScale: 2, padding: 56 };
    // One component with its neighbours still in view.
    case "component":
      return { maxScale: 1, padding: 220 };
    default:
      return assertNever(policy, "Unhandled framing policy");
  }
};

/** The transform that shows `rect` whole and centred in the stage. */
export function frame(policy: FramingPolicy, rect: Box, stage: Stage): Viewport {
  const { maxScale, padding } = framing(policy);
  // On a stage smaller than the padding, the padding shrinks instead of the picture.
  const air = Math.min(padding, stage.width / 6, stage.height / 6);
  const fitted = Math.min(
    (stage.width - air * 2) / rect.width,
    (stage.height - air * 2) / rect.height,
    maxScale,
  );
  const scale = Math.min(Math.max(fitted, MIN_SCALE), MAX_SCALE);

  return {
    x: stage.left + (stage.width - rect.width * scale) / 2 - rect.x * scale,
    y: stage.top + (stage.height - rect.height * scale) / 2 - rect.y * scale,
    scale,
  };
}

/** Short enough not to feel like a wait, long enough that a jump across the strip reads as travel. */
const MIN_FLIGHT_MS = 560;
const MAX_FLIGHT_MS = 1500;
const MS_PER_UNIT = 420;

export function flightFor(distance: number, reducedMotion: boolean): Flight {
  if (reducedMotion) return { kind: "cut" };
  return { kind: "smooth", durationMs: Math.min(Math.max(distance * MS_PER_UNIT, MIN_FLIGHT_MS), MAX_FLIGHT_MS) };
}

export const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export const lerpRect = (from: Box, to: Box, t: number): Box => ({
  x: from.x + (to.x - from.x) * t,
  y: from.y + (to.y - from.y) * t,
  width: from.width + (to.width - from.width) * t,
  height: from.height + (to.height - from.height) * t,
});

/** A camera as the interpolation sees it: where it looks, and how much world the stage spans. */
type View = [x: number, y: number, span: number];

const centre = (stage: Stage) => ({ x: stage.left + stage.width / 2, y: stage.top + stage.height / 2 });

const toView = (viewport: Viewport, stage: Stage): View => {
  const middle = centre(stage);
  return [
    (middle.x - viewport.x) / viewport.scale,
    (middle.y - viewport.y) / viewport.scale,
    stage.width / viewport.scale,
  ];
};

const fromView = (view: View, stage: Stage): Viewport => {
  const middle = centre(stage);
  const scale = stage.width / view[2];
  return { x: middle.x - view[0] * scale, y: middle.y - view[1] * scale, scale };
};

export type FlightPath = {
  at: (t: number) => Viewport;
  /** The path's length in the interpolation's units. It sets the duration. */
  distance: number;
};

const cosh = (x: number) => (Math.exp(x) + Math.exp(-x)) / 2;
const sinh = (x: number) => (Math.exp(x) - Math.exp(-x)) / 2;
const tanh = (x: number) => {
  const e = Math.exp(2 * x);
  return (e - 1) / (e + 1);
};

const RHO = Math.SQRT2;

/** The van Wijk and Nuij path, as d3-interpolate spells it out: out far enough to see both ends, then back in. */
export function interpolateFlight(from: Viewport, to: Viewport, stage: Stage): FlightPath {
  const [ux0, uy0, w0] = toView(from, stage);
  const [ux1, uy1, w1] = toView(to, stage);
  const dx = ux1 - ux0;
  const dy = uy1 - uy0;
  const d2 = dx * dx + dy * dy;
  const rho2 = RHO * RHO;
  const rho4 = rho2 * rho2;

  if (d2 < 1e-12) {
    const distance = Math.abs(Math.log(w1 / w0) / RHO);
    return {
      distance,
      at: (t) => fromView([ux0 + t * dx, uy0 + t * dy, w0 * Math.exp(RHO * t * (Math.log(w1 / w0) / RHO))], stage),
    };
  }

  const d1 = Math.sqrt(d2);
  const b0 = (w1 * w1 - w0 * w0 + rho4 * d2) / (2 * w0 * rho2 * d1);
  const b1 = (w1 * w1 - w0 * w0 - rho4 * d2) / (2 * w1 * rho2 * d1);
  const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
  const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
  const S = (r1 - r0) / RHO;
  const c0 = cosh(r0);

  return {
    distance: Math.abs(S),
    at: (t) => {
      const s = t * S;
      const u = (w0 / (rho2 * d1)) * (c0 * tanh(RHO * s + r0) - sinh(r0));
      return fromView([ux0 + u * dx, uy0 + u * dy, (w0 * c0) / cosh(RHO * s + r0)], stage);
    },
  };
}

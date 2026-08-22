import { HERO_PULSE_DURATION, PULSE_DURATION } from "../design.js";
import { coord } from "../geometry.js";
import { lines, tag, wrap } from "./primitives.js";

/**
 * The travelling pulse: the mark that says a connection carries traffic
 * rather than merely existing. Both lenses draw it from here, because a
 * reader moving between them is reading one language — an architecture edge
 * and a sequence message differ in what they connect, not in how they live.
 *
 * A line running behind the drawing's clock says so with a negative `begin`,
 * which starts its motion that far into its own turn. A positive delay would
 * describe the same steady state and lie for the seconds after load: an
 * animation has no effect before it begins, so the dot waiting for its turn
 * would sit at the canvas origin, in the corner, in full view.
 */
export const travellingPulses = (pulse: {
  path: string;
  colour: string;
  /** Dots riding this line at once, spread evenly around the turn. */
  count: number;
  /** How far this line runs behind the drawing's clock, in seconds. */
  lag: number;
}): string => {
  const { path, colour, count, lag } = pulse;
  const train = count > 1;
  const duration = train ? HERO_PULSE_DURATION : PULSE_DURATION;

  return lines(
    Array.from({ length: count }, (_, index) => {
      const behind = (lag + (duration / count) * index) % duration;
      return wrap(
        "circle",
        { r: train ? 3 : 2.6, fill: colour },
        tag("animateMotion", {
          dur: `${coord(duration)}s`,
          begin: behind === 0 ? undefined : `${coord(behind - duration)}s`,
          repeatCount: "indefinite",
          path,
        }),
      );
    }),
  );
};

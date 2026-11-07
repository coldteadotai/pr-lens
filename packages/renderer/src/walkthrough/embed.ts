import type { GraphDoc } from "@coldtea/pr-lens-schema";
import { assertNever } from "@coldtea/pr-lens-schema";
import type { Box } from "../geometry.js";
import type { RenderedSvg } from "../render.js";
import { markerDefs } from "../svg/document.js";
import { escapeXml } from "../svg/primitives.js";
import { SANS_STACK, truncate } from "../text.js";
import { paletteFor, type PairTheme } from "../theme.js";
import { balancedLines, words } from "./caption.js";
import {
  easeInOut,
  flightFor,
  frame,
  interpolateFlight,
  lerpRect,
  type FramingPolicy,
  type Stage,
  type Viewport,
} from "./camera.js";
import { stripLayout, tileRect, type StripBox } from "./layout.js";
import { nestedRender } from "./nest.js";
import { resolveWalkthrough, type ResolvedFocus, type ResolvedStep, type WalkthroughIssue } from "./resolve.js";
import { planTiles } from "./tiles.js";

/** The walkthrough as one animated SVG: CSS keyframes fly the canvas's own strip twice, then rest on the last step. */

export type WalkthroughEmbedOptions = {
  theme: PairTheme;
  /** Tiles the caller already drew in this theme, by tile id. */
  tiles?: ReadonlyMap<string, RenderedSvg>;
};

export type WalkthroughEmbed = {
  svg: string;
  width: number;
  height: number;
  theme: PairTheme;
  steps: number;
};

export type WalkthroughEmbedResult =
  | { type: "absent" }
  | { type: "unresolvable"; issues: WalkthroughIssue[] }
  | { type: "rendered"; embed: WalkthroughEmbed };

export const EMBED_WIDTH = 870;
const STAGE_HEIGHT = 340;
const STAGE: Stage = { left: 0, top: 0, width: EMBED_WIDTH, height: STAGE_HEIGHT };

const GAP = 16;
const FEATHER = 28;
/** Room for the focus mask to cover past the strip at any zoom. */
const OVERSCAN = 4000;
const PASSES = 2;
/** Keyframes per flight. CSS interpolates linearly between them. */
const SAMPLES = 16;

const EASE_OUT = "cubic-bezier(0.23,1,0.32,1)";

const HEADING_SIZE = 17.5;
const BODY_SIZE = 16;
const LINE_HEIGHT = 22;
const BODY_X = 16;
const HEADING_X = 40;
const HEADING_Y = 26;
const BODY_Y = 52;
const CAPTION_FOOT = 12;
/** Short of the full width, since system fonts run up to 8% wider than the width table's face. */
const CAPTION_WIDTH = 770;

const PIP = { width: 18, gap: 5, height: 3, y: 19, right: EMBED_WIDTH - 2 };
const HEADING_AIR = 12;

/** The `git-pull-request` octicon. */
const PULL_REQUEST_ICON =
  "M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z";

type Tokens = {
  text: string;
  accent: string;
  track: string;
  rim: string;
  /** Opacity of the context outside the focus. */
  dim: string;
  /** A raised white card under the focus. Without it the light theme washes out. */
  card: boolean;
};

const tokensFor = (theme: PairTheme): Tokens => {
  switch (theme) {
    case "dark":
      return {
        text: "#f0f6fc",
        accent: "#3fb950",
        track: "rgba(240,246,252,.14)",
        rim: "rgba(230,237,243,.34)",
        dim: ".24",
        card: false,
      };
    case "light":
      return {
        text: "#1f2328",
        accent: "#1a7f37",
        track: "rgba(31,35,40,.14)",
        rim: "rgba(31,35,40,.5)",
        dim: ".42",
        card: true,
      };
    default:
      return assertNever(theme, "Unhandled embed theme");
  }
};

/** `toFixed` with no sign on a zero. */
const fixed = (value: number, digits: number): string => {
  const text = value.toFixed(digits);
  return /^-0(?:\.0+)?$/.test(text) ? text.slice(1) : text;
};

type Frame = { camera: Viewport; rect: Box };

type Shot = { heading: string; body: string; tileId: string; rect: Box; camera: Viewport };

/** The flight into a shot from the one before, sampled. */
type Leg = { seconds: number; frames: Frame[] };

/** A whole tile is framed at reading distance. A region fills the stage. */
const target = (focus: ResolvedFocus, box: StripBox): { rect: Box; policy: FramingPolicy } => {
  switch (focus.kind) {
    case "whole":
      return { rect: tileRect(box), policy: { kind: "diagram" } };
    case "region": {
      const { x, y, width, height } = focus.rect;
      return { rect: { x: box.x + x, y: box.y + y, width, height }, policy: { kind: "selection" } };
    }
    default:
      return assertNever(focus, "Unhandled focus");
  }
};

const shotFor = (step: ResolvedStep, box: StripBox): Shot => {
  const { rect, policy } = target(step.focus, box);
  return { heading: step.heading, body: step.body, tileId: step.tileId, rect, camera: frame(policy, rect, STAGE) };
};

const legFor = (from: Shot, to: Shot): Leg => {
  const path = interpolateFlight(from.camera, to.camera, STAGE);
  const flight = flightFor(path.distance, false);
  const seconds = (() => {
    switch (flight.kind) {
      case "smooth":
        return flight.durationMs / 1000;
      case "cut":
        return 0;
      default:
        return assertNever(flight, "Unhandled flight");
    }
  })();

  const frames = Array.from({ length: SAMPLES + 1 }, (_, index): Frame => {
    const eased = easeInOut(index / SAMPLES);
    return { camera: path.at(eased), rect: lerpRect(from.rect, to.rect, eased) };
  });
  return { seconds, frames };
};

/** The canvas's reading time, quickened for a picture nobody can pause, less the caption's fade out. */
const dwellFor = (shot: Shot): number => {
  const count = words(`${shot.heading} ${shot.body}`).length;
  return Math.min(Math.max(3.2 + count * 0.38, 8), 14) * 0.614 - 1.1;
};

type Clock = {
  shots: Shot[];
  legs: Leg[];
  /** Each step's share of a pass, flight in included. */
  spans: number[];
  starts: number[];
  total: number;
  /** Where the embed rests. */
  last: Frame;
  /** A moment in one pass as a keyframe percentage. */
  at: (seconds: number) => string;
};

const clockFor = (shots: Shot[]): Clock => {
  const legs = shots.map((shot, index) => legFor(shots[(index + shots.length - 1) % shots.length] ?? shot, shot));
  const spans = shots.map((shot, index) => dwellFor(shot) + (legs[index]?.seconds ?? 0));
  const starts = spans.map((_, index) => spans.slice(0, index).reduce((sum, span) => sum + span, 0));
  const total = spans.reduce((sum, span) => sum + span, 0);
  const lastLeg = legs[legs.length - 1];
  const last = lastLeg?.frames[lastLeg.frames.length - 1];
  if (last === undefined) throw new Error("a walkthrough has at least two steps, so it has a flight");

  return { shots, legs, spans, starts, total, last, at: (seconds) => `${fixed((seconds / total) * 100, 3)}%` };
};

/** Every flight's frames in a row, each last frame held through the dwell. */
const track = (clock: Clock, paint: (frame: Frame) => string): string =>
  clock.legs
    .map((leg, index) => {
      const start = clock.starts[index] ?? 0;
      const hold = clock.starts[index + 1] ?? clock.total;
      const steps = leg.frames.map((frame, sample) => `${clock.at(start + (leg.seconds * sample) / SAMPLES)}{${paint(frame)}}`);
      const resting = leg.frames[leg.frames.length - 1];
      return `${steps.join("")}${resting === undefined ? "" : `${clock.at(hold)}{${paint(resting)}}`}`;
    })
    .join("");

const cameraRule = ({ camera }: Frame): string =>
  `transform:translate(${fixed(camera.x, 2)}px,${fixed(camera.y, 2)}px) scale(${fixed(camera.scale, 4)})`;

const holeRule = ({ rect }: Frame): string =>
  `x:${fixed(rect.x, 1)}px;y:${fixed(rect.y, 1)}px;width:${fixed(rect.width, 1)}px;height:${fixed(rect.height, 1)}px`;

/** The static values are the resting state, so reduced motion shows the picture the tour ends on. */
const baseCss = (clock: Clock): string[] => [
  `.a{animation-duration:${fixed(clock.total, 2)}s;animation-iteration-count:${PASSES};animation-fill-mode:both;animation-timing-function:linear}`,
  ".pip{transform-box:fill-box;transform-origin:left center}",
  `@keyframes cam{${track(clock, cameraRule)}}`,
  `@keyframes hole{${track(clock, holeRule)}}`,
  `.cam{${cameraRule(clock.last)}}.moving{${holeRule(clock.last)}}`,
];

/** In at 35% of the flight, out just before the step ends. The last caption stays up across the seam. */
const fadeCss = (clock: Clock, name: string, index: number, delay: number): string => {
  const start = clock.starts[index] ?? 0;
  const flight = clock.legs[index]?.seconds ?? 0;
  const on = start + flight * 0.35 + delay;
  const seam = index === clock.shots.length - 1;

  if (seam) {
    const out = (clock.legs[0]?.seconds ?? 0) * 0.2;
    return (
      `@keyframes ${name}{0%,${clock.at(out)}{opacity:1;transform:translateY(0)}` +
      `${clock.at(out + 0.12)},${clock.at(on)}{opacity:0;transform:translateY(3px)}` +
      `${clock.at(on + 0.22)},100%{opacity:1;transform:translateY(0)}}`
    );
  }

  const end = start + (clock.spans[index] ?? 0);
  return (
    `@keyframes ${name}{0%,${clock.at(on)}{opacity:0;transform:translateY(3px)}` +
    `${clock.at(on + 0.22)},${clock.at(end - 0.12)}{opacity:1;transform:translateY(0)}` +
    `${clock.at(end)},100%{opacity:0;transform:translateY(0)}}`
  );
};

type Pips = { markup: string; css: string[]; left: number };

/** One bar per step, each filling across its step. */
const pips = (clock: Clock, tokens: Tokens): Pips => {
  const count = clock.shots.length;
  const left = PIP.right - (count * PIP.width + (count - 1) * PIP.gap);
  const css: string[] = [];
  let markup = "";

  clock.shots.forEach((_, index) => {
    const start = clock.starts[index] ?? 0;
    const end = start + (clock.spans[index] ?? 0);
    const x = left + index * (PIP.width + PIP.gap);
    css.push(`@keyframes p${index}{0%,${clock.at(start)}{transform:scaleX(0)}${clock.at(end)},100%{transform:scaleX(1)}}`);
    markup +=
      `<rect x="${x}" y="${PIP.y}" width="${PIP.width}" height="${PIP.height}" rx="1.5" fill="${tokens.track}"/>` +
      `<rect class="a pip" style="animation-name:p${index}" x="${x}" y="${PIP.y}" width="${PIP.width}" height="${PIP.height}" rx="1.5" fill="${tokens.accent}"/>`;
  });

  return { markup, css, left };
};

type Caption = { heading: string; lines: string[] };

const captionHeight = (caption: Caption): number => BODY_Y + (caption.lines.length - 1) * LINE_HEIGHT + CAPTION_FOOT;

const captionFor = (heading: string, body: string, room: number): Caption => ({
  heading: truncate(heading, "sans-bold", HEADING_SIZE, room),
  lines: balancedLines(body, "sans", BODY_SIZE, CAPTION_WIDTH),
});

const headingMarkup = (caption: Caption, tokens: Tokens): string =>
  `<text x="${HEADING_X}" y="${HEADING_Y}" font-size="${HEADING_SIZE}" font-weight="600" fill="${tokens.accent}">${escapeXml(caption.heading)}</text>`;

const bodyMarkup = (caption: Caption, tokens: Tokens): string =>
  caption.lines
    .map(
      (line, index) =>
        `<text x="${BODY_X}" y="${BODY_Y + index * LINE_HEIGHT}" font-size="${BODY_SIZE}" fill="${tokens.text}">${escapeXml(line)}</text>`,
    )
    .join("");

type Captions = { markup: string; css: string[]; height: number };

const captions = (clock: Clock, captionsByStep: Caption[], tokens: Tokens): Captions => {
  const css: string[] = [];
  let markup = "";

  captionsByStep.forEach((caption, index) => {
    const hidden = index === captionsByStep.length - 1 ? "" : ' opacity="0"';
    css.push(fadeCss(clock, `h${index}`, index, 0), fadeCss(clock, `b${index}`, index, 0.05));
    markup +=
      `<g class="a" style="animation-name:h${index}"${hidden}>${headingMarkup(caption, tokens)}</g>` +
      `<g class="a" style="animation-name:b${index}"${hidden}>${bodyMarkup(caption, tokens)}</g>`;
  });

  return { markup, css, height: Math.max(...captionsByStep.map(captionHeight)) };
};

/** The alert's bar follows the caption's height between steps. */
const bar = (clock: Clock, captionsByStep: Caption[], tokens: Tokens): { markup: string; css: string[] } => {
  const heights = captionsByStep.map(captionHeight);
  const lastHeight = heights[heights.length - 1] ?? BODY_Y + CAPTION_FOOT;

  const keyframes = heights
    .map((height, index) => {
      const start = clock.starts[index] ?? 0;
      const previous = heights[(index + heights.length - 1) % heights.length] ?? height;
      const settled = start + (clock.legs[index]?.seconds ?? 0) * 0.35 + 0.22;
      return `${clock.at(start)}{height:${previous}px;animation-timing-function:${EASE_OUT}}${clock.at(settled)}{height:${height}px}`;
    })
    .join("");

  return {
    markup: `<rect class="bar" width="3" height="${lastHeight}" rx="1.5" fill="${tokens.accent}"/>`,
    css: [
      `@keyframes bar{${keyframes}100%{height:${lastHeight}px}}`,
      `.bar{animation:bar ${fixed(clock.total, 2)}s linear ${PASSES} both}`,
    ],
  };
};

/** Stage edges fading into the page. */
const FEATHER_DEFS =
  `<linearGradient id="fx"><stop offset="0" stop-color="#000"/><stop offset="${fixed(FEATHER / EMBED_WIDTH, 4)}" stop-color="#fff"/><stop offset="${fixed(1 - FEATHER / EMBED_WIDTH, 4)}" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>` +
  '<linearGradient id="ft" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>' +
  '<linearGradient id="fb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000"/></linearGradient>' +
  `<mask id="edge" maskUnits="userSpaceOnUse" x="0" y="0" width="${EMBED_WIDTH}" height="${STAGE_HEIGHT}">` +
  `<rect width="${EMBED_WIDTH}" height="${STAGE_HEIGHT}" fill="url(#fx)"/>` +
  `<rect width="${EMBED_WIDTH}" height="${FEATHER}" fill="url(#ft)"/>` +
  `<rect y="${STAGE_HEIGHT - FEATHER}" width="${EMBED_WIDTH}" height="${FEATHER}" fill="url(#fb)"/></mask>` +
  `<clipPath id="stage"><rect width="${EMBED_WIDTH}" height="${STAGE_HEIGHT}"/></clipPath>`;

type World = { defs: string; markup: string };

/** The tiles under the camera, the mask that dims everything outside the focus, and the rim. */
const world = (tiles: string, strip: { width: number; height: number }, tokens: Tokens): World => {
  const cover = `x="${-OVERSCAN}" y="${-OVERSCAN}" width="${strip.width + OVERSCAN * 2}" height="${strip.height + OVERSCAN * 2}"`;
  const lift = tokens.card
    ? '<filter id="lift" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="12"/></filter>'
    : "";
  const card = tokens.card
    ? '<rect class="a moving" style="animation-name:hole" rx="16" fill="rgba(31,35,40,.18)" filter="url(#lift)" transform="translate(0,4)"/>' +
      '<rect class="a moving" style="animation-name:hole" rx="16" fill="#fff"/>'
    : "";

  return {
    defs:
      lift +
      '<filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="8"/></filter>' +
      `<mask id="focus" maskUnits="userSpaceOnUse" ${cover}><rect id="base" ${cover} fill="#fff" fill-opacity="${tokens.dim}"/>` +
      '<rect class="a moving" style="animation-name:hole" rx="16" fill="#fff" filter="url(#soft)"/></mask>',
    markup:
      `<g class="a cam" style="animation-name:cam">${card}<g mask="url(#focus)">${tiles}</g>` +
      `<rect class="a moving" style="animation-name:hole;vector-effect:non-scaling-stroke" rx="16" fill="none" stroke="${tokens.rim}" stroke-width="1.25"/></g>`,
  };
};

const REDUCED_MOTION = "@media (prefers-reduced-motion: reduce){.a,.bar{animation:none!important}}";

const STEP_WORDS = ["two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

/** The embed's accessible name, and the alt text of any image showing it. */
export const walkthroughLabel = (title: string, steps: number): string =>
  `Walkthrough of ${title}, in ${STEP_WORDS[steps - 2] ?? String(steps)} steps`;

export const renderWalkthroughEmbed = (doc: GraphDoc, options: WalkthroughEmbedOptions): WalkthroughEmbedResult => {
  if (doc.walkthrough === undefined) return { type: "absent" };

  const tokens = tokensFor(options.theme);
  const drawn = planTiles(doc).map((plan) => ({ plan, rendered: options.tiles?.get(plan.id) ?? plan.draw(options.theme) }));
  const resolution = resolveWalkthrough(
    doc,
    drawn.map(({ plan, rendered }) => ({ id: plan.id, hero: plan.hero, atlas: rendered.atlas })),
  );

  switch (resolution.type) {
    case "absent":
    case "unresolvable":
      return resolution;
    case "resolved":
      break;
    default:
      return assertNever(resolution, "Unhandled walkthrough resolution");
  }

  const strip = stripLayout(drawn.map(({ plan, rendered }) => ({ id: plan.id, width: rendered.width, height: rendered.height })));
  const boxes = new Map(strip.boxes.map((box) => [box.id, box]));
  const shots = resolution.steps.map((step) => {
    const box = boxes.get(step.tileId);
    if (box === undefined) throw new Error(`a resolved step plays over a tile the strip lacks: ${step.tileId}`);
    return shotFor(step, box);
  });
  const clock = clockFor(shots);

  // Only the tiles the tour visits travel with the picture.
  const visited = new Set(shots.map((shot) => shot.tileId));
  const tiles = drawn
    .map(({ plan, rendered }) => {
      const box = boxes.get(plan.id);
      return box === undefined || !visited.has(plan.id) ? "" : nestedRender(rendered, box.x, box.y);
    })
    .join("");

  const progress = pips(clock, tokens);
  const room = progress.left - HEADING_AIR - HEADING_X;
  const captionsByStep = shots.map((shot) => captionFor(shot.heading, shot.body, room));
  const caption = captions(clock, captionsByStep, tokens);
  const alert = bar(clock, captionsByStep, tokens);
  const scene = world(tiles, strip, tokens);

  const css = [...baseCss(clock), ...progress.css, ...caption.css, ...alert.css, REDUCED_MOTION].join("");
  const height = caption.height + GAP + STAGE_HEIGHT;
  const label = walkthroughLabel(doc.title, shots.length);

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${EMBED_WIDTH} ${height}" width="${EMBED_WIDTH}" height="${height}" role="img" aria-label="${escapeXml(label)}" font-family="${escapeXml(SANS_STACK)}">` +
    `<style>${css}</style>` +
    `<defs>${markerDefs(paletteFor(options.theme))}${scene.defs}${FEATHER_DEFS}</defs>` +
    alert.markup +
    `<g transform="translate(16,12)"><path d="${PULL_REQUEST_ICON}" fill="${tokens.accent}"/></g>` +
    progress.markup +
    caption.markup +
    `<g transform="translate(0,${caption.height + GAP})"><g mask="url(#edge)"><g clip-path="url(#stage)">${scene.markup}</g></g></g>` +
    "</svg>";

  return { type: "rendered", embed: { svg, width: EMBED_WIDTH, height, theme: options.theme, steps: shots.length } };
};

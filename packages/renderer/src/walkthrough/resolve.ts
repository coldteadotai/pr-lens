import type { GraphDoc, StepFocus, StepStage, ViewScope, WalkthroughStep } from "@coldtea/pr-lens-schema";
import { assertNever } from "@coldtea/pr-lens-schema";
import type { RenderAtlas } from "../atlas.js";
import { inflate, union } from "../bounds.js";
import type { Box } from "../geometry.js";
import { flattenViews } from "../scope.js";
import { tileIdForFlow, tileIdForView } from "./tile-ids.js";

/** Which tile each step plays over and which rectangle it points at. Pure, so the canvas and the embed agree. */

/** The atlas is absent on a revision stored before one was kept. */
export type WalkthroughTile = { id: string; hero: boolean; atlas?: RenderAtlas };

/** Rects are in the tile's own viewBox units. The surface adds the tile's place on the strip. */
export type ResolvedFocus = { kind: "whole" } | { kind: "region"; rect: Box };

export type ResolvedStep = {
  id: string;
  heading: string;
  body: string;
  tileId: string;
  focus: ResolvedFocus;
};

/** Why a step could not be matched. */
export type WalkthroughIssue = {
  code: "STAGE_NOT_ON_CANVAS" | "FOCUS_NOT_DRAWN" | "ATLAS_MISSING";
  stepId: string;
  detail: string;
};

export type WalkthroughResolution =
  | { type: "absent" }
  | { type: "resolved"; steps: ResolvedStep[] }
  | { type: "unresolvable"; issues: WalkthroughIssue[] };

/** Air around a focus. Message rows sit 38 units apart, so much more puts the rim over the row above. */
const FOCUS_PAD = 16;

/** A step with no stage plays over the tile that opens the strip. */
type StageChoice = { kind: "opening" } | StepStage;

/** Resolves all of the walkthrough or none of it, collecting every issue in step order. */
export function resolveWalkthrough(doc: GraphDoc, tiles: readonly WalkthroughTile[]): WalkthroughResolution {
  if (doc.walkthrough === undefined) return { type: "absent" };

  const steps: ResolvedStep[] = [];
  const issues: WalkthroughIssue[] = [];

  for (const step of doc.walkthrough.steps) {
    const resolved = resolveStep(doc, step, tiles);
    switch (resolved.type) {
      case "step":
        steps.push(resolved.step);
        break;
      case "issues":
        issues.push(...resolved.issues);
        break;
      default:
        return assertNever(resolved, "Unhandled step resolution");
    }
  }

  return issues.length > 0 ? { type: "unresolvable", issues } : { type: "resolved", steps };
}

/** One issue as a sentence. */
const says = (issue: WalkthroughIssue): string => `Step "${issue.stepId}" ${issue.detail}.`;

/** Copy for a refused push: the first wrong step by name, and a count of the rest. */
export function walkthroughRefusal(issues: readonly WalkthroughIssue[]): string {
  const first = issues[0];
  if (first === undefined) return "This document's walkthrough does not fit the diagrams it draws";

  const elsewhere = new Set(issues.map((issue) => issue.stepId));
  elsewhere.delete(first.stepId);

  const rest =
    elsewhere.size === 0
      ? ""
      : elsewhere.size === 1
        ? " One other step has the same trouble."
        : ` ${elsewhere.size} other steps have the same trouble.`;

  return `This document's walkthrough does not fit the diagrams it draws. ${says(first)}${rest}`;
}

type StepResolution = { type: "step"; step: ResolvedStep } | { type: "issues"; issues: WalkthroughIssue[] };

function resolveStep(doc: GraphDoc, step: WalkthroughStep, tiles: readonly WalkthroughTile[]): StepResolution {
  const choice: StageChoice = step.stage ?? { kind: "opening" };
  const staged = stageTile(doc, choice, tiles);

  switch (staged.type) {
    case "off_canvas":
      return { type: "issues", issues: [{ code: "STAGE_NOT_ON_CANVAS", stepId: step.id, detail: staged.detail }] };
    case "on_canvas":
      break;
    default:
      return assertNever(staged, "Unhandled staged tile");
  }

  const focus = resolveFocus(doc, step, choice, staged.tile.atlas);

  switch (focus.type) {
    case "focus":
      return {
        type: "step",
        step: { id: step.id, heading: step.heading, body: step.body, tileId: staged.tile.id, focus: focus.focus },
      };
    case "issues":
      return focus;
    default:
      return assertNever(focus, "Unhandled focus resolution");
  }
}

type StagedTile = { type: "on_canvas"; tile: WalkthroughTile } | { type: "off_canvas"; detail: string };

export function tileForStage<Tile extends WalkthroughTile>(
  doc: GraphDoc,
  stage: StepStage | undefined,
  tiles: readonly Tile[],
): Tile | undefined {
  const staged = stageTile(doc, stage ?? { kind: "opening" }, tiles);
  switch (staged.type) {
    case "on_canvas":
      return tiles.find((tile) => tile.id === staged.tile.id);
    case "off_canvas":
      return undefined;
    default:
      return assertNever(staged, "Unhandled staged tile");
  }
}

/** A flow is a tile only when there are no data-flow views; otherwise the first view drawing it is the stage. */
function stageTile(doc: GraphDoc, choice: StageChoice, tiles: readonly WalkthroughTile[]): StagedTile {
  switch (choice.kind) {
    case "opening": {
      const opening = tiles.find((tile) => tile.hero);
      return opening === undefined
        ? { type: "off_canvas", detail: "has no stage of its own, and this document draws no opening diagram" }
        : { type: "on_canvas", tile: opening };
    }
    case "view":
      return named(tiles, [tileIdForView(choice.view)], `plays over view "${choice.view}", which the canvas does not draw`);
    case "flow":
      return named(
        tiles,
        [tileIdForFlow(choice.flow), ...viewTilesDrawing(doc, choice.flow)],
        `plays over flow "${choice.flow}", which the canvas does not draw`,
      );
    default:
      return assertNever(choice, "Unhandled stage");
  }
}

/** The first of these tiles in strip order, not in the order asked for. */
function named(tiles: readonly WalkthroughTile[], ids: readonly string[], detail: string): StagedTile {
  const wanted = new Set(ids);
  const tile = tiles.find((candidate) => wanted.has(candidate.id));
  return tile === undefined ? { type: "off_canvas", detail } : { type: "on_canvas", tile };
}

const scopeTakesFlow = (scope: ViewScope, flowId: string): boolean => {
  switch (scope.kind) {
    case "all":
      return true;
    case "selection":
      return scope.flows.includes(flowId);
    default:
      return assertNever(scope, "Unhandled view scope");
  }
};

const viewTilesDrawing = (doc: GraphDoc, flowId: string): string[] =>
  flattenViews(doc.views)
    .filter((view) => view.lens === "data-flow" && scopeTakesFlow(view.scope, flowId))
    .map((view) => tileIdForView(view.id));

type FocusResolution = { type: "focus"; focus: ResolvedFocus } | { type: "issues"; issues: WalkthroughIssue[] };

function resolveFocus(
  doc: GraphDoc,
  step: WalkthroughStep,
  choice: StageChoice,
  atlas: RenderAtlas | undefined,
): FocusResolution {
  switch (step.focus.kind) {
    case "all":
      return { type: "focus", focus: { kind: "whole" } };
    case "selection":
      return atlas === undefined
        ? {
            type: "issues",
            issues: [
              {
                code: "ATLAS_MISSING",
                stepId: step.id,
                detail: "plays over a diagram drawn without the geometry a walkthrough needs",
              },
            ],
          }
        : selectionRect(doc, step.id, step.focus, choice, atlas);
    default:
      return assertNever(step.focus, "Unhandled step focus");
  }
}

type Selection = Extract<StepFocus, { kind: "selection" }>;

/** The padded union of everything a step names. A member never drawn is an issue, not a skip. */
function selectionRect(
  doc: GraphDoc,
  stepId: string,
  selection: Selection,
  choice: StageChoice,
  atlas: RenderAtlas,
): FocusResolution {
  const boxes: Box[] = [];
  const issues: WalkthroughIssue[] = [];

  const take = (kind: string, id: string, box: Box | undefined): void => {
    if (box === undefined) {
      issues.push({
        code: "FOCUS_NOT_DRAWN",
        stepId,
        detail: `focuses ${kind} "${id}", which the diagram it plays over does not draw`,
      });
      return;
    }
    boxes.push(box);
  };

  for (const id of selection.lanes) take("lane", id, atlas.lanes[id]);
  for (const id of selection.nodes) take("node", id, atlas.nodes[id]);
  for (const id of selection.edges) take("edge", id, atlas.edges[id]);
  for (const id of selection.messages) take("flow step", id, messageBox(doc, choice, atlas, id));
  for (const id of selection.tables) take("table", id, atlas.tables[id]);

  if (issues.length > 0) return { type: "issues", issues };

  // A selection that names nothing does not parse, so one with no issues left has at least one box.
  const covered = union(boxes);
  if (covered === undefined) throw new Error("a selection with nothing drawn is reported, not framed");
  return { type: "focus", focus: { kind: "region", rect: inflate(covered, FOCUS_PAD) } };
}

/** A flow step's id is unique only inside its flow, so a view stage asks the document's flows in order. */
function messageBox(doc: GraphDoc, choice: StageChoice, atlas: RenderAtlas, messageId: string): Box | undefined {
  for (const flowId of flowsToAsk(doc, choice)) {
    const box = atlas.messages[flowId]?.[messageId];
    if (box !== undefined) return box;
  }
  return undefined;
}

const flowsToAsk = (doc: GraphDoc, choice: StageChoice): string[] => {
  switch (choice.kind) {
    case "flow":
      return [choice.flow];
    case "opening":
    case "view":
      return doc.flows.map((flow) => flow.id);
    default:
      return assertNever(choice, "Unhandled stage");
  }
};

import type {
  CiteRef,
  Flow,
  GraphEdge,
  GraphNode,
  Lane,
  StepCite,
  StepDetail,
  StepStage,
  View,
  Walkthrough,
  WalkthroughStep,
} from "./graph.js";
import { assertNever } from "./utils.js";

const NOTHING: ReadonlySet<string> = new Set();

export const indexViews = (views: readonly View[]): Map<string, View> =>
  new Map(views.flatMap((view) => [[view.id, view] as const, ...indexViews(view.children)]));

/**
 * A flow step is only ever identified within its own flow, so the stage rather
 * than the document decides which one a focus meant. Two flows may each carry
 * a step called `retry`, and neither document is wrong for it.
 *
 * `unknown-stage` is its own answer rather than an empty set, so a stage that
 * names a view or flow the document lacks is reported once, as the broken
 * reference it is, instead of again for every step underneath it.
 */
export type StagedMessages =
  | { kind: "messages"; ids: ReadonlySet<string> }
  | { kind: "no-stage" }
  | { kind: "unknown-stage" };

const messageIdsOf = (flows: readonly Flow[]): Set<string> =>
  new Set(flows.flatMap((flow) => flow.messages.map((message) => message.id)));

export const stagedMessages = (
  stage: StepStage | undefined,
  flows: readonly Flow[],
  views: ReadonlyMap<string, View>,
): StagedMessages => {
  if (stage === undefined) return { kind: "no-stage" };

  switch (stage.kind) {
    case "flow": {
      const flow = flows.find(({ id }) => id === stage.flow);
      return flow === undefined
        ? { kind: "unknown-stage" }
        : { kind: "messages", ids: messageIdsOf([flow]) };
    }
    case "view": {
      const view = views.get(stage.view);
      if (view === undefined) return { kind: "unknown-stage" };

      switch (view.scope.kind) {
        case "all":
          return { kind: "messages", ids: messageIdsOf(flows) };
        case "selection": {
          const scoped = view.scope.flows;
          return {
            kind: "messages",
            ids: messageIdsOf(flows.filter((flow) => scoped.includes(flow.id))),
          };
        }
        default:
          return assertNever(view.scope, "Unhandled view scope");
      }
    }
    default:
      return assertNever(stage, "Unhandled step stage");
  }
};

/**
 * The document that survived, rather than the ids that went: a step names a
 * diagram as well as elements, and a flow step means nothing outside the flow
 * that carries it.
 */
export type WalkthroughSubject = {
  lanes: readonly Lane[];
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  flows: readonly Flow[];
  views: readonly View[];
};

const stageSurvives = (
  stage: StepStage,
  flows: ReadonlySet<string>,
  views: ReadonlyMap<string, View>,
): boolean => {
  switch (stage.kind) {
    case "view":
      return views.has(stage.view);
    case "flow":
      return flows.has(stage.flow);
    default:
      return assertNever(stage, "Unhandled step stage");
  }
};

const focusable = (staged: StagedMessages): ReadonlySet<string> => {
  switch (staged.kind) {
    case "messages":
      return staged.ids;
    case "no-stage":
    case "unknown-stage":
      return NOTHING;
    default:
      return assertNever(staged, "Unhandled staged messages");
  }
};

/** Each cite is searched for from where the previous one ended, so two cites cannot overlap. */
export const citeStarts = (text: string, cites: readonly StepCite[]): (number | undefined)[] => {
  let cursor = 0;
  return cites.map((cite) => {
    const start = text.indexOf(cite.text, cursor);
    if (start === -1) return undefined;
    cursor = start + cite.text.length;
    return start;
  });
};

export type StepPart = { text: string; ref?: CiteRef };

export const detailParts = ({ text, cites }: StepDetail): StepPart[] => {
  const starts = citeStarts(text, cites);
  const parts: StepPart[] = [];
  let cursor = 0;

  cites.forEach((cite, index) => {
    const start = starts[index];
    if (start === undefined) return;
    if (start > cursor) parts.push({ text: text.slice(cursor, start) });
    parts.push({ text: cite.text, ref: cite.ref });
    cursor = start + cite.text.length;
  });

  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts;
};

/** A file cite always passes, because the document has no list of files to check it against. */
export const citeStands = (
  ref: CiteRef,
  subject: Pick<WalkthroughSubject, "nodes" | "flows" | "views">,
): boolean => {
  switch (ref.kind) {
    case "node":
      return subject.nodes.some((node) => node.id === ref.node);
    case "message":
      return subject.flows.some(
        (flow) => flow.id === ref.flow && flow.messages.some((message) => message.id === ref.message),
      );
    case "view":
      return indexViews(subject.views).has(ref.view);
    case "flow":
      return subject.flows.some((flow) => flow.id === ref.flow);
    case "file":
      return true;
    default:
      return assertNever(ref, "Unhandled cite ref");
  }
};

/** When every cite is gone, the detail is dropped and the step keeps its body. */
const withStandingCites = (step: WalkthroughStep, subject: WalkthroughSubject): WalkthroughStep => {
  const { detail, ...rest } = step;
  if (detail === undefined) return step;

  const cites = detail.cites.filter((cite) => citeStands(cite.ref, subject));
  return cites.length === 0 ? rest : { ...rest, detail: { ...detail, cites } };
};

/**
 * A step that loses the last element it focused is dropped rather than left
 * to widen into a step about everything. A tour of one step is a caption, so
 * a walkthrough cut below two steps goes whole.
 */
export const pruneWalkthrough = (
  walkthrough: Walkthrough | undefined,
  subject: WalkthroughSubject,
): Walkthrough | undefined => {
  if (walkthrough === undefined) return undefined;

  const lanes = new Set(subject.lanes.map((lane) => lane.id));
  const nodes = new Set(subject.nodes.map((node) => node.id));
  const edges = new Set(subject.edges.map((edge) => edge.id));
  const flows = new Set(subject.flows.map((flow) => flow.id));
  const views = indexViews(subject.views);

  const steps = walkthrough.steps.flatMap((cited): WalkthroughStep[] => {
    if (cited.stage !== undefined && !stageSurvives(cited.stage, flows, views)) return [];
    const step = withStandingCites(cited, subject);

    switch (step.focus.kind) {
      case "all":
        return [step];
      case "selection": {
        const onStage = focusable(stagedMessages(step.stage, subject.flows, views));
        const focus = {
          kind: "selection",
          lanes: step.focus.lanes.filter((id) => lanes.has(id)),
          nodes: step.focus.nodes.filter((id) => nodes.has(id)),
          edges: step.focus.edges.filter((id) => edges.has(id)),
          messages: step.focus.messages.filter((id) => onStage.has(id)),
        } as const;

        const focused =
          focus.lanes.length + focus.nodes.length + focus.edges.length + focus.messages.length;
        return focused === 0 ? [] : [{ ...step, focus }];
      }
      default:
        return assertNever(step.focus, "Unhandled step focus");
    }
  });

  return steps.length < 2 ? undefined : { ...walkthrough, steps };
};

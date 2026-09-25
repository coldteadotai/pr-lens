import { z } from "zod";
import { GraphDoc, StepFocus, StepStage } from "./graph.js";
import { Beat, Id } from "./primitives.js";

/**
 * What a reader's own coding agent sends to a canvas open beside it, and what
 * the open tab reports back. The agent does the reading and the writing; the
 * app only checks every id against the canvas and relays the result to the
 * one tab that was paired with it.
 *
 * Ids are the document's own, copied exactly: a component is a node id, a
 * message is `flowId/messageId`, and a diagram is a view or flow id as a
 * walkthrough stage names it. The app resolves them exactly and refuses one it
 * cannot find, with the ids it would have taken.
 */
export const LiveRef = z
  .strictObject({
    kind: z.enum(["component", "message", "diagram"]),
    id: Id.describe("Copied exactly from the document. Never composed."),
  })
  .describe("A place on the canvas that some words name.");
export type LiveRef = z.infer<typeof LiveRef>;

export const LivePart = z
  .strictObject({
    text: z.string().min(1).max(400).describe("Words as the reader reads them."),
    ref: LiveRef.optional().describe("Set when these words name a place: they become a link to it."),
  })
  .describe("A run of words in a paragraph, a link when it names a place.");
export type LivePart = z.infer<typeof LivePart>;

/**
 * One stop of an answer. The same stage and focus a walkthrough step takes,
 * so a producer that can write a walkthrough can write an answer.
 */
export const LiveStep = z
  .strictObject({
    heading: Beat.describe(
      "A sentence of at most six words: who or what, a verb, what happens. The first step's heading is the answer.",
    ),
    stage: StepStage.optional().describe("The diagram this step plays over. Absent is the opening diagram."),
    focus: StepFocus.default({ kind: "all" }),
    paragraphs: z
      .array(
        z.strictObject({
          parts: z.array(LivePart).min(1).max(24),
        }),
      )
      .min(1)
      .max(3)
      .describe("Usually one paragraph of one or two sentences, at most 30 words."),
    cannotTell: z
      .string()
      .min(1)
      .max(300)
      .optional()
      .describe("What the canvas cannot tell about the question, in one sentence."),
  })
  .describe("One stop of an answer: a heading, a diagram, what on it is lit, and a few words.");
export type LiveStep = z.infer<typeof LiveStep>;

export const MAX_FORK_COMPONENTS = 8;

export const LiveCommand = z
  .discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("answer"),
      question: z.string().min(1).max(500),
      steps: z.array(LiveStep).min(1).max(4),
    }),
    z.strictObject({
      kind: z.literal("show"),
      stage: StepStage.optional(),
      focus: StepFocus.default({ kind: "all" }),
      open: z
        .strictObject({ message: Id.describe("`flowId/messageId`, whose payload rail opens.") })
        .optional(),
    }),
    z.strictObject({
      kind: z.literal("fork"),
      subject: z.strictObject({
        components: z
          .array(Id)
          .min(1)
          .max(MAX_FORK_COMPONENTS)
          .describe("The node ids on the canvas the drawing hangs from."),
      }),
      sketch: GraphDoc.describe("The drawing of what is inside them."),
    }),
  ])
  .describe("What a coding agent asks an open canvas to do.");
export type LiveCommand = z.infer<typeof LiveCommand>;
export type LiveCommandInput = z.input<typeof LiveCommand>;

export const LivePlace = z
  .object({
    kind: z.enum(["component", "message", "diagram"]),
    id: z.string(),
    label: z.string(),
  })
  .describe("A place on the canvas, with the id spellings a LiveRef takes.");
export type LivePlace = z.infer<typeof LivePlace>;

/**
 * What the paired tab is looking at, as it last reported it. Read by the CLI
 * off the app, so a field the app adds later is dropped rather than refused.
 */
export const ViewerLook = z
  .object({
    following: z.boolean().describe("The tab is in agent mode, following the agent."),
    rev: z.int().min(0).describe("The revision the tab is showing."),
    diagram: z
      .object({
        stage: StepStage.nullable().describe("Null is a whole-map canvas with no views."),
        title: z.string(),
      })
      .nullable()
      .describe("The diagram nearest the middle of the window."),
    inFrame: z.array(LivePlace).max(64).describe("Components and messages on screen."),
    scope: z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal("place"), place: LivePlace }),
        z.object({ kind: z.literal("region"), places: z.array(LivePlace) }),
        z.object({
          kind: z.literal("drawn"),
          label: z.string(),
          within: z.string(),
          places: z.array(LivePlace),
        }),
      ])
      .nullable()
      .describe("What the reader selected: a clicked part, a dragged region, or a box inside a drawing."),
    answer: z
      .object({
        question: z.string(),
        step: z.int().min(0),
        steps: z.int().min(1),
      })
      .nullable()
      .describe("The answer open in the tab."),
    fork: z
      .object({ label: z.string(), parts: z.array(z.string()) })
      .nullable()
      .default(null)
      .describe("The drawing hung under the strip, and the labels of its parts. Null when there is none."),
  })
  .describe("What the reader of a paired canvas tab is looking at.");
export type ViewerLook = z.infer<typeof ViewerLook>;

import { z } from "zod";
import { Delta, FileRef, Id, Label, Lens, SchemaVersionField, Sha, Summary } from "./primitives.js";

/**
 * Coarse on purpose: this drives the card icon and shape, never analysis.
 * Anything that does not fit is `other`, which still renders.
 */
export const NodeKind = z.enum([
  "service",
  "app",
  "module",
  "function",
  "route",
  "job",
  "queue",
  "datastore",
  "cache",
  "external",
  "ui",
  "config",
  "test",
  "package",
  "other",
]);
export type NodeKind = z.infer<typeof NodeKind>;

export const Lane = z
  .strictObject({
    id: Id,
    label: Label,
    subtitle: Label.optional().describe("Secondary line in the lane header, e.g. the platform."),
    order: z
      .int()
      .min(0)
      .max(64)
      .optional()
      .describe("Left-to-right placement. Ties fall back to array order."),
    delta: Delta.optional().describe("Set only when the lane itself is new or gone."),
    summary: Summary.optional(),
  })
  .describe("A grouping band of the diagram. Every node belongs to exactly one lane.");
export type Lane = z.infer<typeof Lane>;

export const GraphNode = z
  .strictObject({
    id: Id,
    label: Label,
    kind: NodeKind,
    delta: Delta,
    lane: Id.describe("Id of the lane this node sits in."),
    group: Id.optional().describe("Optional sub-cluster within the lane, e.g. a package."),
    subtitle: Label.optional().describe("Secondary line on the card, e.g. a symbol signature."),
    summary: Summary.optional().describe("Body text for this node's drill-down section."),
    files: z
      .array(FileRef)
      .max(64)
      .default([])
      .describe("Backing source locations, used to build diff permalinks."),
    badges: z
      .array(Label)
      .max(6)
      .default([])
      .describe("Extra chips on the card, beyond the delta badge the renderer adds."),
  })
  .describe("A node in the architecture graph.");
export type GraphNode = z.infer<typeof GraphNode>;

export const EdgeKind = z.enum([
  "call",
  "http",
  "rpc",
  "event",
  "queue",
  "data",
  "dependency",
  "render",
  "other",
]);
export type EdgeKind = z.infer<typeof EdgeKind>;

/**
 * `hero` is the one connection the change is really about. More than a couple
 * per diagram and the emphasis stops meaning anything.
 */
export const EdgeEmphasis = z.enum(["normal", "hero", "muted"]);
export type EdgeEmphasis = z.infer<typeof EdgeEmphasis>;

export const GraphEdge = z
  .strictObject({
    id: Id,
    from: Id.describe("Source node id."),
    to: Id.describe("Target node id."),
    kind: EdgeKind,
    delta: Delta,
    label: Label.optional().describe("Text on the edge, e.g. a payload size or protocol."),
    emphasis: EdgeEmphasis.default("normal"),
    animated: z
      .boolean()
      .default(false)
      .describe("Render a travelling pulse along this edge in the architecture lens."),
    summary: Summary.optional(),
    files: z.array(FileRef).max(32).default([]),
  })
  .describe("A directed connection between two nodes.");
export type GraphEdge = z.infer<typeof GraphEdge>;

/** `async` fires and forgets, `return` carries a result back, `self` never leaves the participant. */
export const MessageKind = z.enum(["sync", "async", "return", "self"]);
export type MessageKind = z.infer<typeof MessageKind>;

/**
 * Order is the array position. An explicit step number would let a producer
 * emit a document whose animation order disagrees with its own message list.
 */
export const FlowMessage = z
  .strictObject({
    id: Id,
    from: Id.describe("Participant node id the message originates from."),
    to: Id.describe("Participant node id the message arrives at. Equals `from` when kind is self."),
    label: Label,
    kind: MessageKind.default("sync"),
    delta: Delta,
    animated: z.boolean().default(true).describe("Whether the data-flow lens pulses this step."),
    repeat: z
      .int()
      .min(1)
      .max(1_000_000)
      .optional()
      .describe("Times the step occurs per run, e.g. 4 batched requests."),
    note: Summary.optional().describe("Aside rendered beside the step in the drill-down."),
    files: z.array(FileRef).max(32).default([]),
  })
  .refine((message) => (message.kind === "self") === (message.from === message.to), {
    message: "kind 'self' and from === to must agree",
    path: ["kind"],
  })
  .describe("One ordered step in a flow.");
export type FlowMessage = z.infer<typeof FlowMessage>;

export const FlowParticipant = z
  .strictObject({
    node: Id.describe("Id of the graph node this column represents."),
    label: Label.optional().describe("Shorter name for the column when the node label is long."),
  })
  .describe("A column in the sequence diagram, ordered by array position.");
export type FlowParticipant = z.infer<typeof FlowParticipant>;

export const Flow = z
  .strictObject({
    id: Id,
    title: Label,
    summary: Summary.optional(),
    delta: Delta.default("modified"),
    participants: z.array(FlowParticipant).min(2).max(12),
    messages: z.array(FlowMessage).min(1).max(64).describe("Ordered by array position."),
  })
  .describe("An ordered message sequence for the data-flow lens.");
export type Flow = z.infer<typeof Flow>;

export const StatChip = z
  .strictObject({
    label: Label,
    value: z.string().min(1).max(32),
    tone: z.enum(["neutral", "added", "modified", "removed", "hero"]).default("neutral"),
  })
  .describe("A headline chip above the diagram.");
export type StatChip = z.infer<typeof StatChip>;

/**
 * Counts that cannot be derived from the document, plus free-form chips.
 * Per-delta element counts are deliberately absent: they are derivable, and a
 * stored copy can only ever go stale against the node and edge lists.
 */
export const Stats = z
  .strictObject({
    filesChanged: z.int().min(0).optional(),
    additions: z.int().min(0).optional().describe("Lines added across the diff."),
    deletions: z.int().min(0).optional().describe("Lines removed across the diff."),
    chips: z.array(StatChip).max(8).default([]),
  })
  .describe("Headline numbers for the comment header.");
export type Stats = z.infer<typeof Stats>;

/**
 * A view either shows the whole document or a named selection. The two are
 * distinct states rather than "a selection that happens to be empty", so
 * removing the last element a view pointed at can never silently turn it into
 * a view of everything.
 */
export const ViewScope = z
  .discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("all") }),
    z
      .strictObject({
        kind: z.literal("selection"),
        lanes: z.array(Id).max(64).default([]),
        nodes: z.array(Id).max(256).default([]),
        edges: z.array(Id).max(512).default([]),
        flows: z.array(Id).max(32).default([]),
      })
      .meta({
        anyOf: [
          { properties: { lanes: { minItems: 1 } }, required: ["lanes"] },
          { properties: { nodes: { minItems: 1 } }, required: ["nodes"] },
          { properties: { edges: { minItems: 1 } }, required: ["edges"] },
          { properties: { flows: { minItems: 1 } }, required: ["flows"] },
        ],
      })
      .refine(
        (scope) =>
          scope.lanes.length + scope.nodes.length + scope.edges.length + scope.flows.length > 0,
        { message: "a selection must name at least one element" },
      ),
  ])
  .describe("What a drill-down section shows.");
export type ViewScope = z.infer<typeof ViewScope>;

export type View = {
  id: string;
  title: string;
  lens: Lens;
  summary?: string;
  scope: ViewScope;
  defaultOpen: boolean;
  children: View[];
};

/**
 * One node of the nested `<details>` tree in the PR comment. The whole tree
 * ships pre-rendered, so expanding a section costs no round trip.
 */
export type ViewInput = {
  id: string;
  title: string;
  lens: Lens;
  summary?: string;
  scope?:
    | { kind: "all" }
    | { kind: "selection"; lanes?: string[]; nodes?: string[]; edges?: string[]; flows?: string[] };
  defaultOpen?: boolean;
  children?: ViewInput[];
};

export const View: z.ZodType<View, ViewInput> = z.lazy(() =>
  z
    .strictObject({
      id: Id,
      title: Label,
      lens: Lens,
      summary: Summary.optional(),
      scope: ViewScope.default({ kind: "all" }),
      defaultOpen: z.boolean().default(false),
      children: z.array(View).max(32).default([]),
    })
    .describe("A drill-down section; children nest as further <details> blocks."),
);

/**
 * Hints, not instructions: the renderer owns final placement so that layout
 * stays deterministic for a given document. A hint is a floor rather than an
 * answer — it can push a node further down the page, never above something
 * that feeds it — so a stale hint can leave a gap but can never invert an
 * edge. Absolute coordinates are intentionally not expressible.
 */
export const LayoutHints = z
  .strictObject({
    direction: z.enum(["right", "down"]).default("right").describe("Primary flow direction."),
    laneOrder: z.array(Id).max(64).default([]).describe("Explicit left-to-right lane order."),
    rank: z.record(Id, z.int().min(0).max(256)).optional().describe("Preferred layer index per node id."),
  })
  .describe("Optional, non-binding placement hints.");
export type LayoutHints = z.infer<typeof LayoutHints>;

/** Everything needed to rebuild a permalink to any file this document points at. */
export const Provenance = z
  .strictObject({
    repo: z.strictObject({
      owner: z.string().min(1).max(64),
      name: z.string().min(1).max(128),
      host: z.string().min(1).max(128).default("github.com"),
    }),
    base: z.strictObject({ sha: Sha, ref: z.string().min(1).max(255).optional() }),
    head: z.strictObject({ sha: Sha, ref: z.string().min(1).max(255).optional() }),
    pullRequest: z
      .strictObject({
        number: z.int().min(1),
        title: z.string().min(1).max(512).optional(),
        url: z.url().optional(),
      })
      .optional(),
    generator: z
      .strictObject({
        name: z.string().min(1).max(64),
        version: z.string().min(1).max(32).optional(),
        model: z.string().min(1).max(128).optional().describe("Extraction model, when one was used."),
      })
      .optional(),
  })
  .describe("Where the document came from.");
export type Provenance = z.infer<typeof Provenance>;

/**
 * The document every PR Lens component speaks: extraction emits it, the
 * renderer consumes it, and a baseline map is one of these kept current by
 * patch documents.
 */
export const GraphDoc = z
  .strictObject({
    schemaVersion: SchemaVersionField,
    kind: z.literal("graph"),
    id: Id.optional().describe("Stable id when the document is stored, e.g. a baseline map."),
    generatedAt: z.iso.datetime().optional(),
    title: Label,
    summary: Summary.optional().describe("The one-paragraph answer to 'what does this change do?'"),
    lenses: z
      .array(Lens)
      .min(1)
      .max(8)
      .describe("Lenses this document carries enough detail to render."),
    provenance: Provenance,
    lanes: z.array(Lane).min(1).max(16),
    nodes: z.array(GraphNode).min(1).max(256),
    edges: z.array(GraphEdge).max(512).default([]),
    flows: z.array(Flow).max(16).default([]),
    stats: Stats.optional(),
    views: z.array(View).max(32).default([]),
    layout: LayoutHints.optional(),
  })
  .describe("A PR Lens graph document.");
export type GraphDoc = z.infer<typeof GraphDoc>;
export type GraphDocInput = z.input<typeof GraphDoc>;

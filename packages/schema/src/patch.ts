import { z } from "zod";
import { Flow, GraphEdge, GraphNode, Lane, Stats } from "./graph.js";
import { FullSha, Id, SchemaVersionField, Summary } from "./primitives.js";

/**
 * Update payloads are the element minus its id: a patch never renames the
 * thing it addresses. Every field is optional and only the supplied fields
 * are written, so two producers can patch different facets of one element
 * without clobbering each other.
 */
export const LanePatch = Lane.omit({ id: true }).partial();
export const NodePatch = GraphNode.omit({ id: true }).partial();
export const EdgePatch = GraphEdge.omit({ id: true }).partial();
export const FlowPatch = Flow.omit({ id: true }).partial();

/**
 * Operations that evolve a stored graph — in practice the baseline map, which
 * is updated by each merged pull request rather than re-extracted wholesale.
 *
 * `remove_*` deletes the element from the map. That is a different statement
 * from `delta: "removed"`, which says an element still exists in the map but
 * is being deleted by the change under review.
 */
export const PatchOp = z
  .discriminatedUnion("op", [
    z.strictObject({ op: z.literal("add_lane"), lane: Lane }),
    z.strictObject({ op: z.literal("update_lane"), id: Id, patch: LanePatch }),
    z.strictObject({ op: z.literal("remove_lane"), id: Id }),

    z.strictObject({ op: z.literal("add_node"), node: GraphNode }),
    z.strictObject({ op: z.literal("update_node"), id: Id, patch: NodePatch }),
    z.strictObject({ op: z.literal("remove_node"), id: Id }),

    z.strictObject({ op: z.literal("add_edge"), edge: GraphEdge }),
    z.strictObject({ op: z.literal("update_edge"), id: Id, patch: EdgePatch }),
    z.strictObject({ op: z.literal("remove_edge"), id: Id }),

    z.strictObject({ op: z.literal("add_flow"), flow: Flow }),
    z.strictObject({ op: z.literal("update_flow"), id: Id, patch: FlowPatch }),
    z.strictObject({ op: z.literal("remove_flow"), id: Id }),

    z.strictObject({ op: z.literal("set_stats"), stats: Stats }),
  ])
  .describe("A single change to a stored graph document.");
export type PatchOp = z.infer<typeof PatchOp>;

export const PATCH_OPS = [
  "add_lane",
  "update_lane",
  "remove_lane",
  "add_node",
  "update_node",
  "remove_node",
  "add_edge",
  "update_edge",
  "remove_edge",
  "add_flow",
  "update_flow",
  "remove_flow",
  "set_stats",
] as const;

/**
 * A patch has to move the map: the same commit at both ends describes no
 * transition, and such a patch could be applied over and over.
 *
 * The rule lives here as a predicate because a zod refinement does not
 * survive into the inferred type — a caller holding a `PatchDoc` it built
 * itself has to be held to the same rule as one that came from a parser.
 */
export const targetDescribesATransition = (target: {
  fromSha: string;
  toSha: string;
}): boolean => target.fromSha !== target.toSha;

/** An ordered batch of operations against one stored graph. */
export const PatchDoc = z
  .strictObject({
    schemaVersion: SchemaVersionField,
    kind: z.literal("patch"),
    generatedAt: z.iso.datetime().optional(),
    summary: Summary.optional().describe("Why the map is changing, in prose."),
    target: z
      .strictObject({
        graphId: Id.describe("Id of the stored graph being patched."),
        fromSha: FullSha.describe("Commit the stored graph reflects before the operations run."),
        toSha: FullSha.describe("Commit it reflects once they have."),
      })
      .refine(targetDescribesATransition, {
        message: "a patch has to move the map to a different commit",
        path: ["toSha"],
      })
      .describe(
        "Which stored graph these operations belong to, and which commits they carry it between. All three are required, and the commits must differ: they are what stops a patch landing on the wrong map, on a stale one, or twice.",
      ),
    ops: z.array(PatchOp).min(1).max(512).describe("Applied in array order."),
  })
  .describe("A PR Lens patch document.");
export type PatchDoc = z.infer<typeof PatchDoc>;
export type PatchDocInput = z.input<typeof PatchDoc>;

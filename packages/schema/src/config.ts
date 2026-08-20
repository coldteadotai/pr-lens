import { z } from "zod";
import { Id, Label, Lens, SchemaVersionField } from "./primitives.js";

/**
 * Which inferred elements a correction applies to.
 *
 * `id:<node-id>` addresses one node exactly. Anything else is a path glob
 * matched against the node's file paths, so a correction survives the model
 * renaming the node between runs.
 */
export const Selector = z
  .string()
  .min(1)
  .max(256)
  .describe("`id:<node-id>` for an exact node, otherwise a repository-relative path glob.");
export type Selector = z.infer<typeof Selector>;

/**
 * Human corrections to the inferred map. They are an overlay: inference never
 * writes back here, and every run re-applies the overlay on top of fresh
 * inference, so a correction keeps holding as the code moves.
 */
export const MapCorrections = z
  .strictObject({
    rename: z
      .array(z.strictObject({ match: Selector, to: Label }))
      .max(128)
      .default([])
      .describe("Replace the inferred label."),
    exclude: z
      .array(Selector)
      .max(128)
      .default([])
      .describe("Drop matching nodes, and any edge or flow step that touched them."),
    lane: z
      .array(z.strictObject({ match: Selector, lane: Id }))
      .max(128)
      .default([])
      .describe("Move matching nodes into a lane."),
    group: z
      .array(z.strictObject({ match: Selector, group: Id }))
      .max(128)
      .default([])
      .describe("Cluster matching nodes under a sub-group within their lane."),
  })
  .describe("Overlay applied over inference, never mutated by it.");
export type MapCorrections = z.infer<typeof MapCorrections>;

/** The `.github/pr-lens.yml` a repository may commit. Every field is optional. */
export const Config = z
  .strictObject({
    schemaVersion: SchemaVersionField.optional().describe("Omitted means the current version."),
    lenses: z
      .array(Lens)
      .min(1)
      .max(8)
      .default(["architecture", "data-flow"])
      .describe("Lenses to render for this repository."),
    map: MapCorrections.default({ rename: [], exclude: [], lane: [], group: [] }),
    branding: z
      .boolean()
      .default(true)
      .describe("Show the 'Rendered by PR Lens' footer on comments."),
  })
  .describe("Repository configuration for PR Lens.");
export type Config = z.infer<typeof Config>;
export type ConfigInput = z.input<typeof Config>;

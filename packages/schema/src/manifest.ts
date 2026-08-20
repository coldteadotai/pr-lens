import { z } from "zod";
import { Id, Lens, SchemaVersionField, Sha } from "./primitives.js";

/**
 * GitHub serves comment images through a proxy that caches aggressively, so
 * every asset is addressed by the hash of its own bytes and a new render is a
 * new URL rather than an updated one.
 */
export const RenderAsset = z
  .strictObject({
    id: Id,
    lens: Lens,
    theme: z.enum(["light", "dark"]).describe("Half of a <picture> pair."),
    view: Id.optional().describe("Drill-down view this asset renders, when it is not the root."),
    mediaType: z.literal("image/svg+xml"),
    contentHash: z
      .string()
      .regex(/^[0-9a-f]{16,64}$/, "must be lowercase hex")
      .describe("Hash of the asset bytes; the identity of this render."),
    bytes: z.int().min(1),
    width: z.int().min(1),
    height: z.int().min(1),
    animated: z.boolean().default(false).describe("Contains SMIL animation."),
    url: z.url().optional().describe("Where the asset is published, once it has been uploaded."),
    path: z
      .string()
      .min(1)
      .max(1024)
      .optional()
      .describe("Local path, for surfaces that write files instead of uploading."),
  })
  .refine((asset) => asset.url !== undefined || asset.path !== undefined, {
    message: "an asset needs a url or a path",
    path: ["url"],
  })
  .meta({ anyOf: [{ required: ["url"] }, { required: ["path"] }] })
  .describe("One rendered SVG.");
export type RenderAsset = z.infer<typeof RenderAsset>;

/** What a render produced: the inventory the comment composer builds from. */
export const RenderManifest = z
  .strictObject({
    schemaVersion: SchemaVersionField,
    kind: z.literal("render-manifest"),
    generatedAt: z.iso.datetime().optional(),
    graph: z
      .strictObject({
        id: Id.optional(),
        headSha: Sha.optional(),
        contentHash: z
          .string()
          .regex(/^[0-9a-f]{16,64}$/, "must be lowercase hex")
          .describe("Hash of the graph document this render came from."),
      })
      .describe("The document that was rendered."),
    renderer: z.strictObject({
      name: z.string().min(1).max(64),
      version: z.string().min(1).max(32),
    }),
    assets: z.array(RenderAsset).min(1).max(256),
  })
  .describe("A PR Lens render manifest.");
export type RenderManifest = z.infer<typeof RenderManifest>;
export type RenderManifestInput = z.input<typeof RenderManifest>;

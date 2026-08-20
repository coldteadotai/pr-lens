import { createHash } from "node:crypto";
import type { GraphDoc, Lens, RenderAsset, RenderManifest } from "@coldtea/pr-lens-schema";
import { SCHEMA_VERSION } from "@coldtea/pr-lens-schema";
import type { Theme } from "./theme.js";
import { RENDERER_NAME, RENDERER_VERSION } from "./version.js";

/**
 * How many hex characters of the digest an address carries. Long enough that
 * two different renders will not collide inside one repository's history,
 * short enough to read in a URL.
 */
export const CONTENT_HASH_LENGTH = 32;

/**
 * The one place render bytes become an address.
 *
 * GitHub proxies comment images and caches them hard, so a changed diagram
 * has to arrive as a different URL rather than as new bytes at the old one.
 * Every surface that builds such a URL — the action writing files, the hosted
 * app uploading them — must hash through here, or the two will disagree about
 * what the same render is called.
 */
export const contentHash = (bytes: string): string =>
  createHash("sha256").update(bytes, "utf8").digest("hex").slice(0, CONTENT_HASH_LENGTH);

/** JSON with object keys in sorted order, so equal documents hash equal. */
export const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;

  const entries = Object.entries(value)
    .filter(([, nested]) => nested !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`).join(",")}}`;
};

export const graphContentHash = (doc: GraphDoc): string => contentHash(canonicalJson(doc));

export type AssetAddress = { lens: Lens; theme: Theme; view: string | undefined };

/**
 * How the characters a view id may contain but a file name may not are spelled.
 *
 * View ids are authored by an extraction model, and the contract lets one
 * contain `/`, `:` and `.` — so `a/../../elsewhere` is a perfectly valid id.
 * Surfaces join an asset's path to an output directory, and that id would walk
 * straight out of it. The mapping is one-to-one rather than a scrub, so two
 * different views can never be handed the same address: `_` names itself
 * first, which is what keeps the other three from colliding with text that
 * was already there.
 */
const FILE_NAME_ESCAPES: readonly [string, string][] = [
  ["_", "_u"],
  ["/", "_s"],
  [":", "_c"],
  [".", "_d"],
];

const fileNameSafe = (id: string): string =>
  FILE_NAME_ESCAPES.reduce((text, [character, escape]) => text.split(character).join(escape), id);

/**
 * The identity of one rendered SVG within a render: the drill-down section it
 * belongs to and the half of the theme pair it is. A render with no sections
 * falls back to the lens, which is unique across the same render.
 *
 * This doubles as the stem of the file name, so it is spelled in the alphabet
 * a file name can carry.
 */
export const renderAssetId = ({ lens, theme, view }: AssetAddress): string =>
  `${fileNameSafe(view ?? lens)}-${theme}`;

/** The file name an asset is written or published under. */
export const renderAssetFileName = (address: AssetAddress, hash: string): string =>
  `${renderAssetId(address)}-${hash}.svg`;

export const buildManifest = (doc: GraphDoc, assets: readonly RenderAsset[]): RenderManifest => ({
  schemaVersion: SCHEMA_VERSION,
  kind: "render-manifest",
  graph: {
    id: doc.id,
    headSha: doc.provenance.head.sha,
    contentHash: graphContentHash(doc),
  },
  renderer: { name: RENDERER_NAME, version: RENDERER_VERSION },
  assets: [...assets],
});

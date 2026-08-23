# @coldtea/pr-lens-renderer

A schema-valid PR Lens graph document in, a self-contained animated SVG out. No network, no filesystem, no clock: the same document renders to the same bytes on any machine, which is what lets a diagram be addressed by the hash of itself.

MIT © Coldtea AI.

```bash
pnpm add @coldtea/pr-lens-renderer
```

```ts
import { parseGraphDoc } from "@coldtea/pr-lens-schema";
import { render, renderAll } from "@coldtea/pr-lens-renderer";

const doc = parseGraphDoc(json);

// One diagram.
const { svg, width, height } = render(doc, { lens: "architecture", theme: "dark" });

// Every drill-down section, in both themes, plus the manifest a comment is built from.
const { assets, manifest } = renderAll(doc, { config });
```

## Two lenses

`architecture` draws lanes of cards with the change written into them: a coloured outline and a badge per delta, removed elements ghosted and struck through, edges tinted by their own delta, one hero edge with a glow, and a travelling pulse on anything the document marked `animated`.

`data-flow` draws a flow as a sequence: participant columns, lifelines, activation bars, return arrows, self-messages, and the architecture lens's travelling pulse on every step the document marks `animated`. Those steps share one cycle and take it in turn: one dot crossing one arrow at a time, in the order the steps happen, a repeated step taking consecutive turns. A turn is spent entirely on its crossing, so the next arrow lights as the last dot lands.

## Rendering for a GitHub comment

Every file is self-contained. No script, no external stylesheet, no image, no font file, and no CSS custom property that would need the surrounding page, because GitHub serves comment images through a proxy where that page does not exist. Animation is SMIL, which survives being loaded as an `<img>`; the exact patterns here are the ones proven to play inside a real pull request comment.

Themes are separate files rather than one file that adapts, because an image cannot see the theme of the page it lands in. Render both and pair them:

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="…-dark.svg">
  <img src="…-light.svg" alt="…">
</picture>
```

## Determinism

The hard requirement is that a diagram does not rearrange itself between two pushes that barely changed anything.

- **Depth** is a longest path from a source, so an arrow points at a node below the one it left. Cycles are ranked too, by dropping the edge that closes one, chosen by a walk in document order rather than by map iteration order.
- **`layout.rank` and `layout.laneOrder` are hints**, applied as a floor rather than an answer. A hint can push a node further down; it cannot lift one above what feeds it. A stale hint from an extraction model therefore cannot invert an edge.
- **Depth is counted within a lane.** A lane that only enters the story late still starts at the top of its column, and a rank no card in the lane occupies leaves no empty row behind.
- **Text is measured from a table**, never from a font engine, so a CI runner with no fonts installed lays out identically to a laptop with all of them.
- **Every coordinate is rounded before it is written**, and every comparison is by code unit rather than by `localeCompare`. Arithmetic that differs in the last bit, or a sort that consults the host's collation data, would change the bytes, and the render hash with it.
- **Every lane is the same fixed width**, a constant rather than anything derived from what the lanes hold. A width drawn from content couples every column to the contents of the ones before it, so adding one node with a long name to the first lane would slide every card in every later lane sideways. The cost is that a lane holding something narrow is wider than it needs to be; stability is worth more. A lane header too long for its band gives up its tail rather than widening the band.

Adding a node to one lane leaves every card in every other lane exactly where it was, before it or after it. There are tests for that, and golden SVGs for the reference documents: a change to one is a change to what a reviewer sees, so it is reviewed by a person before it is committed.

```bash
pnpm test                 # compares against the goldens
UPDATE_GOLDENS=1 pnpm test  # records them, for a human to read the diff of
```

## Corrections

A repository's `.github/pr-lens.yml` is an overlay, applied here before layout and never written back into inference, so a correction keeps holding as the code moves:

```ts
render(doc, { lens: "architecture", theme: "dark", config });
```

`rename`, `lane` and `group` address nodes by `id:<node-id>` or by a glob over the paths backing them. A `lane` correction may name a band the document never declared; it gets created, with the id for a label, so write `lane: infrastructure` rather than `lane: l3`.

`exclude` takes with it every edge and flow step that touched what it removed, every view that pointed at nothing else, and every layout hint left naming something that is gone. Half an arrow is worse than none, and the corrected document is a document like any other, so it still parses.

## Addresses

Renders are content-addressed because GitHub's image proxy caches hard: a changed diagram has to arrive as a new URL, not as new bytes at the old one. `contentHash`, `renderAssetId` and `renderAssetFileName` are the single owners of that format, and every surface that builds such a URL must go through them.

An asset's `path` is safe to join to an output directory, and its `id` is always a legal `Id`. View ids are authored by an extraction model and the contract lets one contain `/`, `:` and `.`, so `a/../../elsewhere` is a valid id; those characters are re-spelled one-for-one on the way into an address, which cannot produce a separator or a dot segment. Re-spelling can lengthen an id that was already near the contract's limit, so one that would overflow keeps a readable prefix and ends in a digest of the whole original, which is what stops two different views being handed the same address.

## Untrusted text

Labels, subtitles and titles come from a model. They are escaped for XML at the boundary, and the code points XML 1.0 has no spelling for (most control characters, lone surrogates, the two non-characters) are dropped there too, because the schema constrains how long a label is but not which characters it may contain, and one of those would make the file fail to parse rather than merely look wrong.

## Refusals

`PrLensRenderError` carries a `code` a caller can switch on: `UNKNOWN_VIEW`, `LENS_NOT_DECLARED`, `NOTHING_TO_RENDER`, `NO_FLOW_IN_SCOPE`, `TOO_MANY_ASSETS`. A document that parsed is otherwise safe to render: the renderer trusts `@coldtea/pr-lens-schema` and never re-validates it.

`TOO_MANY_ASSETS` cannot be reached by a parsed document: the contract caps a view tree at `MAX_VIEWS`, which is `MAX_RENDER_ASSETS` divided by the two themes a `<picture>` pair needs. A hand-built one can reach it, because that cap lives in a refinement and a refinement does not survive into the inferred type. The check is a postcondition on what `renderAll` is about to produce rather than a re-reading of what came in, because how many pictures a render makes depends on how many themes the caller asked for, which no document knows.

---

Part of [PR Lens](https://prlens.dev). Review what actually matters.

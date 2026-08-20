# @coldtea/pr-lens-renderer

A schema-valid PR Lens graph document in, a self-contained animated SVG out. No network, no filesystem, no clock: the same document renders to the same bytes on any machine, which is what lets a diagram be addressed by the hash of itself.

MIT © Ohans Emmanuel.

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

`data-flow` draws a flow as a sequence: participant columns, lifelines, activation bars, return arrows, self-messages, and pulses that travel one after another on a single shared cycle, so the dots move in the order the steps happen.

## Rendering for a GitHub comment

Every file is self-contained. No script, no external stylesheet, no image, no font file, and no CSS custom property that would need the surrounding page — GitHub serves comment images through a proxy where that page does not exist. Animation is SMIL, which survives being loaded as an `<img>`; the exact patterns here are the ones proven to play inside a real pull request comment.

Themes are separate files rather than one file that adapts, because an image cannot see the theme of the page it lands in. Render both and pair them:

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="…-dark.svg">
  <img src="…-light.svg" alt="…">
</picture>
```

## Determinism

The hard requirement is that a diagram does not rearrange itself between two pushes that barely changed anything.

- **Depth** is a longest path from a source, so an arrow points at a node below the one it left. Cycles are ranked too, by dropping the edge that closes one — chosen by a walk in document order, not by map iteration order.
- **`layout.rank` and `layout.laneOrder` are hints**, applied as a floor rather than an answer. A hint can push a node further down; it cannot lift one above what feeds it. A stale hint from an extraction model therefore cannot invert an edge.
- **Depth is counted within a lane.** A lane that only enters the story late still starts at the top of its column, and a rank no card in the lane occupies leaves no empty row behind.
- **Text is measured from a table**, never from a font engine, so a CI runner with no fonts installed lays out identically to a laptop with all of them.
- **Every coordinate is rounded before it is written.** Arithmetic that differs in the last bit would change the bytes, and the render hash with it.

Adding a node to one lane leaves every card in the lanes before it exactly where it was. There is a test for that, and golden SVGs for the reference documents: a change to one is a change to what a reviewer sees, so it is reviewed by a person before it is committed.

```bash
pnpm test                 # compares against the goldens
UPDATE_GOLDENS=1 pnpm test  # records them, for a human to read the diff of
```

## Corrections

A repository's `.github/pr-lens.yml` is an overlay, applied here before layout and never written back into inference, so a correction keeps holding as the code moves:

```ts
render(doc, { lens: "architecture", theme: "dark", config });
```

`rename`, `lane` and `group` address nodes by `id:<node-id>` or by a glob over the paths backing them. `exclude` takes with it every edge and flow step that touched what it removed, and every view that pointed at nothing else — half an arrow is worse than none.

## Addresses

Renders are content-addressed because GitHub's image proxy caches hard: a changed diagram has to arrive as a new URL, not as new bytes at the old one. `contentHash`, `renderAssetId` and `renderAssetFileName` are the single owners of that format, and every surface that builds such a URL must go through them.

## Refusals

`PrLensRenderError` carries a `code` a caller can switch on: `UNKNOWN_VIEW`, `LENS_NOT_DECLARED`, `NOTHING_TO_RENDER`, `NO_FLOW_IN_SCOPE`. A document that parsed is otherwise safe to render — the renderer trusts `@coldtea/pr-lens-schema` and never re-validates it.

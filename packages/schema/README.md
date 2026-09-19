# @coldtea/pr-lens-schema

The PR Lens contract. Extraction produces these documents, the renderer consumes them, and every other surface (CLI, GitHub Action, agent skill, hosted app) passes them around. If a document validates here, it is safe to render.

MIT © Coldtea AI.

```bash
pnpm add @coldtea/pr-lens-schema
```

```ts
import { parseGraphDoc, safeParseGraphDoc } from "@coldtea/pr-lens-schema";

const graph = parseGraphDoc(json);          // throws PrLensSchemaError
const result = safeParseGraphDoc(json);     // { ok: true, value } | { ok: false, error }
```

## The four documents

| Document | Purpose | Parser |
| --- | --- | --- |
| `GraphDoc` | Lanes, nodes, edges, flows, stats, the drill-down tree and an optional walkthrough for one pull request, or for a stored baseline map | `parseGraphDoc` |
| `PatchDoc` | Ordered operations that move a stored graph forward as pull requests merge | `parsePatchDoc` |
| `Config` | What a repository commits as `.github/pr-lens.yml` | `parseConfig` |
| `RenderManifest` | The SVGs a render produced, and where they live | `parseRenderManifest` |

Every document carries a `schemaVersion`, config included: a repository's corrections have to keep their meaning as the contract moves.

## Views and the render they imply

A render is one asset per view per theme, so the size of a drill-down tree and the size of a render manifest are one rule, not two numbers:

```ts
MAX_VIEWS * THEMES.length === MAX_RENDER_ASSETS; // 128 * 2 === 256
```

Each array in the view tree is capped, but its depth is not, so the total is bounded by `graphIntegrityIssues`: a document carrying more views than a manifest could describe is rejected here rather than at the renderer, which would otherwise be left holding a document it was told was fine. Import `MAX_VIEWS`, `MAX_RENDER_ASSETS` and `THEMES` rather than restating any of them: raise the budget or add a theme and the other end moves with it.

The cap is the worst case, every theme rendered, not what a particular render would emit. A single-theme render could describe twice as many views, but then whether a document is renderable would depend on how it was asked to be rendered, and **if it parses, it renders** is the promise this package exists to make.

## Two lenses

`architecture` shows blast radius against the existing system. `data-flow` animates an ordered pipeline. There is deliberately no security lens and no findings field: PR Lens is the comprehension layer, and a document that carries findings is rejected rather than quietly stripped. The `Lens` enum is additive: a future contract version may add lenses, so treat one you do not recognise as a view to skip, not as a failure.

## Walkthroughs

A document may carry a `walkthrough`.

```ts
walkthrough: {
  steps: [
    {
      id: "four-batch-calls",
      heading: "Postmark now gets 500 emails per call",
      body: "One call per batch, and Postmark answers with a result for each message.",
      stage: { kind: "flow", flow: "send-pipeline" },
      focus: { kind: "selection", messages: ["batch-post", "batch-results"] },
    },
    {
      id: "blast-radius",
      heading: "4 parts added, 2 removed, across 3 lanes",
      body: "A 2,000-person broadcast used to make 2,000 calls to Postmark. It now makes 4.",
      stage: { kind: "view", view: "overview" },
    },
  ],
}
```

A walkthrough is a short guided tour of the diagrams. It has two to twelve steps. Each step shows one diagram, points at one part of it, and says a few words about it.

Each step has:

- `heading`: the thing and what happened to it, up to 48 characters, in sentence case. For example "Postmark now gets 500 emails per call".
- `body`: one line under the heading, up to 140 characters, on what the change means for behaviour. For example "One call per batch instead of one call per person". A heading with no body reads as unfinished, so the parser requires one.
- `stage`: which diagram to show. A document can have several diagrams: its views (the drill-down diagrams) and its flows (the sequence diagrams). `{ "kind": "view", "view": "overview" }` shows the view called `overview`. `{ "kind": "flow", "flow": "send-pipeline" }` shows the flow called `send-pipeline`. Leave `stage` out and the step uses the diagram the reader is already on.
- `focus`: what to zoom in on inside that diagram. `{ "kind": "all" }` means the whole diagram. A selection means "just these things": name any lanes, nodes, edges or flow steps (`messages`) by id, and the camera zooms to them while everything else dims. A selection must name at least one thing.

The validator checks:

- Every id you name exists in the document. A flow step you name must belong to the flow the stage shows, because flow step ids are only unique inside their own flow.
- `messages` needs a stage that shows a flow. Leave it out when the stage is an architecture view.
- Step ids are unique within the walkthrough. Two steps minimum, twelve maximum.
- A stored map never carries a walkthrough. A map describes the system; a walkthrough tells the story of one change.

When a patch or a correction removes something from the document, the walkthrough follows: a step loses the names that are gone, a step with nothing left to point at or whose diagram is gone is dropped, and if fewer than two steps remain the walkthrough is dropped. `pruneWalkthrough` does this and is exported for anything else that removes parts of a document.

## Deltas

Every node, edge and flow step declares how it relates to the base commit: `added`, `modified`, `removed` or `unchanged`. `unchanged` elements are the context a reviewer needs to judge blast radius, so they belong in the document rather than being filtered out.

## What validation covers

Parsing runs four things in one pass, and reports every problem it finds rather than only the first:

1. **Structure**: types, lengths, enums, no unknown keys, and file paths that can actually become a diff permalink (repository-relative, POSIX, no `..` segment).
2. **Contract version**: the same major, and a minor from the first the contract shipped (`0.1`) up to this package's own. A newer minor is refused, since it may carry a field this parser would take for an invented one.
3. **Referential integrity**: every node sits in a declared lane, every edge joins declared nodes, every flow step runs between declared participants, every drill-down view and layout hint names elements that exist, every walkthrough step stages a diagram the document has and focuses elements it has, and a document carrying flows declares the `data-flow` lens.
4. **That a render could describe the document**: see below.

A document nested deeper than the stack can walk is reported as a document too deep to read, not thrown: `safeParse*` returns a result whatever it is handed.

Failures arrive as a `PrLensSchemaError` with a machine-readable `code` (`INVALID_DOCUMENT`, `BROKEN_REFERENCE`, `DUPLICATE_ID`, `UNSUPPORTED_SCHEMA_VERSION`, `PATCH_CONFLICT`, `NOT_A_SNAPSHOT`) and an `issues` array carrying a path and message each.

## Evolving a stored graph

`applyPatchDoc(graph, patch)` is the executable definition of the patch operations:

```ts
import { applyPatchDoc, parseGraphDoc, parsePatchDoc } from "@coldtea/pr-lens-schema";

const result = applyPatchDoc(parseGraphDoc(baseline), parsePatchDoc(patch));
```

- A patch names the map it targets and the commits it carries it between: `graphId`, `fromSha` and `toSha` are all required, they are full 40-character commit names, and they must differ. Abbreviations are fine for something a human reads but not for deciding whether two records mean the same commit, and a patch that does not move the map is a patch that can be replayed.
- The target is checked before anything is applied: a patch aimed at another map, or written against a commit the map has already moved past, is a `PATCH_CONFLICT` rather than a merge.
- A stored map is a snapshot rather than a diff: it has an id, it records the single commit it reflects in full on both `base` and `head`, and nothing in it is annotated as a change. `graphSnapshotIssues` is that rule, exported for anything that stores a map, and `applyPatchDoc` runs it on the way in and on the way out, so a patch can neither leave an annotation behind nor launder a map that already carries one. Failures are `NOT_A_SNAPSHOT` and name the offender, down to the step of a flow.
- The target rules are re-checked inside `applyPatchDoc` rather than trusted from parsing, because a zod refinement does not survive into the inferred type: a `PatchDoc` a caller assembled itself is held to the same rules as one that came from `parsePatchDoc`.
- Operations apply in array order, and the first conflict stops the batch, because a later operation was written against the state an earlier one was supposed to produce.
- `add_*` refuses an id that is taken; `update_*` and `remove_*` refuse an id that is absent; `update_*` writes only the fields it names.
- Removing a node takes its edges and flow steps with it, and drops a flow left with fewer than two participants or no steps. Removed ids are pruned out of the drill-down tree and the layout hints, and a view whose selection loses its last element is dropped rather than widened.
- A walkthrough is pruned once, against the document the operations produced rather than alongside each one. A step names a diagram as well as elements, so it can name a view the tree prune has just dropped, and an update that rewrites a flow's steps takes focus members away without removing anything the other prunes would notice. A step whose stage is gone, or whose focus loses its last element, goes with it, and a tour left with fewer than two steps goes whole. Focused flow steps are measured against the flow the step's own stage draws, never against the document at large.
- Removing a lane that still holds nodes is a conflict, not a cascade: move its nodes first.
- `remove_*` deletes an element from the stored graph. That is a different statement from `delta: "removed"`, which says an element still exists but is being deleted by the change under review.
- A successful result is always a document that would pass `parseGraphDoc`: the candidate is validated as a whole before it is returned.

The input document is never mutated. `applyPatch(graph, ops)` is the same thing without the target check, for callers that already know which document they hold.

A stored map describes a system rather than a change, so everything in it is `unchanged` and its `base` equals its `head`; the deltas belong to pull-request documents.

## Repository config

```yaml
# .github/pr-lens.yml
schemaVersion: 0.1.0
lenses: [architecture, data-flow]
branding: true
github:
  draw: auto
  comment:
    collapsed: false
    notice: true
map:
  rename:
    - match: functions/src/broadcast/sendBroadcastBulk.ts
      to: Broadcast sender
  exclude:
    - "**/*.test.ts"
  lane:
    - match: packages/broadcast-lib/**
      lane: functions
  group:
    - match: id:build-bulk-payload
      group: broadcast-lib
```

A `match` beginning with `id:` addresses one node exactly; anything else is a path glob matched against a node's file paths, so a correction survives the model renaming the node between runs. Corrections are an overlay applied over fresh inference on every run. Inference never writes back into this file.

The hosted App reads `github` settings from the PR's head commit. Other options apply to the CLI.

| Setting | Default | Effect |
| --- | --- | --- |
| `github.comment.collapsed` | `false` | Start diagrams and details closed. Drawing still runs automatically. |
| `github.draw` | `auto` | `on-demand` leaves a pull request undrawn, with a short notice, until someone comments `@pr-lens draw`. |
| `github.comment.notice` | `true` | `false` drops that notice, so an on-demand repository hears nothing until someone asks. |

## JSON Schema

`json-schema/*.json` (draft 2020-12) is generated from the zod schemas and published with the package, for producers that do not run TypeScript and for editors validating `.github/pr-lens.yml`:

```jsonc
{ "$ref": "node_modules/@coldtea/pr-lens-schema/json-schema/graph-doc.schema.json" }
```

They describe **what an author may write**: a field with a default is one you may leave out. Rules are carried across wherever JSON Schema can state them: the supported contract versions, the repository-relative path rule, `endLine` requiring `startLine`, an asset needing a `url` or a `path`, a `selection` view having to select something.

Exactly seven rules cannot be stated in JSON Schema and stay the parser's job, each of them a comparison the shape alone cannot make:

1. referential integrity between elements,
2. a line range that ends before it starts,
3. the agreement between a self message's endpoints,
4. a patch whose two commits are the same,
5. more views than a render manifest could describe,
6. a walkthrough step focusing flow steps the diagram on its stage does not draw,
7. sample traffic on a flow step deeper than 8 levels or over 4096 bytes once serialised (and a `shape` over 2048 bytes: JSON Schema counts characters, not bytes).

The tests run a table of documents through both representations and assert the same verdict, accept and reject alike, including a case per divergence above, so they stay deliberate and cannot quietly grow an eighth.

## Goldens

`examples/` holds the reference documents, also importable pre-parsed:

```ts
import { postmarkRefactorGraph } from "@coldtea/pr-lens-schema/examples";
```

They tell one story: a real refactor that moved broadcast sending from one Postmark request per recipient to batches of 500:

- **`postmark-refactor.graph.json`** is the canonical document: the pull request itself, across three lanes, exercising all four delta states, a hero edge, a seven-step data flow with returns and a repeated batch step, a nested drill-down tree, and a six-step walkthrough that stages both a view and a flow. Downstream renderer goldens are measured against it.
- **`broadcast-baseline.graph.json`** is the stored map of that subsystem as `main` stood before the change, and **`broadcast-baseline.patch.json`** carries it to the merged state, the transition `applyPatchDoc` performs.
- **`payload.graph.json`** is the pull-request document with sample traffic on six of its seven flow steps: both sides on the batch call, a `before` that differs from its `sample`, a `void` response, and one step left bare.
- **`postmark-refactor.render-manifest.json`** is what rendering the pull-request document produces, **`pr-lens.config.json`** a repository's corrections, and **`minimal.graph.json`** the smallest document that validates.

## Versioning

`SCHEMA_VERSION` is the contract version, and it moves independently of this package's version. A release that changes no contract, a documentation fix or another patch, ships a new package version and leaves `SCHEMA_VERSION` where it stands, so a document written against the older string keeps parsing. A minor release only adds optional fields or widens an enum, and a parser accepts every minor from `0.1` up to its own: a document stored against `0.1.1` still opens on a `0.2.0` parser, and a `0.3.0` document is refused by one until the package that reads it ships. A major release may remove or retype a field.

Contract `0.2.0` added `payload` on a flow step: sample traffic, as JSON values, for a step that moves data.

---

Part of [PR Lens](https://prlens.dev). Review what actually matters.

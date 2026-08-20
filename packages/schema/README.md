# @coldtea/pr-lens-schema

The PR Lens contract. Extraction produces these documents, the renderer consumes them, and every other surface — CLI, GitHub Action, agent skill, hosted app — passes them around. If a document validates here, it is safe to render.

MIT © Ohans Emmanuel.

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
| `GraphDoc` | Lanes, nodes, edges, flows, stats and the drill-down tree for one pull request — or for a stored baseline map | `parseGraphDoc` |
| `PatchDoc` | Ordered operations that move a stored graph forward as pull requests merge | `parsePatchDoc` |
| `Config` | What a repository commits as `.github/pr-lens.yml` | `parseConfig` |
| `RenderManifest` | The SVGs a render produced, and where they live | `parseRenderManifest` |

Every document carries a `schemaVersion`, config included: a repository's corrections have to keep their meaning as the contract moves.

## Views and the render they imply

A render is one asset per view per theme, so the size of a drill-down tree and the size of a render manifest are one rule, not two numbers:

```ts
MAX_VIEWS * THEMES.length === MAX_RENDER_ASSETS; // 128 * 2 === 256
```

Each array in the view tree is capped, but its depth is not, so the total is bounded by `graphIntegrityIssues`: a document carrying more views than a manifest could describe is rejected here rather than at the renderer, which would otherwise be left holding a document it was told was fine. Import `MAX_VIEWS`, `MAX_RENDER_ASSETS` and `THEMES` rather than restating any of them — raise the budget or add a theme and the other end moves with it.

The cap is the worst case, every theme rendered, not what a particular render would emit. A single-theme render could describe twice as many views, but then whether a document is renderable would depend on how it was asked to be rendered — and **if it parses, it renders** is the promise this package exists to make.

## Two lenses

`architecture` shows blast radius against the existing system. `data-flow` animates an ordered pipeline. There is deliberately no security lens and no findings field: PR Lens is the comprehension layer, and a document that carries findings is rejected rather than quietly stripped. The `Lens` enum is additive — a future contract version may add lenses, so treat one you do not recognise as a view to skip, not as a failure.

## Deltas

Every node, edge and flow step declares how it relates to the base commit: `added`, `modified`, `removed` or `unchanged`. `unchanged` elements are the context a reviewer needs to judge blast radius, so they belong in the document rather than being filtered out.

## What validation covers

Parsing runs three things in one pass, and reports every problem it finds rather than only the first:

1. **Structure** — types, lengths, enums, no unknown keys, and file paths that can actually become a diff permalink (repository-relative, POSIX, no `..` segment).
2. **Contract version** — below `1.0.0` an exact `major.minor` match; from `1.0.0` on, the same major and a minor no newer than this package's.
3. **Referential integrity** — every node sits in a declared lane, every edge joins declared nodes, every flow step runs between declared participants, every drill-down view and layout hint names elements that exist, and a document carrying flows declares the `data-flow` lens.
4. **That a render could describe the document** — see below.

A document nested deeper than the stack can walk is reported as a document too deep to read, not thrown: `safeParse*` returns a result whatever it is handed.

Failures arrive as a `PrLensSchemaError` with a machine-readable `code` (`INVALID_DOCUMENT`, `BROKEN_REFERENCE`, `DUPLICATE_ID`, `UNSUPPORTED_SCHEMA_VERSION`, `PATCH_CONFLICT`, `NOT_A_SNAPSHOT`) and an `issues` array carrying a path and message each.

## Evolving a stored graph

`applyPatchDoc(graph, patch)` is the executable definition of the patch operations:

```ts
import { applyPatchDoc, parseGraphDoc, parsePatchDoc } from "@coldtea/pr-lens-schema";

const result = applyPatchDoc(parseGraphDoc(baseline), parsePatchDoc(patch));
```

- A patch names the map it targets and the commits it carries it between — `graphId`, `fromSha` and `toSha` are all required, they are full 40-character commit names, and they must differ. Abbreviations are fine for something a human reads but not for deciding whether two records mean the same commit, and a patch that does not move the map is a patch that can be replayed.
- The target is checked before anything is applied: a patch aimed at another map, or written against a commit the map has already moved past, is a `PATCH_CONFLICT` rather than a merge.
- A stored map is a snapshot rather than a diff: it has an id, it records the single commit it reflects in full on both `base` and `head`, and nothing in it is annotated as a change. `graphSnapshotIssues` is that rule, exported for anything that stores a map, and `applyPatchDoc` runs it on the way in and on the way out — so a patch can neither leave an annotation behind nor launder a map that already carries one. Failures are `NOT_A_SNAPSHOT` and name the offender, down to the step of a flow.
- The target rules are re-checked inside `applyPatchDoc` rather than trusted from parsing, because a zod refinement does not survive into the inferred type: a `PatchDoc` a caller assembled itself is held to the same rules as one that came from `parsePatchDoc`.
- Operations apply in array order, and the first conflict stops the batch — a later operation was written against the state an earlier one was supposed to produce.
- `add_*` refuses an id that is taken; `update_*` and `remove_*` refuse an id that is absent; `update_*` writes only the fields it names.
- Removing a node takes its edges and flow steps with it, and drops a flow left with fewer than two participants or no steps. Removed ids are pruned out of the drill-down tree and the layout hints, and a view whose selection loses its last element is dropped rather than widened.
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

A `match` beginning with `id:` addresses one node exactly; anything else is a path glob matched against a node's file paths, so a correction survives the model renaming the node between runs. Corrections are an overlay applied over fresh inference on every run — inference never writes back into this file.

## JSON Schema

`json-schema/*.json` (draft 2020-12) is generated from the zod schemas and published with the package, for producers that do not run TypeScript and for editors validating `.github/pr-lens.yml`:

```jsonc
{ "$ref": "node_modules/@coldtea/pr-lens-schema/json-schema/graph-doc.schema.json" }
```

They describe **what an author may write**: a field with a default is one you may leave out. Rules are carried across wherever JSON Schema can state them — the supported contract versions, the repository-relative path rule, `endLine` requiring `startLine`, an asset needing a `url` or a `path`, a `selection` view having to select something.

Exactly five rules cannot be stated in JSON Schema and stay the parser's job, each of them a comparison the shape alone cannot make:

1. referential integrity between elements,
2. a line range that ends before it starts,
3. the agreement between a self message's endpoints,
4. a patch whose two commits are the same,
5. more views than a render manifest could describe.

The tests run a table of documents through both representations and assert the same verdict, accept and reject alike — including a case per divergence above, so they stay deliberate and cannot quietly grow a fifth.

## Goldens

`examples/` holds the reference documents, also importable pre-parsed:

```ts
import { postmarkRefactorGraph } from "@coldtea/pr-lens-schema/examples";
```

They tell one story — a real refactor that moved broadcast sending from one Postmark request per recipient to batches of 500:

- **`postmark-refactor.graph.json`** is the canonical document: the pull request itself, across three lanes, exercising all four delta states, a hero edge, a seven-step data flow with returns and a repeated batch step, and a nested drill-down tree. Downstream renderer goldens are measured against it.
- **`broadcast-baseline.graph.json`** is the stored map of that subsystem as `main` stood before the change, and **`broadcast-baseline.patch.json`** carries it to the merged state — the transition `applyPatchDoc` performs.
- **`postmark-refactor.render-manifest.json`** is what rendering the pull-request document produces, **`pr-lens.config.json`** a repository's corrections, and **`minimal.graph.json`** the smallest document that validates.

## Versioning

`SCHEMA_VERSION` is the contract version, and it is not the package version's twin by accident — they move together. While the contract is below `1.0.0`, a minor bump may break: parsers accept only their exact `major.minor`. From `1.0.0` on, minor releases only add optional fields or widen an enum, and a parser accepts any minor at or below its own.

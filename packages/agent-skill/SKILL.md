---
name: pr-lens
description: Draw a code change as an architecture or data-flow diagram with PR Lens — author a graph document from a diff, validate it, render it to SVG, and attach it to a pull request; or correct a repository's map in .github/pr-lens.yml. Use when asked to diagram, visualise or explain the shape of a change, when attaching a diagram to a pull request you opened, or when an existing PR Lens diagram names things wrongly.
---

# PR Lens

PR Lens turns a diff into one JSON document — lanes, nodes, edges, ordered flows — and renders it as an animated SVG that reads inside a GitHub pull request comment. The document is the whole contract: if it validates, it renders.

You are usually the model. Rather than calling out to a provider, read the diff and write the document yourself, then let the tooling check it.

## The loop

1. **Read the diff.** `git diff --find-renames <base>...<head>`. The base is the merge base, not the tip of the base branch.
2. **Write the document** to `pr-lens/graph.json`, following `references/graph-document.md`. The authoritative shape is the JSON Schema that ships with the contract:
   `node_modules/@coldtea/pr-lens-schema/json-schema/graph-doc.schema.json`
3. **Validate, and fix what it names.**
   ```bash
   npx @coldtea/pr-lens-cli validate pr-lens/graph.json
   ```
   Each failure is a path into your document, a reason and a code. Fix every one and run it again. Do not render an invalid document; do not "work around" a failure by deleting the element it names.
4. **Render and attach.**
   ```bash
   npx @coldtea/pr-lens-cli render pr-lens/graph.json --out pr-lens/
   ```
   Commit the SVGs somewhere durable — an orphan branch, or a release asset — and reference them from the pull request body with a `<picture>` pair so the diagram reads in both GitHub themes. `pr-lens comment --graph … --manifest …` composes that markdown for you.

If the repository has a model key configured and you would rather not author the document yourself, `npx @coldtea/pr-lens-cli analyze --base <ref>` does steps 1 and 2 with the provider of your choice.

## What makes a document worth reading

- **Include what did not change.** A diagram of only the changed nodes says nothing about blast radius. The unchanged neighbours a change touches are the context; mark them `delta: "unchanged"`.
- **Lanes are the reader's mental model** — a runtime, a tier, a boundary — not the folder tree.
- **One hero edge**, two at the outside: the connection the change is really about.
- **Add a flow only when there is a sequence** worth animating. One good flow beats three thin ones.
- **Attach file refs**: they become the permalinks a reviewer clicks.
- **There is no findings lens.** PR Lens is the comprehension layer, not another review bot. There is no field for a bug, a risk or a security note, and a document that invents one is rejected rather than trimmed.

## What the validator will catch

Read `references/graph-document.md` before writing. The four failures that account for nearly everything:

| Code | What you did |
| --- | --- |
| `BROKEN_REFERENCE` | an edge, a flow step or a view names an id you never declared |
| `INVALID_DOCUMENT` | an invented field — the schemas are strict, unknown keys are rejected |
| `DUPLICATE_ID` | two nodes, edges or views sharing an id |
| `UNSUPPORTED_SCHEMA_VERSION` | `schemaVersion` is not the contract version installed |

Four rules cannot be expressed in JSON Schema and are checked only by the parser, so structured output alone does not make a document valid: referential integrity, a line range that ends before it starts, a `self` message whose endpoints disagree, and a patch whose two commits are the same. Always validate.

## Fixing a map instead of writing one

When someone says the diagram is wrong — a node is misnamed, a folder should not be on it, something sits in the wrong lane — do not edit the generated document. It is regenerated on every run. Write the correction into `.github/pr-lens.yml`, which is an overlay applied over fresh inference every time:

```yaml
schemaVersion: 0.1.0
map:
  rename:
    - match: functions/src/broadcast/sendBroadcastBulk.ts
      to: Broadcast sender
  exclude:
    - "**/*.test.ts"
  lane:
    - match: packages/broadcast-lib/**
      lane: functions
```

`references/config.md` has the full format and the recipes. Validate it the same way: `npx @coldtea/pr-lens-cli validate .github/pr-lens.yml`.

A `match` beginning with `id:` addresses one node exactly; anything else is a path glob matched against a node's file paths — prefer the glob, because it keeps holding when the next run names the node differently. A lane pin can only name a lane the document already declares.

## Reference documents

The contract ships worked examples. `postmark-refactor.graph.json` is the realistic one — three lanes, all four delta states, a hero edge, a seven-step flow, a nested drill-down tree — and `minimal.graph.json` is the smallest document that validates:

```bash
ls node_modules/@coldtea/pr-lens-schema/examples/
```

Read the realistic one before authoring your first document. It is faster than reading the schema.

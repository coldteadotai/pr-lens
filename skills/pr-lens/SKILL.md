---
name: pr-lens
description: Draw a code change as an architecture or data-flow diagram with PR Lens. Author a graph document from a diff, validate it, render it to SVG, and attach it to a pull request; or correct a repository's map in .github/pr-lens.yml. Use when asked to diagram, visualise or explain the shape of a change, when attaching a diagram to a pull request you opened, or when an existing PR Lens diagram names things wrongly.
---

# PR Lens

PR Lens turns a diff into one JSON document (lanes, nodes, edges, ordered flows) and renders it as an animated SVG that reads inside a GitHub pull request comment. The document is the whole contract: if it validates, it renders.

You are usually the model. Rather than calling out to a provider, read the diff and write the document yourself, then let the tooling check it. Nothing on this path needs a model key or names a model: whichever one you are running is the one doing the reasoning.

## The loop

1. **Read the diff.** `git diff --find-renames <base>...<head>`. The base is the merge base, not the tip of the base branch.
2. **Write the document** to `.pr-lens/graph.json`, following `references/graph-document.md`. That page is the whole shape: every field, every enum, every limit, and the four rules a JSON Schema cannot express. `references/example.graph.json` is a document that validates — three lanes, all four delta states, a hero edge, a seven-step flow, a nested drill-down tree. Read it before you write your first one. It is quicker than reading the reference.
3. **Validate, and fix what it names.**
   ```bash
   npx @coldtea/pr-lens-cli validate .pr-lens/graph.json
   ```
   Each failure is a path into your document, a reason and a code. Fix every one and run it again. Do not render an invalid document; do not "work around" a failure by deleting the element it names.
4. **Render.**
   ```bash
   npx @coldtea/pr-lens-cli render .pr-lens/graph.json
   ```
   The SVGs, the manifest and `drawn.graph.json` land in `.pr-lens/`, which the CLI adds to the repository's .gitignore. Do not commit any of it. These files are a preview, rebuilt from the diff whenever anyone wants them again; the comment on the pull request is the thing you are making.
5. **Attach.** Put the SVGs somewhere durable — an orphan branch, a release asset — then compose the comment from the document that was drawn:
   ```bash
   npx @coldtea/pr-lens-cli comment \
     --graph .pr-lens/drawn.graph.json \
     --manifest .pr-lens/manifest.json \
     --asset-base-url https://raw.githubusercontent.com/<owner>/<repo>/<branch>/<dir>
   ```
   The markdown goes to stdout, with each diagram as a `<picture>` pair so it reads in both GitHub themes. Posting it is your business.

   Both flags matter. `--graph` takes `drawn.graph.json`, not the document you wrote: corrections change what the diagrams show, and the CLI refuses a document its manifest does not describe. `--asset-base-url` is where you published the SVGs; leave it out and the markdown points at local paths no reader can fetch.

If you would rather not author the document yourself, `npx @coldtea/pr-lens-cli analyze --base <ref>` does steps 1 and 2 by asking a provider — Gemini, OpenAI, or any endpoint speaking `/chat/completions` — with a key of your own. That is the only path here that needs one.

## What makes a document worth reading

- **Include what did not change.** A diagram of only the changed nodes says nothing about blast radius. The unchanged neighbours a change touches are the context; mark them `delta: "unchanged"`.
- **Lanes are the reader's mental model** (a runtime, a tier, a boundary), not the folder tree.
- **One hero edge**, two at the outside: the connection the change is really about.
- **Add a flow only when there is a sequence** worth animating. One good flow beats three thin ones.
- **Attach file refs**: they become the permalinks a reviewer clicks.
- **There is no findings lens.** PR Lens is the comprehension layer, not another review bot. There is no field for a bug, a risk or a security note, and a document that invents one is rejected rather than trimmed.

## Choosing architecture views

Treat architecture views as a C4-inspired decision tree, not a checklist. One useful view is enough for a small change. Start with system context when the change affects a user, an external system or a system boundary. Use a container view for the affected applications, services, jobs, data stores and runtimes. Add a component child only when an affected container's internals matter. Do not add code-level views by default.

Every child moves down one level and covers a materially narrower scope. Skip empty, repetitive or speculative levels, and do not infer architecture from folder names alone. Two views should not carry substantially the same nodes and edges. Keep the unchanged direct neighbours that explain blast radius.

Keep data-flow views as separate roots rather than nesting them in the architecture tree. Set `defaultOpen: true` on the highest useful architecture view. Lower levels should normally keep the default, `false`.

## What the validator will catch

Read `references/graph-document.md` before writing. The four failures that account for nearly everything:

| Code | What you did |
| --- | --- |
| `BROKEN_REFERENCE` | an edge, a flow step or a view names an id you never declared |
| `INVALID_DOCUMENT` | an invented field; the schemas are strict, unknown keys are rejected |
| `DUPLICATE_ID` | two nodes, edges or views sharing an id |
| `UNSUPPORTED_SCHEMA_VERSION` | `schemaVersion` is not the contract version installed |

Four rules cannot be expressed in JSON Schema and are checked only by the parser, so structured output alone does not make a document valid: referential integrity, a line range that ends before it starts, a `self` message whose endpoints disagree, and a patch whose two commits are the same. Always validate.

## Fixing a map instead of writing one

When someone says the diagram is wrong (a node is misnamed, a folder should not be on it, something sits in the wrong lane), do not edit the generated document. It is regenerated on every run. Write the correction into `.github/pr-lens.yml`, which is an overlay applied over fresh inference every time:

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

A `match` beginning with `id:` addresses one node exactly; anything else is a path glob matched against a node's file paths. Prefer the glob, because it keeps holding when the next run names the node differently. A lane pin may name a lane the document never declared: the band is created, and takes the id for its label, so give it one a reader would want to see.

`pr-lens render` says so when a correction matched nothing, which is how a config that has drifted, because the file it named moved or was deleted, becomes visible instead of quietly doing nothing.

## What ships with this skill

Everything you need is beside this page. Nothing here asks you to install a package first.

| | |
| --- | --- |
| `references/graph-document.md` | the document, field by field: enums, limits, and where documents actually go wrong |
| `references/config.md` | `.github/pr-lens.yml`, the correction overlay, in full |
| `references/example.graph.json` | one complete document that validates, to read and to copy the shape of |

The same document ships as `postmark-refactor.graph.json` in `@coldtea/pr-lens-schema`, and the JSON Schema the validator enforces is published at `https://unpkg.com/@coldtea/pr-lens-schema/json-schema/graph-doc.schema.json`. Neither is something you need to fetch to write a document.

---
name: pr-lens
description: "WHAT: Draws a code change or part of a codebase as an animated architecture or data-flow diagram, on its own or in a pull request. WHEN: asked to diagram, visualise or explain a change or a system, or when a pull request should carry a diagram. KEYWORDS: PR Lens, diagram, architecture, data flow, visualise, visualize, pull request"
---

# PR Lens

PR Lens draws code as visually rich animated diagrams. It can represent diffs, architecture, data flows, and more.

The diff or code is represented as one JSON document (lanes, nodes, edges, ordered flows) and it renders the JSON as an animated SVG

## Operating manual

1. **Read the diff.** When asked to represent a code change: `git diff --find-renames <base>...<head>`. The base is the merge base, not the tip of the base branch.

   If not expressing a code diff, read the code to be visually represented

2. **Write the document** to `.pr-lens/graph.json`, following `references/graph-document.md`. `references/example.graph.json` is valid reference with three lanes, all four delta states, a hero edge, a seven-step flow, a nested drill-down tree. Read it before you write your first one. It is quicker than reading the reference.

3. **Validate, and fix**

   ```bash
   npx @coldtea/pr-lens-cli validate .pr-lens/graph.json
   ```

   Fix every failure and run it again. Do not render an invalid document; do not "work around" a failure by deleting the element it names.

4. **Render.**

   ```bash
   npx @coldtea/pr-lens-cli render .pr-lens/graph.json --theme dark
   ```

   Render dark as the default theme unless explicitly requested. The SVGs, the manifest and `drawn.graph.json` land in `.pr-lens/`, which the CLI adds to the repository's .gitignore. Do not commit any of it. These files are rebuilt from the diff whenever anyone wants them again. Each SVG is named after its view, the theme and a content hash; `manifest.json` lists them by lens and view, so read the names from there or from the directory.

   If the user asked for a diagram and nothing more, this is the end of the loop. If working in an environment that supports a visual way to display the image e.g., an in-app browser, an artifact, do so. Otherwise, tell them where the SVGs are and which one is the top view.

5. **Attach, when there is a pull request to attach to.** That means the user asked you to open a PR, asked for a diagram on one that exists, or you are opening a PR as part of changes made. Otherwise skip this step.

   GitHub CLI uploads the diagram with the pull request. Write the body with a Markdown image pointing at the local file, then pass the same path to `--attach`. `gh` rewrites the reference to the uploaded asset and keeps the alt text you wrote:

   ```markdown
   Moves bulk sending off the per-recipient trigger and onto a batch endpoint.

   ![Architecture after this change: the queue route, the new bulk sender and the retired per-recipient path](.pr-lens/overview-dark-4f9bd6c1.svg)
   ```

   ```bash
   gh pr create --title "Batch broadcast sends" --body-file .pr-lens/body.md \
     --attach .pr-lens/overview-dark-4f9bd6c1.svg
   ```

   On a pull request that already exists, `gh pr edit <number>` with the same two flags puts the diagram in the description, and `gh pr comment <number>` puts it in a comment. Repeat `--attach` for each diagram the body references.

   gh has three rules:
   - The reference has to be a Markdown image, `![alt](path)`. An HTML `<img>` or `<picture>` is left as written, and the file is appended at the bottom of the body instead.
   - The alt text is the caption a reader without images gets. Say what the diagram shows, in one line.
   - `--attach` arrived in GitHub CLI 2.99. Check with `gh --version` before you write a body around it.

   Attach the views a reviewer needs and leave the rest in `.pr-lens/`: the top architecture view first, then a data flow if the change has a sequence worth following. A body with four diagrams reads worse than one with two, except the four are really needed to understand the change e.g., in the case of a complex feature or refactor.

   When `--attach` is not an option, publish the SVGs somewhere durable and let the CLI compose the comment instead:

   ```bash
   npx @coldtea/pr-lens-cli comment \
     --graph .pr-lens/drawn.graph.json \
     --manifest .pr-lens/manifest.json \
     --asset-base-url https://raw.githubusercontent.com/<owner>/<repo>/<branch>/<dir>
   ```

   `--graph` takes `drawn.graph.json`, not the document you wrote, because corrections change what the diagrams show and the CLI refuses a document its manifest does not describe. `--asset-base-url` is where you published the SVGs; leave it out and the markdown points at local paths no reader can fetch. The markdown goes to stdout, with each diagram as a `<picture>` pair; posting it is your business.

If you would rather not author the document yourself, `npx @coldtea/pr-lens-cli analyze --base <ref>` does steps 1 and 2 by asking a provider — Gemini, OpenAI, or any endpoint speaking `/chat/completions` — with a key of your own. That is the only path here that needs one.

## The pull request body, when there is one

A reviewer should understand the change before reading the diff, so the diagram goes where they look first: the description, not a trailing comment. Open with one sentence on why the change exists, then the architecture diagram, then whatever proves the change works, such as a screenshot of the result or a recording of the interaction. Use one visual per idea. A diagram that needs a paragraph of explanation has a document problem; go back to step 2.

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

| Code                         | What you did                                                         |
| ---------------------------- | -------------------------------------------------------------------- |
| `BROKEN_REFERENCE`           | an edge, a flow step or a view names an id you never declared        |
| `INVALID_DOCUMENT`           | an invented field; the schemas are strict, unknown keys are rejected |
| `DUPLICATE_ID`               | two nodes, edges or views sharing an id                              |
| `UNSUPPORTED_SCHEMA_VERSION` | `schemaVersion` is not the contract version installed                |

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

|                                 |                                                                                    |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| `references/graph-document.md`  | the document, field by field: enums, limits, and where documents actually go wrong |
| `references/config.md`          | `.github/pr-lens.yml`, the correction overlay, in full                             |
| `references/example.graph.json` | one complete document that validates, to read and to copy the shape of             |

The same document ships as `postmark-refactor.graph.json` in `@coldtea/pr-lens-schema`, and the JSON Schema the validator enforces is published at `https://unpkg.com/@coldtea/pr-lens-schema/json-schema/graph-doc.schema.json`. Neither is something you need to fetch to write a document.

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

2. **Write the document** to `.pr-lens/graph.json`, following `references/graph-document.md`. `references/example.graph.json` is valid reference with three lanes, all four delta states, a hero edge, a seven-step flow, a nested drill-down tree and a six-step walkthrough. Read it before you write your first one. It is quicker than reading the reference.

3. **Validate, and fix**

   ```bash
   npx @coldtea/pr-lens-cli@latest validate .pr-lens/graph.json
   ```

   Fix every failure and run it again. Do not render an invalid document; do not "work around" a failure by deleting the element it names.

4. **Render.**

   ```bash
   npx @coldtea/pr-lens-cli@latest render .pr-lens/graph.json --theme light
   ```

   Render light by default unless the user requests another theme. The SVGs, the manifest and `drawn.graph.json` land in `.pr-lens/`, which the CLI adds to the repository's .gitignore. Do not commit any of it. These files are rebuilt from the diff whenever anyone wants them again. Each SVG is named after its view, the theme and a content hash; `manifest.json` lists them by lens and view, so read the names from there or from the directory.

   If the user asked for a diagram, an explanation or a picture of the architecture and nothing more, put it on a canvas and hand back the link:

   ```bash
   npx @coldtea/pr-lens-cli@latest canvas push
   ```

   This pushes `.pr-lens/drawn.graph.json` and prints three links. Give the user the view link, `https://prlens.dev/c/{id}`: that is the diagram, full screen, every view on one page, and it opens without a login. The edit link, the one ending in `#w=…`, lets its holder push over the canvas, so leave it out of the reply unless they ask, and never paste it anywhere public. The embed link serves the top view as an SVG for a README.

   Pushing the same file again updates the same canvas, so a follow-up such as "rename that node" or "add the queue" is: edit the document, validate, render, push. The link stays the same. If the push fails, say so and tell them where the SVGs are and which one is the top view.

5. **Attach, when there is a pull request to attach to.** That means the user asked you to open a PR, asked for a diagram on one that exists, or you are opening a PR as part of changes made. Otherwise skip this step.

   GitHub CLI uploads the diagram with the pull request. Write the body with a Markdown image pointing at the local file, then pass the same path to `--attach`. `gh` rewrites the reference to the uploaded asset and keeps the alt text you wrote:

   ```markdown
   Moves bulk sending off the per-recipient trigger and onto a batch endpoint.

   ![Architecture after this change: the queue route, the new bulk sender and the retired per-recipient path](.pr-lens/overview-light-4f9bd6c1.svg)
   ```

   ```bash
   gh pr create --title "Batch broadcast sends" --body-file .pr-lens/body.md \
     --attach .pr-lens/overview-light-4f9bd6c1.svg
   ```

   On a pull request that already exists, `gh pr edit <number>` with the same two flags puts the diagram in the description, and `gh pr comment <number>` puts it in a comment. Repeat `--attach` for each diagram the body references.

   gh has three rules:
   - The reference has to be a Markdown image, `![alt](path)`. An HTML `<img>` or `<picture>` is left as written, and the file is appended at the bottom of the body instead.
   - The alt text is the caption a reader without images gets. Say what the diagram shows, in one line.
   - `--attach` arrived in GitHub CLI 2.99. Check with `gh --version` before you write a body around it.

   Attach the views a reviewer needs and leave the rest in `.pr-lens/`: the top architecture view first, then a data flow if the change has a sequence worth following. A body with four diagrams reads worse than one with two, except the four are really needed to understand the change e.g., in the case of a complex feature or refactor.

   When `--attach` is not an option, publish the SVGs somewhere durable and let the CLI compose the comment instead:

   ```bash
   npx @coldtea/pr-lens-cli@latest comment \
     --graph .pr-lens/drawn.graph.json \
     --manifest .pr-lens/manifest.json \
     --asset-base-url https://raw.githubusercontent.com/<owner>/<repo>/<branch>/<dir>
   ```

   `--graph` takes `drawn.graph.json`, not the document you wrote, because corrections change what the diagrams show and the CLI refuses a document its manifest does not describe. `--asset-base-url` is where you published the SVGs; leave it out and the markdown points at local paths no reader can fetch. The markdown goes to stdout, with each diagram as a `<picture>` pair; posting it is your business.

If you would rather not author the document yourself, `npx @coldtea/pr-lens-cli@latest analyze --base <ref>` does steps 1 and 2 by asking a provider — Gemini, OpenAI, or any endpoint speaking `/chat/completions` — with a key of your own. That is the only path here that needs one.

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

## Writing a walkthrough

A walkthrough is a short guided tour of the diagrams. It has two to twelve steps. Each step shows one diagram, points at one part of it, and says a few words about it. A canvas plays it, and the reader scrolls through it.

The contract leaves a walkthrough optional. Write one anyway for anything that is not trivial: more than one diagram, a diagram with several changed parts, or any flow. Skip it only when the document is one small diagram whose single step would just repeat the title.

Aim for three to seven steps.

A walkthrough is the fastest read of a pull request. Each step is one change: something added, changed, removed or moved, in the order a reviewer needs it. A step is never a description of the diagram.

What counts as a step: a behaviour change, an API change, an architecture change, a data-flow change, or an addition. Unchanged parts appear only where a step needs them to make sense. The headline change is step one. An overview of everything touched, if there is one, is the last step.

```json
"walkthrough": {
  "steps": [
    {
      "id": "four-batch-calls",
      "heading": "Postmark now gets 500 emails per call",
      "body": "One call per batch, and Postmark answers with a result for each message.",
      "stage": { "kind": "flow", "flow": "send-pipeline" },
      "focus": { "kind": "selection", "messages": ["batch-post", "batch-results"] }
    },
    {
      "id": "blast-radius",
      "heading": "4 parts added, 2 removed, across 3 lanes",
      "body": "A 2,000-person broadcast used to make 2,000 calls to Postmark. It now makes 4.",
      "stage": { "kind": "view", "view": "overview" }
    }
  ]
}
```

Each step has:

- `heading`: the thing and what happened to it, up to 48 characters, in sentence case. Build it from change words: added, removed, replaced, now, moved, split. If a heading could have been true before the pull request, it is not a change heading.
- `body`: one line under the heading, up to 140 characters, on what the change means for behaviour: what happens now that did not before, or what stops happening, with the numbers when they matter. Not a restatement of the heading, and not a description of the code. A heading with no body reads as unfinished, so the body is required.
- `stage`: which diagram to show. A document can have several diagrams: its views (the drill-down diagrams) and its flows (the sequence diagrams). `{ "kind": "view", "view": "overview" }` shows the view called `overview`. `{ "kind": "flow", "flow": "send-pipeline" }` shows the flow called `send-pipeline`. Leave `stage` out and the step uses the diagram the reader is already on. Open on the widest view with the focus left out, so the reader sees the whole thing before it narrows.
- `focus`: what to zoom in on inside that diagram. `{ "kind": "all" }`, the default, means the whole diagram. A selection means "just these things": name any lanes, nodes, edges or flow steps (`messages`) by id, and the camera zooms to them while everything else dims. Focus the elements the step's change touched, so the veil lights the change. Point at two or three of them. A step that lights half the diagram has not said anything.

Write every word for a smart twelve-year-old: short common words, one idea per line, active voice, things named as the diagram names them, numbers as digits. If a line needs a second read, rewrite it. Words like leverages, orchestrates, asynchronous pipeline and fan-out never belong in a step. This holds in whatever language the document is written in.

The same three steps, written well and written badly. Heading first, then the body after the slash:

| Write this | Not this |
| -------- | -------- |
| Route now queues the job instead of sending / The API call finishes at once. A worker sends the mail later. | Broadcast fan-out moves behind the queue / The API route now enqueues broadcast jobs for asynchronous batch processing instead of sending emails inline. |
| Postmark now gets 500 emails per call / One call per batch instead of one call per person. | Batched delivery replaces single sends / The worker leverages the shared library to send emails in chunks of 500 via Postmark's batch endpoint. |
| processBroadcast and sendSingleEmail removed / sendBroadcastBulk does their job for whole batches. | Single send functions are retired / sendBroadcastBulk replaces processBroadcast and sendSingleEmail to handle bulk deliveries in chunks. |

Keep consecutive steps on the same stage together. Every change of stage flies the camera across the canvas, so a tour that alternates between two diagrams spends its time travelling.

The validator checks:

- Every id you name exists in the document. A flow step you name must belong to the flow the stage shows, because flow step ids are only unique inside their own flow.
- `messages` needs a stage that shows a flow. Leave it out when the stage is an architecture view.
- Step ids are unique within the walkthrough. Two steps minimum, twelve maximum.
- A stored map never carries a walkthrough. A map describes the system; a walkthrough tells the story of one change.

The field arrived with contract 0.1.1. A CLI older than 0.4.0 does not know it and rejects the whole document as an invented field, so validate with a current one.

## What the validator will catch

Read `references/graph-document.md` before writing. The four failures that account for nearly everything:

| Code                         | What you did                                                         |
| ---------------------------- | -------------------------------------------------------------------- |
| `BROKEN_REFERENCE`           | an edge, a flow step, a view or a walkthrough step names an id you never declared |
| `INVALID_DOCUMENT`           | an invented field; the schemas are strict, unknown keys are rejected |
| `DUPLICATE_ID`               | two nodes, edges or views sharing an id                              |
| `UNSUPPORTED_SCHEMA_VERSION` | `schemaVersion` is not the contract version installed                |

Six rules cannot be expressed in JSON Schema and are checked only by the parser, so structured output alone does not make a document valid: referential integrity, a line range that ends before it starts, a `self` message whose endpoints disagree, a patch whose two commits are the same, more views than a render manifest could describe, and a walkthrough step focusing flow steps the diagram on its stage does not draw. Always validate.

## Fixing a map instead of writing one

When someone says the diagram is wrong (a node is misnamed, a folder should not be on it, something sits in the wrong lane), do not edit the generated document. It is regenerated on every run. Write the correction into `.github/pr-lens.yml`, which is an overlay applied over fresh inference every time:

```yaml
schemaVersion: 0.1.1
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

`references/config.md` has the full format and the recipes. Validate it the same way: `npx @coldtea/pr-lens-cli@latest validate .github/pr-lens.yml`.

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

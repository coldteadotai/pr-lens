# PR Lens

Review what actually matters. PR Lens draws a pull request as animated diagrams **inside the pull request itself** — architecture blast radius and data-flow pipelines, not another findings table.

<img alt="A PR Lens bot comment in a pull request: stats chips, an architecture diagram of a tiny change, view-option checkboxes and the PR Lens footer" src="docs/showcase/teaser.comment.dark.svg">

<sub>This is what lands in your pull request — a bot comment, drawn here card and all. Green is new, amber changed, red gone, and the pulse is the data moving along the new path.</sub>

<img alt="The full PR Lens comment for the reference pull request: both lenses expanded, drill-down row, view options and footer" src="docs/showcase/reference.comment.dark.svg">

<sub>The reference pull request's complete comment — both lenses, real composer text. Every render ships as a dark/light pair; the live comment serves the pair behind a `<picture>` tag so each reader automatically sees the one matching their GitHub theme.</sub>

Two lenses ship: **architecture** (what this change touches, against the existing system) and **data flow** (the ordered pipeline, animated). Every diagram on this page was rendered by this repo's renderer from a JSON document in this repo — this page *is* the product demo.

## Ways to use it

Five ways in, one contract underneath. Every mode produces the same diagrams from the same document; pick the one that matches where you review.

### 1. In your pull requests — the GitHub App

Install the PR Lens GitHub App on your repository and open a pull request. That is the whole setup: every pull request gets the comment — the framed mockups at the top of this page are what lands — and each push updates it in place. This is the hosted mode, and the only one where the view-option checkboxes are live: tick one and the comment re-renders within seconds from the stored graph, no re-analysis, no key of yours involved.

### 2. As a workflow — the GitHub Action

The same comment from your own CI, drawn with your own model key. Add the key as a repository secret named `GEMINI_API_KEY`, then commit this as `.github/workflows/pr-lens.yml`:

```yaml
name: PR Lens

on:
  pull_request:

permissions:
  contents: write        # to publish the rendered SVGs
  pull-requests: write   # to post the comment

concurrency:             # one run per pull request; a push supersedes the last
  group: pr-lens-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  lens:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0   # the diff is between two commits, so both must be here
      - uses: coldteadotai/pr-lens/packages/action@v0
        with:
          api-key: ${{ secrets.GEMINI_API_KEY }}
```

The key reaches the CLI through the environment, never a command line, and the diff goes to the provider you name and nowhere else. The comment here is deliberately static — an Action cannot hold state between runs, so the checkboxes live in the App. Providers, lenses, branding and the rest of the inputs are in [`packages/action`](packages/action).

### 3. From the CLI

Everything the other modes do, one step at a time, on your machine. The key is read from the environment, never from a flag:

```bash
export GEMINI_API_KEY=…    # or OPENAI_API_KEY with --provider openai

# Diff in, graph document out — measured against the merge base, not the branch tip.
npx @coldtea/pr-lens-cli analyze --base origin/main -o pr-lens/graph.json

# The document as light and dark SVGs, plus the manifest a comment is built from.
npx @coldtea/pr-lens-cli render pr-lens/graph.json -o pr-lens/

# The pull request comment as markdown, on stdout. Posting is your business.
npx @coldtea/pr-lens-cli comment --graph pr-lens/drawn.graph.json --manifest pr-lens/manifest.json \
  --asset-base-url https://raw.githubusercontent.com/owner/repo/pr-lens/42

# Any PR Lens document, checked against the contract — every problem, not just the first.
npx @coldtea/pr-lens-cli validate pr-lens/graph.json .github/pr-lens.yml

# After the merge: the pull-request document as a stored map of the system, worth committing.
npx @coldtea/pr-lens-cli export pr-lens/graph.json -o .github/pr-lens.map.json
```

Ollama, DeepSeek, OpenRouter and anything else speaking `/chat/completions` are reached with `--provider openai-compatible --base-url <url>`. The full command reference, the correction file, and the failure codes a script can branch on are in [`packages/cli`](packages/cli).

### 4. Via your coding agent

Your agent is usually the model. Rather than spending a provider key to describe a diff it already understands, it writes the graph document itself and lets the validator hold it to the contract.

```bash
npm install --save-dev @coldtea/pr-lens-agent-skill

# Claude Code
mkdir -p .claude/skills/pr-lens
cp -R node_modules/@coldtea/pr-lens-agent-skill/{SKILL.md,references} .claude/skills/pr-lens/

# Cursor
mkdir -p .cursor/rules
cp node_modules/@coldtea/pr-lens-agent-skill/SKILL.md .cursor/rules/pr-lens.mdc
```

Then say, literally:

> Diagram the change you just made with PR Lens and attach it to the pull request.

The agent reads the diff, writes the document, runs `npx @coldtea/pr-lens-cli validate` until the contract is satisfied, renders, and attaches the `<picture>` pair. When someone says the diagram names things wrongly, the same skill teaches it to fix `.github/pr-lens.yml` instead of editing generated output. Details in [`packages/agent-skill`](packages/agent-skill).

### 5. In your terminal

Nothing about the diagrams needs a pull request. Render locally and look at the change before anyone else does:

```bash
npx @coldtea/pr-lens-cli analyze --base origin/main
npx @coldtea/pr-lens-cli render pr-lens/graph.json
open pr-lens/*-dark-*.svg    # macOS; the SVGs are self-contained, any browser reads them
```

This is also the shape of reviewing an agent's work: while you read the diff, the agent that wrote it renders it. With the skill installed, "render this change with PR Lens and open the SVGs" gets you the diagram beside the diff — the same picture its pull request will carry, minutes earlier.

## From one card to a monorepo

The renderer answers for every size of change with the same visual grammar: lanes, node cards, delta colours, and routes you can trace with the eye alone.

<img alt="A single-card diagram: the smallest change PR Lens draws" src="docs/showcase/tier1-minimal.architecture.dark.svg">

<sub>The smallest honest diagram — 1 lane · 1 node · 0 edges.</sub>

<img alt="A dense three-lane graph: every route stays traceable through corridors" src="docs/showcase/tier3-dense.architecture.dark.svg">

<sub>The dense synthetic — 3 lanes · 15 nodes · 19 edges. Crossings happen inside corridors and read as wiring, not spaghetti.</sub>

<details>
<summary><b>Tier 4 — a checkout flow</b> · 5 lanes · 21 nodes · 24 edges</summary>
<br>
<img alt="A five-lane checkout system with two dozen routed edges" src="docs/showcase/tier4-checkout.architecture.dark.svg">
</details>

<details>
<summary><b>Tier 5 — a monorepo</b> · 6 lanes · 37 nodes · 49 edges</summary>
<br>
<img alt="A six-lane monorepo graph: the largest tier the renderer answers for" src="docs/showcase/tier5-monorepo.architecture.dark.svg">
</details>

<sub>Collapsed tiers dogfood the same `<details>` drill-down pattern the PR comment uses.</sub>

## The data-flow lens

The ordered pipeline of the change, drawn in the same design system — participants are real node cards, labels are the same pills, colours are the same deltas. **The pulses are moving right now**: PR Lens diagrams are animated SVG, and the animation survives GitHub's image proxy — a hook no findings table has.

<img alt="The reference pull request's send pipeline as an animated sequence diagram" src="docs/showcase/reference.data-flow.dark.svg">

<sub>The reference pull request's send pipeline — 7 steps sharing one cycle and taking it in turn: one dot crosses one arrow at a time, in the order the steps happen, and the next arrow lights as the last dot lands.</sub>

<img alt="A sequence diagram mixing waited-on calls, fire-and-forget messages, returns and a self message" src="docs/showcase/mixed-kinds.data-flow.dark.svg">

<sub>Every message kind at once: a filled head waits for an answer, an open head is fire-and-forget, a dashed line *is* the answer — and only waited-on work lights an activation bar.</sub>

Every render above comes from a checked-in fixture — the [teaser](docs/showcase/teaser.ts), the [reference pull request](packages/schema/src/examples/postmark-refactor.ts), the [dense synthetic](packages/renderer/test/dense.ts), the [upper tiers](packages/renderer/test/fixtures), the [mixed-kinds flow](packages/renderer/test/mixed-kinds.ts) — regenerated deterministically by [`docs/showcase/render.mts`](docs/showcase/render.mts), and the comment mockups up top are framed by [`docs/showcase/frame.ts`](docs/showcase/frame.ts) around the same renders, with the composer's real text.

## Packages

| Package | What it is |
| --- | --- |
| [`packages/schema`](packages/schema) | `@coldtea/pr-lens-schema` — the contract every other component speaks |
| [`packages/renderer`](packages/renderer) | `@coldtea/pr-lens-renderer` — deterministic JSON graph → the animated, theme-paired SVGs on this page |
| [`packages/cli`](packages/cli) | `@coldtea/pr-lens-cli` — read a diff with your own model key, render it, compose the comment |
| [`packages/action`](packages/action) | the GitHub Action: analyze, publish, post one static comment |
| [`packages/agent-skill`](packages/agent-skill) | `@coldtea/pr-lens-agent-skill` — teaches a coding agent to draw the change it just made |

## Working in this repo

```bash
pnpm install
pnpm verify      # build, typecheck, test
```

Node 20.11+ and pnpm 10.

## End-to-end tests

The product's visual guarantees, written as plain-English end-to-end tests for future agent-driven QA: [`e2e.md`](e2e.md).

## License

MIT © Ohans Emmanuel.

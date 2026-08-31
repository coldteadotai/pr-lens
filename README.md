<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/mark.dark.svg">
    <img alt="" src="docs/brand/mark.light.svg" width="76">
  </picture>
</p>

<h1 align="center">PR Lens</h1>

<p align="center">
  <b>Understand a pull request before you read a line of it.</b><br>
  PR Lens draws every pull request as animated architecture and data-flow diagrams,<br>
  posted as a comment inside the pull request itself
</p>

<p align="center">
  <a href="https://github.com/apps/coldtea-pr-lens"><img alt="Install the GitHub App" src="https://img.shields.io/badge/GitHub%20App-install-3fb950?style=flat-square&logo=github&logoColor=white&labelColor=21262d"></a>
  <a href="https://www.npmjs.com/package/@coldtea/pr-lens-cli"><img alt="The CLI on npm" src="https://img.shields.io/npm/v/%40coldtea%2Fpr-lens-cli?style=flat-square&logo=npm&logoColor=white&label=cli&labelColor=21262d&color=21262d"></a>
  <a href="https://discord.gg/nTEFnmBQMJ"><img alt="Join the Discord" src="https://img.shields.io/badge/Discord-join-5865F2?style=flat-square&logo=discord&logoColor=white&labelColor=21262d"></a>
  <a href="https://prlens.dev"><img alt="prlens.dev" src="https://img.shields.io/badge/website-prlens.dev-21262d?style=flat-square&labelColor=21262d"></a>
  <a href="LICENSE"><img alt="MIT licence" src="https://img.shields.io/github/license/coldteadotai/pr-lens?style=flat-square&labelColor=21262d&color=21262d"></a>
</p>

<h3 align="center"><a href="https://github.com/apps/coldtea-pr-lens">Install the GitHub App</a></h3>

<p align="center">
  <sub>Free for open source. No API key, no workflow file.</sub>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/cta-strip.dark.svg">
    <img alt="Three steps: install the GitHub App on any repository, open a pull request, the diagram appears and is redrawn on every push" src="docs/brand/cta-strip.light.svg" width="960">
  </picture>
</p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/showcase/teaser.comment.dark.svg">
  <img alt="A PR Lens bot comment in a pull request: stats chips, an architecture diagram of a small change, and the view-option checkboxes" src="docs/showcase/teaser.comment.light.svg">
</picture>

<br />

## Features

<table>
<tr>
<td width="46%" valign="middle">

### Architecture blast radius

What the pull request touches, drawn against the system around it: the components involved, and the calls that run between them.

Colour carries the delta: **green** new, **amber** changed, **red** gone

</td>
<td width="54%" valign="middle">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/showcase/tier2-reference.architecture.dark.svg">
  <img alt="An architecture diagram of a real refactor: three lanes, ten components, the changed ones picked out in colour" src="docs/showcase/tier2-reference.architecture.light.svg">
</picture>
</td>
</tr>

<tr>
<td width="46%" valign="middle">

### Data flow you can watch

The ordered pipeline of the change as an animated sequence: one dot crosses one arrow at a time, in the order the steps happen.

</td>
<td width="54%" valign="middle">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/showcase/reference.data-flow.dark.svg">
  <img alt="An animated sequence diagram: seven steps taking one cycle in turn" src="docs/showcase/reference.data-flow.light.svg">
</picture>
</td>
</tr>

<tr>
<td width="46%" valign="middle">

### Drill down without leaving the page

The comment nests `<details>` sections, each carrying its own diagram scoped to one part of the change: the whole blast radius on top, then the new path, then what was retired.

</td>

<td width="54%" valign="middle">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/showcase/reference.new-batch-path.dark.svg">
  <img alt="The same pull request narrowed to one nested view: two lanes, the new batch path only" src="docs/showcase/reference.new-batch-path.light.svg">
</picture>
</td>
</tr>

<tr>
<td width="46%" valign="middle">

### From one card to a monorepo

The same visual grammar answers for every size of change: lanes, node cards, delta colours, and routes you can trace with your eye alone.

For what its worth, you should not be opening a PR this large

</td>
<td width="54%" valign="middle">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/showcase/tier5-monorepo.architecture.dark.svg">
  <img alt="A six-lane monorepo graph: 37 nodes and 49 routed edges" src="docs/showcase/tier5-monorepo.architecture.light.svg">
</picture>
</td>
</tr>

</table>

<br />

## Hall of Fame

The pull requests behind Hooks, Node fetch and Ingress, run back through PR Lens. Same renderer and same contract as the diagrams above.

<a href="https://prlens.dev/gallery/react/react/13968"><img alt="React Hooks, redrawn: four lanes across the React package, the reconciler, the server renderer and shared config" src="docs/showcase/gallery/react-hooks.svg"></a>

<sub><b><a href="https://prlens.dev/gallery/react/react/13968">react/react#13968</a></b> · 36 files · +5,868/−130 · 5 lanes. Hooks arrive behind a feature flag.</sub>

<a href="https://prlens.dev/gallery/nodejs/node/41749"><img alt="Node's fetch implementation, redrawn across five lanes" src="docs/showcase/gallery/node-fetch.svg"></a>

<sub><b><a href="https://prlens.dev/gallery/nodejs/node/41749">nodejs/node#41749</a></b> · 16 files · +8,076/−3 · 5 lanes. `fetch`, `Request`, `Response` and `Headers` land in core.</sub>

<a href="https://prlens.dev/gallery/kubernetes/kubernetes/14175"><img alt="The first Kubernetes Ingress type, redrawn across four lanes" src="docs/showcase/gallery/kubernetes-ingress.svg"></a>

<sub><b><a href="https://prlens.dev/gallery/kubernetes/kubernetes/14175">kubernetes/kubernetes#14175</a></b> · 8 files · +766/−0 · 4 lanes. The first Ingress resource type, for L7 load balancing.</sub>

<details>
<summary><b>Seven more</b> · Vue, Rust, Tokio, Neovim, Django, webpack, vLLM</summary>
<br>

<a href="https://prlens.dev/gallery/vuejs/core/2532"><img alt="Vue's script setup and ref sugar, redrawn across three lanes" src="docs/showcase/gallery/vue-script-setup.svg"></a>

<sub><b>vuejs/core#2532</b> · 11 files · +1,081/−670 · 3 lanes. `&lt;script setup&gt;` and the original ref sugar.</sub>

<a href="https://prlens.dev/gallery/rust-lang/rust/31954"><img alt="Rust's question-mark operator, redrawn across four lanes" src="docs/showcase/gallery/rust-try-operator.svg"></a>

<sub><b>rust-lang/rust#31954</b> · 26 files · +369/−16 · 4 lanes. The postfix `?` operator, chainable shorthand for `try!`.</sub>

<a href="https://prlens.dev/gallery/tokio-rs/tokio/1657"><img alt="Tokio's work-stealing thread pool rewrite, redrawn across three lanes" src="docs/showcase/gallery/tokio-work-stealing.svg"></a>

<sub><b>tokio-rs/tokio#1657</b> · 100 files · +7,408/−6,795 · 3 lanes. The work-stealing pool rebuilt to cut scheduler overhead.</sub>

<a href="https://prlens.dev/gallery/neovim/neovim/11336"><img alt="Neovim's built-in LSP client, redrawn across three lanes" src="docs/showcase/gallery/neovim-lsp.svg"></a>

<sub><b>neovim/neovim#11336</b> · 15 files · +5,556/−1 · 3 lanes. The LSP client moves into Neovim itself.</sub>

<a href="https://prlens.dev/gallery/django/django/11209"><img alt="Django's ASGI handler, redrawn across five lanes" src="docs/showcase/gallery/django-asgi.svg"></a>

<sub><b>django/django#11209</b> · 38 files · +931/−42 · 5 lanes. An ASGI handler and a coroutine-safe request context.</sub>

<a href="https://prlens.dev/gallery/webpack/webpack/10440"><img alt="Webpack's ContainerPlugin, redrawn across five lanes" src="docs/showcase/gallery/webpack-federation.svg"></a>

<sub><b>webpack/webpack#10440</b> · 13 files · +567/−5 · 5 lanes. `ContainerPlugin`, and module federation with it.</sub>

<a href="https://prlens.dev/gallery/vllm-project/vllm/1348"><img alt="vLLM's PagedAttention V2, redrawn across three lanes" src="docs/showcase/gallery/vllm-paged-attention.svg"></a>

<sub><b>vllm-project/vllm#1348</b> · 6 files · +764/−139 · 3 lanes. PagedAttention V2 and its sequence-level parallelism.</sub>

</details>

<b><a href="https://prlens.dev/gallery">Open the Hall of Fame →</a></b> Every diagram there is live.

<br />

## Make corrections

When a diagram calls something by the wrong name, the fix is a correction file. Editing the generated SVG only lasts until the next push. Commit `.github/pr-lens.yml` and every later render honours it:

```yaml
schemaVersion: 0.1.0
map:
  rename:
    - match: services/legacy-mailer.ts
      to: Postmark sender
  exclude:
    - "**/*.test.ts"
```

It is an overlay, so it keeps holding as the code moves and the model renames things between runs. Renames, exclusions, lane pins and groupings, all in [`packages/cli`](packages/cli#corrections).

<br />

## Other ways to run it

The App is the whole setup for most people. The modes below cover what it does not: your own CI, your own model, or a diagram before the pull request exists.

<details>
<summary><b>Via your coding agent</b> · it writes the document itself · no second model bill</summary>
<br>

Your agent is usually already the model. Rather than spending a provider key to describe a diff it already understands, it writes the graph document itself and lets the validator hold it to the contract.

```bash
npx skills add coldteadotai/pr-lens
```

Then say, literally:

> Diagram the change you just made with PR Lens and attach it to the pull request.

The agent reads the diff, writes the document, runs `npx @coldtea/pr-lens-cli validate` until the contract is satisfied, renders, and attaches the `<picture>` pair. When someone says the diagram names things wrongly, the same skill teaches it to fix `.github/pr-lens.yml` instead of editing generated output. Details in [`packages/agent-skill`](packages/agent-skill).

Prefer to have the agent do the whole setup? Paste this:

```text
Set up PR Lens (prlens.dev) for me: it draws each pull request as animated architecture and data-flow diagrams, inside the pull request itself.

1. Install the agent skill: `npx skills add coldteadotai/pr-lens`.

2. Walk me through installing the GitHub App at https://github.com/apps/coldtea-pr-lens on every repository where I review pull requests. It posts one sticky comment per pull request and updates it on every push, with no model key of mine involved.

3. If I'd rather run it from CI with a model key of mine, offer the Action instead: `.github/workflows/pr-lens.yml` using `coldteadotai/pr-lens/packages/action@v0`, with the key as a repository secret. It takes Gemini by default, OpenAI, or any endpoint speaking `/chat/completions`.

4. Then prove it: diagram the most recent change in this repository and show me the rendered SVGs.
```

</details>

<details>
<summary><b>As a workflow: the GitHub Action</b> · your CI · your key · one static comment</summary>
<br>

The same comment from your own CI, drawn with your own model key. Add that key as a repository secret — `GEMINI_API_KEY` below, because `provider` defaults to Gemini — then commit this as `.github/workflows/pr-lens.yml`:

```yaml
name: PR Lens

on:
  pull_request:

permissions:
  contents: write # to publish the rendered SVGs
  pull-requests: write # to post the comment

concurrency: # one run per pull request; a push supersedes the last
  group: pr-lens-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  lens:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # the diff is between two commits, so both must be here
      - uses: coldteadotai/pr-lens/packages/action@v0
        with:
          api-key: ${{ secrets.GEMINI_API_KEY }}
```

Nothing here is tied to one model. `provider` takes `gemini` (the default), `openai`, or `openai-compatible` with a `base-url` and `model`, so the same workflow runs against OpenRouter, DeepSeek or a server of your own. The key reaches the CLI through the environment, never a command line, and the diff goes to the provider you name and nowhere else. The comment here is deliberately static — an Action cannot hold state between runs, so the checkboxes live in the App. Providers, lenses, branding and the rest of the inputs are in [`packages/action`](packages/action).

</details>

<details>
<summary><b>From the CLI</b> · every step on your machine, one at a time</summary>
<br>

Everything the other modes do, one step at a time, on your machine. Only `analyze` talks to a model, and its key is read from the environment, never from a flag:

```bash
export GEMINI_API_KEY=…    # the default provider; OPENAI_API_KEY with --provider openai

# Diff in, graph document out — measured against the merge base, not the branch tip.
npx @coldtea/pr-lens-cli analyze --base origin/main

# The document as light and dark SVGs, plus the manifest a comment is built from.
npx @coldtea/pr-lens-cli render .pr-lens/graph.json

# The pull request comment as markdown, on stdout. Posting is your business.
npx @coldtea/pr-lens-cli comment --graph .pr-lens/drawn.graph.json --manifest .pr-lens/manifest.json \
  --asset-base-url https://raw.githubusercontent.com/owner/repo/pr-lens/42

# Any PR Lens document, checked against the contract — every problem, not just the first.
npx @coldtea/pr-lens-cli validate .pr-lens/graph.json .github/pr-lens.yml

# After the merge: the pull-request document as a stored map of the system, worth committing.
npx @coldtea/pr-lens-cli export .pr-lens/graph.json -o .github/pr-lens.map.json
```

Everything lands in `.pr-lens/`, which the CLI adds to your `.gitignore` the first time it writes there. Treat it as scratch: the files are rebuilt from the diff on demand, and the only one worth committing is the map `export` writes. `--out` puts them somewhere else if you would rather.

Ollama, DeepSeek, OpenRouter and anything else speaking `/chat/completions` are reached with `--provider openai-compatible --base-url <url>`. The full command reference, the correction file, and the failure codes a script can branch on are in [`packages/cli`](packages/cli).

</details>

<details>
<summary><b>In your terminal</b> · the diagram before the pull request exists</summary>
<br>

Nothing about the diagrams needs a pull request. Render locally and look at the change before anyone else does:

```bash
npx @coldtea/pr-lens-cli analyze --base origin/main
npx @coldtea/pr-lens-cli render .pr-lens/graph.json
open .pr-lens/*-dark-*.svg    # macOS; the SVGs are self-contained, any browser reads them
```

This is also the shape of reviewing an agent's work: while you read the diff, the agent that wrote it renders it. With the skill installed, "render this change with PR Lens and open the SVGs" gets you the diagram beside the diff, the same picture its pull request will carry, minutes earlier.

</details>

<br />

## Packages

| Package                                        | What it is                                                                                           |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [`packages/schema`](packages/schema)           | `@coldtea/pr-lens-schema`: the contract every other component speaks                                 |
| [`packages/renderer`](packages/renderer)       | `@coldtea/pr-lens-renderer`: deterministic JSON graph → the animated, theme-paired SVGs on this page |
| [`packages/cli`](packages/cli)                 | `@coldtea/pr-lens-cli`: read a diff with your own model key, render it, compose the comment          |
| [`packages/action`](packages/action)           | the GitHub Action: analyze, publish, post one static comment                                         |
| [`packages/agent-skill`](packages/agent-skill) | `@coldtea/pr-lens-agent-skill`: teaches a coding agent to draw the change it just made               |

<br />

## Working in this repo

```bash
pnpm install
pnpm verify      # build, typecheck, test
```

Node 20.11+ and pnpm 10.

<br />

## Why we built this

[Reducing the cognitive load of reviewing PRs](https://www.coldtea.ai/blog/reducing-cognitive-load-ai-generated-prs).

<br />

## License

MIT © Coldtea

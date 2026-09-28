<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/mark.dark.svg">
    <img alt="" src="docs/brand/mark.light.svg" width="76">
  </picture>
</p>

<h1 align="center">PR Lens</h1>

<p align="center">
  <b>Understand a pull request, any codebase, or software visually, before you read a line of code</b><br>
  PR Lens draws every pull request as animated architecture and data-flow diagrams,<br>
  posted as a comment inside the pull request itself. For your coding agents, leverage it for understanding any codebase or code change with a live canvas of animated explainers
</p>

<p align="center">
  <a href="https://github.com/apps/coldtea-pr-lens"><img alt="Install the GitHub App" src="https://img.shields.io/badge/GitHub%20App-install-3fb950?style=flat-square&logo=github&logoColor=white&labelColor=21262d"></a>
  <a href="https://www.npmjs.com/package/@coldtea/pr-lens-cli"><img alt="The CLI on npm" src="https://img.shields.io/npm/v/%40coldtea%2Fpr-lens-cli?style=flat-square&logo=npm&logoColor=white&label=cli&labelColor=21262d&color=21262d"></a>
  <a href="https://discord.gg/nTEFnmBQMJ"><img alt="Join the Discord" src="https://img.shields.io/badge/Discord-join-5865F2?style=flat-square&logo=discord&logoColor=white&labelColor=21262d"></a>
  <a href="https://prlens.dev"><img alt="prlens.dev" src="https://img.shields.io/badge/website-prlens.dev-21262d?style=flat-square&labelColor=21262d"></a>
  <a href="LICENSE"><img alt="MIT licence" src="https://img.shields.io/github/license/coldteadotai/pr-lens?style=flat-square&labelColor=21262d&color=21262d"></a>
</p>

<h3 align="center"><a href="https://github.com/apps/coldtea-pr-lens">Install the GitHub App</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="https://skills.sh/coldteadotai/pr-lens">Install the Skill</a></h3>

<p align="center">
  <sub>Also runs on <a href="https://prlens.dev/gitlab">GitLab</a> and <a href="https://prlens.dev/bitbucket">Bitbucket</a></sub>
</p>

<p align="center">
  <sub>Free for open source &nbsp;&nbsp;·&nbsp;&nbsp; Or have your coding agent draw it: <code>npx skills add coldteadotai/pr-lens</code></sub>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/cta-strip.dark.svg">
    <img alt="Three steps: install the GitHub App on any repository, open a pull request, and the diagram shows up and updates on every push" src="docs/brand/cta-strip.light.svg" width="960">
  </picture>
</p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/showcase/teaser.comment.dark.svg">
  <img alt="A PR Lens comment in a pull request: small labels with numbers about the change, a diagram of a small change, and checkboxes to pick other views" src="docs/showcase/teaser.comment.light.svg">
</picture>

<br />

## Features

<table>
<tr>
<td width="46%" valign="middle">

### Not Mermaid, better

We built a custom renderer from scratch. It draws rich animated visuals, reduces cognitive overload, represents code additions, removals and changes and still works for representing very large systems

</td>
<td width="54%" valign="middle">
<img alt="A code diff with a round lens moving over it. Inside the lens, the same change shows up as PR Lens cards and the paths between them" src="docs/showcase/welcome.not-mermaid.gif">
</td>
</tr>

<tr>
<td width="46%" valign="middle">

### Architecture blast radius

The diagram shows the parts of your system that the code change touches, drawn against the system around it: the components involved, and the calls that run between them.

Colors show what changed: **green** is new, **amber** is changed, and **red** is removed.

</td>
<td width="54%" valign="middle">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/showcase/tier2-reference.architecture.dark.svg">
  <img alt="A diagram of a real change that reorganizes code: three lanes and ten parts, with the changed ones shown in color" src="docs/showcase/tier2-reference.architecture.light.svg">
</picture>
</td>
</tr>

<tr>
<td width="46%" valign="middle">

### Intuitive Data flow

Understand how data flows through your any code change or codebase. The diagram plays the steps of the change in order with a moving dot one step at a time

</td>
<td width="54%" valign="middle">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/showcase/reference.data-flow.dark.svg">
  <img alt="A moving step-by-step diagram: seven steps, each taking its turn" src="docs/showcase/reference.data-flow.light.svg">
</picture>
</td>
</tr>

<tr>
<td width="46%" valign="middle">

### See the payload on every data flow

Click any arrow to see the data it carries. A panel opens next to the diagram with the request and the response. Each one shows either the expected shape or a sample. New fields are green and removed fields are red, the same colors the diagram uses.

</td>
<td width="54%" valign="middle">
<img alt="Clicking the enqueue broadcast job arrow: a side panel opens with the request body. Added fields are green and a removed field is red. Then the Response tab opens and shows the expected shape" src="docs/showcase/welcome.payload.gif">
</td>
</tr>

<tr>
<td width="46%" valign="middle">

### Zoom in without leaving the page

The comment has folding sections (`<details>`) that you can open and close. Each one has its own diagram for one part of the change. The whole change is on top. Below it is the new path, and then what was removed.

</td>

<td width="54%" valign="middle">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/showcase/reference.new-batch-path.dark.svg">
  <img alt="The same pull request zoomed into one section: two lanes, showing only the new batch path" src="docs/showcase/reference.new-batch-path.light.svg">
</picture>
</td>
</tr>

<tr>
<td width="46%" valign="middle">

### Interactive canvas

Every comment or drawing can link to an interactive canvas. It has the same diagrams at full size. You can move around, zoom, and switch between a light and a dark theme. A big change gets all the room it needs instead of squeezing into a narrow comment or static image.

</td>
<td width="54%" valign="middle">
<a href="https://prlens.dev/c/uSdxMcPBFwhfgfaGh-dveQ"><img alt="The canvas: zooming into a small diagram, switching to the light theme, then fitting it back to the screen" src="docs/showcase/welcome.canvas.gif"></a>
</td>
</tr>

<tr>
<td width="46%" valign="middle">

### Walk through the change

PR Lens ships with animated explainers called walkthroughs. Walkthroughs let you explore a system or code change step by step, without overwhelm. Start a walkthrough by pressing play on the canvas, or press W.

</td>
<td width="54%" valign="middle">
<a href="https://prlens.dev/c/uSdxMcPBFwhfgfaGh-dveQ"><img alt="A walkthrough on the canvas: the first step lights up the signup route and the new queue. The second step zooms in on the queue and the worker that empties it" src="docs/showcase/welcome.walkthrough.gif"></a>
</td>
</tr>

<tr>
<td width="46%" valign="middle">

### Your agent, live on the canvas

Ask your local coding agent to connect to a canvas. Then use it to understand any codebase or code change. You can ask follow-up questions, zoom into any part of the diagram, or drag across a few cards and ask your agent about them. Watch it interact live with the canvas!

</td>
<td width="54%" valign="middle">
<img alt="A coding agent in a terminal next to a live canvas. A question typed in the terminal comes back on the canvas as a two-step answer, and the canvas follows the agent through each step" src="docs/showcase/welcome.live.gif">
</td>
</tr>

<tr>
<td width="46%" valign="middle">

### From one card to a whole monorepo

Every size of change uses the same look: lanes, cards, colors for what changed, and paths you can follow with your eyes.

For what it's worth, you should not open a pull request this big.

</td>
<td width="54%" valign="middle">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/showcase/tier5-monorepo.architecture.dark.svg">
  <img alt="A monorepo diagram with six lanes, 37 cards and 49 connecting lines" src="docs/showcase/tier5-monorepo.architecture.light.svg">
</picture>
</td>
</tr>

<tr>
<td width="46%" valign="middle">

### Light or dark theme

With the GitHub App, every diagram comes in a light and a dark version. GitHub shows the one that matches the reader's theme. You can also draw either theme on your own computer with your coding agent.

</td>
<td width="54%" valign="middle">
<p align="center"><img alt="One small diagram cut on a slant: the dark theme on the left and the light theme on the right. Every card and path lines up across the cut" src="docs/showcase/welcome.architecture.split.svg" width="487"></p>
</td>
</tr>

<tr>
<td width="46%" valign="middle">

### GitHub, GitLab and Bitbucket

PR Lens works on all three. On GitHub, install the App. On GitLab, add the CI/CD component to your pipeline. On Bitbucket, add the pipe.

Set it up for [GitLab](https://prlens.dev/gitlab) or [Bitbucket](https://prlens.dev/bitbucket)

</td>
<td width="54%" valign="middle">
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/forges.dark.svg">
    <img alt="GitHub, GitLab and Bitbucket" src="docs/brand/forges.light.svg" width="360">
  </picture>
</p>
</td>
</tr>

</table>

<br />

## Hall of Fame

We ran the pull requests behind React Hooks, Node fetch and Kubernetes Ingress through PR Lens. They were drawn with the same renderer and the same format as the diagrams above.

<a href="https://prlens.dev/gallery/react/react/13968"><img alt="React Hooks, drawn again: four lanes across the React package, the reconciler, the server renderer and shared config" src="docs/showcase/gallery/react-hooks.svg"></a>

<sub><b><a href="https://prlens.dev/gallery/react/react/13968">react/react#13968</a></b> · 36 files · +5,868/−130 · 5 lanes. Hooks are added behind a feature flag.</sub>

<a href="https://prlens.dev/gallery/nodejs/node/41749"><img alt="Node's fetch code, drawn again across five lanes" src="docs/showcase/gallery/node-fetch.svg"></a>

<sub><b><a href="https://prlens.dev/gallery/nodejs/node/41749">nodejs/node#41749</a></b> · 16 files · +8,076/−3 · 5 lanes. `fetch`, `Request`, `Response` and `Headers` are added to Node itself.</sub>

<a href="https://prlens.dev/gallery/kubernetes/kubernetes/14175"><img alt="The first Kubernetes Ingress type, drawn again across four lanes" src="docs/showcase/gallery/kubernetes-ingress.svg"></a>

<sub><b><a href="https://prlens.dev/gallery/kubernetes/kubernetes/14175">kubernetes/kubernetes#14175</a></b> · 8 files · +766/−0 · 4 lanes. The first Ingress type, for L7 load balancing.</sub>

<details>
<summary><b>Seven more</b> · Vue, Rust, Tokio, Neovim, Django, webpack, vLLM</summary>
<br>

<a href="https://prlens.dev/gallery/vuejs/core/2532"><img alt="Vue's script setup and ref sugar, drawn again across three lanes" src="docs/showcase/gallery/vue-script-setup.svg"></a>

<sub><b>vuejs/core#2532</b> · 11 files · +1,081/−670 · 3 lanes. `&lt;script setup&gt;` and the first version of ref sugar.</sub>

<a href="https://prlens.dev/gallery/rust-lang/rust/31954"><img alt="Rust's question mark operator, drawn again across four lanes" src="docs/showcase/gallery/rust-try-operator.svg"></a>

<sub><b>rust-lang/rust#31954</b> · 26 files · +369/−16 · 4 lanes. The `?` operator, a short way to write `try!` that you can chain.</sub>

<a href="https://prlens.dev/gallery/tokio-rs/tokio/1657"><img alt="Tokio's rewritten work-stealing thread pool, drawn again across three lanes" src="docs/showcase/gallery/tokio-work-stealing.svg"></a>

<sub><b>tokio-rs/tokio#1657</b> · 100 files · +7,408/−6,795 · 3 lanes. The work-stealing pool, rebuilt so the scheduler does less extra work.</sub>

<a href="https://prlens.dev/gallery/neovim/neovim/11336"><img alt="Neovim's built-in LSP client, drawn again across three lanes" src="docs/showcase/gallery/neovim-lsp.svg"></a>

<sub><b>neovim/neovim#11336</b> · 15 files · +5,556/−1 · 3 lanes. The LSP client moves into Neovim itself.</sub>

<a href="https://prlens.dev/gallery/django/django/11209"><img alt="Django's ASGI handler, drawn again across five lanes" src="docs/showcase/gallery/django-asgi.svg"></a>

<sub><b>django/django#11209</b> · 38 files · +931/−42 · 5 lanes. An ASGI handler, and a request context that is safe to use with coroutines.</sub>

<a href="https://prlens.dev/gallery/webpack/webpack/10440"><img alt="Webpack's ContainerPlugin, drawn again across five lanes" src="docs/showcase/gallery/webpack-federation.svg"></a>

<sub><b>webpack/webpack#10440</b> · 13 files · +567/−5 · 5 lanes. `ContainerPlugin`, which brought module federation with it.</sub>

<a href="https://prlens.dev/gallery/vllm-project/vllm/1348"><img alt="vLLM's PagedAttention V2, drawn again across three lanes" src="docs/showcase/gallery/vllm-paged-attention.svg"></a>

<sub><b>vllm-project/vllm#1348</b> · 6 files · +764/−139 · 3 lanes. PagedAttention V2 and its sequence-level parallelism.</sub>

</details>

<b><a href="https://prlens.dev/gallery">Open the Hall of Fame</a></b>. Every diagram there is live.

<br />

## Configuration

Add a `.github/pr-lens.yml` file to change how PR Lens works. GitLab and Bitbucket have no `.github/` folder, so there you can use `.gitlab/pr-lens.yml` or a `pr-lens.yml` at the top of the repo. They work the same way. The [configuration reference](packages/schema#repository-config) lists every setting, its default, and examples.

### Fix names and mistakes

When you draw with the CLI, put your fixes in `.github/pr-lens.yml`. Don't edit the SVG files it makes:

```yaml
schemaVersion: 0.1.0
map:
  rename:
    - match: services/legacy-mailer.ts
      to: Postmark sender
  exclude:
    - "**/*.test.ts"
```

These fixes sit on top of what the model finds. They keep working as the code changes, even when the model names things differently from one run to the next. You can rename things, leave files out, pin cards to a lane, and group things together. See [`packages/cli`](packages/cli#corrections) for all of it.

<br />

## Other ways to run it

For most people, the App is all they need. The options below cover what it doesn't: your own CI, your own model, or a diagram before the pull request exists.

<details open>
<summary><b>Via your coding agent</b></summary>
<br>

A lot happens before a pull request is opened. Your agent can use the same renderer to help you understand any codebase or check its own changes before there is a pull request. It also helps you keep a clear picture of your system as it grows.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/agents.dark.svg">
    <img alt="Claude Code, Codex, Gemini CLI, Cursor, OpenCode and Copilot" src="docs/brand/agents.light.svg" width="720">
  </picture>
  <br>
</p>

```bash
npx skills add coldteadotai/pr-lens
```

Then ask your coding agent something like:

> Diagram the change you just made with PR Lens and attach it to the pull request.

The agent reads the diff and writes the diagram file. It runs `npx @coldtea/pr-lens-cli validate` until the file passes every check. Then it draws the diagram and adds it to the pull request description with `gh pr create --attach`, so the diagram is there as soon as the pull request opens. If a diagram gets a name wrong, the skill teaches the agent to fix `.github/pr-lens.yml` instead of editing the files it made. See [`packages/agent-skill`](packages/agent-skill) for more.

Want the agent to do the whole setup? Paste this:

```text
Set up PR Lens for me. It draws code changes as moving diagrams of the system and how data flows through it.

1. Install the agent skill: `npx skills add coldteadotai/pr-lens`.

2. Help me install the GitHub App at https://github.com/apps/coldtea-pr-lens on every repository where I review pull requests. It posts one comment per pull request and updates that comment on every push. It does not need a model key from me.

3. If I'd rather run it from CI with my own model key, offer the Action instead: `.github/workflows/pr-lens.yml` using `coldteadotai/pr-lens/packages/action@v0`, with the key saved as a repository secret. It works with any service that speaks `/chat/completions`, such as OpenAI or Gemini.

4. Then test it: diagram the latest change in this repository and show me the SVGs or the canvas.
```

</details>

<details>
<summary><b>As a workflow: the GitHub Action</b> · your CI · your key · one comment that stays the same</summary>
<br>

This posts the same comment from your own CI, drawn with your own model key. Save the key as a repository secret. The example below uses `GEMINI_API_KEY` because `provider` is Gemini by default. Then commit this file as `.github/workflows/pr-lens.yml`:

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

You can use any model. `provider` can be `gemini` (the default), `openai`, or `openai-compatible` with a `base-url` and `model`. So the same workflow works with OpenRouter, DeepSeek or your own server. The key reaches the CLI through the environment, never on a command line. The diff goes only to the provider you pick. This comment stays the same after it is posted, because an Action can't remember anything between runs. That is why the checkboxes only work in the App. See [`packages/action`](packages/action) for providers, lenses, branding and the other inputs.

</details>

<details>
<summary><b>On GitLab: the CI/CD component</b> · your pipeline · your key · one comment that updates</summary>
<br>

GitLab CI can post the same diagrams on a merge request. Add two masked variables: your model key, and a project access token with the `api` scope. The token is what posts the comment. Then add the component:

```yaml
workflow:
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH

include:
  - component: gitlab.com/coldteadotai/pr-lens/pr-lens@0.1.0
```

The `workflow: rules` block must be in your own `.gitlab-ci.yml`. GitLab only runs merge request pipelines when that file asks for them, and rules inside an included component don't count. You need the access token because `CI_JOB_TOKEN` can't post comments. On GitLab.com, project access tokens need the Premium or Ultimate plan. On the Free plan, a personal access token with the `api` scope works too, but the comment shows your name instead of a bot's.

The SVGs are uploaded to the project as attachments. That way everyone who reads the merge request can see them, even people who can't open files in the repository. On a private project, there is a downside. Anyone who has the attachment link can see the diagram, even if they are not a member. The link can't be guessed, but it is the only thing that protects the image. If a project turns on **Require authentication to view media files**, the images won't load. Readers can still open the diagrams from the canvas link in the comment. See [`packages/gitlab-component`](packages/gitlab-component) for more.

</details>

<details>
<summary><b>On Bitbucket: the pipe</b> · your pipeline · your key · one comment that updates</summary>
<br>

On Bitbucket Pipelines, add the pipe under `pull-requests:`:

```yaml
clone:
  depth: full # the diff needs history back to the merge base

pipelines:
  pull-requests:
    "**":
      - step:
          name: PR Lens
          script:
            - pipe: docker://ghcr.io/coldteadotai/pr-lens-pipe:0.1.0
              variables:
                GEMINI_API_KEY: $GEMINI_API_KEY
                PR_LENS_TOKEN: $PR_LENS_TOKEN
```

A pipe only sees the variables its step gives it, so the step passes in two secured variables by name. The first is your model key. The second is a repository access token with the `pullrequest:write` and `repository:write` scopes. The `repository:write` scope lets the pipe save the diagrams to the repository's Downloads. Every Bitbucket plan has repository access tokens. Tokens for a whole workspace need Premium.

Bitbucket shows comments as plain Markdown. So the comment has no sections to open and close, and no light and dark pair. It shows the headline, the numbers, one diagram per lens, and then the zoomed-in views in order. Bitbucket never runs a pipeline for a pull request opened from a fork, so the pipe can't draw those pull requests, no matter how you set it up. If your repository gets a lot of help from forks, use the hosted app. See [`packages/bitbucket-pipe`](packages/bitbucket-pipe) for more.

</details>

<details>
<summary><b>From the CLI</b> · every step on your computer, one at a time</summary>
<br>

The CLI does everything the other options do, one step at a time, on your computer. Only `analyze` talks to a model. It reads the key from the environment, never from a flag:

```bash
export GEMINI_API_KEY=…    # the default provider; OPENAI_API_KEY with --provider openai

# Diff in, graph document out — measured against the merge base, not the branch tip.
npx @coldtea/pr-lens-cli analyze --base origin/main

# The document as light and dark SVGs, plus the manifest a comment is built from.
# Each drawing lands in its own directory under .pr-lens/, named after its title.
npx @coldtea/pr-lens-cli render .pr-lens/graph.json

# The pull request comment as markdown, on stdout. Posting is your business.
npx @coldtea/pr-lens-cli comment --graph .pr-lens/<drawing>/drawn.graph.json --manifest .pr-lens/<drawing>/manifest.json \
  --asset-base-url https://raw.githubusercontent.com/owner/repo/pr-lens/42

# Any PR Lens document, checked against the contract — every problem, not just the first.
npx @coldtea/pr-lens-cli validate .pr-lens/graph.json .github/pr-lens.yml

# After the merge: the pull-request document as a stored map of the system, worth committing.
npx @coldtea/pr-lens-cli export .pr-lens/graph.json -o .github/pr-lens.map.json
```

Everything goes in `.pr-lens/`. The first time the CLI writes there, it adds that folder to your `.gitignore`. Think of it as scratch space, because the CLI can rebuild those files from the diff at any time. The only file worth committing is the map that `export` writes. Use `--out` if you want the files somewhere else.

`comment --target gitlab` or `--target bitbucket` writes a comment that GitLab or Bitbucket can show. `analyze` finds out which one you use from your git remote. To use Ollama, DeepSeek, OpenRouter, or anything else that speaks `/chat/completions`, pass `--provider openai-compatible --base-url <url>`. See [`packages/cli`](packages/cli) for every command, the fix file, and the error codes a script can check.

</details>

<details>
<summary><b>In your terminal</b> · the diagram before the pull request exists</summary>
<br>

The diagrams don't need a pull request. Draw them on your computer and look at the change before anyone else does:

```bash
npx @coldtea/pr-lens-cli analyze --base origin/main
npx @coldtea/pr-lens-cli render .pr-lens/graph.json
open .pr-lens/*-dark-*.svg    # macOS; the SVGs are self-contained, any browser reads them
```

This also helps when you review an agent's work. While you read the diff, the agent that wrote it can draw it. With the skill installed, say "render this change with PR Lens and open the SVGs". You get the diagram next to the diff, minutes before the pull request shows the same picture.

</details>

<br />

## Packages

| Package                                                  | What it is                                                                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [`packages/schema`](packages/schema)                     | `@coldtea/pr-lens-schema`: the format every other part uses                                                               |
| [`packages/renderer`](packages/renderer)                 | `@coldtea/pr-lens-renderer`: turns a JSON graph into the moving light and dark SVGs on this page, the same way every time |
| [`packages/cli`](packages/cli)                           | `@coldtea/pr-lens-cli`: reads a diff with your own model key, draws it, and writes the comment                            |
| [`packages/action`](packages/action)                     | the GitHub Action: analyzes the change, publishes the diagrams, and posts one comment                                     |
| [`packages/gitlab-component`](packages/gitlab-component) | the GitLab CI/CD component: does the same on a merge request                                                              |
| [`packages/bitbucket-pipe`](packages/bitbucket-pipe)     | the Bitbucket pipe: does the same on a pull request                                                                       |
| [`packages/agent-skill`](packages/agent-skill)           | `@coldtea/pr-lens-agent-skill`: teaches a coding agent to draw the change it just made                                    |

<br />

## Working in this repo

```bash
pnpm install
pnpm verify      # build, typecheck, test
```

You need Node 20.11 or newer and pnpm 10.

<br />

## Self-hosting the canvas

Start with [docs/canvas-api.md](docs/canvas-api.md).

<br />

## Community

Ask questions or share your diagrams on [Discord](https://discord.gg/sGDwjs8yHK). We post new releases and features on X at [@drawwithlens](https://x.com/drawwithlens).

<br />

## Contributing

Open an issue first. Wait for one of us to approve it before you or your agents write any code. We close pull requests that have no approved issue. Once your issue is approved, link to it from your pull request.

Commit under your own name only. Don't add a `Co-Authored-By` line for a model, a "Generated with" footer, or a session link. You can use an agent (we do too), but the commits are yours and you are fully responsible for them. Most tools add these lines unless you turn them off.

<br />

## Why we built this

[Reducing the cognitive load of reviewing PRs](https://www.coldtea.ai/blog/reducing-cognitive-load-ai-generated-prs)

<br />

## License

MIT © Coldtea

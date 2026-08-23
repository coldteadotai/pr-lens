# PR Lens: GitHub Action

Posts the architecture and data flow of a pull request as diagrams in its comments, drawn with your own model key.

MIT © Coldtea AI.

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

That is the whole setup. `GEMINI_API_KEY` is the secret name because `provider` defaults to Gemini; set `provider` to `openai`, or to `openai-compatible` with a `base-url`, and the key is whatever that endpoint wants. The key is passed to the CLI through the environment, so it never appears in a command line or a log; the diff goes to the provider you named and nowhere else.

The `concurrency` block is not decoration. Every run of every pull request writes to one shared branch and one shared comment, so two runs of the same pull request racing is ordinary. A group per pull request means a new push supersedes the render it replaces instead of the two fighting for the comment.

It is not a lock, though, and the Action does not treat it as one: cancellation arrives when it arrives, and a request already on its way to GitHub still lands. So publishing replays onto the branch tip rather than failing, and the comment step asks GitHub for the pull request's head immediately before it writes: a run that was overtaken while it drew says so and posts nothing, rather than replacing a newer diagram with an older one.

## What it does, in order

1. **Analyzes** the diff between the pull request's base and head commits, and validates the model's answer against the PR Lens contract before anything else happens.
2. **Renders** it as self-contained light and dark SVGs, applying the repository's corrections and writing the document those pictures actually show, which is the one the comment is then composed from.
3. **Publishes** them to an orphan `pr-lens` branch under `pr/<number>/<head-sha>/`. That branch holds no code and is never merged. GitHub proxies comment images through a cache that never revalidates, so each render lives at its own path rather than replacing the last one.
4. **Comments**: one comment per pull request, updated in place on every push. The CLI owns the hidden marker that finds it, so nothing here spells a second copy of that string.

Finding that comment takes more than the marker: anyone can post the marker themselves, so a comment is only ever edited when the account this Action comments as wrote it. Everything a pull request author controls (a branch name, a title, the diff itself) reaches a script through the environment rather than being interpolated into it, and the model's own prose is escaped into HTML before it becomes a comment, so a diff cannot talk the bot into posting a link.

## Inputs

| Input | Default | |
| --- | --- | --- |
| `api-key` | none | **required**; the model provider key |
| `provider` | `gemini` | or `openai`, or `openai-compatible` for anything else speaking `/chat/completions` |
| `model` | none | required for `openai` and `openai-compatible`: the endpoint decides which names exist |
| `base-url` | none | required for `openai-compatible`: the endpoint it is compatible with |
| `lens` | both | comma-separated: `architecture`, `data-flow` |
| `branding` | `true` | the "Rendered by PR Lens" footer |
| `comment` | `true` | set `false` to render and publish without commenting |
| `data-branch` | `pr-lens` | branch the SVGs are committed to |
| `cli-version` | the version in this repository | version of `@coldtea/pr-lens-cli` to run |
| `comment-author` | `github-actions[bot]` | the login that owns the comment; only its comments are ever edited |
| `github-token` | `${{ github.token }}` | used to publish and to comment |

Outputs: `graph`, the path of the document that was produced, and `assets-url`, where the SVGs were published.

## Corrections

Commit `.github/pr-lens.yml` and the action picks it up: renames, exclusions, lane pins, groupings, applied when the diagrams are drawn, over whatever the latest analysis inferred. See the [schema README](../schema/README.md#repository-config) for the format, and the [agent skill](../agent-skill) if you would rather tell your coding agent to fix the map than write YAML yourself.

## Deliberately static

The comment is a picture, a set of numbers and a `<details>` tree. There is no checkbox to tick and nothing to click into: an Action cannot hold state between runs, and pretending otherwise makes a comment that lies. The hosted app is where interactivity lives.

## Forks

A pull request from a fork gets no secrets, so there is no key for the action to use and the job cannot run. That is GitHub's rule and the right one, because a fork can change the workflow. Run PR Lens on same-repository pull requests, or from a workflow that a maintainer triggers.

---

Part of [PR Lens](https://prlens.dev). Review what actually matters.

# PR Lens for Bitbucket Pipelines

Draws a pull request as architecture and data-flow diagrams, posted as one
comment on the pull request itself — the same diagrams the
[GitHub Action](../action) and the [GitLab component](../gitlab-component)
post, from your own CI with your own model key.

Bitbucket renders comments as plain Markdown, so the comment arrives without
collapsible sections or theme pairs: headline, numbers, one diagram per lens,
and the drill-down views in order.

## Setup

Two secured repository variables (Repository settings → Pipelines →
Repository variables):

- **`GEMINI_API_KEY`** — your model key. `MODEL_PROVIDER` defaults to Gemini;
  name a different variable with `API_KEY_VARIABLE` for another provider.
- **`PR_LENS_TOKEN`** — a [repository access token](https://support.atlassian.com/bitbucket-cloud/docs/repository-access-tokens/)
  with the `pullrequest:write` and `repository:write` scopes (available on
  every plan) — the first posts the comment, the second publishes the
  diagrams to Downloads. The comment shows the token's name. Pipelines
  provides no token of its own for the Bitbucket API, and app passwords are
  retired.

Then add the pipe under `pull-requests:`:

```yaml
clone:
  depth: full # the diff needs the history back to the merge base

pipelines:
  pull-requests:
    "**":
      - step:
          name: PR Lens
          script:
            - pipe: coldtea/pr-lens-pipe:0.1.0
```

Bitbucket does not run pull-request pipelines for forks, so the pipe only
ever sees same-repository pull requests.

## What a run does

Pipelines hands the step a clone with the destination already merged into
the source branch, and no destination-commit variable — so the pipe fetches
the destination and lets the diff run from their merge base, which is
exactly the pull request's effective change. It renders the SVGs, publishes
them to the repository's **Downloads** (content-hash filenames, so an
identical render overwrites itself), and keeps exactly one sticky comment
per pull request, updated in place on every push. A run whose commit is no
longer the pull request's head stands down instead of overwriting a newer
drawing.

## Variables

| Variable           | Default          | What it does                                                  |
| ------------------ | ---------------- | ------------------------------------------------------------- |
| `MODEL_PROVIDER`   | `gemini`         | `gemini`, `openai`, or `openai-compatible` (needs `BASE_URL`) |
| `MODEL`            |                  | Model to ask; required for `openai-compatible`                |
| `BASE_URL`         |                  | Provider endpoint, for a compatible or self-hosted server     |
| `LENS`             | both             | Comma-separated lenses to render                              |
| `BRANDING`         | `"true"`         | The "Rendered by PR Lens" footer                              |
| `COMMENT`          | `"true"`         | Set `"false"` to render without commenting                    |
| `CLI_VERSION`      | current          | Version of `@coldtea/pr-lens-cli` to run                      |
| `API_KEY_VARIABLE` | `GEMINI_API_KEY` | Name of the variable holding the model key                    |
| `TOKEN_VARIABLE`   | `PR_LENS_TOKEN`  | Name of the variable holding the access token                 |

The key and token are named by variable, never passed as values, so neither
ever appears in a pipeline definition or a step log.

## Publishing (maintainers)

The pipe is a Docker image: build from this directory's `Dockerfile` and
push as `coldtea/pr-lens-pipe:<version>`, keeping `pipe.yml`'s `image:` pin
in step. The image carries only `pipe/lens.sh` plus node, git and curl.

## License

MIT © Coldtea

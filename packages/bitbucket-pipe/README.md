# Bitbucket Pipelines Pipe: PR Lens

Draws a pull request as architecture and data-flow diagrams, posted as one
comment on the pull request itself — the same diagrams the
[GitHub Action](../action) and the [GitLab component](../gitlab-component)
post, from your own CI with your own model key.

## YAML Definition

Add the pipe under `pull-requests:`:

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
              variables:
                MODEL_PROVIDER: "gemini"
```

## Variables

| Variable           | Usage                                                         |
| ------------------ | ------------------------------------------------------------- |
| MODEL_PROVIDER     | `gemini`, `openai`, or `openai-compatible` (needs `BASE_URL`). Default: `gemini` |
| MODEL              | Model to ask; required for `openai-compatible`                |
| BASE_URL           | Provider endpoint, for a compatible or self-hosted server     |
| LENS               | Comma-separated lenses to render. Default: both               |
| BRANDING           | The "Rendered by PR Lens" footer. Default: `"true"`           |
| COMMENT            | Set `"false"` to render without commenting. Default: `"true"` |
| CLI_VERSION        | Version of `@coldtea/pr-lens-cli` to run                      |
| API_KEY_VARIABLE   | Name of the variable holding the model key. Default: `GEMINI_API_KEY` |
| TOKEN_VARIABLE     | Name of the variable holding the access token. Default: `PR_LENS_TOKEN` |

The key and the token are named by variable, never passed as values, so
neither ever appears in a pipeline definition or a step log.

## Details

Pipelines hands the step a clone with the destination already merged into
the source branch, and no destination-commit variable — so the pipe fetches
the destination and lets the diff run from their merge base, which is
exactly the pull request's effective change. It renders the SVGs, publishes
them to the repository's **Downloads** (content-hash filenames, so an
identical render overwrites itself), and keeps exactly one sticky comment
per pull request, updated in place on every push. A run whose commit is no
longer the pull request's head stands down instead of overwriting a newer
drawing.

Bitbucket renders comments as plain Markdown, so the comment arrives without
collapsible sections or theme pairs: headline, numbers, one diagram per lens
— the neutral render, which reads for a light-mode and a dark-mode reader
alike — and the drill-down views in order.

Bitbucket does not run pull-request pipelines for forks, so the pipe only
ever sees same-repository pull requests.

## Prerequisites

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

`clone: depth: full` is required: the diff is measured from the merge base,
and a shallow clone does not reach it.

## Examples

### Basic

```yaml
script:
  - pipe: coldtea/pr-lens-pipe:0.1.0
```

### A different provider

```yaml
script:
  - pipe: coldtea/pr-lens-pipe:0.1.0
    variables:
      MODEL_PROVIDER: "openai-compatible"
      MODEL: "your-model-name"
      BASE_URL: "https://your-endpoint/v1"
      API_KEY_VARIABLE: "YOUR_KEY_VARIABLE"
```

### Render without commenting

```yaml
script:
  - pipe: coldtea/pr-lens-pipe:0.1.0
    variables:
      COMMENT: "false"
```

### One lens only

```yaml
script:
  - pipe: coldtea/pr-lens-pipe:0.1.0
    variables:
      LENS: "architecture"
```

## Support

Open an issue at
[github.com/coldteadotai/pr-lens](https://github.com/coldteadotai/pr-lens/issues).

## Publishing (maintainers)

The pipe is a Docker image: build from this directory's `Dockerfile` and
push as `coldtea/pr-lens-pipe:<version>`, keeping `pipe.yml`'s `image:` pin
in step. The image carries only `pipe/lens.sh` plus node, git and curl.

## License

MIT © Coldtea

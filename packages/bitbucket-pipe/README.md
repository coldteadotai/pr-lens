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

It also files a Code Insights report on the commit, so the pull request's
**Reports** tab records that PR Lens ran and links to the drawing — a surface
that survives a collapsed comment thread. The report carries no
`report_type` and no annotations: Bitbucket's types are SECURITY, COVERAGE,
TEST and BUG, and a diagram is none of them, while annotations render as
findings against lines. If Bitbucket refuses the report the run carries on;
the comment is the product.

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

### Without the pipe

A pipe is a Docker image, so using one means the image has been published. The
same script runs as an ordinary step, which needs nothing published at all:
copy [`pipe/lens.sh`](pipe/lens.sh) into your repository and run it.

```yaml
- step:
    name: PR Lens
    image: node:20
    script:
      - bash ./ci/pr-lens.sh
```

Every variable in the table above defaults inside the script, so a step needs
only the same two repository variables the pipe does — `GEMINI_API_KEY` and
`PR_LENS_TOKEN`. Set any other by exporting it before the call.

This is the same script the pipe runs, and the same shape the
[GitHub Action](https://github.com/coldteadotai/pr-lens/tree/main/packages/action)
uses. What you give up is discovery: a pipe appears in Atlassian's listing and
is one line to adopt, where a copied script is yours to update.

## Support

Open an issue at
[github.com/coldteadotai/pr-lens](https://github.com/coldteadotai/pr-lens/issues).

## Publishing (maintainers)

The pipe is a Docker image: build from this directory's `Dockerfile` and
push as `coldtea/pr-lens-pipe:<version>`, keeping `pipe.yml`'s `image:` pin
in step. The image carries only `pipe/lens.sh` plus node, git and curl.

## License

MIT © Coldtea

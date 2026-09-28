# Bitbucket Pipelines Pipe: PR Lens

Draws a pull request as architecture and data-flow diagrams and posts them
as one comment on the pull request. They are the same diagrams the
[GitHub Action](../action) and the [GitLab component](../gitlab-component)
post, made in your own CI with your own model key.

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
            - pipe: docker://ghcr.io/coldteadotai/pr-lens-pipe:0.1.2
              variables:
                GEMINI_API_KEY: $GEMINI_API_KEY
                PR_LENS_TOKEN: $PR_LENS_TOKEN
```

A pipe runs in its own container and sees only the variables its step passes
in, so the step passes both secured variables by name. `$GEMINI_API_KEY` is a
reference the runner resolves, so the values never appear in the file.

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

You pass the names of the key and token variables, not their values, so
neither value appears in a pipeline definition or a step log.

## Details

Pipelines gives the step a clone with the destination branch already merged
into the source branch, and no variable for the destination commit. The pipe
fetches the destination and diffs from the merge base, which gives exactly
the pull request's changes. It renders the SVGs and publishes them to the
repository's Downloads. The filenames are content hashes, so an identical
render replaces its earlier copy.

The pipe keeps one sticky comment per pull request and updates it in place on
every push. If the pull request's head has moved past a run's commit, that
run leaves the comment alone so it cannot overwrite a newer drawing.

Bitbucket renders comments as plain Markdown, so the comment has no
collapsible sections or theme pairs. It shows the headline, the numbers, one
diagram per lens, and the drill-down views in order. Each diagram is the
neutral render, which reads in both light and dark mode.

The pipe also files a Code Insights report on the commit. The pull request's
Reports tab then records that PR Lens ran and links to the drawing, and the
report stays visible when the comment thread is collapsed. Bitbucket requires
one of four report types (SECURITY, COVERAGE, TEST and BUG), and the pipe
uses `TEST`. A passed test report says only that a tool ran and found nothing
to flag, which misleads least for a drawing. The report has no annotations,
because Bitbucket shows those as findings against lines. If Bitbucket
refuses the report, the run continues; the comment is what matters.

Bitbucket does not run pull-request pipelines for forks, so the pipe only
sees pull requests from the same repository.

## Prerequisites

Add two secured repository variables (Repository settings → Pipelines →
Repository variables):

- `GEMINI_API_KEY`: your model key. `MODEL_PROVIDER` defaults to Gemini. For
  another provider, name a different variable with `API_KEY_VARIABLE`.
- `PR_LENS_TOKEN`: a [repository access token](https://support.atlassian.com/bitbucket-cloud/docs/repository-access-tokens/)
  with the `pullrequest:write` and `repository:write` scopes, available on
  every plan. The first scope posts the comment and the second publishes the
  diagrams to Downloads. The comment appears under the token's name.
  Pipelines has no built-in token for the Bitbucket API, and app passwords
  are retired.

`clone: depth: full` is required because the diff starts at the merge base,
and a shallow clone does not reach it.

## Examples

### Basic

```yaml
script:
  - pipe: docker://ghcr.io/coldteadotai/pr-lens-pipe:0.1.2
    variables:
      GEMINI_API_KEY: $GEMINI_API_KEY
      PR_LENS_TOKEN: $PR_LENS_TOKEN
```

### A different provider

```yaml
script:
  - pipe: docker://ghcr.io/coldteadotai/pr-lens-pipe:0.1.2
    variables:
      MODEL_PROVIDER: "openai-compatible"
      MODEL: "your-model-name"
      BASE_URL: "https://your-endpoint/v1"
      API_KEY_VARIABLE: "YOUR_KEY_VARIABLE"
      YOUR_KEY_VARIABLE: $YOUR_KEY_VARIABLE
      PR_LENS_TOKEN: $PR_LENS_TOKEN
```

### Render without commenting

```yaml
script:
  - pipe: docker://ghcr.io/coldteadotai/pr-lens-pipe:0.1.2
    variables:
      COMMENT: "false"
      GEMINI_API_KEY: $GEMINI_API_KEY
```

### One lens only

```yaml
script:
  - pipe: docker://ghcr.io/coldteadotai/pr-lens-pipe:0.1.2
    variables:
      LENS: "architecture"
      GEMINI_API_KEY: $GEMINI_API_KEY
      PR_LENS_TOKEN: $PR_LENS_TOKEN
```

### Without the pipe

A pipe is a Docker image, so it only works once the image is published. The
same script also runs as an ordinary step with nothing published: copy
[`pipe/lens.sh`](pipe/lens.sh) into your repository and run it.

```yaml
- step:
    name: PR Lens
    image: node:20
    script:
      - bash ./ci/pr-lens.sh
```

The script sets a default for every variable in the table above, so the step
needs only the two repository variables the pipe uses, `GEMINI_API_KEY` and
`PR_LENS_TOKEN`. To set any other, export it before running the script.

It is the same script the pipe runs, and the
[GitHub Action](https://github.com/coldteadotai/pr-lens/tree/main/packages/action)
works the same way. A pipe appears in Atlassian's listing and takes one line
to adopt. A copied script does not, and you have to update it yourself.

## Support

Open an issue at
[github.com/coldteadotai/pr-lens](https://github.com/coldteadotai/pr-lens/issues).

## Publishing (maintainers)

The pipe is a Docker image on GitHub's registry, which hosts public images
under the organisation for free. Build it from this directory's `Dockerfile`
for `linux/amd64`, the architecture Bitbucket's runners use, push it as
`ghcr.io/coldteadotai/pr-lens-pipe:<version>`, and update the `image:` pin in
`pipe.yml` to match. The package must be public, which you set once in its
settings on GitHub. The `docker://` reference works as soon as the image is
pushed. The short form in Atlassian's listing resolves through a Bitbucket
repository that holds this `pipe.yml`; setting that up is a later step.

```bash
docker buildx build --platform linux/amd64 -t ghcr.io/coldteadotai/pr-lens-pipe:0.1.2 .
docker push ghcr.io/coldteadotai/pr-lens-pipe:0.1.2
```

## License

MIT © Coldtea

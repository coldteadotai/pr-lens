# PR Lens for GitLab CI/CD

Draws a merge request as architecture and data-flow diagrams and posts them
as one comment on the merge request. They are the same diagrams the
[GitHub Action](https://github.com/coldteadotai/pr-lens/tree/main/packages/action)
posts, made in your own CI with your own model key.

## Setup

Add two CI/CD variables (Settings → CI/CD → Variables, both masked):

- `GEMINI_API_KEY`: your model key. `provider` defaults to Gemini. For another
  provider, name a different variable with the `api_key_variable` input.
- `PR_LENS_TOKEN`: a [project access token](https://docs.gitlab.com/user/project/settings/project_access_tokens/)
  with the `api` scope. The job posts the comment with it, so the comment
  appears under the token's bot user. `CI_JOB_TOKEN` cannot post notes, so
  this token is required. On GitLab.com, project access tokens need a Premium
  or Ultimate plan. On Free, a personal access token works instead, and the
  comment posts as its owner.

Then include the component:

```yaml
workflow:
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH

include:
  - component: gitlab.com/coldteadotai/pr-lens/pr-lens@0.1.1
```

The `workflow: rules` block has to be in your own `.gitlab-ci.yml`. Merge
request pipelines only exist when that file triggers them, and rules inside
an included component do not count. The component's job then runs only in
those pipelines.

## What a run does

A run reads the diff between `CI_MERGE_REQUEST_DIFF_BASE_SHA` and the head,
asks your model to describe it, and renders the SVGs. It uploads them as
project attachments, which load for anyone who can read the comment, private
projects included. That needs no data branch and no raw-URL permissions.

The job keeps one sticky comment per merge request and updates it in place on
every push. If the merge request's head has moved past a run's commit, that
run leaves the comment alone so it cannot overwrite a newer drawing.

## Inputs

| Input              | Default          | What it does                                               |
| ------------------ | ---------------- | ---------------------------------------------------------- |
| `provider`         | `gemini`         | `gemini`, `openai`, or `openai-compatible` (needs `base_url`) |
| `model`            |                  | Model to ask; required for `openai-compatible`             |
| `base_url`         |                  | Provider endpoint, for a compatible or self-hosted server  |
| `lens`             | both             | Comma-separated lenses to render                           |
| `branding`         | `"true"`         | The "Rendered by PR Lens" footer                           |
| `comment`          | `"true"`         | Set `"false"` to render without commenting                 |
| `cli_version`      | current          | Version of `@coldtea/pr-lens-cli` to run                   |
| `api_key_variable` | `GEMINI_API_KEY` | Name of the variable holding the model key                 |
| `token_variable`   | `PR_LENS_TOKEN`  | Name of the variable holding the access token              |
| `job_name`         | `pr-lens`        | Name of the job, so the component can appear twice in one pipeline |
| `stage` / `image`  | `test` / `node:20` | Where and on what the job runs                           |
| `allow_failure`    | `true`           | Keep the pipeline green when PR Lens fails                 |
| `timeout`          | `15 minutes`     | Job timeout, deliberately under a project default          |
| `interruptible`    | `true`           | Cancel the job when a newer commit supersedes the pipeline |

Every input is typed, and inputs with a fixed set of values declare that
set. GitLab refuses `provider: maybe` or a malformed `cli_version` when it
creates the pipeline, before the job starts.

A PR Lens failure does not fail your pipeline, because `allow_failure`
defaults to `true`. PR Lens draws a picture of the change and does not judge
the code, so a model outage should not hold up a merge. Set `allow_failure`
to `false` if you want failures to block. The job retries transient runner
and API failures only. Retrying a real analysis failure would spend another
model call and fail the same way.

The job saves the render as an artifact under `.pr-lens/` and keeps it for a
week, so you can download the diagrams even when the comment could not be
posted.

Each run fetches the pinned CLI version from npm, as the
[GitHub Action](https://github.com/coldteadotai/pr-lens/tree/main/packages/action)
does. There is no PR Lens image to set as `image`. Baking the CLI into one
would mean pinning its version by hand in two places and bumping both
together, so if the per-run fetch ever goes, it should go for all three
forges at once.

You pass the names of the key and token variables, not their values, so
neither value appears in a pipeline definition or a job log.

## Publishing (maintainers)

Pipelines include the component from a mirror at
`gitlab.com/coldteadotai/pr-lens`. That project is marked as a CI/CD catalog
resource and releases `templates/` and `scripts/` from this directory with the
`release` keyword on semver tags. `templates/pr-lens.yml` embeds
`scripts/lens.sh` verbatim, and a test fails if the two differ. Edit the
script and regenerate the template instead of editing it by hand.

## License

MIT © Coldtea

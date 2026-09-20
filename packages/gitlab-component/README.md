# PR Lens for GitLab CI/CD

Draws a merge request as architecture and data-flow diagrams, posted as one
comment on the merge request itself — the same diagrams the
[GitHub Action](../action) posts, from your own CI with your own model key.

## Setup

Two CI/CD variables (Settings → CI/CD → Variables, both masked):

- **`GEMINI_API_KEY`** — your model key. `provider` defaults to Gemini; name a
  different variable with the `api_key_variable` input for another provider.
- **`PR_LENS_TOKEN`** — a [project access token](https://docs.gitlab.com/user/project/settings/project_access_tokens/)
  with the `api` scope. The comment is posted with it, and appears from the
  token's own bot user. `CI_JOB_TOKEN` cannot post notes, so this one is not
  optional. On GitLab.com, project access tokens need a Premium or Ultimate
  plan; on Free, a personal access token works and posts as its owner.

Then include the component:

```yaml
workflow:
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH

include:
  - component: gitlab.com/coldteadotai/pr-lens/pr-lens@0.1.0
```

The `workflow: rules` block is yours to write, not the component's: merge
request pipelines only exist when the consuming `.gitlab-ci.yml` triggers
them itself, and rules inside an included component do not count. The
component's job then runs only in those pipelines.

## What a run does

Reads the diff between `CI_MERGE_REQUEST_DIFF_BASE_SHA` and the head, asks
your model to describe it, renders the SVGs, uploads them as project
attachments — served to anyone who can read the comment, private projects
included, with no data branch and no raw-URL permissions to reason about —
and keeps exactly one sticky comment per merge request, updated in place on
every push. A run whose commit is no longer the head stands down instead of
overwriting a newer drawing.

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
| `stage` / `image`  | `test` / `node:20` | Where and on what the job runs                           |

The key and token are named by variable, never passed as values, so neither
ever appears in a pipeline definition or a job log.

## Publishing (maintainers)

The component is consumed from a mirror at `gitlab.com/coldteadotai/pr-lens`:
a project marked as a CI/CD catalog resource, releasing `templates/` and
`scripts/` from this directory with the `release` keyword on semver tags.
`templates/pr-lens.yml` embeds `scripts/lens.sh` verbatim — a test holds the
two in lockstep, so edit the script and regenerate rather than editing the
template by hand.

## License

MIT © Coldtea

# Changelog

Versions are semantic, and a consumer pins one:

```yaml
include:
  - component: gitlab.com/coldteadotai/pr-lens/pr-lens@0.1.0
```

For a pinned pipeline, a patch fixes behaviour without changing inputs. A
minor adds an input, or changes a default in a way that cannot fail a
pipeline that did not set it. A major changes or removes an input, or changes
a default in a way that could. Pin a major and let minors arrive; nothing
within one major will break a pipeline.

## Unreleased

- Every input is typed, and inputs with a fixed set of values declare
  `options` or a `regex`, so GitLab refuses a bad value when it creates the
  pipeline instead of the job failing later. **A pipeline passing a value
  outside the declared set now fails earlier and more clearly.**
- `allow_failure` defaults to `true`. PR Lens draws a picture and does not
  judge the code, so a model outage should not hold up a merge. Set it to
  `false` for the old behaviour.
- `timeout` defaults to 15 minutes, so a hung model call stops there instead
  of running to the project's global timeout on the project's CI minutes.
- `interruptible` defaults to `true`, so a superseded pipeline stops drawing
  a commit nobody is looking at.
- `retry` covers transient runner and API failures only. Retrying a real
  analysis failure would spend the model call again and fail the same way.
- `job_name` is an input, so the component can appear twice in one pipeline.
- The job saves the render as an artifact under `.pr-lens/`, so you can
  download the diagrams even when the comment could not be posted.
- Renders with `--theme neutral`. GitLab shows one image and cannot switch it
  to match the reader's theme, and the light render was a glaring rectangle
  for every dark-mode reader.
- Fetches the CLI from npm on each run, as the GitHub Action does. An image
  with the CLI baked in was removed before release: it saved a fetch but meant
  pinning the version by hand in two places.

`branding` and `comment` are still strings, not booleans, so a pipeline
passing `"true"` keeps working.

## 0.1.0

First release. Analyzes a merge request, renders the diagrams, uploads them as
project attachments, and keeps one sticky comment.

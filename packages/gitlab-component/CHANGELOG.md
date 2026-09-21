# Changelog

Versions are semantic, and a consumer pins one:

```yaml
include:
  - component: gitlab.com/coldteadotai/pr-lens/pr-lens@0.1.0
```

**What a bump means for a pinned pipeline.** A patch fixes behaviour without
changing inputs. A minor adds an input, or changes a default in a direction
that cannot fail a pipeline that did not set it. A major changes or removes
an input, or changes a default in a way that could. Pinning a major and
letting minors arrive is the intended usage; nothing here will break a
pipeline within one.

## Unreleased

- Every input is typed, and the ones with a closed set of values declare
  `options` or a `regex` — so a bad value is refused when the pipeline is
  created rather than failing inside the job. **A pipeline passing a value
  outside the declared set now fails earlier and more clearly.**
- `allow_failure` defaults to `true`: PR Lens draws a picture, it does not
  judge the code, and a model outage is no reason to hold a merge. Set it to
  `false` for the old behaviour.
- `timeout` defaults to 15 minutes, so a hung model call cannot run until the
  project's global timeout on the project's CI minutes.
- `interruptible` defaults to `true`, so a superseded pipeline stops drawing
  a commit nobody is looking at.
- `retry` covers transient runner and API failures only — never a real
  analysis failure, which would spend the model call again to fail the same way.
- `job_name` is an input, so the component can appear twice in one pipeline.
- The render is saved as a job artifact under `.pr-lens/`, so the diagrams are
  downloadable even on a run where the comment could not be posted.
- Renders `--theme neutral`: GitLab shows one image and cannot swap on the
  reader's theme, and the light render was a glaring rectangle for every
  dark-mode reader.
- Ships a `Dockerfile` for an image with the CLI baked in. Point `image` at it
  and a pipeline no longer downloads and executes the CLI at job time.

`branding` and `comment` stay strings rather than becoming booleans, so a
pipeline passing `"true"` keeps working.

## 0.1.0

First release. Analyzes a merge request, renders the diagrams, uploads them as
project attachments, and keeps one sticky comment.

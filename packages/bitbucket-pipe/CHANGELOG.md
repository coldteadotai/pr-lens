# Changelog

Versions are semantic, and a consumer pins one:

```yaml
- pipe: ghcr.io/coldteadotai/pr-lens-pipe:0.1.0
```

For a pinned pipeline, a patch fixes behaviour without changing variables. A
minor adds a variable, or changes a default in a way that cannot fail a
pipeline that did not set it. A major changes or removes a variable, or
changes a default in a way that could.

## 0.1.1

- The diagrams are rendered in the light theme. Bitbucket cannot swap an
  image on the reader's theme and opens light by default, so the one render
  is the one most readers see on its own ground. It used to be the neutral
  render, which sat mid-way and looked at home nowhere.

- `pipe.yml` has the shape Atlassian validates: `maintainer` and `vendor` are
  objects with a name and a website, and `category` is declared. The Bitbucket
  Pipes listing refuses a pipe with strings there or no category, so the pipe
  worked for anyone who already knew the image name and was invisible to
  everyone else.
- The README follows Atlassian's required heading order.
- The CLI is baked into the image at build time instead of fetched on every
  run. Downloading and running fresh code in every pipeline put whatever the
  registry served that minute inside a pipeline holding the repository's
  variables, and billed the install to the repository.
- Files a Code Insights report on the commit, so the pull request's Reports
  tab records the run and links to the diagram. Bitbucket refuses a report
  without one of its four types, and `TEST` claims the least of them. The
  report has no annotations, because those would render as findings.
- Renders with `--theme neutral`. Bitbucket renders no HTML and shows one
  image, and the light render was a glaring rectangle for every dark-mode
  reader.

## 0.1.0

First release. Analyzes a pull request, renders the diagrams, publishes them
to the repository's Downloads, and keeps one sticky comment.

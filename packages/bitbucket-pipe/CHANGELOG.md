# Changelog

Versions are semantic, and a consumer pins one:

```yaml
- pipe: coldtea/pr-lens-pipe:0.1.0
```

**What a bump means for a pinned pipeline.** A patch fixes behaviour without
changing variables. A minor adds a variable, or changes a default in a
direction that cannot fail a pipeline that did not set it. A major changes or
removes a variable, or changes a default in a way that could.

## Unreleased

- `pipe.yml` is the shape Atlassian validates: `maintainer` and `vendor` are
  objects with a name and a website, and `category` is declared. As strings,
  and without a category, submission to the Bitbucket Pipes listing is
  refused — so the pipe worked for anyone who already knew the image name and
  was invisible to everyone else.
- The README follows Atlassian's required heading order.
- The CLI is baked into the image at build time rather than fetched on every
  run. A pipe that downloaded and executed fresh code per pipeline put
  whatever the registry served that minute inside a pipeline holding the
  repository's variables, and billed the install to the repository.
- Renders `--theme neutral`: Bitbucket renders no HTML and shows one image,
  and the light render was a glaring rectangle for every dark-mode reader.

## 0.1.0

First release. Analyzes a pull request, renders the diagrams, publishes them
to the repository's Downloads, and keeps one sticky comment.

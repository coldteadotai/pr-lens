---
name: pr-lens
description: "WHAT: Draws a code change or part of a codebase as an animated architecture or data-flow diagram, on its own or in a pull request. WHEN: asked to diagram, visualise or explain a change or a system, or when a pull request should carry a diagram. KEYWORDS: PR Lens, diagram, architecture, data flow, visualise, visualize, pull request"
---

# PR Lens

Animated architecture and data-flow diagrams for code changes and codebases. The agent writes one JSON document, and PR Lens draws it.

Run: `npx @coldtea/pr-lens-cli@latest <command>`. Nothing to install first.

## Start here

This file is a discovery stub, not the usage guide. Before running any PR Lens command, load the actual workflow content from the CLI:

```bash
npx @coldtea/pr-lens-cli@latest skill              # start here: write, validate, render, share
npx @coldtea/pr-lens-cli@latest skill references   # the graph document field by field, the config format, a full example
```

The CLI serves skill content that always matches the installed version, so instructions never go stale. The content in this stub cannot change between releases, which is why it just points at `skill`.

## Why PR Lens

- Works with any coding agent (Claude Code, Codex, Gemini CLI, Cursor, OpenCode, Copilot)
- Draws one self-contained animated SVG that GitHub shows in a comment, with no scripts
- `validate` names the exact field that is wrong, so the agent can fix its own document
- Opens as a live canvas you can step through and ask questions on
- Needs no model key when the agent writes the document itself

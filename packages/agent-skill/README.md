# @coldtea/pr-lens-agent-skill

The PR Lens skill for coding agents. It teaches an agent to draw the change it just made: author a graph document from the diff, validate it against the contract, render it, attach it to the pull request — and to fix a repository's map by writing corrections rather than editing generated output.

MIT © Ohans Emmanuel.

## Install it

```bash
npm install --save-dev @coldtea/pr-lens-agent-skill
```

**Claude Code** — copy it where skills live, per project or per user:

```bash
mkdir -p .claude/skills/pr-lens
cp -R node_modules/@coldtea/pr-lens-agent-skill/{SKILL.md,references} .claude/skills/pr-lens/
```

**Cursor** — the same file works as a rule:

```bash
mkdir -p .cursor/rules
cp node_modules/@coldtea/pr-lens-agent-skill/SKILL.md .cursor/rules/pr-lens.mdc
```

**Anything else** — point your agent's instructions file at `SKILL.md`. It is plain markdown with YAML frontmatter, and it assumes nothing beyond a shell and `npx`.

## What is in it

| | |
| --- | --- |
| `SKILL.md` | when to reach for PR Lens, and the write → validate → fix → render loop |
| `references/graph-document.md` | the document, field by field, and what the validator will catch |
| `references/config.md` | `.github/pr-lens.yml` corrections, with recipes |

The agent is usually the model. Rather than spending a provider key to describe a diff it already understands, it writes the document itself and lets `pr-lens validate` hold it to the contract — every failure is a path into the document, so the loop closes without a human in it.

## Why this exists

A coding agent that opens a pull request is asking a person to review code the person did not write. A diagram of what moved is the cheapest thing the agent can add to make that review possible.

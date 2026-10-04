# @coldtea/pr-lens-agent-skill

The PR Lens skill for coding agents. It teaches an agent to draw the change it just made: author a graph document from the diff, validate it against the contract, render it, attach it to the pull request, and to fix a repository's map by writing corrections rather than editing generated output.

MIT © Coldtea AI.

## Install it

```bash
npm install --save-dev @coldtea/pr-lens-agent-skill
```

**Claude Code**: copy it where skills live, per project or per user:

```bash
mkdir -p .claude/skills/pr-lens
cp node_modules/@coldtea/pr-lens-agent-skill/SKILL.md .claude/skills/pr-lens/
```

**Cursor**: the same file works as a rule:

```bash
mkdir -p .cursor/rules
cp node_modules/@coldtea/pr-lens-agent-skill/SKILL.md .cursor/rules/pr-lens.mdc
```

**Anything else**: point your agent's instructions file at `SKILL.md`. It is plain markdown with YAML frontmatter, and it assumes nothing beyond a shell and `npx`.

## What is in it

`SKILL.md` is short. It tells the agent when to use PR Lens, then sends it to the CLI for the full instructions:

```bash
npx @coldtea/pr-lens-cli@latest skill             # the write, validate, fix, render loop
npx @coldtea/pr-lens-cli@latest skill references  # the graph document, the config format, and an example
```

The CLI prints the instructions for its own version, so an old copy of `SKILL.md` never sends the agent to commands that have changed. Their source is `manual.md` and `references/`, in this folder of the repository.

The agent is usually the model. Rather than spending a provider key to describe a diff it already understands, it writes the document itself and lets `pr-lens validate` hold it to the contract. Every failure is a path into the document, so the loop closes without a human in it.

## Why this exists

A coding agent that opens a pull request is asking a person to review code the person did not write. A diagram of what moved is the cheapest thing the agent can add to make that review possible.

---

Part of [PR Lens](https://prlens.dev). Review what actually matters.

# PR Lens — Agent Instructions

Hard rules for anyone (human or agent) working in this repo. Read fully before writing code.

## Hard requirements

- **No secrets in this repo, ever.** This repo needs no credentials. Do not read `~/Documents/dev/pr-lens-secrets/`.
- **Verify before claiming done**: tests green, `pnpm build` + typecheck clean, and visual output verified in a real browser when the change affects rendered SVGs.
- **Pass user-facing words through the humanizer before shipping them.** Anything a person reads — comments, captions, tips, README prose, share pages, cards, terminal output — goes through the [humanizer skill](https://github.com/blader/humanizer/blob/main/SKILL.md) first. Copy that reads as machine-written spends trust the diagrams then have to earn back.

# General

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Preserve intentional blank lines between methods and logical blocks. Do not compact whitespace to reduce line count or satisfy a file-size target; restructure the code instead if length is a problem.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 5. Comment Sparingly

**Default to no comment. Code says WHAT; comments say WHY — and only when the WHY isn't obvious.**

- Don't narrate what the code does — the reader sees the `map`, the `switch`, the names. Restating them is noise.
- Comment only the non-obvious: a reason, a gotcha, a workaround, a constraint, a "looks wrong but isn't."
- If code needs a comment to be understood, first make the code clearer (rename, extract). Comment only what better code can't express.
- Delete comments that restate the adjacent line. One earned comment beats ten obvious ones.
- Every comment must earn its place: if you can't name what it tells the reader that the code doesn't, drop it.

# TypeScript quality — exhaustive, deterministic types

Quality software is built on types the compiler can enforce. These are non-negotiable in this codebase.

- **Closed sets use an exhaustive `switch` + `assertNever`.** For discriminated unions / enums, `switch` on the discriminant and end with `default: return assertNever(value)` so adding a variant fails to compile until every consumer handles it. Never use if/else-if chains for mutually-exclusive variants. When behavior depends on several related status checks, derive one closed decision/status type and switch over that — don't scatter conditionals through a method. Define `assertNever` once in the schema package's utils and import it everywhere:

  ```ts
  export const assertNever = (
    value: never,
    message = "Unhandled variant",
  ): never => {
    throw new Error(`${message}: ${JSON.stringify(value)}`);
  };
  ```

- **Use `type`, not `interface`.**
- **Discriminated unions for state** — every multi-shape value carries a `type`/`kind` discriminant. No optional-field soup where one shape is meant.
- **No type casting.** `as` is a bug until proven otherwise — narrow with `typeof`/discriminants/schema parsing instead. (`as const` and zod `.parse()` outputs are fine.)
- **Expected failures use typed domain errors** with a stable machine-readable `code` (SCREAMING_SNAKE_CASE) callers can switch on exhaustively. Concise messages, no terminal punctuation.
- **Deterministic ID/key formats have a single owner**: one named creation function per format (content-hash keys, R2 paths, comment markers). Never inline-format the same ID in two places.
- **Schema-first boundaries**: anything crossing a process/API boundary is zod-parsed at the edge; internal code trusts parsed types, never re-validates ad hoc.

# Repo specifics

- pnpm monorepo: `packages/schema` (the contract — everything else consumes it), `packages/renderer` (pure function, no I/O), `packages/cli`, `packages/action`, `packages/agent-skill`. MIT © Coldtea AI.
- The renderer must be deterministic: same graph in → byte-identical SVG out. Treat any nondeterminism (object iteration order, Date, random) as a bug.
- Rendered SVGs must remain GitHub-safe: SMIL/CSS animation only, no scripts, no external resources, self-contained.

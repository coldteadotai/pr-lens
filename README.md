# PR Lens

Review what actually matters. PR Lens renders a pull request as beautiful, animated diagrams **inside the GitHub pull request itself** — architecture blast radius and data-flow pipelines, not another findings table.

<img alt="A PR Lens bot comment in a pull request: stats chips, an architecture diagram of a tiny change, view-option checkboxes and the PR Lens footer" src="docs/showcase/teaser.comment.dark.svg">

<sub>This is what lands in your pull request — a bot comment, drawn here card and all. Green is new, amber changed, red gone, and the pulse is the data moving along the new path.</sub>

<img alt="The full PR Lens comment for the reference pull request: both lenses expanded, drill-down row, view options and footer" src="docs/showcase/reference.comment.dark.svg">

<sub>The reference pull request's complete comment — both lenses, real composer text. Every render ships as a dark/light pair; the live comment serves the pair behind a `<picture>` tag so each reader automatically sees the one matching their GitHub theme.</sub>

Two lenses ship: **architecture** (what this change touches, against the existing system) and **data flow** (the ordered pipeline, animated). Every diagram on this page was rendered by this repo's renderer from a JSON document in this repo — this page *is* the product demo.

## From one card to a monorepo

The renderer answers for every size of change with the same visual grammar: lanes, node cards, delta colours, and routes you can trace with the eye alone.

<img alt="A single-card diagram: the smallest change PR Lens draws" src="docs/showcase/tier1-minimal.architecture.dark.svg">

<sub>The smallest honest diagram — 1 lane · 1 node · 0 edges.</sub>

<img alt="A dense three-lane graph: every route stays traceable through corridors" src="docs/showcase/tier3-dense.architecture.dark.svg">

<sub>The dense synthetic — 3 lanes · 15 nodes · 19 edges. Crossings happen inside corridors and read as wiring, not spaghetti.</sub>

<details>
<summary><b>Tier 4 — a checkout flow</b> · 5 lanes · 21 nodes · 24 edges</summary>
<br>
<img alt="A five-lane checkout system with two dozen routed edges" src="docs/showcase/tier4-checkout.architecture.dark.svg">
</details>

<details>
<summary><b>Tier 5 — a monorepo</b> · 6 lanes · 37 nodes · 49 edges</summary>
<br>
<img alt="A six-lane monorepo graph: the largest tier the renderer answers for" src="docs/showcase/tier5-monorepo.architecture.dark.svg">
</details>

<sub>Collapsed tiers dogfood the same `<details>` drill-down pattern the PR comment uses.</sub>

## The data-flow lens

The ordered pipeline of the change, drawn in the same design system — participants are real node cards, labels are the same pills, colours are the same deltas. **The pulses are moving right now**: PR Lens diagrams are animated SVG, and the animation survives GitHub's image proxy — a hook no findings table has.

<img alt="The reference pull request's send pipeline as an animated sequence diagram" src="docs/showcase/reference.data-flow.dark.svg">

<sub>The reference pull request's send pipeline — 7 steps on one shared clock, pulses travelling in the order the steps happen.</sub>

<img alt="A sequence diagram mixing waited-on calls, fire-and-forget messages, returns and a self message" src="docs/showcase/mixed-kinds.data-flow.dark.svg">

<sub>Every message kind at once: a filled head waits for an answer, an open head is fire-and-forget, a dashed line *is* the answer — and only waited-on work lights an activation bar.</sub>

Every render above comes from a checked-in fixture — the [teaser](docs/showcase/teaser.ts), the [reference pull request](packages/schema/src/examples/postmark-refactor.ts), the [dense synthetic](packages/renderer/test/dense.ts), the [upper tiers](packages/renderer/test/fixtures), the [mixed-kinds flow](packages/renderer/test/mixed-kinds.ts) — regenerated deterministically by [`docs/showcase/render.mts`](docs/showcase/render.mts), and the comment mockups up top are framed by [`docs/showcase/frame.ts`](docs/showcase/frame.ts) around the same renders, with the composer's real text.

## Packages

| Package | What it is |
| --- | --- |
| [`packages/schema`](packages/schema) | `@coldtea/pr-lens-schema` — the contract every other component speaks |
| [`packages/renderer`](packages/renderer) | `@coldtea/pr-lens-renderer` — deterministic JSON graph → the animated, theme-paired SVGs on this page |
| [`packages/cli`](packages/cli) | `@coldtea/pr-lens-cli` — read a diff with your own model key, render it, compose the comment |
| [`packages/action`](packages/action) | the GitHub Action: analyze, publish, post one static comment |
| [`packages/agent-skill`](packages/agent-skill) | `@coldtea/pr-lens-agent-skill` — teaches a coding agent to draw the change it just made |

## Working in this repo

```bash
pnpm install
pnpm verify      # build, typecheck, test
```

Node 20.11+ and pnpm 10.

## End-to-end tests

The product's visual guarantees, written as plain-English end-to-end tests for future agent-driven QA: [`e2e.md`](e2e.md).

## License

MIT © Ohans Emmanuel.

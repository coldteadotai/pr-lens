# PR Lens

Review what actually matters. PR Lens renders a pull request as beautiful, animated diagrams **inside the GitHub pull request itself** — architecture blast radius and data-flow pipelines, not another findings table.

Two lenses ship: **architecture** (what this change touches, against the existing system) and **data flow** (the ordered pipeline, animated).

## Packages

| Package | What it is |
| --- | --- |
| [`packages/schema`](packages/schema) | `@coldtea/pr-lens-schema` — the contract every other component speaks |

## Working in this repo

```bash
pnpm install
pnpm verify      # build, typecheck, test
```

Node 20.11+ and pnpm 10.

## License

MIT © Ohans Emmanuel.

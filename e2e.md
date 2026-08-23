# TODO: end-to-end tests, in plain English

These are the visual guarantees this product makes. They are written here as English-language end-to-end tests, to be implemented later with agent-driven QA tooling. The infrastructure does not exist yet, and nothing here needs building today. Every one of them either shipped as a founding requirement or was earned by fixing a real regression; none may quietly break. The renderer's congestion behaviors have deeper, zoom-level specs in [`packages/renderer/test/e2e-specs.md`](packages/renderer/test/e2e-specs.md), which the entries below reference rather than repeat.

## In a real GitHub pull request

1. **The pulses move.** Open a PR that PR Lens has commented on: the animated dots travel along the data-flow edges inside the comment itself. (SMIL must survive GitHub's image proxy and the `<img>` context.)
2. **The drill-down actually renders.** Expand every `<details>` section in the comment: file links, code spans, and nested lists appear as rendered links and code, never as literal `- [path](url)` text. Must be checked through GitHub's own rendering at real nesting depth; a shallow probe passes while the real shape fails.
3. **The diagram matches the reader's theme.** View the comment in GitHub dark mode and light mode: the dark and light diagram variants appear respectively, and both are fully legible.
4. **One comment, always current.** Push to the PR repeatedly: there is only ever one PR Lens comment, updated in place, and the images always show the latest push, never a stale cached diagram.
5. **Checkboxes work without re-analysis.** Toggle a view-option checkbox: the comment re-renders within seconds from the stored graph, and toggling back restores the original view.
6. **A forged marker does nothing.** Post a human comment containing a copy of the sticky-comment state marker: PR Lens must never edit, delete, or honor that comment. Only the bot's own comment is ever touched.
7. **Model text cannot phish or ping.** Feed a PR whose code contains URLs, emails, and `@names` in identifiers and strings: none of them autolink, none become notifying mentions, and no label or summary can smuggle a clickable link into the comment.
8. **Permalinks land true.** Click a file link in the drill-down: it opens the exact lines at the analyzed commit, even after later pushes.
9. **The footer behaves.** The "Rendered by PR Lens" footer is present by default and absent when branding is disabled.

## The diagram's visual grammar

10. **The right line for the job.** On the reference graph: aligned neighbors are connected by dead-straight lines, and only routes that travel are curved. The curve set is exactly the known five (enqueue, batch size, the hero, the fan, the exiled dead path). A render where everything curves, or a neighbor's line bends, is broken.
11. **No crossings in open space.** No edge crosses another over the open canvas; where crossings must exist they happen inside corridors and read as wiring, not spaghetti.
12. **The dead path never touches the living graph.** Removed cards sit in their own band below everything alive; a dashed edge with one living end travels around the outside of the diagram, never through it; an edge between two removed cards stays inside the band.
13. **Stems are honest.** Where sibling edges share a trunk, it departs from one shared port, carries a single delta color, and fans out without any branch crossing another. A stem that braids at its junction is a regression.
14. **Arrivals are square.** Every edge meets its card perpendicular to the face it touches.
15. **Delta colors never lie.** Added is green, changed is amber, removed is red, dashed and ghosted. Each color holds uniformly along its stroke, never mixed, on every tier.
16. **Any flow is traceable.** On the dense and stress fixtures, pick any single edge and follow it end-to-end with the eye alone: it never merges into a neighbor or disappears under anything. (Zoom-level detail: renderer specs 1-3.)
17. **Labels are readable, owned, and complete.** Every labelled edge shows exactly one pill; no pill hides another; each pill visibly belongs to one line. (Renderer specs 1-2.)
18. **A name is only cut when the card is genuinely full.** Put a long node label on a card that shares its row: the whole name reads, set a step smaller if it must be, rather than losing its tail with card still empty beside it. A name is cut only once the smallest size it may be set at still overruns.

## Stability and self-containment

19. **Determinism is absolute.** Render the same graph twice: identical bytes. Rename a node: nothing else moves. Add one node: no card jumps, only small, proportionate shifts.
20. **Congestion handling never moves the uncongested.** The minimal fixture is pixel-identical across renderer changes; on the reference graph, cards never move and only crowded pills may shift, along their own lines. (Renderer spec 4.)
21. **The SVG stands alone.** No scripts, no external fonts or fetches, nothing clipped at the canvas edge, and the whole diagram, animation included, works when loaded through a plain `<img>` tag. (Renderer specs 5-6.)

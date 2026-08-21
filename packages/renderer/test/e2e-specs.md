# End-to-end regression specs — renderer congestion behavior

Plain-language specifications for browser-level end-to-end tests, to be implemented
with Coldtea's QA tooling. Each spec describes what a person (or QA agent) does in a
real browser and what they must see. The unit/golden suite already covers these
properties numerically; these specs exist to catch what only a rendered, zoomed,
human-scale view can catch — a label that is technically non-overlapping but
unreadable, a corridor whose lines blur together at real zoom.

The fixtures live in `test/fixtures/` (tier 4 and 5) and in code (`tier1` minimal
and `tier2` reference from `@coldtea/pr-lens-schema/examples`, `tier3` in
`test/dense.ts`). Render each with the architecture lens; every spec below applies
to both the dark and the light theme unless it says otherwise.

## 1. No label pill ever hides another

**Setup:** Render each of the five tiers and open the SVG in the browser at 100%.

**Check:** Every edge label in the source document is readable somewhere on the
canvas — its full text visible, not clipped, not covered by any other pill. Count
the pills: there must be exactly one per labelled edge, no duplicates, none missing.

**Known regression shapes (zoom into these):**
- Tier 5, the row gap below the `markdown` card: `index doc`, `write PDF`, and
  `revenue facts` must all three be individually readable. The historical defect
  hid the first two beneath the third.
- Tier 2 (reference), the vertical pair between `broadcastQueue` and
  `sendBroadcastBulk`: both `onWrite` and `write results` must be readable. They
  used to stack exactly on top of each other.
- Tier 4, around the `captureWorker` ↔ `orders` conversation: `order snapshot`,
  `quote tax`, `update status`, `post entry`, `PaymentIntent API`, `refund API`,
  and `capture` must each be readable and separate.

## 2. Every label sits with its own line

**Setup:** Same renders as spec 1.

**Check:** Pick each label and trace: the pill must visually belong to exactly one
line — sitting on the line, or squarely at the line's foot where it meets a card.
A reader must never have to guess between two candidate lines for one label. In
particular, on tier 5, the `codegen` pill must read as belonging to the short
vertical `schema` → `api-client` arrow.

## 3. Parallel lines stay individually traceable (the pitch floor)

**Setup:** Render tiers 3, 4, and 5; zoom into the busiest gap of each:
- Tier 3: the gutter left of the `Core` lane's card column.
- Tier 4: the corridor between the `WORKERS` and `DATA` lanes.
- Tier 5: the corridor left of the `SERVICES` lane and the row gaps below
  `docService` / `markdown`.

**Check:** At 100% zoom, every parallel line in the gap can be followed
individually from end to end — adjacent lines never merge into a band of color,
and there is visible background between any two neighbouring lines. (The layout
guarantees at least 10px between track centres; lines are 1.5–2.25px wide, so the
gap between strokes must be obvious, not marginal.)

## 4. Congestion never moves what isn't congested

**Setup:** Render tier 1 and tier 2 before and after any renderer change.

**Check:** Tier 1 (one card, no edges) must be pixel-identical across the change.
Tier 2 (the reference pull request) must keep every card in place; only pills in
a crowded cluster may shift, and only along their own line. If a change to
congestion handling moves a card, or moves a pill on an uncrowded diagram, that
is a regression even if everything is still readable.

## 5. The canvas contains everything

**Setup:** Render all five tiers, both themes.

**Check:** Nothing is clipped at any edge of the image — no line, arrowhead,
pill, or card touches or crosses the canvas border. Corridors widened for
traffic (tiers 3–5) must be fully inside the canvas, including the exile
corridor past the last lane.

## 6. The rendered SVG behaves on GitHub

**Setup:** Embed each rendered SVG in a plain HTML page (as GitHub would, via
`<img>`), and open it.

**Check:** The diagram renders completely; the pulse animations run (SMIL);
nothing requires scripts, external fonts, or network fetches; the browser console
shows no failed requests originating from the SVG.

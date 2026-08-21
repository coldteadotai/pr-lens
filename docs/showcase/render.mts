/**
 * Regenerates every diagram the README shows, straight from the fixtures the
 * test suite answers for. The renderer is deterministic, so running this on
 * an unchanged tree rewrites identical bytes — a diff here is a real change
 * to what the README shows, and deserves the same eye a golden gets.
 *
 *   pnpm tsx docs/showcase/render.mts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GraphDoc } from "../../packages/schema/src/index.js";
import { render, THEMES } from "../../packages/renderer/src/index.js";
import { tiers } from "../../packages/renderer/test/tiers.js";
import { mixedKindsGraph } from "../../packages/renderer/test/mixed-kinds.js";

const OUT = dirname(fileURLToPath(import.meta.url));
mkdirSync(OUT, { recursive: true });

const counts = (doc: GraphDoc): string =>
  `${doc.lanes.length} lanes · ${doc.nodes.length} nodes · ${doc.edges.length} edges`;

for (const { name, doc } of tiers) {
  for (const theme of THEMES)
    writeFileSync(join(OUT, `${name}.architecture.${theme}.svg`), render(doc, { lens: "architecture", theme }).svg);
  console.log(`${name}: ${counts(doc)}`);
}

const reference = tiers.find(({ name }) => name === "tier2-reference");
if (reference === undefined) throw new Error("the complexity ladder lost its reference tier");

for (const theme of THEMES) {
  writeFileSync(
    join(OUT, `reference.data-flow.${theme}.svg`),
    render(reference.doc, { lens: "data-flow", theme }).svg,
  );
  writeFileSync(
    join(OUT, `mixed-kinds.data-flow.${theme}.svg`),
    render(mixedKindsGraph, { lens: "data-flow", theme }).svg,
  );
}
console.log(`reference flow: ${reference.doc.flows[0]?.messages.length ?? 0} messages`);
console.log(`mixed kinds: ${mixedKindsGraph.flows[0]?.messages.length ?? 0} messages`);

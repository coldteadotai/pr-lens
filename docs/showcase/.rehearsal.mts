import { writeFileSync } from "node:fs";
import { parseGraphDoc } from "@coldtea/pr-lens-schema";
import { minimalGraph } from "@coldtea/pr-lens-schema/examples";
import { render } from "@coldtea/pr-lens-renderer";

const node = (id: string, label: string, delta: string) => ({
  id, label, kind: "service", delta, lane: "api", files: [], badges: [],
});

const doc = parseGraphDoc({
  ...minimalGraph,
  title: "The rehearsal label",
  nodes: [
    node("cancellations", "Cancellations Service", "modified"),
    node("billing", "Billing", "added"),
    node("long", "Cancellations and Refunds Reconciliation Service", "unchanged"),
    node("search", "Search", "unchanged"),
  ],
});

for (const theme of ["light", "dark"] as const) {
  const { svg } = render(doc, { lens: "architecture", theme });
  writeFileSync(`${process.argv[2]}/rehearsal.${theme}.svg`, svg);
  console.log(theme, svg.match(/class="ntitle"[^>]*>([^<]*)</g));
}

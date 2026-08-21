import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GraphDoc } from "@coldtea/pr-lens-schema";
import { parseGraphDoc } from "@coldtea/pr-lens-schema";
import { minimalGraph, postmarkRefactorGraph } from "@coldtea/pr-lens-schema/examples";
import { denseGraph } from "./dense.js";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

const fixture = (name: string): GraphDoc =>
  parseGraphDoc(JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")));

/**
 * The complexity ladder: every graph the renderer answers for, from a single
 * card to a six-lane monorepo. Congestion only bites on the upper tiers, but
 * whatever relieves it is held to account on all five.
 */
export const tiers: readonly { name: string; doc: GraphDoc }[] = [
  { name: "tier1-minimal", doc: minimalGraph },
  { name: "tier2-reference", doc: postmarkRefactorGraph },
  { name: "tier3-dense", doc: denseGraph },
  { name: "tier4-checkout", doc: fixture("tier4-checkout.json") },
  { name: "tier5-monorepo", doc: fixture("tier5-monorepo.json") },
];

import type { GraphDoc } from "@coldtea/pr-lens-schema";
import {
  billingOrgGraph,
  broadcastBaselineGraph,
  minimalGraph,
  payloadGraph,
  postmarkRefactorGraph,
} from "@coldtea/pr-lens-schema/examples";
import { cjkGraph } from "./cjk.js";
import { mixedKindsGraph } from "./mixed-kinds.js";
import { oneStoreGraph } from "./one-store.js";
import { tallTablesGraph } from "./tall-tables.js";
import { tenantsGraph } from "./tenants.js";
import { fixture, tiers } from "./tiers.js";
import { twoStoresGraph } from "./two-stores.js";

/** Every document in the repo. */
export const corpus: readonly { name: string; doc: GraphDoc }[] = [
  ...tiers,
  { name: "postmark-refactor", doc: postmarkRefactorGraph },
  { name: "billing-org", doc: billingOrgGraph },
  { name: "minimal", doc: minimalGraph },
  { name: "broadcast-baseline", doc: broadcastBaselineGraph },
  { name: "payload", doc: payloadGraph },
  { name: "cjk", doc: cjkGraph },
  { name: "mixed-kinds", doc: mixedKindsGraph },
  { name: "one-store", doc: oneStoreGraph },
  { name: "two-stores", doc: twoStoresGraph },
  { name: "tall-tables", doc: tallTablesGraph },
  { name: "tenants", doc: tenantsGraph },
  ...["label-clearance", "short-connection", "removed-route", "pr-124.graph", "stacked-columns"].map((name) => ({ name, doc: fixture(`${name}.json`) })),
];

import type { GraphDocInput } from "../graph.js";
import { SCHEMA_VERSION } from "../version.js";

/** The smallest document that validates: one lane, one node, one lens. */
export const minimalGraphInput: GraphDocInput = {
  schemaVersion: SCHEMA_VERSION,
  kind: "graph",
  title: "Touch the health check",
  lenses: ["architecture"],
  provenance: {
    repo: { owner: "coldteadotai", name: "pr-lens" },
    base: { sha: "1111111" },
    head: { sha: "2222222" },
  },
  lanes: [{ id: "api", label: "API" }],
  nodes: [
    {
      id: "health-route",
      label: "GET /health",
      kind: "route",
      delta: "modified",
      lane: "api",
      files: [{ path: "src/routes/health.ts" }],
    },
  ],
};

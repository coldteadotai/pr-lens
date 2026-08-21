import type { GraphDoc } from "../../packages/schema/src/index.js";
import { parseGraphDoc, SCHEMA_VERSION } from "../../packages/schema/src/index.js";

/**
 * The README's opening diagram: a pull request a visitor grasps in two
 * seconds that still shows the whole grammar — all three delta colours, one
 * animated hero path, one ghosted removal in the dead band. Deliberately
 * generic; the reference fixture below it carries the realistic detail.
 */
export const teaserGraph: GraphDoc = parseGraphDoc({
  schemaVersion: SCHEMA_VERSION,
  kind: "graph",
  title: "Add a welcome email on signup",
  summary: "A new welcome service replaces the inline legacy mailer.",
  lenses: ["architecture"],
  provenance: {
    repo: { owner: "acme", name: "webapp" },
    base: { sha: "0000000" },
    head: { sha: "1111111" },
  },
  lanes: [
    { id: "api", label: "API", order: 0 },
    { id: "services", label: "Services", order: 1 },
    { id: "data", label: "Data", order: 2 },
  ],
  nodes: [
    {
      id: "signup-route",
      label: "POST /signup",
      kind: "route",
      delta: "modified",
      lane: "api",
    },
    {
      id: "welcome-service",
      label: "welcome-service",
      kind: "service",
      delta: "added",
      lane: "services",
      subtitle: "queue worker",
    },
    {
      id: "legacy-mailer",
      label: "legacy-mailer",
      kind: "service",
      delta: "removed",
      lane: "services",
    },
    {
      id: "user-store",
      label: "user store",
      kind: "datastore",
      delta: "unchanged",
      lane: "data",
    },
  ],
  edges: [
    {
      id: "signup-to-welcome",
      from: "signup-route",
      to: "welcome-service",
      kind: "event",
      delta: "added",
      emphasis: "hero",
      animated: true,
      label: "signup event",
    },
    {
      id: "welcome-to-store",
      from: "welcome-service",
      to: "user-store",
      kind: "data",
      delta: "added",
      label: "load profile",
    },
    {
      id: "signup-to-legacy",
      from: "signup-route",
      to: "legacy-mailer",
      kind: "call",
      delta: "removed",
      label: "send inline",
    },
  ],
});

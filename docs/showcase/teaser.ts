import type { GraphDoc } from "../../packages/schema/src/index.js";
import { parseGraphDoc, SCHEMA_VERSION } from "../../packages/schema/src/index.js";

/**
 * The README's opening diagram: a pull request a visitor grasps in two
 * seconds that still shows the whole grammar — all three delta colours, the
 * new path animated end to end, one ghosted removal in the dead band, and an
 * unchanged neighbour to measure the change against.
 *
 * The four added edges chain left to right (route → queue → worker → stores),
 * so a reader's eye is carried along the path the change introduced rather
 * than to four unrelated pulses. Deliberately generic; the reference fixture
 * below it carries the realistic detail.
 */
export const teaserGraph: GraphDoc = parseGraphDoc({
  schemaVersion: SCHEMA_VERSION,
  kind: "graph",
  title: "Add a welcome email on signup",
  summary: "Signup now publishes an event; a new welcome worker drains it and retires the inline mailer.",
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
      files: [{ path: "app/api/signup/route.ts" }],
    },
    {
      id: "email-queue",
      label: "email-queue",
      kind: "queue",
      delta: "added",
      lane: "services",
      subtitle: "signup.welcome",
      files: [{ path: "infra/queues/email.ts" }],
    },
    {
      id: "welcome-service",
      label: "welcome-service",
      kind: "service",
      delta: "added",
      lane: "services",
      subtitle: "queue worker",
      files: [{ path: "services/welcome/worker.ts" }],
    },
    {
      id: "legacy-mailer",
      label: "legacy-mailer",
      kind: "service",
      delta: "removed",
      lane: "services",
      files: [{ path: "services/legacy-mailer.ts" }],
    },
    {
      id: "user-store",
      label: "user store",
      kind: "datastore",
      delta: "unchanged",
      lane: "data",
    },
    {
      id: "email-log",
      label: "email log",
      kind: "datastore",
      delta: "added",
      lane: "data",
      files: [{ path: "services/welcome/log.ts" }],
    },
  ],
  edges: [
    {
      id: "signup-to-queue",
      from: "signup-route",
      to: "email-queue",
      kind: "event",
      delta: "added",
      emphasis: "hero",
      animated: true,
      label: "signup event",
    },
    {
      id: "queue-to-welcome",
      from: "email-queue",
      to: "welcome-service",
      kind: "queue",
      delta: "added",
      animated: true,
      label: "welcome job",
    },
    {
      id: "welcome-to-store",
      from: "welcome-service",
      to: "user-store",
      kind: "data",
      delta: "added",
      animated: true,
      label: "load profile",
    },
    {
      id: "welcome-to-log",
      from: "welcome-service",
      to: "email-log",
      kind: "data",
      delta: "added",
      animated: true,
      label: "record send",
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

import type { GraphDocInput } from "../graph.js";
import type { PatchDocInput } from "../patch.js";
import { SCHEMA_VERSION } from "../version.js";

const BASE_SHA = "3f5c1ab9d24e7f08c6b1a5d3e9074c2b8a6f1d40";
const HEAD_SHA = "b71e0d4c8a92f5361de7c0b4a8f2593d6c1e8a77";

/**
 * The stored baseline map for the broadcast subsystem as `main` stood before
 * the refactor. A map describes a system rather than a change, so everything
 * in it is `unchanged` and its provenance names the single commit it reflects.
 */
export const broadcastBaselineGraphInput: GraphDocInput = {
  schemaVersion: SCHEMA_VERSION,
  kind: "graph",
  id: "bestregards-broadcast-baseline",
  generatedAt: "2026-08-12T09:02:00.000Z",
  title: "Broadcast sending",
  summary: "How a broadcast reaches its recipients: queued from the web app, sent one message at a time by a Firestore trigger.",
  lenses: ["architecture", "data-flow"],
  provenance: {
    repo: { owner: "ohansemmanuel", name: "bestregards", host: "github.com" },
    base: { sha: BASE_SHA, ref: "main" },
    head: { sha: BASE_SHA, ref: "main" },
    generator: { name: "pr-lens-examples", version: "0.1.0" },
  },
  lanes: [
    { id: "web", label: "Next.js", subtitle: "Vercel", order: 0 },
    { id: "functions", label: "Cloud Functions", subtitle: "Firebase", order: 1 },
    { id: "external", label: "External", subtitle: "Postmark", order: 2 },
  ],
  nodes: [
    {
      id: "broadcast-composer",
      label: "Broadcast composer",
      kind: "ui",
      delta: "unchanged",
      lane: "web",
      subtitle: "app/broadcasts/new",
      files: [{ path: "app/broadcasts/new/page.tsx" }],
    },
    {
      id: "queue-route",
      label: "POST /api/broadcasts/queue",
      kind: "route",
      delta: "unchanged",
      lane: "web",
      files: [{ path: "app/api/broadcasts/queue/route.ts" }],
    },
    {
      id: "broadcast-queue",
      label: "broadcastQueue",
      kind: "datastore",
      delta: "unchanged",
      lane: "functions",
      subtitle: "Firestore collection",
      files: [{ path: "functions/src/broadcast/schema.ts" }],
    },
    {
      id: "process-broadcast",
      label: "processBroadcast",
      kind: "function",
      delta: "unchanged",
      lane: "functions",
      subtitle: "onWrite trigger",
      summary: "Walks the recipient list and sends one message at a time.",
      files: [{ path: "functions/src/broadcast/processBroadcast.ts" }],
    },
    {
      id: "send-single-email",
      label: "sendSingleEmail",
      kind: "function",
      delta: "unchanged",
      lane: "functions",
      files: [{ path: "functions/src/broadcast/sendSingleEmail.ts" }],
    },
    {
      id: "postmark",
      label: "Postmark",
      kind: "external",
      delta: "unchanged",
      lane: "external",
      subtitle: "Email API",
    },
  ],
  edges: [
    {
      id: "composer-to-queue",
      from: "broadcast-composer",
      to: "queue-route",
      kind: "http",
      delta: "unchanged",
      label: "send broadcast",
    },
    {
      id: "queue-to-firestore",
      from: "queue-route",
      to: "broadcast-queue",
      kind: "data",
      delta: "unchanged",
      label: "enqueue job",
    },
    {
      id: "firestore-to-process",
      from: "broadcast-queue",
      to: "process-broadcast",
      kind: "event",
      delta: "unchanged",
      label: "onWrite",
    },
    {
      id: "process-to-single",
      from: "process-broadcast",
      to: "send-single-email",
      kind: "call",
      delta: "unchanged",
      label: "per recipient",
    },
    {
      id: "single-to-postmark",
      from: "send-single-email",
      to: "postmark",
      kind: "http",
      delta: "unchanged",
      label: "POST /email · 1 msg/call",
    },
  ],
  flows: [
    {
      id: "send-pipeline",
      title: "Sending a broadcast",
      delta: "unchanged",
      participants: [
        { node: "queue-route", label: "queue route" },
        { node: "broadcast-queue", label: "Firestore" },
        { node: "process-broadcast", label: "processBroadcast" },
        { node: "postmark", label: "Postmark" },
      ],
      messages: [
        {
          id: "enqueue",
          from: "queue-route",
          to: "broadcast-queue",
          label: "enqueue broadcast job",
          kind: "async",
          delta: "unchanged",
        },
        {
          id: "trigger",
          from: "broadcast-queue",
          to: "process-broadcast",
          label: "onWrite trigger",
          kind: "async",
          delta: "unchanged",
        },
        {
          id: "single-post",
          from: "process-broadcast",
          to: "postmark",
          label: "POST /email",
          kind: "sync",
          delta: "unchanged",
          repeat: 2000,
          note: "One request per recipient.",
        },
        {
          id: "single-result",
          from: "postmark",
          to: "process-broadcast",
          label: "message id",
          kind: "return",
          delta: "unchanged",
        },
        {
          id: "write-result",
          from: "process-broadcast",
          to: "broadcast-queue",
          label: "write result",
          kind: "async",
          delta: "unchanged",
          repeat: 2000,
        },
      ],
    },
  ],
  views: [
    {
      id: "overview",
      title: "Broadcast sending",
      lens: "architecture",
      defaultOpen: true,
      scope: { kind: "all" },
    },
  ],
  layout: { direction: "right", laneOrder: ["web", "functions", "external"] },
};

/**
 * The refactor folded back into the baseline map, which is what happens once
 * the pull request merges: the batch path joins the map as ordinary
 * `unchanged` structure, and the single-send path leaves it.
 *
 * The old flow is removed before its participants are, so the removal is a
 * deliberate replacement rather than a side effect of cascade.
 */
export const broadcastBaselinePatchInput: PatchDocInput = {
  schemaVersion: SCHEMA_VERSION,
  kind: "patch",
  generatedAt: "2026-08-19T18:31:00.000Z",
  summary: "Fold the batch send path into the baseline map and retire the single-send path.",
  target: {
    graphId: "bestregards-broadcast-baseline",
    fromSha: BASE_SHA,
    toSha: HEAD_SHA,
  },
  ops: [
    {
      op: "add_node",
      node: {
        id: "send-broadcast-bulk",
        label: "sendBroadcastBulk",
        kind: "function",
        delta: "unchanged",
        lane: "functions",
        subtitle: "onWrite trigger",
        summary: "Fetches suppressions once, then posts batched payloads of 500 to Postmark.",
        files: [{ path: "functions/src/broadcast/sendBroadcastBulk.ts" }],
      },
    },
    {
      op: "add_node",
      node: {
        id: "build-bulk-payload",
        label: "buildBulkPayload",
        kind: "function",
        delta: "unchanged",
        lane: "functions",
        files: [{ path: "packages/broadcast-lib/src/buildBulkPayload.ts" }],
      },
    },
    {
      op: "add_node",
      node: {
        id: "get-suppressed-emails",
        label: "getSuppressedEmails",
        kind: "function",
        delta: "unchanged",
        lane: "functions",
        files: [{ path: "packages/broadcast-lib/src/getSuppressedEmails.ts" }],
      },
    },
    {
      op: "add_node",
      node: {
        id: "broadcast-lib",
        label: "broadcast-lib",
        kind: "package",
        delta: "unchanged",
        lane: "functions",
        subtitle: "packages/broadcast-lib",
        files: [{ path: "packages/broadcast-lib/src/index.ts" }],
      },
    },
    {
      op: "add_edge",
      edge: {
        id: "firestore-to-bulk",
        from: "broadcast-queue",
        to: "send-broadcast-bulk",
        kind: "event",
        delta: "unchanged",
        label: "onWrite",
      },
    },
    {
      op: "add_edge",
      edge: {
        id: "bulk-to-payload",
        from: "send-broadcast-bulk",
        to: "build-bulk-payload",
        kind: "call",
        delta: "unchanged",
      },
    },
    {
      op: "add_edge",
      edge: {
        id: "bulk-to-suppressions",
        from: "send-broadcast-bulk",
        to: "get-suppressed-emails",
        kind: "call",
        delta: "unchanged",
      },
    },
    {
      op: "add_edge",
      edge: {
        id: "bulk-to-lib",
        from: "send-broadcast-bulk",
        to: "broadcast-lib",
        kind: "dependency",
        delta: "unchanged",
      },
    },
    {
      op: "add_edge",
      edge: {
        id: "queue-to-lib",
        from: "queue-route",
        to: "broadcast-lib",
        kind: "dependency",
        delta: "unchanged",
        label: "batch size",
      },
    },
    {
      op: "add_edge",
      edge: {
        id: "suppressions-to-postmark",
        from: "get-suppressed-emails",
        to: "postmark",
        kind: "http",
        delta: "unchanged",
        label: "GET suppression dump",
      },
    },
    {
      op: "add_edge",
      edge: {
        id: "bulk-to-postmark",
        from: "send-broadcast-bulk",
        to: "postmark",
        kind: "http",
        delta: "unchanged",
        label: "500 msgs/call",
      },
    },
    {
      op: "add_edge",
      edge: {
        id: "bulk-to-firestore",
        from: "send-broadcast-bulk",
        to: "broadcast-queue",
        kind: "data",
        delta: "unchanged",
        label: "write results",
      },
    },
    { op: "remove_flow", id: "send-pipeline" },
    { op: "remove_node", id: "process-broadcast" },
    { op: "remove_node", id: "send-single-email" },
    {
      op: "update_node",
      id: "broadcast-queue",
      patch: {
        summary: "Queue documents carry the batch size and suppressed count the sender works from.",
      },
    },
    {
      op: "add_flow",
      flow: {
        id: "send-pipeline",
        title: "Sending a broadcast",
        delta: "unchanged",
        participants: [
          { node: "queue-route", label: "queue route" },
          { node: "broadcast-queue", label: "Firestore" },
          { node: "send-broadcast-bulk", label: "sendBroadcastBulk" },
          { node: "postmark", label: "Postmark" },
        ],
        messages: [
          {
            id: "enqueue",
            from: "queue-route",
            to: "broadcast-queue",
            label: "enqueue broadcast job",
            kind: "async",
            delta: "unchanged",
          },
          {
            id: "trigger",
            from: "broadcast-queue",
            to: "send-broadcast-bulk",
            label: "onWrite trigger",
            kind: "async",
            delta: "unchanged",
          },
          {
            id: "suppressions-request",
            from: "send-broadcast-bulk",
            to: "postmark",
            label: "GET suppression dump",
            kind: "sync",
            delta: "unchanged",
          },
          {
            id: "suppressions-response",
            from: "postmark",
            to: "send-broadcast-bulk",
            label: "suppressed addresses",
            kind: "return",
            delta: "unchanged",
          },
          {
            id: "batch-post",
            from: "send-broadcast-bulk",
            to: "postmark",
            label: "POST /email/batch · 500 msgs",
            kind: "sync",
            delta: "unchanged",
            repeat: 4,
          },
          {
            id: "batch-results",
            from: "postmark",
            to: "send-broadcast-bulk",
            label: "per-message results",
            kind: "return",
            delta: "unchanged",
          },
          {
            id: "write-results",
            from: "send-broadcast-bulk",
            to: "broadcast-queue",
            label: "write results",
            kind: "async",
            delta: "unchanged",
          },
        ],
      },
    },
    {
      op: "set_stats",
      stats: { chips: [{ label: "Batch size", value: "500", tone: "neutral" }] },
    },
  ],
};

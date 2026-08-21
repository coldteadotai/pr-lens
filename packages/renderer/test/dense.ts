import type { GraphDoc } from "@coldtea/pr-lens-schema";
import { parseGraphDoc } from "@coldtea/pr-lens-schema";

/**
 * The dense synthetic: the graph that makes routing failures visible, which
 * the reference pull request alone never does. It packs one lane with eight
 * living cards, sends three long intra-lane routes through the same gutter so
 * their jogs must cross, points one edge back up the page, skips a lane
 * entirely, and retires a two-card subsystem whose three removed edges are
 * the three cases of the exile rule — dead→dead is the one that must stay
 * inside the dead band rather than leave the graph.
 */
export const denseGraph: GraphDoc = parseGraphDoc({
  schemaVersion: "0.1.0",
  kind: "graph",
  title: "Dense synthetic",
  summary: "A synthetic change dense enough to exercise every routing rule.",
  lenses: ["architecture"],
  provenance: {
    repo: { owner: "coldteadotai", name: "pr-lens" },
    base: { sha: "aaaaaaa" },
    head: { sha: "bbbbbbb" },
  },
  lanes: [
    { id: "ui", label: "UI", order: 0 },
    { id: "core", label: "Core", order: 1 },
    { id: "infra", label: "Infra", order: 2 },
  ],
  nodes: [
    { id: "dashboard", label: "Dashboard", kind: "ui", delta: "unchanged", lane: "ui" },
    { id: "settings", label: "Settings panel", kind: "ui", delta: "modified", lane: "ui" },
    { id: "gateway", label: "POST /api/plans", kind: "route", delta: "modified", lane: "core" },
    { id: "auth", label: "authorize", kind: "function", delta: "unchanged", lane: "core" },
    { id: "planner", label: "buildPlan", kind: "function", delta: "added", lane: "core" },
    { id: "scheduler", label: "schedulePlan", kind: "function", delta: "added", lane: "core", subtitle: "cron trigger" },
    { id: "executor", label: "executePlan", kind: "function", delta: "modified", lane: "core" },
    { id: "metrics", label: "recordMetrics", kind: "function", delta: "unchanged", lane: "core" },
    { id: "batcher", label: "batchResults", kind: "function", delta: "added", lane: "core", group: "output" },
    { id: "audit", label: "auditTrail", kind: "function", delta: "added", lane: "core", group: "output" },
    { id: "store", label: "planStore", kind: "datastore", delta: "modified", lane: "core", subtitle: "results table" },
    { id: "legacy-poller", label: "legacyPoller", kind: "job", delta: "removed", lane: "core" },
    { id: "poll-queue", label: "pollQueue", kind: "queue", delta: "removed", lane: "core" },
    { id: "postgres", label: "Postgres", kind: "datastore", delta: "modified", lane: "infra" },
    { id: "blobs", label: "Object storage", kind: "external", delta: "unchanged", lane: "infra" },
  ],
  edges: [
    { id: "dashboard-to-gateway", from: "dashboard", to: "gateway", kind: "http", delta: "unchanged", label: "save plan" },
    { id: "gateway-to-auth", from: "gateway", to: "auth", kind: "call", delta: "unchanged" },
    { id: "auth-to-planner", from: "auth", to: "planner", kind: "call", delta: "added" },
    { id: "planner-to-scheduler", from: "planner", to: "scheduler", kind: "call", delta: "added" },
    { id: "scheduler-to-executor", from: "scheduler", to: "executor", kind: "call", delta: "added" },
    { id: "scheduler-to-metrics", from: "scheduler", to: "metrics", kind: "call", delta: "added" },
    { id: "executor-to-batcher", from: "executor", to: "batcher", kind: "call", delta: "added", label: "collect" },
    { id: "executor-to-audit", from: "executor", to: "audit", kind: "call", delta: "added" },
    { id: "batcher-to-store", from: "batcher", to: "store", kind: "data", delta: "added" },
    { id: "gateway-to-batcher", from: "gateway", to: "batcher", kind: "call", delta: "added", label: "fast path", emphasis: "hero", animated: true },
    { id: "auth-to-metrics", from: "auth", to: "metrics", kind: "call", delta: "modified", label: "emit stats" },
    { id: "planner-to-store", from: "planner", to: "store", kind: "data", delta: "added", label: "persist plan" },
    { id: "store-to-gateway", from: "store", to: "gateway", kind: "data", delta: "modified", label: "backpressure" },
    { id: "settings-to-blobs", from: "settings", to: "blobs", kind: "http", delta: "added", label: "upload avatar" },
    { id: "store-to-postgres", from: "store", to: "postgres", kind: "data", delta: "modified", label: "write rows" },
    { id: "postgres-to-store", from: "postgres", to: "store", kind: "data", delta: "modified", label: "row count" },
    { id: "poller-to-queue", from: "legacy-poller", to: "poll-queue", kind: "queue", delta: "removed", label: "drain" },
    { id: "gateway-to-poller", from: "gateway", to: "legacy-poller", kind: "event", delta: "removed", label: "poll tick" },
    { id: "queue-to-blobs", from: "poll-queue", to: "blobs", kind: "http", delta: "removed", label: "flush blobs" },
  ],
});

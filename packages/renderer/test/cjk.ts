import type { GraphDoc } from "@coldtea/pr-lens-schema";
import { parseGraphDoc, SCHEMA_VERSION } from "@coldtea/pr-lens-schema";

/**
 * Labels in the three scripts whose glyphs take a full em: Hangul, Japanese
 * kana, and Han. Latin labels sit beside them so a golden that only moved
 * because the whole layout shifted is told apart from one where the wide
 * measurements changed.
 *
 * The edge and message labels are long on purpose. A label's plate is drawn
 * to its measured width, so a script measured at the narrow fallback is
 * covered by a plate too small for it, and the line beneath runs through the
 * text. That is what this golden holds still.
 */
export const cjkGraph: GraphDoc = parseGraphDoc({
  schemaVersion: SCHEMA_VERSION,
  kind: "graph",
  title: "알림 발송을 대기열로 옮기기",
  summary: "발송 API가 게이트웨이를 직접 부르던 것을 대기열에 넣는 것으로 바꿉니다.",
  lenses: ["architecture", "data-flow"],
  provenance: {
    repo: { owner: "coldteadotai", name: "pr-lens" },
    base: { sha: "1111111" },
    head: { sha: "2222222" },
  },
  lanes: [
    { id: "app", label: "앱", subtitle: "アプリ", order: 0 },
    { id: "workers", label: "워커", subtitle: "workers", order: 1 },
  ],
  nodes: [
    {
      id: "route",
      label: "알림 발송 API",
      kind: "route",
      delta: "modified",
      lane: "app",
      subtitle: "createNotification",
      files: [{ path: "src/routes/notify.ts" }],
    },
    {
      id: "queue",
      label: "通知キュー",
      kind: "queue",
      delta: "added",
      lane: "workers",
      subtitle: "notification-jobs",
    },
    {
      id: "store",
      label: "发送记录",
      kind: "datastore",
      delta: "added",
      lane: "workers",
      subtitle: "delivery_log",
    },
    {
      id: "gateway",
      label: "delivery gateway",
      kind: "external",
      delta: "unchanged",
      lane: "workers",
    },
  ],
  edges: [
    {
      id: "route-queue",
      from: "route",
      to: "queue",
      kind: "queue",
      delta: "added",
      label: "발송 작업 하나를 대기열에 넣습니다",
      emphasis: "hero",
      animated: true,
    },
    {
      id: "queue-store",
      from: "queue",
      to: "store",
      kind: "data",
      delta: "added",
      label: "送信記録を一件書き込みます",
    },
    {
      id: "store-gateway",
      from: "store",
      to: "gateway",
      kind: "http",
      delta: "unchanged",
      label: "hands the record to the gateway",
    },
  ],
  flows: [
    {
      id: "notify",
      title: "발송 순서",
      delta: "modified",
      participants: [
        { node: "route" },
        { node: "queue" },
        { node: "store" },
        { node: "gateway" },
      ],
      messages: [
        {
          id: "enqueue",
          from: "route",
          to: "queue",
          label: "발송 작업 하나를 대기열에 넣습니다",
          kind: "async",
          delta: "added",
        },
        {
          id: "record",
          from: "queue",
          to: "store",
          label: "送信記録を一件書き込みます",
          kind: "sync",
          delta: "added",
        },
        {
          id: "handoff",
          from: "store",
          to: "gateway",
          label: "把这条记录发送给网关",
          kind: "sync",
          delta: "unchanged",
        },
        {
          id: "result",
          from: "gateway",
          to: "store",
          label: "delivery result comes back",
          kind: "return",
          delta: "unchanged",
        },
      ],
    },
  ],
});

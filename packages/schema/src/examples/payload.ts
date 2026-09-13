import type { GraphDocInput, PayloadInput } from "../graph.js";
import { postmarkRefactorGraphInput } from "./postmark-refactor.js";

const email = {
  From: "news@example.com",
  To: "ada@example.com",
  Subject: "The batching issue, fixed",
  HtmlBody: "<!doctype html><html><body>…",
  TextBody: "…",
  Tag: "broadcast-2026-09",
  MessageStream: "broadcast",
  TrackOpens: true,
  Headers: [{ Name: "List-Unsubscribe", Value: "<https://example.com/u/…>" }],
  Metadata: { campaignId: "cmp_0001", batchId: "b_0001", listId: "lst_0001" },
};

const emailBefore = {
  From: "news@example.com",
  To: "ada@example.com",
  Cc: "ops@example.com",
  Subject: "The batching issue, fixed",
  HtmlBody: "<!doctype html><html><body>…",
  TextBody: "…",
  Tag: "weekly",
  TrackOpens: true,
  Headers: [{ Name: "List-Unsubscribe", Value: "<https://example.com/u/…>" }],
  Metadata: { campaignId: "cmp_0001", listId: "lst_0001" },
};

const sendResult = {
  ErrorCode: 0,
  Message: "OK",
  To: "ada@example.com",
  SubmittedAt: "2026-09-12T09:00:04.112Z",
  MessageID: "b7fa5c1e-…",
};

const jobResult = {
  status: "sent",
  sentCount: 1984,
  failedCount: 0,
  results: [sendResult],
  finishedAt: "2026-09-12T09:00:19Z",
};

/** The suppression answer is left bare on purpose: a step may say nothing about what it moves. */
const payloads: Record<string, PayloadInput> = {
  enqueue: {
    request: {
      type: "BroadcastJob",
      shape:
        '{\n  campaignId: string;\n  listId: string;\n  subject: string;\n  htmlBody: string;\n  textBody?: string;\n  scheduledFor: string; // ISO 8601\n  status: "queued" | "sending" | "sent";\n  batchSize: number;\n  recipientCount: number;\n}',
      sample: {
        campaignId: "cmp_0001",
        listId: "lst_weekly",
        subject: "The batching issue, fixed",
        htmlBody: "<html>…",
        textBody: "…",
        scheduledFor: "2026-09-12T09:00:00Z",
        status: "queued",
        batchSize: 500,
        recipientCount: 1984,
      },
      before: {
        campaignId: "cmp_0001",
        listId: "lst_weekly",
        subject: "The batching issue, fixed",
        htmlBody: "<html>…",
        textBody: "…",
        scheduledFor: "2026-09-12T09:00:00Z",
        status: "queued",
      },
      source: { path: "tests/fixtures/broadcast-job.json" },
    },
    response: {
      type: "WriteResult",
      shape: "{ writeTime: Timestamp }",
      sample: { writeTime: "2026-09-12T08:59:58.301Z" },
    },
  },
  trigger: {
    request: {
      type: "Change<BroadcastJob>",
      shape: "{ before: BroadcastJob | null; after: BroadcastJob; params: { jobId: string } }",
      sample: {
        before: null,
        after: { campaignId: "cmp_0001", status: "queued", batchSize: 500, recipientCount: 1984 },
        params: { jobId: "job_0001" },
      },
      source: { path: "functions/src/broadcast/sendBroadcastBulk.test.ts", startLine: 12, endLine: 40 },
    },
    response: { type: "void" },
  },
  "suppressions-request": {
    request: {
      type: "SuppressionQuery",
      shape:
        '{ SuppressionReason?: "HardBounce" | "SpamComplaint" | "ManualSuppression"; Origin?: string; EmailAddress?: string }',
      sample: { SuppressionReason: "HardBounce", Origin: "Recipient" },
      source: { path: "packages/broadcast-lib/src/postmark.ts", startLine: 40 },
    },
    response: {
      type: "SuppressionDump[312]",
      shape:
        "{ Suppressions: Suppression[] }\nSuppression = { EmailAddress: string; SuppressionReason: string; Origin: string; CreatedAt: string }",
      sample: {
        Suppressions: [
          {
            EmailAddress: "bounced@example.com",
            SuppressionReason: "HardBounce",
            Origin: "Recipient",
            CreatedAt: "2026-08-30T11:14:02Z",
          },
        ],
      },
    },
  },
  "batch-post": {
    request: {
      type: "EmailBatch[500]",
      shape:
        'EmailBatch = Email[]  // max 500\nEmail = {\n  From: string; To: string; Subject: string;\n  HtmlBody: string; TextBody?: string; Tag?: string;\n  MessageStream: "broadcast";\n  TrackOpens: boolean;\n  Headers: { Name: string; Value: string }[];\n  Metadata: { campaignId: string; batchId: string; listId: string };\n}',
      sample: [email],
      before: [emailBefore],
      source: { path: "tests/fixtures/postmark-batch.json" },
    },
    response: {
      type: "BatchResult[500]",
      shape:
        "BatchResult = SendResult[]  // one per Email, same order\nSendResult = { ErrorCode: number; Message: string; To: string; SubmittedAt: string; MessageID: string }",
      sample: [sendResult],
    },
  },
  "batch-results": {
    response: {
      type: "BatchResult[500]",
      shape: "SendResult[]",
      sample: [sendResult],
      source: { path: "tests/fixtures/postmark-batch.json" },
    },
  },
  "write-results": {
    request: {
      type: "JobResult",
      shape:
        '{ status: "sent" | "partial"; sentCount: number; failedCount: number; batches: number; results: SendResult[]; finishedAt: string }',
      sample: { ...jobResult, batches: 4 },
      before: jobResult,
      source: { path: "functions/src/broadcast/sendBroadcastBulk.ts", startLine: 88, endLine: 120 },
    },
    response: {
      type: "WriteResult",
      sample: { writeTime: "2026-09-12T09:00:19.402Z" },
    },
  },
};

export const payloadGraphInput: GraphDocInput = {
  ...postmarkRefactorGraphInput,
  title: "Batch broadcast sending through Postmark, with sample traffic",
  flows: (postmarkRefactorGraphInput.flows ?? []).map((flow) => ({
    ...flow,
    messages: flow.messages.map((message) => {
      const payload = payloads[message.id];
      return payload === undefined ? message : { ...message, payload };
    }),
  })),
};

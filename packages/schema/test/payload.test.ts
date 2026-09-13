import { describe, expect, it } from "vitest";
import { payloadGraphInput } from "../src/examples/payload.js";
import type { PayloadInput } from "../src/graph.js";
import {
  JsonPath,
  MAX_CHANGED_PATHS,
  MAX_PAYLOAD_DEPTH,
  MAX_SAMPLE_BYTES,
  MAX_SHAPE_BYTES,
  type JsonValue,
} from "../src/primitives.js";
import { safeParseGraphDoc } from "../src/validate.js";
import { isSupportedVersion } from "../src/version.js";
import { clone, expectRejected, withBatchPayload } from "./helpers.js";

const parseWith = (payload: PayloadInput) => safeParseGraphDoc(withBatchPayload(payload).doc);

const rejectWith = (payload: PayloadInput) => {
  const { doc, at } = withBatchPayload(payload);
  return { error: expectRejected(doc), at };
};

const nested = (depth: number): JsonValue => (depth === 0 ? "leaf" : { deeper: nested(depth - 1) });

describe("sample traffic on a flow step", () => {
  it("accepts the golden and keeps every payload with its step", () => {
    const result = safeParseGraphDoc(payloadGraphInput);
    if (!result.ok) throw result.error;
    const carried = result.value.flows[0]!.messages.map((message) => message.payload !== undefined);
    expect(carried).toEqual([true, true, true, false, true, true, true]);
  });

  it("stores samples as values and defaults changedPaths to an empty list", () => {
    const result = safeParseGraphDoc(payloadGraphInput);
    if (!result.ok) throw result.error;
    const request = result.value.flows[0]!.messages[4]!.payload?.request;
    expect(Array.isArray(request?.sample)).toBe(true);
    expect(request?.changedPaths).toEqual([]);
  });

  it("rejects a payload with neither side", () => {
    const { error, at } = rejectWith({});
    expect(error.code).toBe("INVALID_DOCUMENT");
    expect(error.issues[0]?.path).toBe(at);
    expect(error.message).toContain("a payload carries at least one side");
  });

  it("rejects a before with no sample to differ from", () => {
    const { error, at } = rejectWith({ request: { type: "Email", before: { To: "ada@example.com" } } });
    expect(error.issues[0]?.path).toBe(`${at}.request.before`);
    expect(error.message).toContain("before needs a sample to differ from");
  });

  it("rejects JSON text where a value belongs", () => {
    const { error, at } = rejectWith({ request: { type: "Email", sample: JSON.stringify({ To: "ada@example.com" }) } });
    expect(error.code).toBe("INVALID_DOCUMENT");
    expect(error.issues[0]?.path).toBe(`${at}.request.sample`);
    expect(error.message).toContain("must be an inline JSON value, not a string");
  });

  it("holds a sample to the depth cap", () => {
    expect(parseWith({ request: { type: "Deep", sample: nested(MAX_PAYLOAD_DEPTH) } }).ok).toBe(true);

    const { error, at } = rejectWith({ request: { type: "Deep", sample: nested(MAX_PAYLOAD_DEPTH + 1) } });
    expect(error.issues[0]?.path).toBe(`${at}.request.sample`);
    expect(error.message).toContain(`must be at most ${MAX_PAYLOAD_DEPTH} levels deep`);
  });

  it("holds a sample to the byte cap once serialised, and refuses rather than cuts", () => {
    const fits = { body: "a".repeat(MAX_SAMPLE_BYTES - '{"body":""}'.length) };
    expect(parseWith({ request: { type: "Blob", sample: fits } }).ok).toBe(true);

    const { error, at } = rejectWith({ response: { type: "Blob", before: fits, sample: { body: `${fits.body}a` } } });
    expect(error.issues).toHaveLength(1);
    expect(error.issues[0]?.path).toBe(`${at}.response.sample`);
    expect(error.message).toContain(`must be at most ${MAX_SAMPLE_BYTES} bytes when serialised`);
  });

  it("counts bytes, not characters", () => {
    const sample = { body: "…".repeat(MAX_SAMPLE_BYTES / 3) };
    expect(parseWith({ request: { type: "Blob", sample } }).ok).toBe(false);
  });

  it("holds a shape to its byte cap", () => {
    expect(parseWith({ request: { type: "T", shape: "a".repeat(MAX_SHAPE_BYTES) } }).ok).toBe(true);

    const { error, at } = rejectWith({ request: { type: "T", shape: "a".repeat(MAX_SHAPE_BYTES + 1) } });
    expect(error.issues[0]?.path).toBe(`${at}.request.shape`);
    expect(error.message).toContain(`must be at most ${MAX_SHAPE_BYTES} bytes`);
  });

  it("holds changedPaths to its cap", () => {
    const paths = (count: number) => Array.from({ length: count }, (_, index) => `[${index}].To`);
    const side = (count: number): PayloadInput => ({
      request: { type: "EmailBatch", sample: [{}], before: [{}], changedPaths: paths(count) },
    });
    expect(parseWith(side(MAX_CHANGED_PATHS)).ok).toBe(true);

    const { error, at } = rejectWith(side(MAX_CHANGED_PATHS + 1));
    expect(error.issues[0]?.path).toBe(`${at}.request.changedPaths`);
  });

  it("rejects an invented key on a side", () => {
    const { doc } = withBatchPayload({ request: { type: "T", sample: {} } });
    Object.assign(doc.flows![0]!.messages.find((message) => message.id === "batch-post")!.payload!.request!, { note: "x" });

    const error = expectRejected(doc);
    expect(error.code).toBe("INVALID_DOCUMENT");
    expect(error.message).toContain("note");
  });
});

describe("paths into a sample", () => {
  it.each(["Metadata.batchId", "[0].Cc", 'headers["Content-Type"]', '[0].headers["X-Trace-Id"].value', "$ref", "a_b.c1"])(
    "accepts %s",
    (path) => {
      expect(JsonPath.safeParse(path).success).toBe(true);
    },
  );

  it.each(["", ".Cc", "Metadata..batchId", "headers[Content-Type]", "a[b]", "a.", "0.Cc", "headers[\"\"]"])(
    "rejects %j",
    (path) => {
      expect(JsonPath.safeParse(path).success).toBe(false);
    },
  );

  it("rejects a bad path on a side, naming it", () => {
    const { error, at } = rejectWith({ request: { type: "T", sample: {}, changedPaths: ["headers[Content-Type]"] } });
    expect(error.issues[0]?.path).toBe(`${at}.request.changedPaths[0]`);
  });
});

describe("the readable contract range", () => {
  it.each(["0.1.0", "0.1.1", "0.2.0", "0.2.7"])("reads %s", (version) => {
    expect(isSupportedVersion(version)).toBe(true);
  });

  it.each(["0.0.1", "0.3.0", "1.0.0", "0.1", "0.10.0"])("refuses %s", (version) => {
    expect(isSupportedVersion(version)).toBe(false);
  });

  it("still opens a document stored against 0.1.1", () => {
    const doc = clone(payloadGraphInput);
    doc.schemaVersion = "0.1.1";
    expect(safeParseGraphDoc(doc).ok).toBe(true);
  });

  it("refuses a document from a contract this package does not know", () => {
    const doc = clone(payloadGraphInput);
    doc.schemaVersion = "0.3.0";
    expect(expectRejected(doc).code).toBe("UNSUPPORTED_SCHEMA_VERSION");
  });
});

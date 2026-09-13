import { payloadGraphInput } from "../src/examples/payload.js";
import type { GraphDocInput, PayloadInput } from "../src/graph.js";
import { safeParseGraphDoc } from "../src/validate.js";

export const clone = (doc: GraphDocInput): GraphDocInput => structuredClone(doc);

export const expectRejected = (input: unknown) => {
  const result = safeParseGraphDoc(input);
  if (result.ok) throw new Error("expected the document to be rejected");
  return result.error;
};

/** `at` is the issue path a rejection on that step reports. */
export const withBatchPayload = (payload: PayloadInput): { doc: GraphDocInput; at: string } => {
  const doc = clone(payloadGraphInput);
  const flow = doc.flows![0]!;
  const index = flow.messages.findIndex((message) => message.id === "batch-post");
  flow.messages[index]!.payload = payload;
  return { doc, at: `flows[0].messages[${index}].payload` };
};

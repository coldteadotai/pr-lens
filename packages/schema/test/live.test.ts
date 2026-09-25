import { describe, expect, it } from "vitest";
import { minimalGraphInput } from "../src/examples/minimal.js";
import { LiveCommand, ViewerLook } from "../src/live.js";

const answer = {
  kind: "answer",
  question: "What does push check first?",
  steps: [
    {
      heading: "Push checks the token first",
      stage: { kind: "view", view: "overview" },
      focus: { kind: "selection", nodes: ["api"] },
      paragraphs: [
        { parts: [{ text: "The " }, { text: "API", ref: { kind: "component", id: "api" } }, { text: " checks it." }] },
      ],
    },
  ],
};

describe("live commands", () => {
  it("accepts an answer and fills the focus a step left out", () => {
    const parsed = LiveCommand.safeParse({ ...answer, steps: [{ ...answer.steps[0], focus: undefined }] });
    expect(parsed.success).toBe(true);
    if (!parsed.success || parsed.data.kind !== "answer") return;
    expect(parsed.data.steps[0]?.focus).toEqual({ kind: "all" });
  });

  it("refuses a fifth step, a heading past the rail and a paragraph with no words", () => {
    const step = answer.steps[0];
    expect(LiveCommand.safeParse({ ...answer, steps: [step, step, step, step, step] }).success).toBe(false);
    expect(LiveCommand.safeParse({ ...answer, steps: [{ ...step, heading: "a".repeat(49) }] }).success).toBe(false);
    expect(LiveCommand.safeParse({ ...answer, steps: [{ ...step, paragraphs: [{ parts: [] }] }] }).success).toBe(false);
  });

  it("refuses a ref kind the canvas has no place for, and a field it does not know", () => {
    const step = answer.steps[0];
    const file = { ...step, paragraphs: [{ parts: [{ text: "x", ref: { kind: "file", id: "src/a.ts" } }] }] };
    expect(LiveCommand.safeParse({ ...answer, steps: [file] }).success).toBe(false);
    expect(LiveCommand.safeParse({ ...answer, extra: true }).success).toBe(false);
  });

  it("takes a show with a payload to open, and a fork with a drawing", () => {
    expect(LiveCommand.safeParse({ kind: "show", focus: { kind: "selection", nodes: ["api"] }, open: { message: "push/put" } }).success).toBe(true);
    expect(LiveCommand.safeParse({ kind: "fork", subject: { components: ["api"] }, sketch: minimalGraphInput }).success).toBe(true);
    expect(LiveCommand.safeParse({ kind: "fork", subject: { components: [] }, sketch: minimalGraphInput }).success).toBe(false);
  });
});

describe("viewer look", () => {
  it("reads a look, and drops a field a newer app adds", () => {
    const parsed = ViewerLook.safeParse({
      following: true,
      rev: 2,
      diagram: { stage: null, title: "Everything" },
      inFrame: [{ kind: "component", id: "api", label: "API" }],
      scope: { kind: "place", place: { kind: "component", id: "api", label: "API" } },
      answer: null,
      later: "ignored",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && "later" in parsed.data).toBe(false);
  });
});

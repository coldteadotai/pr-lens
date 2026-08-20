import { minimalGraph } from "@coldtea/pr-lens-schema/examples";
import { expect, test, vi } from "vitest";
import { applyKnownFields, extractGraph, readJsonObject, type KnownFields } from "../src/extract.js";
import { PrLensCliError } from "../src/errors.js";

const known: KnownFields = {
  provenance: {
    repo: { owner: "coldteadotai", name: "pr-lens" },
    base: { sha: "1111111" },
    head: { sha: "2222222" },
    generator: { name: "pr-lens-cli", version: "0.1.0", model: "test-model" },
  },
  stats: { filesChanged: 3, additions: 40, deletions: 12 },
  lenses: ["architecture"],
  generatedAt: "2026-08-20T21:00:00.000Z",
};

const modelBody = (): Record<string, unknown> => {
  const { schemaVersion: _v, provenance: _p, ...rest } = structuredClone(minimalGraph);
  return { ...rest, stats: { additions: 9999, chips: [{ label: "Batch size", value: "500" }] } };
};

test("what the repository knows is written over what the model claimed", () => {
  const stamped = applyKnownFields(
    { ...modelBody(), provenance: { repo: { owner: "someone", name: "else" } } },
    known,
  );

  expect(stamped).toMatchObject({
    schemaVersion: "0.1.0",
    kind: "graph",
    generatedAt: known.generatedAt,
    provenance: { repo: { owner: "coldteadotai", name: "pr-lens" } },
    stats: { additions: 40, deletions: 12, filesChanged: 3, chips: [{ label: "Batch size", value: "500" }] },
  });
});

test.each([
  ['{"a":1}', "plain"],
  ['```json\n{"a":1}\n```', "fenced"],
  ['Here you go:\n{"a":1}', "prefaced with prose"],
])("a %s answer is read as an object (%s)", (answer) => {
  expect(readJsonObject(answer)).toEqual({ ok: true, value: { a: 1 } });
});

test("an answer that holds no object fails with a reason to hand back", () => {
  const read = readJsonObject("I cannot help with that");
  expect(read.ok).toBe(false);
});

test("a lens that was not asked for cannot come back in the answer", () => {
  const stamped = applyKnownFields({ ...modelBody(), lenses: ["architecture", "data-flow"] }, known);
  expect(stamped).toMatchObject({ lenses: ["architecture"] });
});

test("truncated JSON buys the same correction round a rejected document gets", async () => {
  const complete = vi
    .fn()
    .mockResolvedValueOnce('{"title":"cut off"')
    .mockResolvedValueOnce(JSON.stringify(modelBody()));

  const { attempts } = await extractGraph(
    { system: "s", user: "u", maxOutputTokens: 1024, known },
    complete,
  );

  expect(attempts).toBe(2);
  const repair = complete.mock.calls[1]?.[0];
  expect(repair.turns[2].text).toContain("could not be read as JSON");
});

test("a model that answers with prose twice fails saying so", async () => {
  const complete = vi.fn().mockResolvedValue("I cannot help with that");

  await expect(
    extractGraph({ system: "s", user: "u", maxOutputTokens: 1024, known }, complete),
  ).rejects.toThrow(expect.objectContaining({ code: "MODEL_OUTPUT_INVALID" }));
  expect(complete).toHaveBeenCalledTimes(2);
});

test("an invalid document buys one correction round, and the errors go back to the model", async () => {
  const complete = vi
    .fn()
    .mockResolvedValueOnce(
      JSON.stringify({ ...modelBody(), edges: [{ id: "e1", from: "health-route", to: "ghost", kind: "call", delta: "added" }] }),
    )
    .mockResolvedValueOnce(JSON.stringify(modelBody()));

  const { document, attempts } = await extractGraph(
    { system: "s", user: "u", maxOutputTokens: 1024, known },
    complete,
  );

  expect(attempts).toBe(2);
  expect(document.nodes).toHaveLength(1);

  const repair = complete.mock.calls[1]?.[0];
  expect(repair.turns.map((turn: { role: string }) => turn.role)).toEqual(["user", "model", "user"]);
  expect(repair.turns[2].text).toContain("BROKEN_REFERENCE");
});

test("a model that cannot produce a valid document twice fails with the reasons", async () => {
  const complete = vi.fn().mockResolvedValue(JSON.stringify({ ...modelBody(), nodes: [] }));

  await expect(
    extractGraph({ system: "s", user: "u", maxOutputTokens: 1024, known }, complete),
  ).rejects.toThrow(PrLensCliError);
  expect(complete).toHaveBeenCalledTimes(2);
});

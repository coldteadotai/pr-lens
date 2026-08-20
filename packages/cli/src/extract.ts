import {
  SCHEMA_VERSION,
  safeParseGraphDoc,
  type GraphDoc,
  type GraphDocInput,
  type Lens,
} from "@coldtea/pr-lens-schema";
import { z } from "zod";
import { PrLensCliError } from "./errors.js";
import type { JsonCompletion, Turn } from "./providers/index.js";
import { buildJsonRepairPrompt, buildRepairPrompt } from "./prompt.js";

/** One repair round. A model that cannot fix a named path in one go does not fix it in three. */
const MAX_ATTEMPTS = 2;

const JsonObject = z.record(z.string(), z.unknown());

/**
 * The fields the repository already knows the answer to. They are written
 * over whatever the model emitted rather than merged with it: a commit sha, a
 * line count or the lens set that was asked for is a fact, and a fact the
 * model is free to restate is a fact that eventually disagrees with itself.
 */
export type KnownFields = {
  provenance: GraphDocInput["provenance"];
  stats: { filesChanged: number; additions: number; deletions: number };
  lenses: readonly Lens[];
  generatedAt: string;
};

/**
 * Stamping the lens set is what makes `--lens` a request rather than a
 * suggestion: a document whose flows or views need a lens that was not asked
 * for now fails validation, and the correction round removes them.
 */
export const applyKnownFields = (body: Record<string, unknown>, known: KnownFields): unknown => {
  const authored = JsonObject.safeParse(body.stats);
  return {
    ...body,
    schemaVersion: SCHEMA_VERSION,
    kind: "graph",
    generatedAt: known.generatedAt,
    provenance: known.provenance,
    lenses: [...known.lenses],
    stats: { ...(authored.success ? authored.data : {}), ...known.stats },
  };
};

const FENCE = /^```(?:json)?\s*\n([\s\S]*?)\n?```\s*$/;

export type JsonObjectRead =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; reason: string };

/**
 * Providers asked for JSON still fence it now and then, and some prepend a
 * line of prose. Both are recoverable, and a run that already spent the tokens
 * should not fail on packaging.
 *
 * A failure is returned rather than thrown, because truncated or malformed
 * JSON is a weak model's most common answer and deserves the same correction
 * round a structurally wrong document gets.
 */
export const readJsonObject = (text: string): JsonObjectRead => {
  const fenced = FENCE.exec(text.trim());
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");

  let reason = "the answer holds no JSON object";

  const attempts = [candidate, start >= 0 && end > start ? candidate.slice(start, end + 1) : ""];
  for (const attempt of attempts) {
    if (attempt === "") continue;
    try {
      const parsed = JsonObject.safeParse(JSON.parse(attempt));
      if (parsed.success) return { ok: true, value: parsed.data };
      reason = "the answer is JSON, but not an object";
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
    }
  }

  return { ok: false, reason };
};

export type Complete = (request: JsonCompletion) => Promise<string>;

export type Extraction = { document: GraphDoc; attempts: number };

export const extractGraph = async (
  options: {
    system: string;
    user: string;
    maxOutputTokens: number;
    known: KnownFields;
    onAttempt?: (attempt: number) => void;
  },
  complete: Complete,
): Promise<Extraction> => {
  const turns: Turn[] = [{ role: "user", text: options.user }];

  const giveUp = (message: string, details: string): PrLensCliError =>
    new PrLensCliError("MODEL_OUTPUT_INVALID", message, details);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    options.onAttempt?.(attempt);
    const last = attempt === MAX_ATTEMPTS;

    const text = await complete({
      system: options.system,
      turns,
      maxOutputTokens: options.maxOutputTokens,
    });

    const read = readJsonObject(text);
    if (!read.ok) {
      if (last) throw giveUp("the model did not answer with a JSON object, twice", read.reason);
      turns.push({ role: "model", text }, { role: "user", text: buildJsonRepairPrompt(read.reason) });
      continue;
    }

    const parsed = safeParseGraphDoc(applyKnownFields(read.value, options.known));
    if (parsed.ok) return { document: parsed.value, attempts: attempt };

    if (last)
      throw giveUp(
        `the model produced a document that does not validate, twice [${parsed.error.code}]`,
        parsed.error.message,
      );

    turns.push({ role: "model", text }, { role: "user", text: buildRepairPrompt(parsed.error) });
  }

  throw giveUp("extraction produced no document", "no attempt returned an answer");
};

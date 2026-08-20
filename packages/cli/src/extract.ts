import {
  SCHEMA_VERSION,
  safeParseGraphDoc,
  type GraphDoc,
  type GraphDocInput,
} from "@coldtea/pr-lens-schema";
import { z } from "zod";
import { PrLensCliError } from "./errors.js";
import type { JsonCompletion, Turn } from "./providers/index.js";
import { buildRepairPrompt } from "./prompt.js";

/** One repair round. A model that cannot fix a named path in one go does not fix it in three. */
const MAX_ATTEMPTS = 2;

const JsonObject = z.record(z.string(), z.unknown());

/**
 * The fields the repository already knows the answer to. They are written
 * over whatever the model emitted rather than merged with it: a commit sha or
 * a line count is a fact, and a fact the model is free to restate is a fact
 * that eventually disagrees with itself.
 */
export type KnownFields = {
  provenance: GraphDocInput["provenance"];
  stats: { filesChanged: number; additions: number; deletions: number };
  generatedAt: string;
};

export const applyKnownFields = (body: Record<string, unknown>, known: KnownFields): unknown => {
  const authored = JsonObject.safeParse(body.stats);
  return {
    ...body,
    schemaVersion: SCHEMA_VERSION,
    kind: "graph",
    generatedAt: known.generatedAt,
    provenance: known.provenance,
    stats: { ...(authored.success ? authored.data : {}), ...known.stats },
  };
};

const FENCE = /^```(?:json)?\s*\n([\s\S]*?)\n?```\s*$/;

/**
 * Providers asked for JSON still fence it now and then, and some prepend a
 * line of prose. Both are recoverable, and a run that already spent the tokens
 * should not fail on packaging.
 */
export const readJsonObject = (text: string): Record<string, unknown> => {
  const fenced = FENCE.exec(text.trim());
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");

  const attempts = [candidate, start >= 0 && end > start ? candidate.slice(start, end + 1) : ""];
  for (const attempt of attempts) {
    if (attempt === "") continue;
    try {
      const parsed = JsonObject.safeParse(JSON.parse(attempt));
      if (parsed.success) return parsed.data;
    } catch {
      continue;
    }
  }

  throw new PrLensCliError(
    "MODEL_OUTPUT_INVALID",
    "the model did not answer with a JSON object",
    text.slice(0, 400),
  );
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

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    options.onAttempt?.(attempt);

    const text = await complete({
      system: options.system,
      turns,
      maxOutputTokens: options.maxOutputTokens,
    });

    const parsed = safeParseGraphDoc(applyKnownFields(readJsonObject(text), options.known));
    if (parsed.ok) return { document: parsed.value, attempts: attempt };

    if (attempt === MAX_ATTEMPTS)
      throw new PrLensCliError(
        "MODEL_OUTPUT_INVALID",
        `the model produced a document that does not validate, twice [${parsed.error.code}]`,
        parsed.error.message,
      );

    turns.push({ role: "model", text }, { role: "user", text: buildRepairPrompt(parsed.error) });
  }

  throw new PrLensCliError("MODEL_OUTPUT_INVALID", "extraction produced no document");
};

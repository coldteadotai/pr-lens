import { z } from "zod";
import { cutOff, postJson, unreadableResponse } from "./http.js";
import type { JsonCompletion, Provider } from "./index.js";

/**
 * Reasoning parts come back in the same array as the answer and must not be
 * concatenated into it.
 */
const Response = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({ parts: z.array(z.object({ text: z.string().optional(), thought: z.boolean().optional() })).optional() })
          .optional(),
        finishReason: z.string().optional(),
      }),
    )
    .optional(),
});

export const geminiCompleteJson = async (
  provider: Provider,
  request: JsonCompletion,
): Promise<string> => {
  const body = await postJson(
    `${provider.baseUrl}/models/${provider.model}:generateContent`,
    { "x-goog-api-key": provider.apiKey },
    {
      systemInstruction: { parts: [{ text: request.system }] },
      contents: request.turns.map((turn) => ({ role: turn.role, parts: [{ text: turn.text }] })),
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0,
        maxOutputTokens: request.maxOutputTokens,
      },
    },
  );

  const parsed = Response.safeParse(body);
  if (!parsed.success)
    throw unreadableResponse("Gemini", "the response did not have the shape the API documents");

  const candidate = parsed.data.candidates?.[0];
  if (candidate === undefined)
    throw unreadableResponse("Gemini", "the response carried no candidate — the prompt may have been blocked");

  const text = (candidate.content?.parts ?? [])
    .filter((part) => part.thought !== true)
    .map((part) => part.text ?? "")
    .join("");

  if (text.trim() === "") {
    if (candidate.finishReason === "MAX_TOKENS") throw cutOff("Gemini");
    throw unreadableResponse("Gemini", `finish reason: ${candidate.finishReason ?? "unknown"}`);
  }

  if (candidate.finishReason === "MAX_TOKENS") throw cutOff("Gemini");

  return text;
};

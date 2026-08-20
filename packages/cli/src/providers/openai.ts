import { z } from "zod";
import { cutOff, postJson, unreadableResponse } from "./http.js";
import type { JsonCompletion, Provider } from "./index.js";

const Response = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable().optional() }).optional(),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .optional(),
});

/**
 * What an output limit is called on this endpoint.
 *
 * OpenAI renamed the field to `max_completion_tokens` and its newer models
 * reject the old one; the servers that copied the API before that rename —
 * DeepSeek, Ollama, llama.cpp and the rest — only know `max_tokens`. There is
 * no spelling both accept, so the caller says which endpoint it is talking to
 * rather than the request guessing from a hostname.
 */
export type TokenLimitField = "max_tokens" | "max_completion_tokens";

/**
 * The `/chat/completions` shape. The system prompt is the first message rather
 * than a separate field.
 */
export const openAiCompleteJson = async (
  provider: Provider,
  request: JsonCompletion,
  tokenLimitField: TokenLimitField,
): Promise<string> => {
  const body = await postJson(
    `${provider.baseUrl}/chat/completions`,
    { authorization: `Bearer ${provider.apiKey}` },
    {
      model: provider.model,
      temperature: 0,
      [tokenLimitField]: request.maxOutputTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: request.system },
        ...request.turns.map((turn) => ({
          role: turn.role === "model" ? "assistant" : "user",
          content: turn.text,
        })),
      ],
    },
  );

  const parsed = Response.safeParse(body);
  if (!parsed.success)
    throw unreadableResponse("the provider", "the response did not have the shape /chat/completions documents");

  const choice = parsed.data.choices?.[0];
  if (choice === undefined) throw unreadableResponse("the provider", "the response carried no choice");

  if (choice.finish_reason === "length") throw cutOff("the provider");

  const text = choice.message?.content ?? "";
  if (text.trim() === "")
    throw unreadableResponse("the provider", `finish reason: ${choice.finish_reason ?? "unknown"}`);

  return text;
};

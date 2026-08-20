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
 * The `/chat/completions` shape, which OpenAI, DeepSeek, Anthropic's
 * compatibility endpoint, OpenRouter, Ollama and llama.cpp all speak. The
 * system prompt is the first message rather than a separate field.
 */
export const openAiCompleteJson = async (
  provider: Provider,
  request: JsonCompletion,
): Promise<string> => {
  const body = await postJson(
    `${provider.baseUrl}/chat/completions`,
    { authorization: `Bearer ${provider.apiKey}` },
    {
      model: provider.model,
      temperature: 0,
      max_completion_tokens: request.maxOutputTokens,
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

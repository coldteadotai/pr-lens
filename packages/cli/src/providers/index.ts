import { assertNever } from "@coldtea/pr-lens-schema";
import { PrLensCliError } from "../errors.js";
import { geminiCompleteJson } from "./gemini.js";
import { openAiCompleteJson } from "./openai.js";

/**
 * Three shapes rather than a list of vendors: Gemini's own API, OpenAI's own
 * API, and the `/chat/completions` shape everyone else copied from it.
 *
 * OpenAI is separate from the servers that copied it because the two have
 * drifted: it renamed the output limit to `max_completion_tokens` and its
 * newer models reject `max_tokens`, which is the only spelling DeepSeek,
 * Ollama and llama.cpp know. Everything else about the request is shared, and
 * a new vendor still needs no code here — only a `--base-url`.
 */
export const PROVIDER_IDS = ["gemini", "openai", "openai-compatible"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const isProviderId = (value: string): value is ProviderId =>
  PROVIDER_IDS.some((id) => id === value);

export type Provider = {
  id: ProviderId;
  model: string;
  apiKey: string;
  baseUrl: string;
};

export type Turn = { role: "user" | "model"; text: string };

export type JsonCompletion = {
  system: string;
  turns: readonly Turn[];
  maxOutputTokens: number;
};

type ProviderDefaults = {
  apiKeyEnv: string;
  baseUrl: string | undefined;
  model: string | undefined;
};

export const providerDefaults = (id: ProviderId): ProviderDefaults => {
  switch (id) {
    case "gemini":
      return {
        apiKeyEnv: "GEMINI_API_KEY",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        model: "gemini-3.7-flash",
      };
    case "openai":
      return {
        apiKeyEnv: "OPENAI_API_KEY",
        baseUrl: "https://api.openai.com/v1",
        model: undefined,
      };
    case "openai-compatible":
      return {
        apiKeyEnv: "OPENAI_API_KEY",
        baseUrl: undefined,
        model: undefined,
      };
    default:
      return assertNever(id, "Unhandled provider");
  }
};

export type ProviderOptions = {
  id: ProviderId;
  model: string | undefined;
  baseUrl: string | undefined;
  apiKeyEnv: string | undefined;
};

/**
 * The key is read from the environment and never accepted as an argument: a
 * flag would land in shell history and in a CI log line.
 */
export const resolveProvider = (
  options: ProviderOptions,
  env: Record<string, string | undefined>,
): Provider => {
  const defaults = providerDefaults(options.id);
  const apiKeyEnv = options.apiKeyEnv ?? defaults.apiKeyEnv;
  const apiKey = env[apiKeyEnv];

  if (apiKey === undefined || apiKey === "")
    throw new PrLensCliError(
      "MISSING_API_KEY",
      `${apiKeyEnv} is not set`,
      `export ${apiKeyEnv} with your own key, or point --api-key-env at the variable that holds it`,
    );

  const model = options.model ?? defaults.model;
  if (model === undefined)
    throw new PrLensCliError(
      "USAGE",
      `--model is required for the ${options.id} provider`,
      "the endpoint decides which model names exist, so there is no default worth guessing",
    );

  const baseUrl = options.baseUrl ?? defaults.baseUrl;
  if (baseUrl === undefined)
    throw new PrLensCliError(
      "USAGE",
      "--base-url is required for an openai-compatible provider",
      "it is the endpoint that is compatible: point it at DeepSeek, OpenRouter, Ollama or your own server. For OpenAI itself, use --provider openai",
    );

  return { id: options.id, model, apiKey, baseUrl: baseUrl.replace(/\/+$/, "") };
};

export const completeJson = (provider: Provider, request: JsonCompletion): Promise<string> => {
  switch (provider.id) {
    case "gemini":
      return geminiCompleteJson(provider, request);
    case "openai":
      return openAiCompleteJson(provider, request, "max_completion_tokens");
    case "openai-compatible":
      return openAiCompleteJson(provider, request, "max_tokens");
    default:
      return assertNever(provider.id, "Unhandled provider");
  }
};

import { afterEach, expect, test, vi } from "vitest";
import { PrLensCliError } from "../src/errors.js";
import { completeJson, isProviderId, resolveProvider } from "../src/providers/index.js";

const options = { id: "gemini", model: undefined, baseUrl: undefined, apiKeyEnv: undefined } as const;

test("the key is read from the environment, and named in the error when it is missing", () => {
  expect(() => resolveProvider(options, {})).toThrow(
    expect.objectContaining({ code: "MISSING_API_KEY", message: "GEMINI_API_KEY is not set" }),
  );
});

test("--api-key-env points at another variable", () => {
  const provider = resolveProvider({ ...options, apiKeyEnv: "WORK_KEY" }, { WORK_KEY: "k" });
  expect(provider).toMatchObject({ id: "gemini", apiKey: "k" });
  expect(provider.model).toBe("gemini-3.7-flash");
});

test("a trailing slash on --base-url does not become a double slash in the request", () => {
  const provider = resolveProvider(
    { ...options, baseUrl: "http://localhost:11434/v1/" },
    { GEMINI_API_KEY: "k" },
  );
  expect(provider.baseUrl).toBe("http://localhost:11434/v1");
});

test("an endpoint that is not Gemini has no default model to guess", () => {
  expect(() => resolveProvider({ ...options, id: "openai" }, { OPENAI_API_KEY: "k" })).toThrow(
    PrLensCliError,
  );
});

test("openai-compatible means compatible with something, so it needs that something", () => {
  expect(() =>
    resolveProvider({ ...options, id: "openai-compatible", model: "deepseek-chat" }, { OPENAI_API_KEY: "k" }),
  ).toThrow(expect.objectContaining({ code: "USAGE" }));

  expect(
    resolveProvider(
      { ...options, id: "openai-compatible", model: "deepseek-chat", baseUrl: "https://api.deepseek.com" },
      { OPENAI_API_KEY: "k" },
    ),
  ).toMatchObject({ baseUrl: "https://api.deepseek.com", model: "deepseek-chat" });
});

test("OpenAI itself needs no base url, and is its own provider", () => {
  expect(resolveProvider({ ...options, id: "openai", model: "gpt-5.2" }, { OPENAI_API_KEY: "k" })).toMatchObject(
    { baseUrl: "https://api.openai.com/v1" },
  );
});

test("only the providers the CLI implements are accepted", () => {
  expect(isProviderId("gemini")).toBe(true);
  expect(isProviderId("openai-compatible")).toBe(true);
  expect(isProviderId("anthropic")).toBe(false);
});

const sentBody = async (provider: Parameters<typeof completeJson>[0], temperature?: number): Promise<unknown> => {
  const answer =
    provider.id === "gemini"
      ? { candidates: [{ content: { parts: [{ text: "{}" }] }, finishReason: "STOP" }] }
      : { choices: [{ message: { content: "{}" }, finish_reason: "stop" }] };
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(answer)));
  vi.stubGlobal("fetch", fetchMock);
  await completeJson(provider, { system: "s", turns: [{ role: "user", text: "t" }], maxOutputTokens: 10, temperature });
  return JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
};

const openai = { id: "openai", model: "gpt-6-luna", apiKey: "k", baseUrl: "https://api.openai.com/v1" } as const;
const compatible = { id: "openai-compatible", model: "deepseek-chat", apiKey: "k", baseUrl: "https://api.deepseek.com" } as const;
const gemini = { id: "gemini", model: "gemini-3.7-flash", apiKey: "k", baseUrl: "https://example.test" } as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

test("each provider sends the temperature it is given", async () => {
  expect(await sentBody(openai, 0)).toHaveProperty("temperature", 0);
  expect(await sentBody(compatible, 0.2)).toHaveProperty("temperature", 0.2);
  expect(await sentBody(gemini, 0.7)).toHaveProperty("generationConfig.temperature", 0.7);
});

test("no temperature sends none, for models that accept only their own default", async () => {
  expect(await sentBody(openai)).not.toHaveProperty("temperature");
  expect(await sentBody(compatible)).not.toHaveProperty("temperature");
  expect(await sentBody(gemini)).not.toHaveProperty("generationConfig.temperature");
});

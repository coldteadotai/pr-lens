import { expect, test } from "vitest";
import { PrLensCliError } from "../src/errors.js";
import { isProviderId, resolveProvider } from "../src/providers/index.js";

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

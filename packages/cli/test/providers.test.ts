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

test("an openai-compatible endpoint has no default model to guess", () => {
  expect(() => resolveProvider({ ...options, id: "openai-compatible" }, { OPENAI_API_KEY: "k" })).toThrow(
    PrLensCliError,
  );
});

test("only the providers the CLI implements are accepted", () => {
  expect(isProviderId("gemini")).toBe(true);
  expect(isProviderId("anthropic")).toBe(false);
});

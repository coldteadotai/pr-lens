import { z } from "zod";
import { parse } from "yaml";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

const run = promisify(execFile);
const Action = z.object({
  inputs: z.record(z.string(), z.object({ default: z.string().optional() })),
  runs: z.object({ steps: z.array(z.looseObject({
    id: z.string().optional(),
    run: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
  })) }),
});
const action = Action.parse(parse(await readFile(new URL("../action.yml", import.meta.url), "utf8")));

const analyzeArguments = async (
  temperature: string,
  responseFormat: string,
  maxDiffBytes = "",
): Promise<string[]> => {
  const step = action.runs.steps.find((step) => step.id === "analyze");
  expect(step?.env?.TEMPERATURE).toBe("${{ inputs.temperature }}");
  expect(step?.env?.RESPONSE_FORMAT).toBe("${{ inputs.response-format }}");
  expect(step?.env?.MAX_DIFF_BYTES).toBe("${{ inputs.max-diff-bytes }}");
  if (step?.run === undefined) throw new Error("Missing analyze step");

  const root = await mkdtemp(join(tmpdir(), "pr-lens-analyze-"));
  try {
    await writeFile(join(root, "npx"), '#!/usr/bin/env bash\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
    const { stdout } = await run("bash", ["-c", step.run], {
      env: {
        PATH: `${root}:${process.env.PATH ?? ""}`,
        CLI_VERSION: "test",
        BASE_SHA: "1111111",
        HEAD_SHA: "2222222",
        PR_NUMBER: "42",
        PROVIDER: "openai-compatible",
        MODEL: "test model",
        BASE_URL: "https://example.test/v1",
        LENS: "",
        TEMPERATURE: temperature,
        RESPONSE_FORMAT: responseFormat,
        MAX_DIFF_BYTES: maxDiffBytes,
        RUNNER_TEMP: root,
        GITHUB_OUTPUT: join(root, "output"),
      },
    });
    return stdout.trim().split("\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

test.each(["0", "default"])("the Action forwards temperature %s and response format", async (temperature) => {
  const args = await analyzeArguments(temperature, "none");
  expect(args.slice(args.indexOf("--temperature"), args.indexOf("--temperature") + 2)).toEqual(["--temperature", temperature]);
  expect(args.slice(args.indexOf("--response-format"), args.indexOf("--response-format") + 2)).toEqual(["--response-format", "none"]);
  expect(args).toContain("test model");
});

test("the Action forwards max-diff-bytes", async () => {
  const args = await analyzeArguments("", "", "200000");
  expect(args.slice(args.indexOf("--max-diff-bytes"), args.indexOf("--max-diff-bytes") + 2)).toEqual([
    "--max-diff-bytes",
    "200000",
  ]);
});

test("unset inputs leave the CLI defaults intact", async () => {
  expect(action.inputs.temperature?.default).toBe("");
  expect(action.inputs["response-format"]?.default).toBe("");
  expect(action.inputs["max-diff-bytes"]?.default).toBe("");
  const args = await analyzeArguments("", "");
  expect(args).not.toContain("--temperature");
  expect(args).not.toContain("--response-format");
  expect(args).not.toContain("--max-diff-bytes");
});

test("input values stay one argument and cannot run shell commands", async () => {
  const value = 'none; $(exit 42) "two words"';
  expect(await analyzeArguments("default", value)).toContain(value);
});

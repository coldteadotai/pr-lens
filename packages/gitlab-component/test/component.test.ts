import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { expect, test } from "vitest";
import { z } from "zod";

const Input = z.looseObject({ default: z.string(), description: z.string() });

const Spec = z.looseObject({
  spec: z.looseObject({ inputs: z.record(z.string(), Input) }),
});

const Job = z.looseObject({
  "pr-lens": z.looseObject({
    stage: z.string(),
    image: z.string(),
    rules: z.array(z.looseObject({ if: z.string() })),
    variables: z.record(z.string(), z.string()),
    script: z.array(z.string()),
  }),
});

const read = async (name: string) => readFile(new URL(`../${name}`, import.meta.url), "utf8");

const source = await read("templates/pr-lens.yml");
const [specDocument, jobDocument] = source.split("\n---\n");
const spec = Spec.parse(parse(specDocument ?? ""));
const job = Job.parse(parse(jobDocument ?? ""))["pr-lens"];
const script = await read("scripts/lens.sh");

test("the template's script is the script file, byte for byte", () => {
  expect(job.script).toHaveLength(1);
  expect(job.script[0]).toBe(script);
});

test("the job runs only in merge request pipelines", () => {
  expect(job.rules.map((rule) => rule.if)).toEqual(['$CI_PIPELINE_SOURCE == "merge_request_event"']);
});

test("the clone reaches the diff base", () => {
  expect(job.variables.GIT_DEPTH).toBe("0");
});

test("every input the job forwards is an input the spec declares", () => {
  for (const match of jobDocument?.matchAll(/\$\[\[\s*inputs\.([a-z_]+)\s*\]\]/g) ?? []) {
    expect(Object.keys(spec.spec.inputs), `inputs.${match[1]}`).toContain(match[1]);
  }
});

test("every PR_LENS variable the script reads is one the job provides", () => {
  const provided = new Set(Object.keys(job.variables));
  const read = new Set([...script.matchAll(/\bPR_LENS_[A-Z_]+/g)].map((match) => match[0]));
  // PR_LENS_API_KEY is set by the script itself; PR_LENS_WORK is a test override.
  read.delete("PR_LENS_API_KEY");
  read.delete("PR_LENS_WORK");
  for (const name of read) {
    expect(provided, name).toContain(name);
  }
});

test("no input reaches the script by interpolation, only through variables", () => {
  expect(job.script[0]).not.toContain("$[[");
});

test("secrets are named by variable, never taken as values", () => {
  const inputs = Object.keys(spec.spec.inputs);
  expect(inputs).toContain("api_key_variable");
  expect(inputs).toContain("token_variable");
  expect(inputs).not.toContain("api_key");
  expect(inputs).not.toContain("token");
});

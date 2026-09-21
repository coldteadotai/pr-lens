import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { expect, test } from "vitest";
import { z } from "zod";

/**
 * A default can be a string, a boolean or a number — GitLab's four input
 * types are string, array, number and boolean — so the schema cannot insist
 * on strings without excluding the typed inputs it exists to check.
 */
const Input = z.looseObject({
  default: z.union([z.string(), z.boolean(), z.number()]),
  description: z.string(),
  type: z.enum(["string", "array", "number", "boolean"]).optional(),
  options: z.array(z.union([z.string(), z.number()])).optional(),
  regex: z.string().optional(),
});

const Spec = z.looseObject({
  spec: z.looseObject({ inputs: z.record(z.string(), Input) }),
});

const Job = z.looseObject({
  stage: z.string(),
  image: z.string(),
  allow_failure: z.string(),
  timeout: z.string(),
  interruptible: z.string(),
  rules: z.array(z.looseObject({ if: z.string() })),
  retry: z.looseObject({ max: z.number(), when: z.array(z.string()) }),
  artifacts: z.looseObject({ paths: z.array(z.string()) }),
  variables: z.record(z.string(), z.string()),
  script: z.array(z.string()),
});

/** Never retried: re-running these spends the model call again to fail the same way. */
const NEVER_RETRY = ["script_failure", "missing_dependency_failure", "archived_failure"];

const read = async (name: string) => readFile(new URL(`../${name}`, import.meta.url), "utf8");

const source = await read("templates/pr-lens.yml");
const [specDocument, jobDocument] = source.split("\n---\n");
const spec = Spec.parse(parse(specDocument ?? ""));
const jobs = parse(jobDocument ?? "") as Record<string, unknown>;
const jobNames = Object.keys(jobs);
const job = Job.parse(jobs[jobNames[0] ?? ""]);
const script = await read("scripts/lens.sh");

test("the template defines exactly one job, named by an input", () => {
  // Hardcoding the name would put two invocations of the component in one
  // pipeline in collision with each other.
  expect(jobNames).toEqual(["$[[ inputs.job_name ]]"]);
});

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

test("a PR Lens failure leaves the pipeline green by default", () => {
  expect(job.allow_failure).toBe("$[[ inputs.allow_failure ]]");
  expect(spec.spec.inputs.allow_failure?.default).toBe(true);
});

test("the job bounds its own runtime rather than inheriting the project's", () => {
  expect(job.timeout).toBe("$[[ inputs.timeout ]]");
  expect(String(spec.spec.inputs.timeout?.default)).toMatch(/\d+ minutes?/);
});

test("a superseded pipeline cancels the job instead of drawing a stale commit", () => {
  expect(job.interruptible).toBe("$[[ inputs.interruptible ]]");
  expect(spec.spec.inputs.interruptible?.default).toBe(true);
});

test("retries cover transient failures only, never a real analysis failure", () => {
  expect(job.retry.max).toBeLessThanOrEqual(2);
  expect(job.retry.when.length).toBeGreaterThan(0);
  for (const never of NEVER_RETRY) {
    expect(job.retry.when, never).not.toContain(never);
  }
});

test("the render is collectable from the job, and from where the script writes it", () => {
  const work = job.variables.PR_LENS_WORK;
  expect(work).toBeDefined();
  // An artifact path that does not match where the script works collects
  // nothing, and says so only by producing an empty archive.
  const directory = String(work).replace("$CI_PROJECT_DIR/", "");
  expect(job.artifacts.paths).toContain(`${directory}/`);
});

test("every input declares a type, so a bad value fails at pipeline creation", () => {
  for (const [name, input] of Object.entries(spec.spec.inputs)) {
    expect(input.type, name).toBeDefined();
  }
});

test("inputs with a closed set of values constrain it", () => {
  // Free-text where the value is actually enumerated is how "maybe" reaches
  // a shell comparison and fails three steps later instead of immediately.
  expect(spec.spec.inputs.provider?.options).toEqual(["gemini", "openai", "openai-compatible"]);
  expect(spec.spec.inputs.branding?.options).toEqual(["true", "false"]);
  expect(spec.spec.inputs.comment?.options).toEqual(["true", "false"]);
  expect(spec.spec.inputs.cli_version?.regex).toBeDefined();
  expect(spec.spec.inputs.api_key_variable?.regex).toBeDefined();
  expect(spec.spec.inputs.token_variable?.regex).toBeDefined();
});

test("the variable-name inputs accept only shell-legal names", () => {
  const pattern = new RegExp(String(spec.spec.inputs.api_key_variable?.regex));
  expect(pattern.test("GEMINI_API_KEY")).toBe(true);
  expect(pattern.test("my key; rm -rf /")).toBe(false);
});

test("every input the job forwards is an input the spec declares", () => {
  for (const match of jobDocument?.matchAll(/\$\[\[\s*inputs\.([a-z_]+)\s*\]\]/g) ?? []) {
    expect(Object.keys(spec.spec.inputs), `inputs.${match[1]}`).toContain(match[1]);
  }
});

test("every PR_LENS variable the script reads is one the job provides", () => {
  const provided = new Set(Object.keys(job.variables));
  const used = new Set([...script.matchAll(/\bPR_LENS_[A-Z_]+/g)].map((match) => match[0]));
  // PR_LENS_API_KEY is set by the script itself. PR_LENS_BAKED_CLI_VERSION
  // comes from the image, and is absent on a plain node image on purpose —
  // that absence is what sends the run down the npx path.
  used.delete("PR_LENS_API_KEY");
  used.delete("PR_LENS_BAKED_CLI_VERSION");
  for (const name of used) {
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

test("the component ships an image with the CLI baked in, at the version it defaults to", async () => {
  const dockerfile = await read("Dockerfile");
  const baked = /ARG CLI_VERSION=(\d+\.\d+\.\d+)/.exec(dockerfile);

  expect(baked?.[1], "Dockerfile does not pin a CLI version to bake").toBeDefined();
  expect(baked?.[1]).toBe(String(spec.spec.inputs.cli_version?.default));
  expect(dockerfile).toContain("ENV PR_LENS_BAKED_CLI_VERSION=${CLI_VERSION}");
  // GitLab runs the job's own script; an entrypoint would fight it. Matched
  // as a directive, since the file explains in prose why there is none.
  expect(dockerfile).not.toMatch(/^ENTRYPOINT/m);
});

test("the script prefers a baked CLI and keeps npx for a version the image lacks", () => {
  // The default image is a plain node, where nothing is baked — so the npx
  // path has to stay, and the guard has to tolerate the variable being unset.
  expect(script).toContain('[ -n "${PR_LENS_BAKED_CLI_VERSION:-}" ]');
  expect(script).toContain("command -v pr-lens");
  expect(script).toContain('npx --yes "@coldtea/pr-lens-cli@${PR_LENS_CLI_VERSION}"');
});

test("the release job the catalog requires is version-controlled beside the component", async () => {
  // Without a release on a tagged commit the component is in no catalog, and
  // is findable only by someone who already knows its path.
  const ci = await read(".gitlab-ci.yml");
  expect(ci).toContain("release:");
  expect(ci).toContain("tag_name: $CI_COMMIT_TAG");
  expect(ci).toContain('if: $CI_COMMIT_TAG');
});

test("the changelog documents the version that is about to ship", async () => {
  const changelog = await read("CHANGELOG.md");
  const manifest = JSON.parse(await read("package.json"));
  expect(
    changelog.includes("## Unreleased") || changelog.includes(`## ${manifest.version}`),
  ).toBe(true);
});

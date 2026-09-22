import { access, constants, readFile } from "node:fs/promises";
import { parse } from "yaml";
import { expect, test } from "vitest";
import { z } from "zod";

const Step = z.looseObject({
  name: z.string().optional(),
  id: z.string().optional(),
  uses: z.string().optional(),
  run: z.string().optional(),
  shell: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
});

const Action = z.looseObject({
  name: z.string(),
  description: z.string(),
  inputs: z.record(z.string(), z.looseObject({ description: z.string(), required: z.boolean().optional(), default: z.string().optional() })),
  outputs: z.record(z.string(), z.looseObject({ description: z.string(), value: z.string() })),
  runs: z.looseObject({ using: z.literal("composite"), steps: z.array(Step) }),
});

const read = async (name: string) =>
  readFile(new URL(`../${name}`, import.meta.url), "utf8");

const action = Action.parse(parse(await read("action.yml")));
const source = await read("action.yml");

const script = (name: string) =>
  readFile(new URL(`../scripts/${name}`, import.meta.url), "utf8");

const CLI = "@coldtea/pr-lens-cli";

/** A step runs the CLI directly, or through the one script it hands off to. */
const runsTheCli = async (step: z.infer<typeof Step>): Promise<boolean> => {
  const body = step.run ?? "";
  if (body.includes(CLI)) return true;

  const handoff = body.match(/scripts\/([a-z-]+\.sh)/)?.[1];
  return handoff === undefined ? false : (await script(handoff)).includes(CLI);
};

const references = (pattern: RegExp): string[] =>
  [...source.matchAll(pattern)].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));

test("every step a composite action runs declares the shell it runs in", () => {
  for (const step of action.runs.steps) {
    if (step.uses !== undefined) continue;
    expect(step.run, `${step.name ?? "a step"} has neither uses nor run`).toBeDefined();
    expect(step.shell, `${step.name ?? "a step"} runs without a shell`).toBe("bash");
  }
});

test("nothing is interpolated into a shell body, so no branch or title can inject a command", () => {
  for (const step of action.runs.steps) {
    expect(step.run ?? "", `${step.name ?? "a step"} interpolates into its script`).not.toContain("${{");
  }
});

test("every input the steps read is an input the action declares", () => {
  for (const name of references(/\$\{\{\s*inputs\.([a-z-]+)/g)) {
    expect(Object.keys(action.inputs), `inputs.${name}`).toContain(name);
  }
});

test("every step output the action reads comes from a step that has that id", () => {
  const ids = action.runs.steps.flatMap((step) => (step.id === undefined ? [] : [step.id]));
  for (const id of references(/\$\{\{\s*steps\.([a-z-]+)\.outputs/g)) {
    expect(ids, `steps.${id}`).toContain(id);
  }
});

test("a workflow only has to hand over the key; everything else has a default", () => {
  expect(action.inputs["api-key"]?.required).toBe(true);

  for (const [name, input] of Object.entries(action.inputs)) {
    if (name === "api-key") continue;
    expect(input.default, `${name} has no default`).toBeDefined();
  }
});

test("every script a step runs is present and executable", async () => {
  const referenced = [...source.matchAll(/scripts\/([a-z-]+\.sh)/g)].map((match) => match[1]);
  expect(referenced.length).toBeGreaterThan(0);

  for (const name of new Set(referenced)) {
    const path = new URL(`../scripts/${name}`, import.meta.url);
    await expect(access(path, constants.X_OK)).resolves.toBeUndefined();
    expect(await readFile(path, "utf8")).toContain("set -euo pipefail");
  }
});

test("publishing replays onto the branch tip rather than failing the run", async () => {
  const publishing = await readFile(new URL("../scripts/publish.sh", import.meta.url), "utf8");

  expect(publishing).toContain("retrying");
  expect(publishing).toContain("git fetch");
});

test("a comment is only ever edited when the account this action comments as wrote it", async () => {
  const commenting = await readFile(new URL("../scripts/comment.sh", import.meta.url), "utf8");

  expect(commenting).toContain(".user.login == $author");
  expect(Object.keys(action.inputs)).toContain("comment-author");
});

test("the workflow the README hands out serialises runs of the same pull request", async () => {
  const readme = await read("README.md");

  expect(readme).toContain("concurrency:");
  expect(readme).toContain("cancel-in-progress: true");
});

test("the CLI version the action runs is the CLI version in this repository", async () => {
  const cli: unknown = JSON.parse(await read("../cli/package.json"));
  expect(cli).toMatchObject({ version: action.inputs["cli-version"]?.default });
});

test("every step that runs the CLI is handed the account token", async () => {
  const running = [];
  for (const step of action.runs.steps) {
    if (await runsTheCli(step)) running.push(step);
  }
  expect(running.length, "no step in this action runs the CLI").toBeGreaterThan(0);

  for (const step of running) {
    expect(
      step.env?.PR_LENS_TOKEN,
      `${step.name ?? "a step"} runs the CLI with no token in its environment`,
    ).toBe("${{ inputs.token }}");
  }
});

// The token names an account; a workflow that never gives one keeps drawing
// anonymously. So nothing may read it outside the environment it is handed in:
// a flag or a guard would make the run behave differently for want of one, and
// would also spell a secret onto a command line.
test("a run without the token is the run there was before", async () => {
  expect(action.inputs["token"]?.required).not.toBe(true);
  expect(action.inputs["token"]?.default).toBe("");

  for (const step of action.runs.steps) {
    expect(step.run ?? "", `${step.name ?? "a step"} reads the token`).not.toContain(
      "PR_LENS_TOKEN",
    );
  }
  for (const name of new Set(references(/scripts\/([a-z-]+\.sh)/g))) {
    expect(await script(name), `${name} reads the token`).not.toContain("PR_LENS_TOKEN");
  }
});

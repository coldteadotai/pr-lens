import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { expect, test } from "vitest";
import { z } from "zod";

/**
 * Atlassian's fixed set. A value outside it is rejected when the pipe is
 * submitted, so spelling it their way — sentence case — is load-bearing.
 */
const CATEGORIES = [
  "Alerting",
  "Artifact management",
  "Code quality",
  "Deployment",
  "Feature flagging",
  "Monitoring",
  "Notifications",
  "Security",
  "Testing",
  "Utilities",
  "Workflow automation",
] as const;

/** name and website, not a bare string: a string parses as YAML and fails validation. */
const Party = z.object({
  name: z.string().min(1),
  website: z.string().url(),
  email: z.string().email().optional(),
});

/**
 * The metadata Atlassian validates on submission. Held strictly here because
 * the failure mode is not a broken run — the pipe works fine unlisted — it is
 * a pipe nobody can find, which is the whole point of shipping one.
 */
const Pipe = z.looseObject({
  name: z.string().min(1),
  image: z.string(),
  category: z.enum(CATEGORIES),
  description: z.string().min(1),
  repository: z.string().url(),
  maintainer: Party,
  vendor: Party,
  tags: z.array(z.string().min(1)).min(1),
  variables: z.array(z.looseObject({ name: z.string(), default: z.string() })),
});

/** The headings Atlassian requires, in the order it requires them. */
const README_ORDER = [
  "# Bitbucket Pipelines Pipe:",
  "## YAML Definition",
  "## Variables",
  "## Details",
  "## Prerequisites",
  "## Examples",
  "## Support",
];

const read = async (name: string) => readFile(new URL(`../${name}`, import.meta.url), "utf8");

const raw = parse(await read("pipe.yml"));
const pipe = Pipe.parse(raw);
const script = await read("pipe/lens.sh");
const dockerfile = await read("Dockerfile");
const readme = await read("README.md");

test("the metadata is the shape Atlassian validates on submission", () => {
  // Parsing above would already have thrown; this states what is being held
  // so a failure reads as "the listing would reject this" rather than
  // "a schema somewhere is unhappy".
  expect(Pipe.safeParse(raw).success).toBe(true);
  // The two that were wrong, spelled out: strings here are the easy mistake.
  expect(typeof raw.maintainer).toBe("object");
  expect(typeof raw.vendor).toBe("object");
  expect(CATEGORIES).toContain(pipe.category);
});

test("the README carries Atlassian's required headings in their required order", () => {
  let searchFrom = 0;
  for (const heading of README_ORDER) {
    const at = readme.indexOf(heading, searchFrom);
    expect(at, `${heading} missing, or out of order`).toBeGreaterThan(-1);
    searchFrom = at + heading.length;
  }
});

test("every variable has a default, so only the two secrets need setting", () => {
  for (const variable of pipe.variables) {
    expect(variable.default, variable.name).toBeDefined();
  }
});

test("every declared variable is one the script defaults and reads", () => {
  for (const variable of pipe.variables) {
    expect(script, variable.name).toContain(`${variable.name}="\${${variable.name}:-`);
  }
});

test("secrets are named by variable, never taken as values", () => {
  const names = pipe.variables.map((variable) => variable.name);
  expect(names).toContain("API_KEY_VARIABLE");
  expect(names).toContain("TOKEN_VARIABLE");
  expect(names).not.toContain("API_KEY");
  expect(names).not.toContain("TOKEN");
});

test("the image the metadata names is the image the Dockerfile builds for", () => {
  expect(pipe.image).toMatch(/^coldtea\/pr-lens-pipe:\d+\.\d+\.\d+$/);
  expect(dockerfile).toContain("COPY pipe/lens.sh /lens.sh");
  expect(dockerfile).toContain('ENTRYPOINT ["bash", "/lens.sh"]');
});

test("the image bakes the CLI at the version the metadata pins", () => {
  // A pipe that fetched the CLI per run would execute whatever the registry
  // served that minute inside a pipeline holding the customer's variables.
  const baked = /ARG CLI_VERSION=(\d+\.\d+\.\d+)/.exec(dockerfile);
  expect(baked?.[1], "Dockerfile does not pin a CLI version to bake").toBeDefined();
  expect(dockerfile).toContain('npm install -g "@coldtea/pr-lens-cli@${CLI_VERSION}"');
  expect(dockerfile).toContain("ENV PR_LENS_BAKED_CLI_VERSION=${CLI_VERSION}");

  // And it is the version the pipe's own default asks for, or every run would
  // silently take the npx path the baking exists to avoid.
  const declared = pipe.variables.find((variable) => variable.name === "CLI_VERSION");
  expect(declared?.default).toBe(baked?.[1]);
});

test("the script prefers the baked CLI and keeps npx only as the override path", () => {
  expect(script).toContain("command -v pr-lens");
  expect(script).toContain('pr-lens "$@"');
  expect(script).toContain('npx --yes "@coldtea/pr-lens-cli@${CLI_VERSION}"');
});

test("the image tag the metadata pins is this package's own version", async () => {
  // A pipe published at one version while its metadata names another is a
  // pipe whose consumers pin a tag that does not carry what the release
  // notes describe.
  const manifest = JSON.parse(await read("package.json"));
  expect(pipe.image).toBe(`coldtea/pr-lens-pipe:${manifest.version}`);
});

test("the changelog documents the version that is about to ship", async () => {
  const changelog = await read("CHANGELOG.md");
  const manifest = JSON.parse(await read("package.json"));
  // Either the current version has an entry, or there is an Unreleased
  // section describing what a bump would carry. A changelog with neither is
  // a package whose consumers cannot tell whether to take an upgrade.
  expect(
    changelog.includes("## Unreleased") || changelog.includes(`## ${manifest.version}`),
  ).toBe(true);
});

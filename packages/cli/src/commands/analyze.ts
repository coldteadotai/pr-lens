import { LENSES, PROVIDERS, type GraphDocInput, type Lens, type Provider } from "@coldtea/pr-lens-schema";
import { dirname } from "node:path";
import { parseOptions, readBoolean, readInt, readList, readString } from "../args.js";
import { discoverConfig, loadConfig, type LoadedConfig } from "../config-file.js";
import { PrLensCliError, usageError } from "../errors.js";
import { extractGraph } from "../extract.js";
import { collectDiff, mergeBase, parseRepoSlug, pullRequestUrl, remoteSlug, repositoryRoot, resolveCommit } from "../git.js";
import { writeJsonFile } from "../io.js";
import { buildExtractionPrompt, SYSTEM_PROMPT } from "../prompt.js";
import { completeJson, isProviderId, PROVIDER_IDS, resolveProvider } from "../providers/index.js";
import { GRAPH_DOCUMENT_JSON_SCHEMA } from "../skill-content.generated.js";
import { triageDiff, truncatePatch, TRIAGE_MODEL } from "../triage.js";
import type { Terminal } from "../terminal.js";
import { CLI_VERSION, GENERATOR_NAME } from "../version.js";
import { prepareWorkspace, WORKSPACE_DIR } from "../workspace.js";

const DEFAULT_OUT = `${WORKSPACE_DIR}/graph.json`;
const DEFAULT_MAX_OUTPUT_TOKENS = 32_768;
const DEFAULT_MAX_DIFF_BYTES = 400_000;

export const USAGE = `pr-lens analyze --base <ref> [options]

Reads the diff between two commits and asks your own model to describe it as a
graph document. The key never leaves your machine: it is read from the
environment, and the diff goes straight to the provider you name.

  --base <ref>              what the change is measured against (required)
  --head <ref>              the tip of the change (default HEAD)
  --repo <dir>              repository to read (default .)
  --provider <id>           ${PROVIDER_IDS.join(" | ")} (default gemini)
  --model <name>            model to ask (required for openai-compatible)
  --base-url <url>          provider endpoint, for a compatible or local server
  --api-key-env <name>      environment variable holding the key
  --lens <lens>             ${LENSES.join(", ")} (repeatable, default both)
  --config <file>           read the lenses from this config (default the repository's)
  --no-config               ignore the repository's config
  --pr <number>             pull request number, recorded in provenance
  --repo-slug <owner/name>  override the slug read from the git remote
  --remote <name>           remote to read the slug from (default origin)
  --forge <name>            github | gitlab | bitbucket — where the repository is
                            hosted (default read from the remote host)
  --max-diff-bytes <n>      truncate the diff sent to the model (default ${DEFAULT_MAX_DIFF_BYTES})
  --triage                  drop files no diagram would draw before the model reads the diff,
                            judged per file by ${TRIAGE_MODEL} via the Vercel AI Gateway
                            (sends the diff there too; needs AI_GATEWAY_API_KEY)
  --max-output-tokens <n>   room for the answer (default ${DEFAULT_MAX_OUTPUT_TOKENS})
  --dry-run                 report what would be sent, and send nothing
  -o, --out <file>          where to write the document (default ${DEFAULT_OUT})`;

const readLenses = (values: Record<string, unknown>): Lens[] | undefined => {
  const requested = readList(values.lens, "lens");
  if (requested === undefined) return undefined;

  const unknown = requested.filter((lens) => !LENSES.some((known) => known === lens));
  if (unknown.length > 0)
    throw usageError(`unknown lens ${unknown.join(", ")}`, `known lenses: ${LENSES.join(", ")}`);

  return LENSES.filter((lens) => requested.includes(lens));
};

const readForge = (values: Record<string, unknown>): Provider | undefined => {
  const forge = readString(values.forge, "forge");
  if (forge === undefined) return undefined;

  const known = PROVIDERS.find((provider) => provider === forge);
  if (known === undefined)
    throw usageError(`unknown forge ${JSON.stringify(forge)}`, `known forges: ${PROVIDERS.join(", ")}`);
  return known;
};

const readProviderId = (values: Record<string, unknown>) => {
  const id = readString(values.provider, "provider") ?? "gemini";
  if (!isProviderId(id))
    throw usageError(`unknown provider ${JSON.stringify(id)}`, `known providers: ${PROVIDER_IDS.join(", ")}`);
  return id;
};

export const analyzeCommand = async (
  args: readonly string[],
  terminal: Terminal,
  env: Record<string, string | undefined>,
): Promise<void> => {
  const { values, positionals } = parseOptions(args, {
    base: { type: "string" },
    head: { type: "string" },
    repo: { type: "string" },
    provider: { type: "string" },
    model: { type: "string" },
    "base-url": { type: "string" },
    "api-key-env": { type: "string" },
    lens: { type: "string", multiple: true },
    config: { type: "string" },
    "no-config": { type: "boolean" },
    pr: { type: "string" },
    "repo-slug": { type: "string" },
    remote: { type: "string" },
    forge: { type: "string" },
    "max-diff-bytes": { type: "string" },
    "max-output-tokens": { type: "string" },
    triage: { type: "boolean" },
    "dry-run": { type: "boolean" },
    out: { type: "string", short: "o" },
  });

  if (positionals.length > 0) throw usageError(`analyze takes no positional arguments, got ${positionals.join(" ")}`);

  const base = readString(values.base, "base");
  if (base === undefined) throw usageError("--base is required", "it names the commit the change is measured against, e.g. --base origin/main");

  const repo = readString(values.repo, "repo") ?? process.cwd();
  const head = readString(values.head, "head") ?? "HEAD";
  const maxDiffBytes = readInt(values["max-diff-bytes"], "max-diff-bytes", DEFAULT_MAX_DIFF_BYTES);

  const slugOption = readString(values["repo-slug"], "repo-slug");
  const detected = slugOption === undefined
    ? await remoteSlug(repo, readString(values.remote, "remote") ?? "origin")
    : parseRepoSlug(slugOption);

  if (detected === undefined)
    throw new PrLensCliError(
      "REPOSITORY_UNKNOWN",
      "cannot tell which repository this is",
      "pass --repo-slug owner/name, or add a git remote the CLI can read",
    );

  const forge = readForge(values);
  // An owner/name slug carries no host, and parseRepoSlug fills in
  // github.com — which a non-GitHub forge would then dress in the wrong
  // URLs. Refusing beats a permalink that 404s in the reader's face.
  if (forge !== undefined && forge !== "github" && slugOption !== undefined)
    throw usageError(
      `--forge ${forge} cannot be combined with --repo-slug`,
      "an owner/name slug names no host; let the CLI read the git remote, which carries one",
    );
  const slug = forge === undefined ? detected : { ...detected, provider: forge };

  const configPath = readString(values.config, "config");
  const configured: LoadedConfig | undefined = readBoolean(values["no-config"])
    ? undefined
    : configPath === undefined
      ? await discoverConfig(await repositoryRoot(repo))
      : await loadConfig(configPath);

  const requestedLenses = readLenses(values);
  const lenses = requestedLenses ?? configured?.config.lenses ?? [...LENSES];

  const dryRun = readBoolean(values["dry-run"]);
  const triage = readBoolean(values.triage) && !dryRun;
  if (triage && env.AI_GATEWAY_API_KEY === undefined)
    throw new PrLensCliError(
      "MISSING_API_KEY",
      "--triage asks the Vercel AI Gateway, and AI_GATEWAY_API_KEY is not set",
      "export AI_GATEWAY_API_KEY with a gateway key, or drop --triage",
    );

  const headCommit = await resolveCommit(repo, head);
  const baseCommit = await resolveCommit(repo, base);
  const comparedAgainst = await mergeBase(repo, baseCommit.sha, headCommit.sha);

  // Triage judges the whole change, so it reads a far larger raw diff than the
  // model budget; the byte cut is applied after the noise is gone, not before.
  const diff = await collectDiff(repo, comparedAgainst, headCommit.sha, triage ? maxDiffBytes * 8 : maxDiffBytes);

  if (diff.files.length === 0)
    throw new PrLensCliError(
      "EMPTY_DIFF",
      `${base} and ${head} have the same content`,
      "there is nothing to draw",
    );

  let promptDiff = diff;
  if (triage) {
    terminal.err(`triage: asking ${TRIAGE_MODEL} about ${diff.files.length} files…`);
    const triaged = await triageDiff(diff);
    promptDiff = truncatePatch(triaged.diff, maxDiffBytes);
    terminal.err(
      `triage: kept ${triaged.kept.length}/${diff.files.length} files, patch ${Buffer.byteLength(diff.patch, "utf8")} → ${Buffer.byteLength(promptDiff.patch, "utf8")} bytes, ${triaged.tookMs}ms`,
    );
    if (triaged.dropped.length > 0)
      terminal.err(`triage: dropped ${triaged.dropped.map((file) => file.path).join(", ")}`);
  }

  const promptContext = {
    repo: { owner: slug.owner, name: slug.name },
    base: { sha: comparedAgainst, ref: baseCommit.ref },
    head: { sha: headCommit.sha, ref: headCommit.ref },
    diff: promptDiff,
    lenses,
  };

  const user = buildExtractionPrompt(promptContext, GRAPH_DOCUMENT_JSON_SCHEMA);
  const provider = dryRun
    ? undefined
    : resolveProvider(
        {
          id: readProviderId(values),
          model: readString(values.model, "model"),
          baseUrl: readString(values["base-url"], "base-url"),
          apiKeyEnv: readString(values["api-key-env"], "api-key-env"),
        },
        env,
      );

  terminal.err(
    `${promptDiff.files.length} files, +${diff.additions} -${diff.deletions}, ${Buffer.byteLength(promptDiff.patch, "utf8")} bytes of diff${promptDiff.truncatedAt === undefined ? "" : " (truncated)"}`,
  );
  terminal.err(`prompt: ${Buffer.byteLength(user, "utf8")} bytes`);

  if (provider === undefined) {
    terminal.out(`✓ dry run — nothing was sent, and nothing was written`);
    return;
  }

  const pr = values.pr === undefined ? undefined : readInt(values.pr, "pr", 0);
  const pullRequest =
    pr === undefined
      ? undefined
      : { number: pr, url: pullRequestUrl(slug, pr) };

  const provenance: GraphDocInput["provenance"] = {
    repo: { owner: slug.owner, name: slug.name, host: slug.host },
    base: { sha: comparedAgainst, ref: baseCommit.ref },
    head: { sha: headCommit.sha, ref: headCommit.ref },
    ...(pullRequest === undefined ? {} : { pullRequest }),
    generator: { name: GENERATOR_NAME, version: CLI_VERSION, model: provider.model },
  };

  terminal.err(`asking ${provider.id} (${provider.model})…`);

  const { document, attempts } = await extractGraph(
    {
      system: SYSTEM_PROMPT,
      user,
      maxOutputTokens: readInt(values["max-output-tokens"], "max-output-tokens", DEFAULT_MAX_OUTPUT_TOKENS),
      known: {
        provenance,
        lenses,
        stats: {
          filesChanged: diff.files.length,
          additions: diff.additions,
          deletions: diff.deletions,
        },
        generatedAt: new Date().toISOString(),
      },
      onAttempt: (attempt) => {
        if (attempt > 1) terminal.err(`the document did not validate — asking for a correction`);
      },
    },
    (request) => completeJson(provider, request),
  );

  const outPath = readString(values.out, "out") ?? DEFAULT_OUT;
  await prepareWorkspace(dirname(outPath), terminal);
  const written = await writeJsonFile(outPath, document);
  terminal.out(
    `✓ ${written} — ${document.nodes.length} nodes, ${document.edges.length} edges, ${document.flows.length} flows${attempts > 1 ? ` (${attempts} attempts)` : ""}`,
  );
};

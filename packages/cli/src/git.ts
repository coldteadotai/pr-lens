import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PrLensCliError } from "./errors.js";

const run = promisify(execFile);

/** Large enough for any diff worth sending to a model; a bigger one is truncated anyway. */
const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;

export const git = async (repo: string, args: readonly string[]): Promise<string> => {
  try {
    const { stdout } = await run("git", [...args], {
      cwd: repo,
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      encoding: "utf8",
    });
    return stdout;
  } catch (error) {
    const stderr =
      typeof error === "object" && error !== null && "stderr" in error ? String(error.stderr) : "";
    throw new PrLensCliError(
      "GIT_FAILED",
      `git ${args.join(" ")} failed in ${repo}`,
      stderr.trim() || (error instanceof Error ? error.message : String(error)),
    );
  }
};

export type Commit = { sha: string; ref: string | undefined };

/**
 * A ref becomes the commit it named at the moment of the run, and a branch
 * keeps its name for the permalinks. `HEAD` is resolved to a branch name when
 * it is on one, since "HEAD" tells a reader of the comment nothing.
 */
export const resolveCommit = async (repo: string, ref: string): Promise<Commit> => {
  const sha = (await git(repo, ["rev-parse", "--verify", `${ref}^{commit}`])).trim();
  if (ref !== "HEAD") return { sha, ref };

  const branch = (await git(repo, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  return { sha, ref: branch === "HEAD" ? undefined : branch };
};

/**
 * The commit the pull request would be compared against, not the tip of the
 * base branch: a diff against the tip would attribute every change made on
 * the base branch since the fork point to this pull request.
 */
export const mergeBase = async (repo: string, base: string, head: string): Promise<string> => {
  const merged = await git(repo, ["merge-base", base, head]).catch(() => undefined);
  if (merged === undefined)
    throw new PrLensCliError(
      "GIT_FAILED",
      `${base} and ${head} have no common ancestor`,
      "fetch the base branch, or pass --base with a ref that shares history with the head",
    );
  return merged.trim();
};

export type ChangedFile = {
  path: string;
  additions: number | undefined;
  deletions: number | undefined;
};

export type Diff = {
  files: ChangedFile[];
  additions: number;
  deletions: number;
  patch: string;
  truncatedAt: number | undefined;
};

/** `--numstat` reports a binary file's line counts as `-`, which is not zero. */
const parseNumstat = (stdout: string): ChangedFile[] =>
  stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .flatMap((line) => {
      const [additions, deletions, ...rest] = line.split("\t");
      const path = rest.join("\t");
      if (additions === undefined || deletions === undefined || path === "") return [];
      const count = (value: string): number | undefined =>
        value === "-" ? undefined : Number(value);
      return [{ path, additions: count(additions), deletions: count(deletions) }];
    });

const sum = (values: readonly (number | undefined)[]): number =>
  values.reduce<number>((total, value) => total + (value ?? 0), 0);

export const collectDiff = async (
  repo: string,
  base: string,
  head: string,
  maxPatchBytes: number,
): Promise<Diff> => {
  const files = parseNumstat(await git(repo, ["diff", "--numstat", "--find-renames", base, head]));
  const patch = await git(repo, [
    "diff",
    "--no-color",
    "--find-renames",
    "--unified=3",
    base,
    head,
  ]);

  const withinBudget = Buffer.byteLength(patch, "utf8") <= maxPatchBytes;

  return {
    files,
    additions: sum(files.map((file) => file.additions)),
    deletions: sum(files.map((file) => file.deletions)),
    patch: withinBudget ? patch : Buffer.from(patch, "utf8").subarray(0, maxPatchBytes).toString("utf8"),
    truncatedAt: withinBudget ? undefined : maxPatchBytes,
  };
};

export type RepoSlug = { owner: string; name: string; host: string };

const REMOTE_URL = /^(?:(?:ssh|git|https?):\/\/)?(?:[^@/]+@)?([^/:]+)[:/](.+?)(?:\.git)?\/?$/;

export const parseRemoteUrl = (url: string): RepoSlug | undefined => {
  const match = REMOTE_URL.exec(url.trim());
  if (!match) return undefined;

  const [, host, path] = match;
  if (host === undefined || path === undefined) return undefined;

  const segments = path.split("/").filter((segment) => segment !== "");
  const name = segments.at(-1);
  const owner = segments.slice(0, -1).join("/");
  if (name === undefined || owner === "") return undefined;

  return { owner, name, host };
};

export const parseRepoSlug = (slug: string): RepoSlug | undefined => {
  const segments = slug.split("/").filter((segment) => segment !== "");
  const name = segments.at(-1);
  const owner = segments.slice(0, -1).join("/");
  if (name === undefined || owner === "" || segments.length !== 2) return undefined;
  return { owner, name, host: "github.com" };
};

export const remoteSlug = async (repo: string, remote: string): Promise<RepoSlug | undefined> => {
  const url = await git(repo, ["remote", "get-url", remote]).catch(() => undefined);
  return url === undefined ? undefined : parseRemoteUrl(url);
};

export const repositoryRoot = async (repo: string): Promise<string> =>
  (await git(repo, ["rev-parse", "--show-toplevel"])).trim();

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { collectDiff, git, parseRemoteUrl, parseRepoSlug, providerForHost, pullRequestUrl } from "../src/git.js";

test("collectDiff preserves a Chinese filename in the file list and patch", async () => {
  const repo = await mkdtemp(join(tmpdir(), "pr-lens-diff-"));
  const path = "支付流程.ts";
  const commit = (message: string) => git(repo, [
    "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test",
    "-c", "commit.gpgSign=false", "commit", "-m", message,
  ]);
  try {
    await git(repo, ["init", "--template="]);
    await git(repo, ["config", "--local", "core.quotePath", "true"]);
    await writeFile(join(repo, path), "export const payment = 0;\n");
    await git(repo, ["add", "--", path]);
    await commit("Add payment flow");
    await writeFile(join(repo, path), "export const payment = 1;\n");
    await git(repo, ["add", "--", path]);
    await commit("Update payment flow");

    const diff = await collectDiff(repo, "HEAD^", "HEAD", 100_000);
    expect.soft(diff.files).toEqual([{ path, additions: 1, deletions: 1 }]);
    expect.soft(diff.patch).toContain(`diff --git a/${path} b/${path}`);
    expect((await git(repo, ["config", "--local", "--get", "core.quotePath"])).trim()).toBe("true");
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test.each([
  ["git@github.com:coldteadotai/pr-lens.git", "coldteadotai", "pr-lens", "github.com", "github"],
  ["https://github.com/coldteadotai/pr-lens.git", "coldteadotai", "pr-lens", "github.com", "github"],
  ["https://user:token@github.com/coldteadotai/pr-lens.git", "coldteadotai", "pr-lens", "github.com", "github"],
  ["https://github.com/coldteadotai/pr-lens", "coldteadotai", "pr-lens", "github.com", "github"],
  ["ssh://git@github.com/coldteadotai/pr-lens.git", "coldteadotai", "pr-lens", "github.com", "github"],
  ["https://gitlab.example.com/team/group/app.git", "team/group", "app", "gitlab.example.com", "gitlab"],
  ["https://gitlab.example.com:8443/team/group/app.git", "team/group", "app", "gitlab.example.com:8443", "gitlab"],
  ["https://user:token@gitlab.example.com:8443/team/group/app.git", "team/group", "app", "gitlab.example.com:8443", "gitlab"],
  ["git@gitlab.com:group/subgroup/app.git", "group/subgroup", "app", "gitlab.com", "gitlab"],
  ["git@gitlab.com:8443/group/app.git", "8443/group", "app", "gitlab.com", "gitlab"],
  ["https://bitbucket.org/workspace/repo.git", "workspace", "repo", "bitbucket.org", "bitbucket"],
  ["https://bitbucket.org:443/workspace/repo.git", "workspace", "repo", "bitbucket.org:443", "bitbucket"],
  ["git@bitbucket.org:workspace/repo.git", "workspace", "repo", "bitbucket.org", "bitbucket"],
])("%s names a repository", (url, owner, name, host, provider) => {
  expect(parseRemoteUrl(url)).toEqual({ owner, name, host, provider });
});

test("a remote that names no repository is not guessed at", () => {
  expect(parseRemoteUrl("/srv/git/bare-repo")).toBeUndefined();
});

test("a GitLab merge request link keeps the HTTPS port in the authority", () => {
  const slug = parseRemoteUrl("https://gitlab.example.com:8443/team/group/app.git");
  expect(slug).toBeDefined();
  if (slug !== undefined)
    expect(pullRequestUrl(slug, 42)).toBe("https://gitlab.example.com:8443/team/group/app/-/merge_requests/42");
});

test("parseRemoteUrl rejects long adversarial inputs without backtracking", () => {
  const start = performance.now();
  expect(parseRemoteUrl(`${"a@".repeat(5_000)}host`)).toBeUndefined();
  expect(performance.now() - start).toBeLessThan(100);
});

test("--repo-slug takes owner/name and nothing longer", () => {
  expect(parseRepoSlug("coldteadotai/pr-lens")).toEqual({
    owner: "coldteadotai",
    name: "pr-lens",
    host: "github.com",
    provider: "github",
  });
  expect(parseRepoSlug("pr-lens")).toBeUndefined();
  expect(parseRepoSlug("a/b/c")).toBeUndefined();
});

test.each([
  ["github.com", "github"],
  ["bitbucket.org", "bitbucket"],
  ["gitlab.com", "gitlab"],
  ["GitLab.example.com", "gitlab"],
  ["git.mycompany.dev", "github"],
])("%s is read as %s", (host, provider) => {
  expect(providerForHost(host)).toBe(provider);
});

test.each([
  ["github", "https://github.com/coldteadotai/pr-lens/pull/42"],
  ["gitlab", "https://gitlab.com/group/sub/app/-/merge_requests/42"],
  ["bitbucket", "https://bitbucket.org/workspace/repo/pull-requests/42"],
])("a pull request on %s gets its own URL shape", (provider, url) => {
  const slug =
    provider === "github"
      ? parseRepoSlug("coldteadotai/pr-lens")
      : parseRemoteUrl(
          provider === "gitlab"
            ? "https://gitlab.com/group/sub/app.git"
            : "https://bitbucket.org/workspace/repo.git",
        );
  expect(slug).toBeDefined();
  if (slug !== undefined) expect(pullRequestUrl(slug, 42)).toBe(url);
});

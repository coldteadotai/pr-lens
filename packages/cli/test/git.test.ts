import { expect, test } from "vitest";
import { parseRemoteUrl, parseRepoSlug, providerForHost, pullRequestUrl } from "../src/git.js";

test.each([
  ["git@github.com:coldteadotai/pr-lens.git", "coldteadotai", "pr-lens", "github.com", "github"],
  ["https://github.com/coldteadotai/pr-lens.git", "coldteadotai", "pr-lens", "github.com", "github"],
  ["https://github.com/coldteadotai/pr-lens", "coldteadotai", "pr-lens", "github.com", "github"],
  ["ssh://git@github.com/coldteadotai/pr-lens.git", "coldteadotai", "pr-lens", "github.com", "github"],
  ["https://gitlab.example.com/team/group/app.git", "team/group", "app", "gitlab.example.com", "gitlab"],
  ["git@gitlab.com:group/subgroup/app.git", "group/subgroup", "app", "gitlab.com", "gitlab"],
  ["https://bitbucket.org/workspace/repo.git", "workspace", "repo", "bitbucket.org", "bitbucket"],
  ["git@bitbucket.org:workspace/repo.git", "workspace", "repo", "bitbucket.org", "bitbucket"],
])("%s names a repository", (url, owner, name, host, provider) => {
  expect(parseRemoteUrl(url)).toEqual({ owner, name, host, provider });
});

test("a remote that names no repository is not guessed at", () => {
  expect(parseRemoteUrl("/srv/git/bare-repo")).toBeUndefined();
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

import { expect, test } from "vitest";
import { parseRemoteUrl, parseRepoSlug } from "../src/git.js";

test.each([
  ["git@github.com:coldteadotai/pr-lens.git", "coldteadotai", "pr-lens", "github.com"],
  ["https://github.com/coldteadotai/pr-lens.git", "coldteadotai", "pr-lens", "github.com"],
  ["https://github.com/coldteadotai/pr-lens", "coldteadotai", "pr-lens", "github.com"],
  ["ssh://git@github.com/coldteadotai/pr-lens.git", "coldteadotai", "pr-lens", "github.com"],
  ["https://gitlab.example.com/team/group/app.git", "team/group", "app", "gitlab.example.com"],
])("%s names a repository", (url, owner, name, host) => {
  expect(parseRemoteUrl(url)).toEqual({ owner, name, host });
});

test("a remote that names no repository is not guessed at", () => {
  expect(parseRemoteUrl("/srv/git/bare-repo")).toBeUndefined();
});

test("--repo-slug takes owner/name and nothing longer", () => {
  expect(parseRepoSlug("coldteadotai/pr-lens")).toEqual({
    owner: "coldteadotai",
    name: "pr-lens",
    host: "github.com",
  });
  expect(parseRepoSlug("pr-lens")).toBeUndefined();
  expect(parseRepoSlug("a/b/c")).toBeUndefined();
});

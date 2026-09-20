import { describe, expect, it } from "vitest";

import { PROVIDERS, Provider, RepoRef, surfaceFor } from "../src/provider.js";

describe("Provider", () => {
  it("names exactly the three supported forges", () => {
    expect(PROVIDERS).toEqual(["github", "gitlab", "bitbucket"]);
  });

  it.each(["gitea", "GITHUB", "", "github "])("rejects anything else: %j", (value) => {
    expect(Provider.safeParse(value).success).toBe(false);
  });
});

describe("RepoRef", () => {
  const base = {
    provider: "github",
    host: "github.com",
    owner: "coldteadotai",
    repo: "pr-lens",
    repoId: "123456",
  };

  it("accepts each forge's id spelling as a string", () => {
    expect(RepoRef.parse(base).repoId).toBe("123456");
    expect(
      RepoRef.parse({
        ...base,
        provider: "bitbucket",
        host: "bitbucket.org",
        repoId: "{21fa9bf8-b5b2-4891-97ed-d590bad0f871}",
      }).repoId,
    ).toBe("{21fa9bf8-b5b2-4891-97ed-d590bad0f871}");
  });

  it("keeps the slashes of a GitLab subgroup owner", () => {
    const ref = RepoRef.parse({
      ...base,
      provider: "gitlab",
      host: "gitlab.com",
      owner: "group/subgroup/team",
    });
    expect(ref.owner).toBe("group/subgroup/team");
  });

  it.each([
    { ...base, owner: "/leading" },
    { ...base, owner: "trailing/" },
    { ...base, owner: "group//team" },
    { ...base, repo: "a/b" },
    { ...base, repoId: "" },
    { ...base, host: "" },
    { ...base, provider: "gitea" },
    { ...base, extra: "field" },
  ])("rejects malformed references: %j", (input) => {
    expect(RepoRef.safeParse(input).success).toBe(false);
  });
});

describe("surfaceFor", () => {
  it("covers every provider", () => {
    for (const provider of PROVIDERS) expect(surfaceFor(provider)).toBeDefined();
  });

  it("gives GitHub the full surface", () => {
    expect(surfaceFor("github")).toEqual({
      html: true,
      themePair: true,
      collapsibles: true,
      checkboxes: true,
      dialect: "gfm",
      maxChars: 65_536,
    });
  });

  it("gives GitLab HTML without theme pairs, and no checkboxes until the spike proves them", () => {
    expect(surfaceFor("gitlab")).toEqual({
      html: true,
      themePair: false,
      collapsibles: true,
      checkboxes: false,
      dialect: "glfm",
      maxChars: 1_000_000,
    });
  });

  it("gives Bitbucket the pure-Markdown surface", () => {
    expect(surfaceFor("bitbucket")).toEqual({
      html: false,
      themePair: false,
      collapsibles: false,
      checkboxes: false,
      dialect: "python-markdown",
      maxChars: 32_768,
    });
  });
});

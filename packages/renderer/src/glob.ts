const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Path matching for config selectors, with the subset of glob a person
 * actually writes in one: `**` crosses directory boundaries, `*` and `?` do
 * not. Every other character is literal.
 */
export const matchesGlob = (pattern: string, path: string): boolean => {
  const source = pattern
    .split("**")
    .map((crossing) =>
      crossing
        .split("*")
        .map((segment) => segment.split("?").map(escapeRegExp).join("[^/]"))
        .join("[^/]*"),
    )
    .join(".*");

  return new RegExp(`^${source}$`).test(path);
};

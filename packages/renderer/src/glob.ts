import { assertNever } from "@coldtea/pr-lens-schema";

type GlobToken =
  | { readonly kind: "crossDir" }
  | { readonly kind: "cross" }
  | { readonly kind: "star" }
  | { readonly kind: "any" }
  | { readonly kind: "char"; readonly value: string };

const tokenize = (pattern: string): readonly GlobToken[] => {
  const tokens: GlobToken[] = [];
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i]!;
    if (
      ch === "*" &&
      pattern[i + 1] === "*" &&
      pattern[i + 2] === "/" &&
      (i === 0 || pattern[i - 1] === "/")
    ) {
      tokens.push({ kind: "crossDir" });
      i += 2;
    } else if (ch === "*" && pattern[i + 1] === "*") {
      tokens.push({ kind: "cross" });
      i += 1;
    } else if (ch === "*") {
      tokens.push({ kind: "star" });
    } else if (ch === "?") {
      tokens.push({ kind: "any" });
    } else {
      tokens.push({ kind: "char", value: ch });
    }
  }
  return tokens;
};

/**
 * Path matching for config selectors, with the subset of glob a person
 * actually writes in one: `**` crosses directory boundaries, `*` and `?` do
 * not. Every other character is literal.
 */
export const matchesGlob = (pattern: string, path: string): boolean => {
  const n = path.length;
  const reachable = new Uint8Array(n + 1);
  reachable[0] = 1;

  for (const token of tokenize(pattern)) {
    switch (token.kind) {
      case "crossDir": {
        const first = reachable.indexOf(1);
        if (first !== -1) {
          for (let j = first + 1; j <= n; j += 1) {
            if (path[j - 1] === "/") reachable[j] = 1;
          }
        }
        break;
      }
      case "cross":
        for (let j = 1; j <= n; j += 1) {
          if (reachable[j - 1]) reachable[j] = 1;
        }
        break;
      case "star":
        for (let j = 1; j <= n; j += 1) {
          if (path[j - 1] !== "/" && reachable[j - 1]) reachable[j] = 1;
        }
        break;
      case "any":
        for (let j = n; j >= 1; j -= 1) {
          reachable[j] = path[j - 1] !== "/" && reachable[j - 1] ? 1 : 0;
        }
        reachable[0] = 0;
        break;
      case "char":
        for (let j = n; j >= 1; j -= 1) {
          reachable[j] = path[j - 1] === token.value && reachable[j - 1] ? 1 : 0;
        }
        reachable[0] = 0;
        break;
      default:
        return assertNever(token);
    }
  }

  return reachable[n] === 1;
};

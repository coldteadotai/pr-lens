import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** A bundler follows every import, so one `node:` import under the browser entry breaks the canvas build. */
const SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const ENTRY = resolve(SOURCE, "walkthrough/index.ts");

const specifiers = (file: string): string[] =>
  [...readFileSync(file, "utf8").matchAll(/^(?:import|export)[^"']*?from\s+["']([^"']+)["']/gm)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );

const reachable = (entry: string): { files: Set<string>; bare: Set<string> } => {
  const files = new Set<string>();
  const bare = new Set<string>();
  const visit = (file: string): void => {
    if (files.has(file)) return;
    files.add(file);
    for (const specifier of specifiers(file)) {
      if (!specifier.startsWith(".")) {
        bare.add(specifier);
        continue;
      }
      visit(resolve(dirname(file), specifier.replace(/\.js$/, ".ts")));
    }
  };
  visit(entry);
  return { files, bare };
};

describe("the walkthrough entry", () => {
  const graph = reachable(ENTRY);

  it("reaches nothing of node", () => {
    expect([...graph.bare].filter((specifier) => specifier.startsWith("node:"))).toEqual([]);
    expect([...graph.bare]).toEqual(["@coldtea/pr-lens-schema"]);
  });

  it("leaves the drawing, hashing and manifest behind", () => {
    const names = [...graph.files].map((file) => file.slice(SOURCE.length + 1)).sort();
    for (const file of names) expect(file).not.toMatch(/^(render|manifest|svg\/|layout\/|walkthrough\/(embed|tiles|nest|caption))/);
    expect(names).toContain("walkthrough/camera.ts");
    expect(names).toContain("walkthrough/resolve.ts");
  });
});

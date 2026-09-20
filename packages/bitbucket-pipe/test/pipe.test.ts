import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { expect, test } from "vitest";
import { z } from "zod";

const Pipe = z.looseObject({
  name: z.string(),
  image: z.string(),
  description: z.string(),
  variables: z.array(z.looseObject({ name: z.string(), default: z.string() })),
});

const read = async (name: string) => readFile(new URL(`../${name}`, import.meta.url), "utf8");

const pipe = Pipe.parse(parse(await read("pipe.yml")));
const script = await read("pipe/lens.sh");
const dockerfile = await read("Dockerfile");

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

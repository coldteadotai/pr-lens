import { describe, expect, it } from "vitest";
import { render, THEMES } from "../src/index.js";
import { expectGolden } from "./goldens.js";
import { tiers } from "./tiers.js";

const stress = tiers.filter(({ name }) => name.startsWith("tier4") || name.startsWith("tier5"));

describe("the stress fixtures render the bytes their review saw", () => {
  for (const { name, doc } of stress)
    for (const theme of THEMES)
      it(`${name}, ${theme}`, () => {
        const { svg } = render(doc, { lens: "architecture", theme });
        expectGolden(`${name}.architecture.${theme}.svg`, svg);
      });
});

describe("the stress fixtures draw the same bytes twice", () => {
  for (const { name, doc } of stress)
    it(name, () => {
      const draw = () => render(doc, { lens: "architecture", theme: "dark" }).svg;
      expect(draw()).toBe(draw());
    });
});

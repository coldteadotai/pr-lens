import { describe, expect, it } from "vitest";
import { renderAll } from "../src/index.js";
import { corpus } from "./route-corpus.js";
import { arrowsOf, violations, type Arrow } from "./route-invariants.js";

const card = (x: number, y: number) => ({ x, y, width: 100, height: 40 });

const picture = (arrows: Arrow[], cards: Record<string, ReturnType<typeof card>>, merged = false) =>
  violations({ arrows, cards, merged });

describe("the checks themselves", () => {
  const cards = { a: card(0, 0), b: card(200, 0), c: card(0, 200), d: card(200, 200) };

  it("call two arrows on one line, end to end, a shared track", () => {
    const found = picture(
      [
        { id: "b-c", from: "b", to: "c", path: "M250,40 L250,68 L120,68 L120,150 L50,150 L50,200" },
        { id: "a-d", from: "a", to: "d", path: "M100,30 L130,30 L130,60 L160,60 L160,74 L250,74 L250,200" },
      ],
      cards,
    );
    expect(found.map((v) => v.kind)).toEqual(["shared-track"]);
  });

  it("let two arrows cross at a right angle", () => {
    const found = picture(
      [
        { id: "a-d", from: "a", to: "d", path: "M50,40 L50,150 L250,150 L250,200" },
        { id: "b-c", from: "b", to: "c", path: "M250,40 L250,100 L150,100 L150,180 L50,180 L50,200" },
      ],
      cards,
    );
    expect(found.filter((v) => v.kind === "shared-track")).toEqual([]);
  });

  it("let siblings from one card share their trunk", () => {
    const found = picture(
      [
        { id: "a-c", from: "a", to: "c", path: "M50,40 L50,200" },
        { id: "a-d", from: "a", to: "d", path: "M50,40 L50,120 L250,120 L250,200" },
      ],
      cards,
    );
    expect(found).toEqual([]);
  });

  it("call an arrow through a card it does not join a crossing", () => {
    const found = picture([{ id: "c-b", from: "c", to: "b", path: "M50,200 L50,20 L200,20" }], cards);
    expect(found).toContainEqual({ kind: "crosses-card", arrow: "c-b", card: "a" });
  });

  it("call an arrow running along a card it does not join a hug", () => {
    const found = picture([{ id: "c-b", from: "c", to: "b", path: "M50,200 L50,150 L102,150 L102,-20 L250,-20 L250,0" }], cards);
    expect(found).toContainEqual({ kind: "hugs-card", arrow: "c-b", card: "a" });
  });

  it("call two arrowheads on one spot one head, unless the picture merges arrivals", () => {
    const arrows = [
      { id: "a-d", from: "a", to: "d", path: "M50,40 L50,120 L250,120 L250,200" },
      { id: "c-d", from: "c", to: "d", path: "M100,220 L150,220 L150,160 L251,160 L251,200" },
    ];
    expect(picture(arrows, cards).map((v) => v.kind)).toContain("heads-together");
    expect(picture(arrows, cards, true)).toEqual([]);
  });
});

describe("every picture in the repo tells a reader truly what joins what", () => {
  for (const { name, doc } of corpus) {
    const { assets } = renderAll(doc, { themes: ["dark"] });
    for (const rendered of assets) {
      const { lens, view } = rendered.asset;
      if (lens === "data-flow") continue;
      it(`${name} ${view ?? "(whole)"} ${lens}`, () => {
        expect(violations(arrowsOf(doc, lens, rendered.atlas))).toEqual([]);
      });
    }
  }
});

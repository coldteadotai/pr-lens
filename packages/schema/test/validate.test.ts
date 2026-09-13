import { describe, expect, it } from "vitest";
import { postmarkRefactorGraphInput } from "../src/examples/postmark-refactor.js";
import { minimalGraphInput } from "../src/examples/minimal.js";
import type { GraphDocInput } from "../src/graph.js";
import type { ViewInput } from "../src/graph.js";
import { MAX_RENDER_ASSETS, MAX_VIEWS, THEMES } from "../src/primitives.js";
import { postmarkRefactorManifestInput } from "../src/examples/postmark-refactor.js";
import { safeParseConfig, safeParseGraphDoc, safeParseRenderManifest } from "../src/validate.js";
import { SCHEMA_VERSION } from "../src/version.js";
import { clone, expectRejected } from "./helpers.js";

describe("graph document validation", () => {
  it("accepts the goldens", () => {
    expect(safeParseGraphDoc(postmarkRefactorGraphInput).ok).toBe(true);
    expect(safeParseGraphDoc(minimalGraphInput).ok).toBe(true);
  });

  it("applies documented defaults", () => {
    const result = safeParseGraphDoc(minimalGraphInput);
    if (!result.ok) throw result.error;
    expect(result.value.edges).toEqual([]);
    expect(result.value.flows).toEqual([]);
    expect(result.value.views).toEqual([]);
    expect(result.value.nodes[0]?.badges).toEqual([]);
    expect(result.value.provenance.repo.host).toBe("github.com");
  });

  it("names the node and the lane when a lane reference is broken", () => {
    const doc = clone(minimalGraphInput);
    doc.nodes[0]!.lane = "typo-lane";

    const error = expectRejected(doc);
    expect(error.code).toBe("BROKEN_REFERENCE");
    expect(error.issues[0]?.path).toBe("nodes[0].lane");
    expect(error.message).toContain("node 'health-route' references unknown lane 'typo-lane'");
  });

  it("rejects an edge that points at a node nobody declared", () => {
    const doc = clone(postmarkRefactorGraphInput);
    doc.edges![0]!.to = "ghost-node";

    const error = expectRejected(doc);
    expect(error.code).toBe("BROKEN_REFERENCE");
    expect(error.message).toContain("unknown node 'ghost-node'");
  });

  it("rejects duplicate node ids", () => {
    const doc = clone(postmarkRefactorGraphInput);
    doc.nodes.push({ ...doc.nodes[0]!, label: "Copy" });

    const error = expectRejected(doc);
    expect(error.code).toBe("DUPLICATE_ID");
    expect(error.message).toContain("duplicate node id 'broadcast-composer'");
  });

  it("rejects a flow message from a node that is not a participant", () => {
    const doc = clone(postmarkRefactorGraphInput);
    doc.flows![0]!.messages[0]!.from = "broadcast-composer";

    const error = expectRejected(doc);
    expect(error.code).toBe("BROKEN_REFERENCE");
    expect(error.issues[0]?.path).toBe("flows[0].messages[0].from");
  });

  it("rejects a self message whose endpoints differ", () => {
    const doc = clone(postmarkRefactorGraphInput);
    doc.flows![0]!.messages[0]!.kind = "self";

    const error = expectRejected(doc);
    expect(error.code).toBe("INVALID_DOCUMENT");
    expect(error.message).toContain("kind 'self' and from === to must agree");
  });

  it("rejects flows the document does not declare a lens for", () => {
    const doc = clone(postmarkRefactorGraphInput);
    doc.lenses = ["architecture"];

    const error = expectRejected(doc);
    expect(error.message).toContain("does not declare the 'data-flow' lens");
  });

  it("rejects a view scoped to an element that does not exist", () => {
    const doc = clone(postmarkRefactorGraphInput);
    doc.views![0]!.children![0]!.scope = { kind: "selection", nodes: ["not-a-node"] };

    const error = expectRejected(doc);
    expect(error.issues[0]?.path).toBe("views[0].children[0].scope.nodes[0]");
    expect(error.message).toContain("scopes unknown node 'not-a-node'");
  });

  it("rejects unknown keys rather than dropping them", () => {
    const error = expectRejected({ ...minimalGraphInput, findings: [{ severity: "high" }] });
    expect(error.code).toBe("INVALID_DOCUMENT");
    expect(error.message).toContain("findings");
  });

  it("rejects a line range that ends before it starts", () => {
    const doc = clone(minimalGraphInput);
    doc.nodes[0]!.files = [{ path: "src/routes/health.ts", startLine: 40, endLine: 12 }];

    const error = expectRejected(doc);
    expect(error.message).toContain("endLine must be greater than or equal to startLine");
  });

  it.each(["../../etc/passwd", "/etc/passwd", "C:\\Windows\\system32\\file.ts", "src\\index.ts"])(
    "rejects '%s', which cannot become a diff permalink",
    (path) => {
      const doc = clone(minimalGraphInput);
      doc.nodes[0]!.files = [{ path }];

      const error = expectRejected(doc);
      expect(error.message).toContain("repository-relative POSIX path");
    },
  );

  it("keeps a filename that merely contains dots", () => {
    const doc = clone(minimalGraphInput);
    doc.nodes[0]!.files = [{ path: "src/fine..name/health.ts" }];

    expect(safeParseGraphDoc(doc).ok).toBe(true);
  });

  it("rejects a document written against a different contract version", () => {
    const doc = clone(minimalGraphInput);
    doc.schemaVersion = "9.0.0";

    const error = expectRejected(doc);
    expect(error.code).toBe("UNSUPPORTED_SCHEMA_VERSION");
    expect(error.message).toContain(`this package implements ${SCHEMA_VERSION}`);
  });

  it("reports every broken reference at once", () => {
    const doc = clone(postmarkRefactorGraphInput);
    doc.edges![0]!.to = "ghost-one";
    doc.edges![1]!.to = "ghost-two";

    const error = expectRejected(doc);
    expect(error.issues).toHaveLength(2);
  });
});

type StepInput = NonNullable<GraphDocInput["walkthrough"]>["steps"][number];

const withSteps = (steps: readonly StepInput[]): GraphDocInput => ({
  ...postmarkRefactorGraphInput,
  walkthrough: { steps: [...steps] },
});

const stepsOfLength = (count: number): StepInput[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `step-${index}`,
    heading: `Step ${index}`,
    body: `What step ${index} is about.`,
    stage: { kind: "view", view: "overview" } as const,
  }));

describe("walkthroughs", () => {
  it("accepts the tour the reference document carries", () => {
    const result = safeParseGraphDoc(postmarkRefactorGraphInput);
    if (!result.ok) throw result.error;
    expect(result.value.walkthrough?.steps.map((step) => step.id)).toEqual([
      "batches-of-500",
      "suppression-first",
      "old-path-goes-dark",
      "sequence-start-to-finish",
      "four-batch-calls",
      "blast-radius",
    ]);
  });

  it("focuses the whole stage when a step says nothing else", () => {
    const result = safeParseGraphDoc(withSteps(stepsOfLength(2)));
    if (!result.ok) throw result.error;
    expect(result.value.walkthrough?.steps[0]?.focus).toEqual({ kind: "all" });
  });

  it.each([2, 12])("accepts a tour of %i steps", (count) => {
    expect(safeParseGraphDoc(withSteps(stepsOfLength(count))).ok).toBe(true);
  });

  it.each([1, 13])("rejects a tour of %i steps", (count) => {
    expect(safeParseGraphDoc(withSteps(stepsOfLength(count))).ok).toBe(false);
  });

  it("holds a heading to one line", () => {
    const [first, second] = stepsOfLength(2);
    expect(safeParseGraphDoc(withSteps([{ ...first!, heading: "a".repeat(48) }, second!])).ok).toBe(
      true,
    );
    expect(safeParseGraphDoc(withSteps([{ ...first!, heading: "a".repeat(49) }, second!])).ok).toBe(
      false,
    );
  });

  it("holds a body to one line", () => {
    const [first, second] = stepsOfLength(2);
    expect(safeParseGraphDoc(withSteps([{ ...first!, body: "a".repeat(140) }, second!])).ok).toBe(
      true,
    );
    expect(safeParseGraphDoc(withSteps([{ ...first!, body: "a".repeat(141) }, second!])).ok).toBe(
      false,
    );
  });

  it("rejects a step with no body, which reads as a heading someone left unfinished", () => {
    const [first, second] = stepsOfLength(2);
    const error = expectRejected({
      ...postmarkRefactorGraphInput,
      walkthrough: { steps: [{ id: first!.id, heading: first!.heading }, second!] },
    });
    expect(error.issues[0]?.path).toBe("walkthrough.steps[0].body");
  });

  it("rejects a focus that names nothing, rather than reading it as everything", () => {
    const [first, second] = stepsOfLength(2);
    const error = expectRejected(
      withSteps([{ ...first!, focus: { kind: "selection" } }, second!]),
    );
    expect(error.message).toContain("a selection must name at least one element");
  });

  it("rejects two steps sharing an id", () => {
    const [first, second] = stepsOfLength(2);
    const error = expectRejected(withSteps([first!, { ...second!, id: first!.id }]));
    expect(error.code).toBe("DUPLICATE_ID");
    expect(error.message).toContain("duplicate step id 'step-0'");
  });

  it("rejects a step staged on a view the document does not have", () => {
    const [first, second] = stepsOfLength(2);
    const error = expectRejected(
      withSteps([{ ...first!, stage: { kind: "view", view: "no-such-view" } }, second!]),
    );
    expect(error.code).toBe("BROKEN_REFERENCE");
    expect(error.issues[0]?.path).toBe("walkthrough.steps[0].stage.view");
    expect(error.message).toContain("stages unknown view 'no-such-view'");
  });

  it("rejects a step staged on a flow the document does not have", () => {
    const [first, second] = stepsOfLength(2);
    const error = expectRejected(
      withSteps([{ ...first!, stage: { kind: "flow", flow: "no-such-flow" } }, second!]),
    );
    expect(error.code).toBe("BROKEN_REFERENCE");
    expect(error.issues[0]?.path).toBe("walkthrough.steps[0].stage.flow");
  });

  it("rejects a focus on an element the document does not have", () => {
    const [first, second] = stepsOfLength(2);
    const error = expectRejected(
      withSteps([{ ...first!, focus: { kind: "selection", nodes: ["ghost"] } }, second!]),
    );
    expect(error.issues[0]?.path).toBe("walkthrough.steps[0].focus.nodes[0]");
    expect(error.message).toContain("focuses unknown node 'ghost'");
  });

  it("accepts a step with no stage at all, which plays over the picture already shown", () => {
    const [first, second] = stepsOfLength(2);
    const doc = withSteps([
      {
        id: first!.id,
        heading: first!.heading,
        body: first!.body,
        focus: { kind: "selection", nodes: ["postmark"] },
      },
      second!,
    ]);
    expect(safeParseGraphDoc(doc).ok).toBe(true);
  });

  it("accepts flow steps focused through the flow on the stage", () => {
    const [first, second] = stepsOfLength(2);
    const doc = withSteps([
      {
        ...first!,
        stage: { kind: "flow", flow: "send-pipeline" },
        focus: { kind: "selection", messages: ["batch-post"] },
      },
      second!,
    ]);
    expect(safeParseGraphDoc(doc).ok).toBe(true);
  });

  it("accepts flow steps focused through a view that draws everything", () => {
    const [first, second] = stepsOfLength(2);
    const doc = withSteps([
      {
        ...first!,
        stage: { kind: "view", view: "overview" },
        focus: { kind: "selection", messages: ["batch-post"] },
      },
      second!,
    ]);
    expect(safeParseGraphDoc(doc).ok).toBe(true);
  });

  it("rejects flow steps focused through a view that draws no flow", () => {
    const [first, second] = stepsOfLength(2);
    const error = expectRejected(
      withSteps([
        {
          ...first!,
          stage: { kind: "view", view: "retired-path" },
          focus: { kind: "selection", messages: ["batch-post"] },
        },
        second!,
      ]),
    );
    expect(error.code).toBe("BROKEN_REFERENCE");
    expect(error.issues[0]?.path).toBe("walkthrough.steps[0].focus.messages[0]");
    expect(error.message).toContain("which no flow on its stage carries");
  });

  it("rejects flow steps focused with no stage to draw them on", () => {
    const [first, second] = stepsOfLength(2);
    const error = expectRejected(
      withSteps([
        {
          id: first!.id,
          heading: first!.heading,
          body: first!.body,
          focus: { kind: "selection", messages: ["batch-post"] },
        },
        second!,
      ]),
    );
    expect(error.code).toBe("INVALID_DOCUMENT");
    expect(error.issues[0]?.path).toBe("walkthrough.steps[0].focus.messages");
    expect(error.message).toContain("names no stage to draw them on");
  });

  it("reports a stage that points nowhere once, not once per step it focuses", () => {
    const [first, second] = stepsOfLength(2);
    const error = expectRejected(
      withSteps([
        {
          ...first!,
          stage: { kind: "flow", flow: "no-such-flow" },
          focus: { kind: "selection", messages: ["batch-post", "batch-results"] },
        },
        second!,
      ]),
    );
    expect(error.issues).toHaveLength(1);
  });
});

/** One view per level, so the tree's depth rather than its breadth carries the count. */
const nestedViews = (count: number): ViewInput[] => {
  let children: ViewInput[] = [];
  for (let index = count - 1; index >= 0; index -= 1)
    children = [
      { id: `v${index}`, title: `View ${index}`, lens: "architecture", scope: { kind: "all" }, children },
    ];
  return children;
};

describe("the drill-down tree and the render it implies", () => {
  it("is one rule: every view fits a manifest at every theme", () => {
    expect(MAX_VIEWS * THEMES.length).toBe(MAX_RENDER_ASSETS);
  });

  it("accepts a tree a render can describe", () => {
    const doc = { ...minimalGraphInput, views: nestedViews(MAX_VIEWS) };
    expect(safeParseGraphDoc(doc).ok).toBe(true);
  });

  it("rejects one view more, which no valid manifest could describe", () => {
    const doc = { ...minimalGraphInput, views: nestedViews(MAX_VIEWS + 1) };

    const error = expectRejected(doc);
    expect(error.issues[0]?.path).toBe("views");
    expect(error.message).toContain("one asset per view per theme");
  });

  it("reports a tree too deep to read rather than exhausting the stack", () => {
    const doc = { ...minimalGraphInput, views: nestedViews(5000) };

    const error = expectRejected(doc);
    expect(error.code).toBe("INVALID_DOCUMENT");
    expect(error.message).toContain("nests too deeply to read");
  });

  it("accepts a manifest at the asset budget and rejects one past it", () => {
    const asset = postmarkRefactorManifestInput.assets[0]!;
    const manifestOf = (count: number) => ({
      ...postmarkRefactorManifestInput,
      assets: Array.from({ length: count }, (_, index) => ({ ...asset, id: `asset-${index}` })),
    });

    expect(safeParseRenderManifest(manifestOf(MAX_RENDER_ASSETS)).ok).toBe(true);
    expect(safeParseRenderManifest(manifestOf(MAX_RENDER_ASSETS + 1)).ok).toBe(false);
  });
});

describe("config validation", () => {
  it("fills in the defaults a repository omits", () => {
    const result = safeParseConfig({ schemaVersion: SCHEMA_VERSION });
    if (!result.ok) throw result.error;
    expect(result.value.lenses).toEqual(["architecture", "data-flow"]);
    expect(result.value.branding).toBe(true);
    expect(result.value.map).toEqual({ rename: [], exclude: [], lane: [], group: [] });
  });

  it("rejects lenses this version does not ship", () => {
    const result = safeParseConfig({ schemaVersion: SCHEMA_VERSION, lenses: ["security"] });
    expect(result.ok).toBe(false);
  });

  it("requires a repository to declare which contract its corrections target", () => {
    const result = safeParseConfig({ lenses: ["architecture"] });
    expect(result.ok).toBe(false);
  });
});

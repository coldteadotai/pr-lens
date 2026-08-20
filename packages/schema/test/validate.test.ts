import { describe, expect, it } from "vitest";
import { postmarkRefactorGraphInput } from "../src/examples/postmark-refactor.js";
import { minimalGraphInput } from "../src/examples/minimal.js";
import type { GraphDocInput } from "../src/graph.js";
import { safeParseConfig, safeParseGraphDoc } from "../src/validate.js";
import { SCHEMA_VERSION } from "../src/version.js";

const clone = (doc: GraphDocInput): GraphDocInput => structuredClone(doc);

const expectRejected = (input: unknown) => {
  const result = safeParseGraphDoc(input);
  if (result.ok) throw new Error("expected the document to be rejected");
  return result.error;
};

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

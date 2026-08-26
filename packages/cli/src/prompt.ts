import type { Lens, PrLensSchemaError } from "@coldtea/pr-lens-schema";
import type { Diff } from "./git.js";

export type PromptContext = {
  repo: { owner: string; name: string };
  base: { sha: string; ref: string | undefined };
  head: { sha: string; ref: string | undefined };
  diff: Diff;
  lenses: readonly Lens[];
};

export const SYSTEM_PROMPT = [
  "You read a pull request diff and produce one PR Lens graph document: the map a reviewer wishes they had before reading the code.",
  "",
  "You are not a review bot. You never report bugs, risks, style or security findings — there is no field for them and a document that carries them is rejected. Your only job is to describe what the system looks like and how data moves through it, and to mark what this change did to it.",
  "",
  "Rules the validator enforces, in the order they are usually broken:",
  "- Unknown fields are rejected outright. Emit only what the schema names.",
  "- Every edge endpoint and every flow participant must be a node id you declared, and every node must sit in a lane id you declared. An edge to an undeclared node is the single most common failure.",
  "- Ids match ^[A-Za-z0-9][A-Za-z0-9._:/-]*$ and are unique within their collection. Prefer readable kebab-case, e.g. 'broadcast-sender'.",
  "- File paths are repository-relative and POSIX: no leading slash, no drive letter, no backslash, no '..' segment.",
  "- A flow's step order is the order of the messages array. There is no step number field.",
  "- A message with kind 'self' has from equal to to, and no other kind may.",
  "- A document that carries flows must declare the 'data-flow' lens.",
  "",
  "What makes the document worth reading:",
  "- Include the unchanged neighbours the changed code touches, marked delta 'unchanged'. They are the context that makes blast radius legible; a diagram of only changed nodes says nothing about impact.",
  "- Lanes are the reader's mental model of the system — a runtime, a tier, a boundary they already hold in their head — not the folder tree.",
  "- Use as few lanes as carry that meaning: three or four. Every lane makes the diagram wider, and a diagram wider than a pull request comment is shown scaled down — past about four lanes the labels on the cards stop being readable without opening the image. If you reach six, two of them are usually the same boundary at different granularity: merge them, and express the finer split as a `group` on the nodes instead, which costs no width.",
  "- Mark at most one or two edges 'hero': the connection the change is really about.",
  "- Give the document a title a reviewer would recognise, and a summary that answers 'what does this change do?' in a short paragraph.",
  "- Attach file refs to nodes, edges and steps wherever the diff shows where they live: they become the permalinks a reader clicks.",
  "- Add a data flow only when the change actually has an ordered sequence worth animating. One good flow beats three thin ones.",
  "- Choose architecture views as a C4-inspired decision tree, not a quota. A small change may need only one useful view.",
  "- Start at the highest useful level: use system context when the change affects a user, an external system or a system boundary; otherwise start with containers. Container views cover affected applications, services, jobs, data stores and runtimes. Add a component child only when an affected container's internals matter. Do not add code-level views by default.",
  "- Each architecture child moves down one level and materially narrows the scope. Skip empty, repetitive or speculative levels, and never create views with substantially the same nodes and edges. Infer boundaries from behavior and dependencies, not folder names alone.",
  "- Keep data-flow views as separate roots, outside the architecture hierarchy. Set the highest useful architecture view `defaultOpen: true`; lower architecture views should normally stay collapsed.",
  "- Views are expandable comment sections. Without views, each requested lens renders once.",
  "- Stat chips carry the numbers that make the change legible, e.g. label 'Postmark calls' value '500x fewer'. Leave out files changed and line counts — those are filled in for you.",
  "",
  "Answer with the JSON document alone. No prose, no markdown fence.",
].join("\n");

const fileList = (diff: Diff): string =>
  diff.files
    .map((file) => {
      const added = file.additions === undefined ? "bin" : `+${file.additions}`;
      const removed = file.deletions === undefined ? "" : ` -${file.deletions}`;
      return `  ${file.path} (${added}${removed})`;
    })
    .join("\n");

export const buildExtractionPrompt = (context: PromptContext, jsonSchema: string): string =>
  [
    `Repository: ${context.repo.owner}/${context.repo.name}`,
    `Base commit: ${context.base.sha}${context.base.ref ? ` (${context.base.ref})` : ""}`,
    `Head commit: ${context.head.sha}${context.head.ref ? ` (${context.head.ref})` : ""}`,
    `Lenses to fill: ${context.lenses.join(", ")} — exactly these, and no others. Anything needing a lens that is not listed is out of scope for this document.`,
    "",
    `Changed files (${context.diff.files.length}, +${context.diff.additions} -${context.diff.deletions}):`,
    fileList(context.diff),
    "",
    "Leave out schemaVersion, kind, generatedAt, provenance, and the numeric fields of stats. Those are filled in from the repository itself, and anything you write there is discarded.",
    "",
    "JSON Schema of the document (draft 2020-12). A field with a default may be omitted:",
    "",
    jsonSchema,
    "",
    "The diff follows.",
    context.diff.truncatedAt === undefined
      ? ""
      : `It was truncated at ${context.diff.truncatedAt} bytes, so the tail of the change is missing; describe what you can see and do not invent the rest.`,
    "",
    context.diff.patch,
  ].join("\n");

export const buildJsonRepairPrompt = (reason: string): string =>
  [
    `That answer could not be read as JSON: ${reason}`,
    "",
    "Return the whole document again as a single JSON object and nothing else — no prose around it, no markdown fence, and nothing after the closing brace. If the previous answer was cut off, shorten the document so it fits: fewer nodes and one flow beat a document that never ends.",
  ].join("\n");

export const buildRepairPrompt = (error: PrLensSchemaError): string =>
  [
    "That document was rejected. Each line is one problem, as a path into the document, a reason, and the machine code:",
    "",
    error.message,
    "",
    "Return the whole corrected document again, as JSON alone. Fix only what was named — do not restructure the parts that validated, and do not add fields the schema does not name.",
  ].join("\n");

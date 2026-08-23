import { assertNever } from "@coldtea/pr-lens-schema";
import { dirname, join, resolve } from "node:path";
import { git } from "./git.js";
import { readTextFile, writeTextFile } from "./io.js";
import type { Terminal } from "./terminal.js";

/**
 * Where the CLI leaves what it makes, unless someone says otherwise.
 *
 * A dot-directory, and ignored by git from the first write, because none of it
 * is source. The SVGs, the document they were drawn from and the manifest are
 * a preview of the comment, rebuilt from the diff whenever anyone wants it
 * again. A working tree that fills with them leaves the user deciding what to
 * commit, and the answer is always none of it.
 */
export const WORKSPACE_DIR = ".pr-lens";

const README_NAME = "README.md";

const ignoreEntry = (pattern: string): string =>
  `# PR Lens writes its previews here. They are rebuilt on demand.\n${pattern}/\n`;

/** Where a directory sits in its repository: the root, and its path below it. */
type Location = { root: string; prefix: string };

/**
 * Asked of git rather than computed from the two paths, because on macOS the
 * root comes back through /private and the working directory usually does not,
 * and subtracting one from the other then yields a climb out of the repository.
 */
const locate = async (from: string): Promise<Location> => {
  const [root = "", prefix = ""] = (
    await git(from, ["rev-parse", "--show-toplevel", "--show-prefix"])
  )
    .split("\n")
    .map((line) => line.trim());

  return { root, prefix };
};

/**
 * Whether git already ignores this workspace. Asked of git rather than worked
 * out from the file, because a pattern that looks right often is not: at the
 * root of a repository `/.pr-lens/` covers the root and nothing below it, and
 * two leading spaces are part of the pattern and so cover nothing at all.
 * Reading the entry back and deciding it means what we would have meant is how
 * a run leaves the previews visible while reporting them handled.
 *
 * The question is asked about a file inside the workspace, not the directory:
 * a pattern ending in a slash matches directories only, and git cannot tell
 * that a path which does not exist yet would have been one.
 */
const alreadyIgnored = (root: string, workspace: string): Promise<boolean> =>
  git(root, ["check-ignore", "-q", "--", join(workspace, README_NAME)]).then(
    () => true,
    () => false,
  );

/**
 * A line that un-ignores a workspace, and how far its choice reaches: a bare
 * name holds at any depth, while a pattern carrying a slash anywhere but its
 * end is anchored to the root and speaks for one directory only.
 */
type Negation = { kind: "anywhere" } | { kind: "one"; workspace: string };

/**
 * The negations a .gitignore makes about a PR Lens workspace.
 *
 * git will not answer this one. When a negation wins, `check-ignore` reports
 * the path as matching nothing at all — the same answer it gives for a path
 * nobody has mentioned — so the file has to be read, and read the way git reads
 * it. `!/.pr-lens/` at the root is a choice about the root's own previews and
 * says nothing about a workspace inside a subdirectory.
 *
 * Only literal names are recognised. A negation written with wildcards is not,
 * and the entry is added despite it — a line in a .gitignore is visible, the
 * CLI names the file it wrote, and the user can take it back.
 */
const negations = (gitignore: string): Negation[] =>
  gitignore.split("\n").flatMap((line): Negation[] => {
    const pattern = line.trimEnd();
    if (!pattern.startsWith("!")) return [];

    const body = pattern.slice(1).replace(/\/+$/, "");
    if (!body.includes("/")) return body === WORKSPACE_DIR ? [{ kind: "anywhere" }] : [];

    const workspace = body.replace(/^\//, "");
    return workspace.endsWith(WORKSPACE_DIR) ? [{ kind: "one", workspace }] : [];
  });

const spares = (negation: Negation, workspace: string): boolean => {
  switch (negation.kind) {
    case "anywhere":
      return true;
    case "one":
      return negation.workspace === workspace;
    default:
      return assertNever(negation, "Unhandled negation");
  }
};

/**
 * Adds the workspace to the repository's .gitignore, and says so. Answers with
 * the file it wrote, or nothing when there was nothing to do.
 *
 * Nothing is written when git already ignores the previews, or when the
 * repository un-ignores this workspace on purpose: a user who chose to track
 * these files has chosen.
 *
 * The entry is normally unanchored, so it holds wherever in the tree the CLI is
 * run. It is narrowed to this one workspace when the repository un-ignores a
 * different one, since an unanchored line lands last and would overrule that
 * choice on its way past.
 */
export const ignoreWorkspace = async (workspace: string): Promise<string | undefined> => {
  const location = await locate(dirname(workspace)).catch(() => undefined);
  if (location === undefined) return undefined;
  if (await alreadyIgnored(location.root, workspace)) return undefined;

  const path = join(location.root, ".gitignore");
  const existing = (await readTextFile(path).catch(() => undefined)) ?? "";

  const mine = `${location.prefix}${WORKSPACE_DIR}`;
  const spared = negations(existing);
  if (spared.some((negation) => spares(negation, mine))) return undefined;

  const before = existing === "" || existing.endsWith("\n") ? existing : `${existing}\n`;
  const entry = ignoreEntry(spared.length > 0 ? mine : WORKSPACE_DIR);
  return writeTextFile(path, `${before}${before === "" ? "" : "\n"}${entry}`);
};

const README = `# .pr-lens

PR Lens writes its previews here: the diagrams as light and dark SVGs, the
document they were drawn from, and the manifest describing them.

None of it belongs in a commit. Every file is rebuilt from the diff by
\`pr-lens analyze\` and \`pr-lens render\`, so a stale copy in the history is
worth less than nothing — it is a diagram of a pull request somebody already
merged. What readers are meant to see is the comment on the pull request, or
the share page it links to.

Delete the directory whenever you like. Nothing reads it back.
`;

/**
 * Prepares the workspace on the way to writing in it: the README that says
 * what the directory is, and the .gitignore entry that keeps anyone from
 * having to ask.
 *
 * Both are skipped when --out named somewhere else. That directory is the
 * user's, and so is the question of what to do with it.
 */
export const prepareWorkspace = async (out: string, terminal: Terminal): Promise<void> => {
  const directory = resolve(out);
  if (directory !== resolve(WORKSPACE_DIR)) return;

  await writeTextFile(join(directory, README_NAME), README);

  const ignored = await ignoreWorkspace(directory);
  if (ignored !== undefined) terminal.err(`✓ ${ignored} — ${WORKSPACE_DIR}/ is ignored`);
};

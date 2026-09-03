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

/**
 * A path written into a .gitignore is read as a pattern, not as a name. A
 * directory called `sub[1]` spells a character class that matches neither
 * bracket; one beginning with `#` turns the line into a comment and one
 * beginning with `!` turns it into another negation. Each leaves the previews
 * visible under an entry that looks like it was written correctly.
 *
 * Trailing spaces want no escape here. git strips them from the end of a
 * pattern, and every pattern this writes ends in a slash.
 */
const asPattern = (path: string): string =>
  path.replace(/[\\*?[\]]/g, (character) => `\\${character}`).replace(/^([#!])/, "\\$1");

/** The name a pattern stands for, with the escapes git reads taken back off. */
const asLiteral = (pattern: string): string => pattern.replace(/\\(.)/g, "$1");

const ignoreEntry = (path: string): string =>
  `# PR Lens writes its previews here. They are rebuilt on demand.\n${asPattern(path)}/\n`;

/** Where a directory sits in its repository: the root, and its path below it. */
type Location = { root: string; prefix: string };

/**
 * Asked of git rather than computed from the two paths, because on macOS the
 * root comes back through /private and the working directory usually does not,
 * and subtracting one from the other then yields a climb out of the repository.
 *
 * Only the record terminator comes off each line. A directory may legitimately
 * begin or end with a space, and trimming one writes a rule for a directory
 * nobody has.
 */
const locate = async (from: string): Promise<Location> => {
  const [root = "", prefix = ""] = (
    await git(from, ["rev-parse", "--show-toplevel", "--show-prefix"])
  )
    .split("\n")
    .map((line) => line.replace(/\r$/, ""));

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
 * The question is about the directory, and nothing standing in for it. A rule
 * covering one file inside — `README.md` is a common one to carry — answers
 * for that file and for nothing beside it, and taking it as settled leaves
 * every SVG and both documents in the working tree.
 *
 * The directory has to exist to be recognised as one, since a pattern ending
 * in a slash matches directories only. It does: the caller writes into it
 * first, for this reason.
 */
const alreadyIgnored = (root: string, workspace: string): Promise<boolean> =>
  git(root, ["check-ignore", "-q", "--", workspace]).then(
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

    const body = asLiteral(pattern.slice(1)).replace(/\/+$/, "");
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
 * the file it wrote, or nothing when there was nothing to do. Call it once the
 * workspace directory exists, so git can see that it is one.
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

None of that belongs in a commit. Those files are rebuilt from the diff by
\`pr-lens analyze\` and \`pr-lens render\`, so a stale copy in the history is
worth less than nothing — it is a diagram of a pull request somebody already
merged. What readers are meant to see is the comment on the pull request, or
the share page it links to. Delete them whenever you like; nothing reads them
back.

\`canvas.json\` is the exception. It holds the write token for every canvas
this checkout has pushed with \`pr-lens canvas push\`, and nothing can rebuild
it. Without it the canvases stay readable by everyone, but pushing to them
again needs the edit link you were given. Keep it out of commits and out of
other people's hands.
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

  // The README first, which is what puts the directory on disk: git is asked
  // whether a directory is ignored, and one that is not there cannot be.
  await writeTextFile(join(directory, README_NAME), README);

  const ignored = await ignoreWorkspace(directory);
  if (ignored !== undefined) terminal.err(`✓ ${ignored} — ${WORKSPACE_DIR}/ is ignored`);
};

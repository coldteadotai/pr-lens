import { dirname, join, resolve } from "node:path";
import { git, repositoryRoot } from "./git.js";
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

const IGNORE_ENTRY = `# PR Lens writes its previews here. They are rebuilt on demand.
${WORKSPACE_DIR}/
`;

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

/** A line that deliberately un-ignores the workspace, in any of its spellings. */
const unIgnoresWorkspace = (gitignore: string): boolean =>
  gitignore.split("\n").some((line) => {
    const trimmed = line.trimEnd();
    if (!trimmed.startsWith("!")) return false;
    return trimmed.slice(1).replace(/^\//, "").replace(/\/$/, "") === WORKSPACE_DIR;
  });

/**
 * Adds the workspace to the repository's .gitignore, and says so. Answers with
 * the file it wrote, or nothing when there was nothing to do.
 *
 * The entry carries no leading slash, so it holds wherever in the tree the CLI
 * was run from — a run inside a subdirectory writes to the root file and is
 * covered by it. Nothing is written when git already ignores the workspace, or
 * when the repository un-ignores it on purpose: a user who chose to track these
 * files has chosen.
 */
export const ignoreWorkspace = async (workspace: string): Promise<string | undefined> => {
  const root = await repositoryRoot(dirname(workspace)).catch(() => undefined);
  if (root === undefined) return undefined;
  if (await alreadyIgnored(root, workspace)) return undefined;

  const path = join(root, ".gitignore");
  const existing = (await readTextFile(path).catch(() => undefined)) ?? "";
  if (unIgnoresWorkspace(existing)) return undefined;

  const before = existing === "" || existing.endsWith("\n") ? existing : `${existing}\n`;
  return writeTextFile(path, `${before}${before === "" ? "" : "\n"}${IGNORE_ENTRY}`);
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
  if (ignored !== undefined) terminal.err(`✓ ${ignored} — added ${WORKSPACE_DIR}/`);
};

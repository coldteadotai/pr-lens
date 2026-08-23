import { dirname, join, resolve } from "node:path";
import { repositoryRoot } from "./git.js";
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

/** Every spelling of the entry that means the same thing to git. */
const listsWorkspace = (gitignore: string): boolean =>
  gitignore.split("\n").some((line) => {
    const body = line.trim().replace(/^!/, "").replace(/^\//, "").replace(/\/$/, "");
    return body === WORKSPACE_DIR;
  });

const IGNORE_ENTRY = `# PR Lens writes its previews here. They are rebuilt on demand.
${WORKSPACE_DIR}/
`;

/**
 * Adds the workspace to the repository's .gitignore, and says so. Answers with
 * the file it wrote, or nothing when there was nothing to do.
 *
 * The entry carries no leading slash, so it holds wherever in the tree the CLI
 * was run from. A line already naming the directory is left exactly as it is,
 * including one that un-ignores it: running the CLI twice must not stack up
 * copies, and a user who chose to track these files has chosen.
 */
export const ignoreWorkspace = async (from: string): Promise<string | undefined> => {
  const root = await repositoryRoot(from).catch(() => undefined);
  if (root === undefined) return undefined;

  const path = join(root, ".gitignore");
  const existing = (await readTextFile(path).catch(() => undefined)) ?? "";
  if (listsWorkspace(existing)) return undefined;

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

  await writeTextFile(join(directory, "README.md"), README);

  const ignored = await ignoreWorkspace(dirname(directory));
  if (ignored !== undefined) terminal.err(`✓ ${ignored} — added ${WORKSPACE_DIR}/`);
};

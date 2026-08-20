import { expectOne, parseOptions, readString } from "../args.js";
import { invalidDocument, readGraphDoc } from "../document.js";
import { PrLensCliError, usageError } from "../errors.js";
import { writeJsonFile } from "../io.js";
import { toStoredMap } from "../snapshot.js";
import type { Terminal } from "../terminal.js";

const DEFAULT_OUT = ".github/pr-lens.map.json";

export const USAGE = `pr-lens export <graph.json> [options]

Turns a pull-request document into the stored map of the system once that pull
request has merged: elements the change deletes are dropped, the rest stops
being annotated, and the result is stamped with the single commit it reflects.

The map is a snapshot, not a source of truth — nothing reads it back into the
pipeline. Committing it gives a repository something to read, to diff, and to
hand an agent.

  -o, --out <file>   where to write it (default ${DEFAULT_OUT})
      --id <id>      map id, so a patch can name it (default <owner>/<name>)
      --sha <sha>    the commit it reflects, in full (default the document's head)`;

export const exportCommand = async (args: readonly string[], terminal: Terminal): Promise<void> => {
  const { values, positionals } = parseOptions(args, {
    out: { type: "string", short: "o" },
    id: { type: "string" },
    sha: { type: "string" },
  });

  const source = expectOne(positionals, "one graph document to export");
  if (/^https?:\/\//.test(source))
    throw usageError(
      "export reads a local graph document",
      "fetching a map from a hosted pipeline is not something the CLI does yet",
    );

  const graph = await readGraphDoc(source);
  const out = readString(values.out, "out") ?? DEFAULT_OUT;

  const stored = toStoredMap(graph, {
    id: readString(values.id, "id") ?? `${graph.provenance.repo.owner}/${graph.provenance.repo.name}`,
    sha: readString(values.sha, "sha") ?? graph.provenance.head.sha,
    generatedAt: new Date().toISOString(),
  });

  if (!stored.ok) {
    if (stored.error.code === "NOT_A_SNAPSHOT" || stored.error.code === "PATCH_CONFLICT")
      throw new PrLensCliError(
        "INVALID_DOCUMENT",
        `${source} cannot be exported as a stored map [${stored.error.code}]`,
        stored.error.message,
      );
    throw invalidDocument(source, "graph", stored.error);
  }

  const written = await writeJsonFile(out, stored.value);
  terminal.out(
    `✓ ${written} — stored map of ${stored.value.provenance.repo.owner}/${stored.value.provenance.repo.name} at ${stored.value.provenance.head.sha.slice(0, 7)} · ${stored.value.nodes.length} nodes, ${stored.value.edges.length} edges`,
  );
};

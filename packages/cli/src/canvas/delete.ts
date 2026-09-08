import { deleteCanvas } from "./api.js";
import { usageError } from "../errors.js";
import type { Terminal } from "../terminal.js";
import { parseOptions, readString } from "../args.js";
import { selectCanvas, readRegistry, updateRegistry } from "./registry.js";
import { readApi, requireWriteToken, settlePendingRotation } from "./write.js";

export const deleteCommand = async (
  args: readonly string[],
  terminal: Terminal,
  env: Record<string, string | undefined>,
): Promise<void> => {
  const { values, positionals } = parseOptions(args, {
    canvas: { type: "string" },
    api: { type: "string" },
  });
  if (positionals.length > 0)
    throw usageError(
      `delete takes no positional arguments, got ${positionals.join(" ")}`,
    );

  const api = readApi(values.api, env);

  const registry = await readRegistry();

  const ref = readString(values.canvas, "canvas");
  const selected = selectCanvas(registry, ref);

  const target = await settlePendingRotation(api, selected, terminal);
  await deleteCanvas(api, target.id, requireWriteToken(target));

  await updateRegistry((current) => {
    if (current.canvases[target.id]?.api === api)
      delete current.canvases[target.id];
  }, terminal);
  terminal.out(
    `✓ deleted ${target.id} from ${api}; local graph and SVG files kept`,
  );
};

/**
 * The write token is the only proof, and it rides in every edit link ever
 * shared, so claiming retires it in the same step.
 */
import { requireToken } from "../auth.js";
import type { Terminal } from "../terminal.js";
import { claimCanvas, listOwnedCanvases } from "./api.js";
import { expectOne, parseOptions } from "../args.js";
import { PrLensCliError } from "../errors.js";
import { readApi, requireWriteToken, settlePendingRotation } from "./write.js";
import {
  findCanvas,
  mintWriteToken,
  readRegistry,
  REGISTRY_PATH,
  updateRegistry,
} from "./registry.js";

const unfinishedClaim = (error: PrLensCliError): PrLensCliError =>
  new PrLensCliError(
    error.code,
    `${error.message}; the claim may have landed`,
    [
      error.details,
      "run pr-lens canvas claim again: the token it minted is kept, and a second run finishes the claim",
    ]
      .filter((line) => line !== undefined && line !== "")
      .join("\n"),
  );

export const claimCommand = async (
  args: readonly string[],
  terminal: Terminal,
  env: Record<string, string | undefined>,
): Promise<void> => {
  const { values, positionals } = parseOptions(args, {
    api: { type: "string" },
  });
  const ref = expectOne(positionals, "the id or name of a canvas to claim");

  const api = readApi(values.api, env);
  const registry = await readRegistry();
  const selected = findCanvas(registry, ref);

  // Checked first, so a signed-out machine never costs a rotation.
  const account = await requireToken(env, api);

  // Also finishes a claim whose answer was lost: its token is still pending.
  const settled = await settlePendingRotation(api, selected, terminal, env);
  const id = settled.id;

  // Unlike push and delete, ownership cannot stand in: claiming is how a
  // canvas gets an owner.
  requireWriteToken(settled);

  // The app treats an owner's claim as a replay and rotates, so running the
  // command twice would retire a token for nothing.
  const mine = await listOwnedCanvases(api, account);
  if (mine.some((canvas) => canvas.id === id))
    throw new PrLensCliError(
      "CANVAS_OWNED",
      `${id} is already yours on ${new URL(api).host}`,
      "claiming it again would retire its write token for nothing",
    );

  terminal.err("! Claiming rotates this canvas's write token.");
  terminal.err("  Edit links you have already shared will stop working.");

  // Saved first, so a lost answer does not lose the token.
  const nextToken = mintWriteToken();
  let saved = false;
  await updateRegistry((current) => {
    const entry = current.canvases[id];
    if (entry === undefined || entry.api !== api) return;
    current.canvases[id] = { ...entry, pending: nextToken };
    saved = true;
  }, terminal);
  if (!saved)
    throw new PrLensCliError(
      "CANVAS_UNREGISTERED",
      `${id} is no longer in ${REGISTRY_PATH}`,
    );

  const claimed = await claimCanvas(
    api,
    id,
    account,
    requireWriteToken(settled),
    nextToken,
  ).catch(async (error: unknown) => {
    if (!(error instanceof PrLensCliError)) throw error;
    // Only these two mean the app did not rotate. Anything else may have
    // landed, so the pending token stays for the next run to finish.
    if (error.code !== "CANVAS_UNKNOWN" && error.code !== "CANVAS_OWNED")
      throw unfinishedClaim(error);

    await updateRegistry((current) => {
      const entry = current.canvases[id];
      if (entry === undefined || entry.pending !== nextToken || entry.api !== api)
        return;
      current.canvases[id] = { ...entry, pending: undefined };
    }, terminal);
    throw error;
  });

  // A different token pending by now belongs to a later rotation.
  await updateRegistry((current) => {
    const entry = current.canvases[id];
    if (entry === undefined || entry.pending !== nextToken || entry.api !== api)
      return;
    current.canvases[id] = {
      ...entry,
      writeToken: nextToken,
      pending: undefined,
    };
  }, terminal);

  const view = new URL(claimed.editUrl);
  view.hash = "";
  terminal.out(`✓ ${view.href} is yours`);
  terminal.out(
    `  Its new write token is in ${REGISTRY_PATH}, so this checkout can push to it.`,
  );
  terminal.out(
    "  Edit links you shared before this still open the page, and no longer edit it.",
  );
};

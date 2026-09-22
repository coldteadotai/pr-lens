/**
 * Taking a canvas onto the account this machine is signed in to.
 *
 * For a canvas pushed from a machine that is gone, or from a checkout nobody
 * has any more. Possession of the write token is the only proof on offer, and
 * that token rides in the fragment of every edit link ever pasted into a chat
 * — so claiming retires it in the same step. Whoever claims walks away with a
 * token nobody else has seen, and the links already handed out stop editing.
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
      "run pr-lens canvas claim again: the token it minted is kept, and asking again with the same pair is how a lost answer is finished",
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

  // Before anything is sent: a machine that is not signed in has nothing to
  // claim onto, and finding that out must not cost a rotation.
  const account = await requireToken(env, api);

  // A rotation left half done would have this checkout offering a token the
  // app has already replaced. It also finishes a claim whose answer was lost:
  // the token that claim minted is pending, the app has it on record, and
  // rotating onto it is answered "rotated".
  const settled = await settlePendingRotation(api, selected, terminal);
  const id = settled.id;

  // Asked rather than attempted. The app treats a claim from the owner as a
  // replay and finishes it, which is right for a lost answer and wrong for a
  // command run twice — the second run would retire a token nobody asked to
  // retire. Whoever wins the race to own it is still settled by the app.
  const mine = await listOwnedCanvases(api, account);
  if (mine.some((canvas) => canvas.id === id))
    throw new PrLensCliError(
      "CANVAS_OWNED",
      `${id} is already yours on ${new URL(api).host}`,
      "claiming it again would retire its write token for nothing",
    );

  terminal.err("! Claiming rotates this canvas's write token.");
  terminal.err("  Edit links you have already shared will stop working.");

  // Saved before the request, so an answer that never arrives does not take
  // the new token with it.
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
    // These two are the app saying it decided and did not rotate: it answers
    // NOT_FOUND only when neither token is on record, and ALREADY_OWNED
    // before the swap. Anything else may have landed, so the pending token
    // stays and the next claim or rotation finishes it.
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

import { hostname } from "node:os";
import { spawn } from "node:child_process";
import { assertNever } from "@coldtea/pr-lens-schema";

import { CLI_VERSION } from "../version.js";
import { readInstallId, readStoredInstallId } from "../install.js";
import type { Terminal } from "../terminal.js";
import { PrLensCliError, usageError } from "../errors.js";
import { parseOptions, readBoolean } from "../args.js";
import { API_ENV, DEFAULT_API, readApi } from "../canvas/write.js";
import {
  forgetCredential,
  readToken,
  readCredential,
  TOKEN_ENV,
  writeCredential,
  type CredentialRead,
} from "../auth.js";
import {
  checkSignIn,
  endSession,
  pollSignIn,
  startSignIn,
  checkSession,
  whoAmI,
  type MachineState,
  type StartedSignIn,
} from "../account.js";

const SUBCOMMANDS = ["login", "status", "logout"] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];

const isSubcommand = (value: string): value is Subcommand =>
  SUBCOMMANDS.some((subcommand) => subcommand === value);

export const USAGE = `pr-lens auth <login | status | logout> [options]

Signs this machine in to the PR Lens app, so the canvases it pushes are yours
rather than unlisted pages only a link reaches. Nothing else needs it: pushing,
pulling and rendering all work signed out, and always will.

  pr-lens auth login                   approve this machine in a browser
  pr-lens auth login --force           sign in again even if this machine already is
    --no-browser                       print the link instead of opening one

  pr-lens auth status                  which app this machine is signed in to
    --json                             the same answer, for scripts

  pr-lens auth logout                  forget the sign-in kept on this machine

  --api <url>                          the PR Lens app (default $${API_ENV}, else ${DEFAULT_API})

The sign-in is kept per app, so one machine can be signed in to prlens.dev and
to a private store at once. $${TOKEN_ENV} overrides it, which is how CI signs in
without a browser.`;

const CLIENT = `pr-lens-cli/${CLI_VERSION}`;

/** RFC 8628 §3.5: a `slow_down` means back off by five seconds, every time. */
const SLOW_DOWN_STEP_SECONDS = 5;

/**
 * The floor after the app said we asked too soon.
 *
 * The RFC's rule is "add five seconds", and it has to be the addition rather
 * than whatever the app serves: this app answers `slow_down` with the same
 * five-second floor it always names, so obeying that number alone would leave
 * a client that is already at five polling at five forever. A larger number
 * from the app still wins.
 */
export const nextInterval = (seconds: number, served: number | undefined): number =>
  Math.max(seconds + SLOW_DOWN_STEP_SECONDS, served ?? 0);

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const hostOf = (api: string): string => new URL(api).host;

/**
 * Asks the desktop to open a link, and never minds if it cannot.
 *
 * True means asked, not opened: there is no answer to wait for, and a machine
 * reached over SSH will happily report success while the browser appears on
 * nobody's screen. That is why the link is printed either way.
 */
const askToOpen = (url: string): boolean => {
  // The address came off the wire, and handing an arbitrary string to the
  // desktop is how an opener becomes a way to run something. Windows gets
  // `rundll32` rather than `cmd /c start` for the same reason: nothing here
  // goes near a shell.
  const scheme = ((): string => {
    try {
      return new URL(url).protocol;
    } catch {
      return "";
    }
  })();
  if (scheme !== "http:" && scheme !== "https:") return false;

  const [command, leading] =
    process.platform === "darwin"
      ? ["open", []]
      : process.platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler"]]
        : ["xdg-open", []];

  try {
    const child = spawn(command, [...leading, url], {
      detached: true,
      stdio: "ignore",
    });
    // A desktop with no opener fails asynchronously, and unhandled would take
    // the sign-in down with it.
    child.on("error", () => undefined);
    child.unref();
    return true;
  } catch {
    return false;
  }
};

const minutes = (seconds: number): string => {
  const whole = Math.round(seconds / 60);
  return whole <= 1 ? "a minute" : `${whole} minutes`;
};

const tellHowToApprove = (
  started: StartedSignIn,
  opening: boolean,
  terminal: Terminal,
): void => {
  terminal.out(
    opening
      ? `  Code ${started.userCode} · opening ${started.approveUrl}`
      : `  Code ${started.userCode} · open ${started.approveUrl}`,
  );
  terminal.out(
    `  Check the page shows the same code, then approve. The code lasts ${minutes(started.expiresInSeconds)}.`,
  );
  terminal.out("  Waiting for it…");
};

const refused = (): PrLensCliError =>
  new PrLensCliError(
    "AUTH_REQUIRED",
    "the sign-in was turned down in the browser",
    "nothing was signed in; run pr-lens auth login to ask again",
  );

const ranOut = (): PrLensCliError =>
  new PrLensCliError(
    "AUTH_REQUIRED",
    "the code ran out before anyone approved it",
    [
      "run pr-lens auth login for a fresh one",
      "a code also runs out when the browser refused to link the machine — it says so on the page, and this end only sees the wait",
    ].join("\n"),
  );

/**
 * Polls until somebody answers, the code runs out, or the clock does.
 *
 * The deadline is fixed from the moment the code arrived rather than counted
 * down, so a slow round trip or a laptop that slept cannot leave this asking
 * about a grant the app threw away an hour ago.
 *
 * A request that does not arrive is not an answer. Wi-Fi drops mid-sign-in,
 * and a fifteen-minute window is long enough to carry one, so a failure to
 * reach the app is kept and retried — and only reported if the window closes
 * with it still failing.
 */
type Approval = { token: string; claimed: number | undefined };

const waitForApproval = async (
  api: string,
  started: StartedSignIn,
): Promise<Approval> => {
  const deadline = Date.now() + started.expiresInSeconds * 1000;
  let seconds = started.intervalSeconds;
  let unreached: PrLensCliError | undefined;

  while (Date.now() < deadline) {
    await sleep(seconds * 1000);

    const outcome = await pollSignIn(api, started.deviceCode).catch(
      (error: unknown) => {
        if (!(error instanceof PrLensCliError) || error.code !== "APP_UNAVAILABLE")
          throw error;
        unreached = error;
        return undefined;
      },
    );
    if (outcome === undefined) continue;
    unreached = undefined;

    switch (outcome.type) {
      case "token":
        return { token: outcome.token, claimed: outcome.claimed };
      case "pending":
        break;
      case "slow_down":
        seconds = nextInterval(seconds, outcome.intervalSeconds);
        break;
      case "denied":
        throw refused();
      case "expired":
        throw ranOut();
      default:
        return assertNever(outcome, "Unhandled sign-in answer");
    }
  }

  throw unreached ?? ranOut();
};

const login = async (
  args: readonly string[],
  terminal: Terminal,
  env: Record<string, string | undefined>,
): Promise<void> => {
  const { values, positionals } = parseOptions(args, {
    api: { type: "string" },
    "no-browser": { type: "boolean" },
    force: { type: "boolean" },
  });
  if (positionals.length > 0)
    throw usageError(
      `login takes no positional arguments, got ${positionals.join(" ")}`,
    );

  const api = readApi(values.api, env);

  /*
   * A machine that is already signed in is not asked to sign in again.
   *
   * This used to mint a device code and open a browser unconditionally, so
   * running the command twice put somebody through an approval for a session
   * they already had — and left a second grant to expire unanswered.
   *
   * Only an active session stops it. A token the app has ended is exactly
   * when a fresh login is the right answer, and a store that did not reply is
   * not evidence about the token: the flow below needs the network anyway and
   * will report the outage with a better error than this check could.
   */
  if (!readBoolean(values.force)) {
    const stored = await readToken(env, api);
    const session = stored === undefined ? undefined : await checkSession(api, stored);

    if (session?.type === "active") {
      terminal.out(`✓ Already signed in to ${hostOf(api)} as ${session.email}`);
      terminal.out("  pr-lens auth login --force signs in again, as somebody else or on a new token.");
      return;
    }
  }

  // The same id every mint already carries, so approving links the machine
  // that pushed rather than minting a second identity for the same laptop.
  const installId = await readInstallId(env, api);
  if (installId === undefined)
    throw new PrLensCliError(
      "UNREADABLE_FILE",
      "this machine has nowhere to keep a sign-in",
      "set HOME, or XDG_CONFIG_HOME, to a directory this machine can write to",
    );

  const started = await startSignIn(api, installId, CLIENT, hostname());
  const opening = readBoolean(values["no-browser"])
    ? false
    : askToOpen(started.approveUrl);
  tellHowToApprove(started, opening, terminal);

  const { token, claimed } = await waitForApproval(api, started);
  await writeCredential(env, api, token, new Date().toISOString());

  // Asked after the credential is on disk, never before: the sign-in has
  // happened, and a greeting that could not be fetched must not make it look
  // as though it had not.
  const who = await whoAmI(api, token);
  terminal.out(
    who === undefined ? `✓ Signed in to ${hostOf(api)}` : `✓ Signed in to ${hostOf(api)} as ${who}`,
  );
  // A count only when the app sent one. "0 canvases are now yours" is a
  // sentence worth saying to somebody who expected some; "we did not ask" is
  // not a sentence at all, which is why absent and zero stay apart.
  terminal.out(
    claimed === undefined
      ? "  This machine is linked, so every canvas it has pushed is yours, and so is every one it pushes next."
      : `  This machine is linked. ${claimed === 1 ? "1 canvas is" : `${claimed} canvases are`} now yours, and so is every one it pushes next.`,
  );
};

type State =
  | "signed_in"
  | "unconfirmed"
  | "rejected"
  | "signed_out"
  | "unreadable";

type Status = {
  api: string;
  state: State;
  /** Where the credential came from, and never the credential itself. */
  source: "file" | "environment" | "none";
  signedInAt: string | undefined;
  machine: MachineState;
  why: string | undefined;
};

const sourceOf = (
  stored: CredentialRead,
  fromEnvironment: boolean,
): Status["source"] =>
  fromEnvironment
    ? "environment"
    : stored.type === "credential"
      ? "file"
      : "none";

const statusOf = async (
  api: string,
  env: Record<string, string | undefined>,
): Promise<Status> => {
  const given = env[TOKEN_ENV];
  const stored = await readCredential(env, api);
  const token = given || (stored.type === "credential" ? stored.credential.token : undefined);

  const base: Omit<Status, "state" | "why"> = {
    api,
    source: sourceOf(stored, Boolean(given)),
    signedInAt:
      stored.type === "credential" && !given ? stored.credential.signedInAt : undefined,
    machine: "unknown",
  };

  if (token === undefined)
    return stored.type === "unreadable"
      ? { ...base, state: "unreadable", why: `${stored.path}: ${stored.why}` }
      : { ...base, state: "signed_out", why: undefined };

  // Read, never minted: asking a question must not leave a new machine
  // identity on disk for a store this person may never push to.
  const checked = await checkSignIn(api, token, await readStoredInstallId(env, api));
  switch (checked.type) {
    case "live":
      return { ...base, state: "signed_in", machine: checked.machine, why: undefined };
    case "rejected":
      return { ...base, state: "rejected", why: undefined };
    case "unknown":
      return { ...base, state: "unconfirmed", why: checked.why };
    default:
      return assertNever(checked, "Unhandled sign-in check");
  }
};

const tellMachine = (machine: MachineState, terminal: Terminal): void => {
  switch (machine) {
    case "linked":
      terminal.out("  This machine is linked.");
      return;
    case "unlinked":
      terminal.out(
        "  This machine is not linked to that account, so what it pushes stays unattributed.",
      );
      return;
    case "revoked":
    case "unknown":
      return;
    default:
      return assertNever(machine, "Unhandled machine state");
  }
};

const tellSource = (status: Status, terminal: Terminal): void => {
  switch (status.source) {
    case "environment":
      terminal.out(`  Signed in with $${TOKEN_ENV}.`);
      return;
    case "file":
      terminal.out(
        status.signedInAt === undefined
          ? "  Signed in on this machine."
          : `  Signed in on this machine on ${status.signedInAt.slice(0, 10)}.`,
      );
      return;
    case "none":
      return;
    default:
      return assertNever(status.source, "Unhandled credential source");
  }
};

/**
 * The states a person has to act on, as the error each one ends the run with.
 *
 * Separate from the printing so `--json` answers the question and still exits
 * on the verdict, without a second copy of it in prose underneath.
 */
const refusalFor = (status: Status): PrLensCliError | undefined => {
  const host = hostOf(status.api);

  switch (status.state) {
    case "signed_in":
      // A machine the account has removed still holds a working token when
      // that token came from CI, and saying "signed in" and stopping would
      // leave somebody wondering why nothing they push shows up.
      return status.machine === "revoked"
        ? new PrLensCliError(
            "MACHINE_REVOKED",
            `this machine was removed from the account on ${host}`,
            "the sign-in still works, but nothing this machine pushes is attributed, and an id that was removed cannot be linked again",
          )
        : undefined;

    case "unconfirmed":
      return undefined;

    case "rejected":
      return new PrLensCliError(
        "AUTH_REQUIRED",
        `${host} no longer accepts this sign-in`,
        "it was signed out, or the machine was removed; run pr-lens auth login to sign in again",
      );

    case "signed_out":
      return new PrLensCliError(
        "AUTH_REQUIRED",
        `not signed in to ${host}`,
        "pr-lens auth login",
      );

    case "unreadable":
      // Not "signed out" and not "the token is wrong": these bytes could not
      // be opened, and what they hold is still unknown.
      return new PrLensCliError(
        "UNREADABLE_FILE",
        `the sign-in for ${host} cannot be read`,
        [status.why ?? "", "pr-lens auth logout clears it, and then auth login writes a fresh one"]
          .filter((line) => line !== "")
          .join("\n"),
      );

    default:
      return assertNever(status.state, "Unhandled sign-in state");
  }
};

const tellStatus = (status: Status, terminal: Terminal): void => {
  const host = hostOf(status.api);

  switch (status.state) {
    case "signed_in":
      terminal.out(`✓ Signed in to ${host}`);
      tellMachine(status.machine, terminal);
      tellSource(status, terminal);
      return;

    case "unconfirmed":
      terminal.out(`✓ A sign-in for ${host} is kept on this machine`);
      tellSource(status, terminal);
      terminal.out(`  ${host} could not be asked to confirm it: ${status.why ?? "no reason given"}`);
      return;

    // Every other state ends the run, and `refusalFor` is what says so.
    case "rejected":
    case "signed_out":
    case "unreadable":
      return;

    default:
      return assertNever(status.state, "Unhandled sign-in state");
  }
};

const status = async (
  args: readonly string[],
  terminal: Terminal,
  env: Record<string, string | undefined>,
): Promise<void> => {
  const { values, positionals } = parseOptions(args, {
    api: { type: "string" },
    json: { type: "boolean" },
  });
  if (positionals.length > 0)
    throw usageError(
      `status takes no positional arguments, got ${positionals.join(" ")}`,
    );

  const found = await statusOf(readApi(values.api, env), env);

  const refusal = refusalFor(found);

  // Answered before the refusal, so `--json` says something in every state
  // and the exit code still carries whether this machine is signed in.
  if (readBoolean(values.json))
    terminal.out(
      JSON.stringify(
        {
          api: found.api,
          state: found.state,
          source: found.source,
          signedInAt: found.signedInAt ?? null,
          machine: found.machine,
        },
        null,
        2,
      ),
    );
  else tellStatus(found, terminal);

  if (refusal !== undefined) throw refusal;
};

const logout = async (
  args: readonly string[],
  terminal: Terminal,
  env: Record<string, string | undefined>,
): Promise<void> => {
  const { values, positionals } = parseOptions(args, { api: { type: "string" } });
  if (positionals.length > 0)
    throw usageError(
      `logout takes no positional arguments, got ${positionals.join(" ")}`,
    );

  const api = readApi(values.api, env);

  // Ended at the app first, then forgotten here whatever it answered. A
  // store that cannot be reached must not keep somebody signed in on a
  // laptop they are holding — so the local half is unconditional, and the
  // remote half only decides what the last line says.
  const stored = await readCredential(env, api);
  const ended =
    stored.type === "credential" ? await endSession(api, stored.credential.token) : undefined;

  const forgotten = await forgetCredential(env, api);

  const host = hostOf(api);
  if (!forgotten) {
    terminal.out(`Nothing was signed in to ${host}`);
    if (env[TOKEN_ENV])
      terminal.out(`  $${TOKEN_ENV} is set, and this machine still signs in with it.`);
    return;
  }

  terminal.out(`✓ Signed out of ${host}`);
  if (ended !== undefined && typeof ended !== "string")
    terminal.out(
      `  ${host} could not be told, so the token is forgotten here and stays live there until it is used: ${ended.why}`,
    );
  terminal.out(
    "  The machine stays linked, so the canvases it pushed stay yours. Remove it in the app's settings to cut it off.",
  );
};

export const authCommand = async (
  args: readonly string[],
  terminal: Terminal,
  env: Record<string, string | undefined>,
): Promise<void> => {
  const [name, ...rest] = args;
  if (name === undefined)
    throw usageError("auth needs a subcommand: login, status or logout");
  if (!isSubcommand(name))
    throw usageError(`unknown auth subcommand ${JSON.stringify(name)}`);

  switch (name) {
    case "login":
      return login(rest, terminal, env);
    case "status":
      return status(rest, terminal, env);
    case "logout":
      return logout(rest, terminal, env);
    default:
      return assertNever(name, "Unhandled auth subcommand");
  }
};

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

Signs this machine in to the PR Lens app, so the canvases it pushes belong to
your account. Nothing else needs it: pushing, pulling and rendering
all work signed out, and always will.

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

/** RFC 8628 §3.5: each `slow_down` adds five seconds. */
const SLOW_DOWN_STEP_SECONDS = 5;

/**
 * Adds the step rather than taking the served interval: the app serves the
 * same five-second floor on `slow_down`, which alone would never back off.
 */
export const nextInterval = (seconds: number, served: number | undefined): number =>
  Math.max(seconds + SLOW_DOWN_STEP_SECONDS, served ?? 0);

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const hostOf = (api: string): string => new URL(api).host;

/** True means asked, not opened (over SSH it "succeeds" on no screen), so the link is printed either way. */
const askToOpen = (url: string): boolean => {
  // The URL came off the wire: only http(s), and never through a shell
  // (hence `rundll32` over `cmd /c start`).
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
    // A missing opener fails asynchronously; unhandled, it would crash the sign-in.
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
  // On a TTY the ticker shows this instead.
  if (terminal.status === undefined) terminal.out("  Waiting for it…");
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
      "a code also runs out when the browser refused to link the machine; the page says so, but this terminal only sees the wait",
    ].join("\n"),
  );

type Approval = { token: string; claimed: number | undefined };

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const TICK_MS = 120;

const remaining = (deadline: number): string => {
  const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
};

/** Only on a TTY, so pipes and CI logs don't collect spinner frames. */
const ticker = (terminal: Terminal, deadline: number): (() => void) => {
  if (terminal.status === undefined) return () => undefined;

  let frame = 0;
  const timer = setInterval(() => {
    frame = (frame + 1) % FRAMES.length;
    terminal.status?.(`  ${FRAMES[frame]} Waiting for approval · ${remaining(deadline)} left`);
  }, TICK_MS);

  // Must not hold the event loop open after the command finishes.
  timer.unref?.();

  return () => {
    clearInterval(timer);
    terminal.status?.(undefined);
  };
};

/**
 * The deadline is fixed up front, so a slept laptop never polls a dead grant.
 * An unreachable app is retried and reported only if the window closes on it.
 */
const waitForApproval = async (
  api: string,
  started: StartedSignIn,
  terminal: Terminal,
): Promise<Approval> => {
  const deadline = Date.now() + started.expiresInSeconds * 1000;
  let seconds = started.intervalSeconds;
  let unreached: PrLensCliError | undefined;

  const stop = ticker(terminal, deadline);
  try {
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
  } finally {
    // Every exit clears the spinner, so none is left above an error.
    stop();
  }
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

  // Only an active session skips the flow; an unreachable store falls
  // through so the flow below reports the outage.
  if (!readBoolean(values.force)) {
    const stored = await readToken(env, api);
    const session = stored === undefined ? undefined : await checkSession(api, stored);

    if (session?.type === "active") {
      terminal.out(`✓ Already signed in to ${hostOf(api)} as ${session.email}`);
      terminal.out("  pr-lens auth login --force signs in again, as somebody else or on a new token.");
      return;
    }
  }

  // The id mints already carry, so approval links the machine that pushed.
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

  const { token, claimed } = await waitForApproval(api, started, terminal);
  await writeCredential(env, api, token, new Date().toISOString());

  // After the write, so a failed greeting never looks like a failed sign-in.
  const who = await whoAmI(api, token);
  terminal.out(
    who === undefined ? `✓ Signed in to ${hostOf(api)}` : `✓ Signed in to ${hostOf(api)} as ${who}`,
  );
  // Absent and zero stay apart: "0 canvases" is worth saying, "unknown" is not.
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
  /** Never the credential itself. */
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

  // Read, never minted: a status check must not create a machine identity.
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

/** Separate from printing so `--json` still exits on the verdict. */
const refusalFor = (status: Status): PrLensCliError | undefined => {
  const host = hostOf(status.api);

  switch (status.state) {
    case "signed_in":
      // A CI token still works on a removed machine, but nothing it pushes is attributed.
      return status.machine === "revoked"
        ? new PrLensCliError(
            "MACHINE_REVOKED",
            `this machine was removed from the account on ${host}`,
            "the sign-in still works, but nothing this machine pushes is attributed; pr-lens auth login --force links it again",
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

    // `refusalFor` reports these.
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

  // Print first, so `--json` answers in every state and the exit code still carries the verdict.
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

  // Forgotten locally whatever the app answers; an unreachable store must
  // not keep somebody signed in.
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
      `  ${host} did not end the session, so the token is forgotten here but stays live there until it is used: ${ended.why}`,
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

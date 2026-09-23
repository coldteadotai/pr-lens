import { expect, test } from "vitest";
import { stat, readFile, writeFile, mkdir } from "node:fs/promises";

import { API, setupCanvasTest } from "./helpers/canvas.js";
import { installHash } from "../src/account.js";
import { authPath } from "../src/auth.js";
import { nextInterval } from "../src/commands/auth.js";

const { output, fetchMock, invoke, installId, env } = setupCanvasTest();

const USER_CODE = "WDJB-MJHT";
const DEVICE_CODE = "WDJBMJHT.aaaaaaaaaaaaaaaaaaaaaa";
const TOKEN = "prl_u_ZZZZZZZZZZZZZZZZZZZZZZ";

type Seen = { method: string; path: string; headers: Headers; body: unknown };

type Poll =
  | { type: "token" }
  | { type: "pending" }
  | { type: "slow_down" }
  | { type: "denied" }
  | { type: "expired" };

const app = {
  interval: 0,
  expiresIn: 900,
  /** Consumed in order; the last one repeats once the script runs out. */
  polls: [] as Poll[],
  code: { status: 200, body: undefined as unknown },
  machines: { status: 200, list: [] as { id: string; revoked: boolean }[] },
  account: { status: 200, email: "favour@coldtea.ai" },
  session: { status: 200 },
  claimed: {} as { claimed?: number },
  offline: false,
  seen: [] as Seen[],
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const pollAnswer = (): Response => {
  const next = app.polls.length > 1 ? app.polls.shift() : app.polls[0];
  switch (next?.type) {
    case "token":
      return json(200, { access_token: TOKEN, token_type: "Bearer", ...app.claimed });
    case "slow_down":
      return json(400, { error: "slow_down", interval: 0 });
    case "denied":
      return json(400, { error: "access_denied" });
    case "expired":
      return json(400, { error: "expired_token" });
    default:
      return json(400, { error: "authorization_pending" });
  }
};

const useApp = (): void => {
  app.interval = 0;
  app.expiresIn = 900;
  app.polls = [{ type: "token" }];
  app.code = { status: 200, body: undefined };
  app.machines = { status: 200, list: [] };
  app.account = { status: 200, email: "favour@coldtea.ai" };
  app.session = { status: 200 };
  app.claimed = {};
  app.offline = false;
  app.seen = [];

  fetchMock.mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    app.seen.push({ method, path: url.pathname, headers: new Headers(init?.headers), body });

    if (app.offline) throw new TypeError("fetch failed");

    switch (url.pathname) {
      case "/api/device/code":
        return app.code.status === 200
          ? json(200, {
              device_code: DEVICE_CODE,
              user_code: USER_CODE,
              verification_uri: `${API}/device`,
              verification_uri_complete: `${API}/device?code=${USER_CODE}`,
              expires_in: app.expiresIn,
              interval: app.interval,
            })
          : json(app.code.status, app.code.body);
      case "/api/device/token":
        return pollAnswer();
      case "/api/machines":
        return app.machines.status === 200
          ? json(200, { machines: app.machines.list })
          : json(app.machines.status, {
              error: { code: "UNAUTHENTICATED", message: "Sign in to see what you own" },
            });
      case "/api/account":
        return app.account.status === 200
          ? json(200, { email: app.account.email, createdAt: "2026-09-22T00:00:00.000Z", identities: [] })
          : json(app.account.status, { error: { code: "NOT_FOUND", message: "no" } });
      case "/api/session":
        return app.session.status === 200
          ? json(200, { signedOut: true })
          : json(app.session.status, { error: { code: "NOT_FOUND", message: "no" } });
      default:
        return json(404, { error: { code: "NOT_FOUND", message: "no" } });
    }
  });
};

const login = (...extra: string[]) =>
  invoke("auth", "login", "--api", API, "--no-browser", ...extra);

const everything = (): string => [...output.out, ...output.err].join("\n");

const seen = (path: string): Seen[] => app.seen.filter((call) => call.path === path);

const stored = async (): Promise<{ token?: string; api?: string; signedInAt?: string }> =>
  JSON.parse(await readFile(authPath(env(), API) as string, "utf8"));

const linkThisMachine = async (): Promise<void> => {
  const id = await installId(API);
  app.machines.list = [{ id: installHash(id as string), revoked: false }];
};

test("login shows a code to check, links this machine, and keeps the token 0600", async () => {
  useApp();
  app.polls = [{ type: "pending" }, { type: "token" }];

  expect(await login()).toBe(0);

  const printed = output.out.join("\n");
  expect(printed).toContain(`Code ${USER_CODE}`);
  expect(printed).toContain(`${API}/device?code=${USER_CODE}`);
  expect(printed).toContain("Check the page shows the same code");
  expect(printed).toContain("The code lasts 15 minutes.");
  expect(printed).toContain("✓ Signed in to canvas.test");

  // Two polls: the first was answered "not yet".
  expect(seen("/api/device/token")).toHaveLength(2);

  const credential = await stored();
  expect(credential.token).toBe(TOKEN);
  expect(credential.api).toBe(API);
  expect(credential.signedInAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

  const file = await stat(authPath(env(), API) as string);
  expect(file.mode & 0o777).toBe(0o600);
  const directory = await stat(
    (authPath(env(), API) as string).replace(/\/[^/]+$/, ""),
  );
  expect(directory.mode & 0o777).toBe(0o700);
});

test("the token never reaches the terminal", async () => {
  useApp();
  await login();
  await linkThisMachine();
  expect(await invoke("auth", "status", "--api", API)).toBe(0);
  expect(await invoke("auth", "status", "--api", API, "--json")).toBe(0);

  expect(everything()).not.toContain(TOKEN);
});

test("login sends the install id this machine already pushes with, and mints no second one", async () => {
  useApp();
  expect(await login()).toBe(0);

  const id = await installId(API);
  expect(id).toMatch(/^prl_i_/);

  const [asked] = seen("/api/device/code");
  expect(asked?.body).toMatchObject({ install_id: id });
  expect((asked?.body as { client: string }).client).toMatch(/^pr-lens-cli\//);

  // A second sign-in reuses it rather than becoming a second machine.
  output.out = [];
  expect(await login()).toBe(0);
  expect(await installId(API)).toBe(id);
});

test("a refusal in the browser signs nothing in", async () => {
  useApp();
  app.polls = [{ type: "denied" }];

  expect(await login()).toBe(1);
  expect(output.err.join("\n")).toContain("turned down in the browser");
  expect(output.err.join("\n")).toContain("[AUTH_REQUIRED]");
  await expect(stored()).rejects.toThrow();
});

test("a code nobody approved runs out, and says what else that means", async () => {
  useApp();
  app.polls = [{ type: "expired" }];

  expect(await login()).toBe(1);
  const said = output.err.join("\n");
  expect(said).toContain("ran out before anyone approved it");
  expect(said).toContain("refused to link the machine");
  await expect(stored()).rejects.toThrow();
});

test("the wait ends on the deadline the code arrived with, not on a poll count", async () => {
  useApp();
  app.expiresIn = 1;
  app.interval = 1;
  app.polls = [{ type: "pending" }];

  const started = Date.now();
  expect(await login()).toBe(1);

  expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  expect(output.err.join("\n")).toContain("ran out before anyone approved it");
  expect(seen("/api/device/token").length).toBeLessThanOrEqual(2);
  // The only test here that waits on a real clock, so it gets room to be
  // scheduled late rather than becoming the suite's flaky one.
}, 20_000);

test("too many codes from one address is a wait, not an accusation", async () => {
  useApp();
  app.code = {
    status: 429,
    body: { error: { code: "RATE_LIMITED", message: "Too many sign-in attempts from here" } },
  };

  expect(await login()).toBe(1);
  const said = output.err.join("\n");
  expect(said).toContain("enough sign-in codes for now");
  expect(said).toContain("a short wait clears it");
  expect(said).not.toContain("attempts");
});

test("status on a machine that never signed in says so, and exits non-zero", async () => {
  useApp();
  expect(await invoke("auth", "status", "--api", API)).toBe(1);
  expect(output.err.join("\n")).toContain("not signed in to canvas.test");
  expect(output.err.join("\n")).toContain("[AUTH_REQUIRED]");
});

test("--json answers in every state, and the exit code carries the verdict", async () => {
  useApp();
  expect(await invoke("auth", "status", "--api", API, "--json")).toBe(1);
  expect(JSON.parse(output.out.join("\n"))).toEqual({
    api: API,
    state: "signed_out",
    source: "none",
    signedInAt: null,
    machine: "unknown",
  });

  output.out = [];
  await login();
  await linkThisMachine();
  output.out = [];

  expect(await invoke("auth", "status", "--api", API, "--json")).toBe(0);
  expect(JSON.parse(output.out.join("\n"))).toMatchObject({
    api: API,
    state: "signed_in",
    source: "file",
    machine: "linked",
  });
});

test("status confirms the sign-in against the app and says the machine is linked", async () => {
  useApp();
  await login();
  await linkThisMachine();
  output.out = [];

  expect(await invoke("auth", "status", "--api", API)).toBe(0);
  expect(output.out.join("\n")).toContain("✓ Signed in to canvas.test");
  expect(output.out.join("\n")).toContain("This machine is linked.");
});

test("a token the app turns down is reported as a sign-in to redo", async () => {
  useApp();
  await login();
  app.machines.status = 401;
  output.out = [];
  output.err = [];

  expect(await invoke("auth", "status", "--api", API)).toBe(1);
  expect(output.err.join("\n")).toContain("no longer accepts this sign-in");
});

test("a machine the account removed is named, and not called signed out", async () => {
  useApp();
  await login();
  const id = await installId(API);
  app.machines.list = [{ id: installHash(id as string), revoked: true }];
  output.out = [];
  output.err = [];

  expect(await invoke("auth", "status", "--api", API)).toBe(1);
  expect(output.err.join("\n")).toContain("[MACHINE_REVOKED]");
  expect(output.err.join("\n")).toContain("cannot be linked again");
});

test("an app that cannot be reached is not a credential that is wrong", async () => {
  useApp();
  await login();
  app.offline = true;
  output.out = [];
  output.err = [];

  expect(await invoke("auth", "status", "--api", API)).toBe(0);
  const said = output.out.join("\n");
  expect(said).toContain("A sign-in for canvas.test is kept on this machine");
  expect(said).toContain("could not be asked to confirm it");
  expect(said).not.toContain("not signed in");
});

test("an unreadable sign-in is not a sign-out, and status leaves it where it is", async () => {
  useApp();
  const path = authPath(env(), API) as string;
  await mkdir(path.replace(/\/[^/]+$/, ""), { recursive: true });
  await writeFile(path, "{ this is not json", "utf8");

  expect(await invoke("auth", "status", "--api", API)).toBe(1);
  const said = output.err.join("\n");
  expect(said).toContain("cannot be read");
  expect(said).toContain("[UNREADABLE_FILE]");
  expect(said).not.toContain("not signed in");

  expect(await readFile(path, "utf8")).toBe("{ this is not json");
});

test("logout forgets the credential, and says the machine stays linked", async () => {
  useApp();
  await login();
  output.out = [];

  expect(await invoke("auth", "logout", "--api", API)).toBe(0);
  expect(output.out.join("\n")).toContain("✓ Signed out of canvas.test");
  expect(output.out.join("\n")).toContain("The machine stays linked");
  await expect(stored()).rejects.toThrow();

  output.out = [];
  expect(await invoke("auth", "logout", "--api", API)).toBe(0);
  expect(output.out.join("\n")).toContain("Nothing was signed in to canvas.test");
});

test("logout clears a file nothing else would touch", async () => {
  useApp();
  const path = authPath(env(), API) as string;
  await mkdir(path.replace(/\/[^/]+$/, ""), { recursive: true });
  await writeFile(path, "{ this is not json", "utf8");

  expect(await invoke("auth", "logout", "--api", API)).toBe(0);
  await expect(readFile(path, "utf8")).rejects.toThrow();
});

test("a sign-in is kept per app, so signing out of one leaves the other", async () => {
  useApp();
  const other = "https://lens.example.com";
  await login();
  await invoke("auth", "login", "--api", other, "--no-browser");
  output.out = [];

  expect(await invoke("auth", "logout", "--api", other)).toBe(0);
  expect((await stored()).token).toBe(TOKEN);
});

test("PR_LENS_TOKEN set to the empty string is a run without a token", async () => {
  useApp();
  await login();
  await linkThisMachine();

  env().PR_LENS_TOKEN = "";
  output.out = [];
  app.seen = [];

  expect(await invoke("auth", "status", "--api", API, "--json")).toBe(0);
  // The stored credential, not the blank: `??` here would send `Bearer ` and
  // report a sign-in that came from the environment.
  expect(JSON.parse(output.out.join("\n"))).toMatchObject({ source: "file", state: "signed_in" });
  expect(seen("/api/machines")[0]?.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
});

test("PR_LENS_TOKEN with a token in it is how CI signs in", async () => {
  useApp();
  env().PR_LENS_TOKEN = TOKEN;

  expect(await invoke("auth", "status", "--api", API, "--json")).toBe(0);
  // `unknown` rather than `unlinked`: a runner that has never pushed has no
  // install id, and status will not mint one just to have something to ask
  // about. Not asking is not the same answer as asking and being told no.
  expect(JSON.parse(output.out.join("\n"))).toMatchObject({
    source: "environment",
    state: "signed_in",
    machine: "unknown",
  });
  expect(output.out.join("\n")).not.toContain(TOKEN);
});

test("status asks about this machine without minting one", async () => {
  useApp();
  env().PR_LENS_TOKEN = TOKEN;

  expect(await invoke("auth", "status", "--api", API)).toBe(0);
  expect(await installId(API)).toBeUndefined();

  // A machine that has pushed before is asked about by the id it pushed with.
  delete env().PR_LENS_TOKEN;
  await login();
  await linkThisMachine();
  output.out = [];

  expect(await invoke("auth", "status", "--api", API)).toBe(0);
  expect(output.out.join("\n")).toContain("This machine is linked.");
});

test("PR_LENS_API_URL set to the empty string is a run without one", async () => {
  useApp();
  env().PR_LENS_API_URL = "";

  expect(await invoke("auth", "status", "--json")).toBe(1);
  expect(JSON.parse(output.out.join("\n"))).toMatchObject({ api: "https://prlens.dev" });
});

test("auth needs a subcommand, and names the ones it has", async () => {
  useApp();
  expect(await invoke("auth")).toBe(2);
  expect(output.err.join("\n")).toContain("auth needs a subcommand: login, status or logout");

  output.err = [];
  expect(await invoke("auth", "whoami")).toBe(2);
  expect(output.err.join("\n")).toContain('unknown auth subcommand "whoami"');

  output.out = [];
  expect(await invoke("auth", "--help")).toBe(0);
  expect(output.out.join("\n")).toContain("pr-lens auth login");
  expect(output.out.join("\n")).toContain("all work signed out");
});

test("slow_down backs off by five seconds, however small a floor the app names", () => {
  // The app answers slow_down with its own five-second floor, so honouring
  // that alone would leave a client already at five polling at five forever.
  expect(nextInterval(5, 5)).toBe(10);
  expect(nextInterval(0, 0)).toBe(5);
  expect(nextInterval(5, 60)).toBe(60);
  expect(nextInterval(5, undefined)).toBe(10);
});

test("login names the address it signed in as", async () => {
  useApp();
  expect(await login()).toBe(0);
  expect(output.out.join("\n")).toContain("✓ Signed in to canvas.test as favour@coldtea.ai");
});

test("an app that cannot say who you are still signs you in", async () => {
  useApp();
  // The credential is already on disk by the time the greeting is fetched, so
  // a store too old to answer must cost the name and nothing else.
  app.account = { status: 404, email: "" };

  expect(await login()).toBe(0);
  expect(output.out.join("\n")).toContain("✓ Signed in to canvas.test");
  expect(output.out.join("\n")).not.toContain(" as ");
});

test("logout ends the session at the app before forgetting it here", async () => {
  useApp();
  expect(await login()).toBe(0);
  app.seen = [];

  expect(await invoke("auth", "logout", "--api", API)).toBe(0);

  const ended = app.seen.find((seen) => seen.path === "/api/session");
  expect(ended?.method).toBe("DELETE");
  // The token it is ending is the one it holds, not a fresh sign-in.
  expect(ended?.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
  expect(output.out.join("\n")).toContain("✓ Signed out of canvas.test");
});

test("an unreachable app does not keep somebody signed in on their own laptop", async () => {
  useApp();
  expect(await login()).toBe(0);
  app.offline = true;

  expect(await invoke("auth", "logout", "--api", API)).toBe(0);

  // Forgotten locally regardless, and told plainly that the far end does not
  // know yet — the one thing worse than this message is silently keeping the
  // credential because a server was down.
  expect(output.out.join("\n")).toContain("✓ Signed out of canvas.test");
  expect(output.out.join("\n")).toContain("could not be told");
  // Forgotten here is the half that must hold: status now reports no sign-in,
  // and exits non-zero saying so, the way it does for a machine that never
  // signed in at all.
  app.offline = false;
  expect(await invoke("auth", "status", "--api", API)).toBe(1);
  expect(`${output.out.join("\n")}\n${output.err.join("\n")}`).toContain(
    "not signed in to canvas.test",
  );
});

test("login says how many canvases the machine just brought with it", async () => {
  useApp();
  app.claimed = { claimed: 8 };

  expect(await login()).toBe(0);
  expect(output.out.join("\n")).toContain("8 canvases are now yours");
});

test("one canvas is not eight, and none is still a sentence", async () => {
  useApp();
  app.claimed = { claimed: 1 };
  expect(await login()).toBe(0);
  expect(output.out.join("\n")).toContain("1 canvas is now yours");

  output.out.length = 0;
  useApp();
  app.claimed = { claimed: 0 };
  // `--force`, because the first login left a credential and a machine that is
  // already signed in is no longer asked to sign in again.
  expect(await login("--force")).toBe(0);
  expect(output.out.join("\n")).toContain("0 canvases are now yours");
});

test("an app that sends no count says nothing about one", async () => {
  useApp();
  app.claimed = {};

  expect(await login()).toBe(0);
  // Absent is not zero: an older store has not told us there were none.
  expect(output.out.join("\n")).toContain("every canvas it has pushed is yours");
  expect(output.out.join("\n")).not.toContain("now yours,");
});


/**
 * Running `auth login` twice used to mint a second device code and open a
 * second browser for a session the machine already had — and leave the first
 * grant to expire unanswered.
 */
test("a machine that is already signed in is not asked to sign in again", async () => {
  useApp();
  expect(await login()).toBe(0);

  output.out.length = 0;
  app.seen.length = 0;

  expect(await login()).toBe(0);
  expect(output.out.join("\n")).toContain("Already signed in");
  expect(output.out.join("\n")).toContain("--force");

  // And nothing was started: no code minted, nothing left to expire.
  expect(seen("/api/device/code")).toHaveLength(0);
});

test("--force signs in again over a live session", async () => {
  useApp();
  expect(await login()).toBe(0);

  output.out.length = 0;
  app.seen.length = 0;

  expect(await login("--force")).toBe(0);
  expect(output.out.join("\n")).not.toContain("Already signed in");
  expect(seen("/api/device/code")).toHaveLength(1);
});

/**
 * A token the app has ended is exactly when a fresh login is right, so the
 * check must not stand in the way of one — "not you" and "we could not ask"
 * are different answers and only the first is evidence about the credential.
 */
test("a session the app has ended does not block a fresh login", async () => {
  useApp();
  expect(await login()).toBe(0);

  output.out.length = 0;
  app.seen.length = 0;
  app.account = { status: 401, email: "favour@coldtea.ai" };

  expect(await login()).toBe(0);
  expect(output.out.join("\n")).not.toContain("Already signed in");
  expect(seen("/api/device/code")).toHaveLength(1);
});

/**
 * Where this machine keeps what belongs to it rather than to any checkout.
 *
 * Two things live here, and they are kept the same way for the same reason:
 * the install id that names this machine, and the credential that signs it
 * in. Either one is enough to act as this machine somewhere, so one file per
 * store makes sending either to the wrong `--api` impossible rather than
 * unlikely.
 */
import { join } from "node:path";

const DIRECTORY = "pr-lens";

/**
 * Read from the environment the caller was given rather than the process, so
 * that a test never writes to the real home directory, and so a run with
 * nothing set is a run without a config home rather than a guess.
 */
export const configHome = (
  env: Record<string, string | undefined>,
): string | undefined => {
  const xdg = env.XDG_CONFIG_HOME;
  if (xdg) return xdg;

  const home = env.HOME || env.USERPROFILE;
  return home ? join(home, ".config") : undefined;
};

/**
 * Percent-encoded, so one file name can hold an origin and still be a file
 * name. Only the two schemes the API speaks: every other scheme has an origin
 * of the literal "null", which would file unrelated stores together in the one
 * function whose whole job is that stores never share.
 */
const fileFor = (api: string): string | undefined => {
  try {
    const { protocol, origin } = new URL(api);
    if (protocol !== "http:" && protocol !== "https:") return undefined;
    return `${encodeURIComponent(origin)}.json`;
  } catch {
    return undefined;
  }
};

/** Undefined when there is nowhere to put it, which every caller treats as "no file". */
export const originPath = (
  env: Record<string, string | undefined>,
  folder: string,
  api: string,
): string | undefined => {
  const home = configHome(env);
  const file = fileFor(api);
  return home === undefined || file === undefined
    ? undefined
    : join(home, DIRECTORY, folder, file);
};

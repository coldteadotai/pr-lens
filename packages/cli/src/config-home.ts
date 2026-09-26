/**
 * Per-machine state: the install id and the sign-in credential. Either one
 * can act as this machine, so each store gets its own file and neither can
 * reach the wrong `--api`.
 */
import { join } from "node:path";

const DIRECTORY = "pr-lens";

/** Takes `env` from the caller so tests never write to the real home directory. */
export const configHome = (
  env: Record<string, string | undefined>,
): string | undefined => {
  const xdg = env.XDG_CONFIG_HOME;
  if (xdg) return xdg;

  const home = env.HOME || env.USERPROFILE;
  return home ? join(home, ".config") : undefined;
};

/**
 * http and https only: other schemes have the origin "null", which would put
 * unrelated stores in one file.
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

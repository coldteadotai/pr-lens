import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { PrLensCliError } from "./errors.js";

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const readTextFile = async (path: string): Promise<string> => {
  try {
    return await readFile(resolve(path), "utf8");
  } catch (error) {
    throw new PrLensCliError("UNREADABLE_FILE", `cannot read ${path}`, describe(error));
  }
};

export const readJsonFile = async (path: string): Promise<unknown> => {
  const text = await readTextFile(path);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new PrLensCliError("UNREADABLE_FILE", `${path} is not valid JSON`, describe(error));
  }
};

export const writeTextFile = async (path: string, contents: string): Promise<string> => {
  const absolute = resolve(path);
  try {
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, contents, "utf8");
  } catch (error) {
    throw new PrLensCliError("UNREADABLE_FILE", `cannot write ${path}`, describe(error));
  }
  return absolute;
};

/** One trailing newline, so written documents behave in a diff and in a shell. */
export const writeJsonFile = (path: string, value: unknown): Promise<string> =>
  writeTextFile(path, `${JSON.stringify(value, null, 2)}\n`);

/**
 * A file that holds a secret and nothing else can rebuild: readable by its
 * owner alone, and replaced in one step so an interrupted write leaves the
 * old copy rather than half of a new one.
 */
export const writeSecretJsonFile = async (path: string, value: unknown): Promise<string> => {
  const absolute = resolve(path);
  const staging = `${absolute}.${process.pid}.tmp`;
  try {
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(staging, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(staging, absolute);
  } catch (error) {
    throw new PrLensCliError("UNREADABLE_FILE", `cannot write ${path}`, describe(error));
  }
  return absolute;
};

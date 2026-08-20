import { parseArgs, type ParseArgsConfig } from "node:util";
import { usageError } from "./errors.js";

type Options = NonNullable<ParseArgsConfig["options"]>;

/**
 * `parseArgs` throws a plain `TypeError` on an unknown flag or a missing
 * value, which would surface as a stack trace. Every one of them is a usage
 * mistake and reads as one.
 */
export const parseOptions = <Config extends Options>(
  args: readonly string[],
  options: Config,
): { values: Record<string, string | boolean | string[] | undefined>; positionals: string[] } => {
  try {
    const parsed = parseArgs({ args: [...args], options, allowPositionals: true, strict: true });
    return { values: parsed.values, positionals: parsed.positionals };
  } catch (error) {
    throw usageError(error instanceof Error ? error.message : String(error));
  }
};

export const readString = (value: unknown, flag: string): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw usageError(`--${flag} needs a value`);
  return value;
};

export const readBoolean = (value: unknown): boolean => value === true;

export const readInt = (value: unknown, flag: string, fallback: number): number => {
  const text = readString(value, flag);
  if (text === undefined) return fallback;

  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw usageError(`--${flag} needs a positive whole number, got ${JSON.stringify(text)}`);
  return parsed;
};

export const readList = (value: unknown, flag: string): string[] | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw usageError(`--${flag} needs a value`);
  return value.flatMap((entry) => (typeof entry === "string" ? entry.split(",") : []));
};

export const expectOne = (positionals: readonly string[], what: string): string => {
  const [first, ...rest] = positionals;
  if (first === undefined) throw usageError(`expected ${what}`);
  if (rest.length > 0) throw usageError(`expected ${what}, got ${positionals.length} arguments`);
  return first;
};

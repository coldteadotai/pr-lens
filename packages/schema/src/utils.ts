/**
 * Ends a switch over a closed set. Adding a variant then fails to compile at
 * every consumer instead of silently falling through at runtime.
 */
export const assertNever = (value: never, message = "Unhandled variant"): never => {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
};

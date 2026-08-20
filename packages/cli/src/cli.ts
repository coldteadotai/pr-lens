import { assertNever } from "@coldtea/pr-lens-schema";
import { analyzeCommand, USAGE as ANALYZE_USAGE } from "./commands/analyze.js";
import { commentCommand, USAGE as COMMENT_USAGE } from "./commands/comment.js";
import { exportCommand, USAGE as EXPORT_USAGE } from "./commands/export.js";
import { renderCommand, USAGE as RENDER_USAGE } from "./commands/render.js";
import { USAGE as VALIDATE_USAGE, validateCommand } from "./commands/validate.js";
import { formatError, PrLensCliError } from "./errors.js";
import type { Terminal } from "./terminal.js";
import { CLI_VERSION } from "./version.js";

const COMMANDS = ["analyze", "render", "comment", "validate", "export"] as const;
type CommandName = (typeof COMMANDS)[number];

const isCommand = (value: string): value is CommandName =>
  COMMANDS.some((command) => command === value);

const HELP = `pr-lens — review what actually matters

  pr-lens analyze   --base <ref>            a diff, read by your own model, as a graph document
  pr-lens render    <graph.json>            that document, as light and dark SVGs
  pr-lens comment   --graph --manifest      the pull request comment, as markdown
  pr-lens validate  <file...>               any PR Lens document, checked against the contract
  pr-lens export    <graph.json>            the merged state, as a map worth committing

  pr-lens <command> --help                  what a command takes
  pr-lens --version

Your model key is read from the environment and goes only to the provider you
name. https://github.com/coldteadotai/pr-lens`;

const usageFor = (command: CommandName): string => {
  switch (command) {
    case "analyze":
      return ANALYZE_USAGE;
    case "render":
      return RENDER_USAGE;
    case "comment":
      return COMMENT_USAGE;
    case "validate":
      return VALIDATE_USAGE;
    case "export":
      return EXPORT_USAGE;
    default:
      return assertNever(command, "Unhandled command");
  }
};

const dispatch = (
  command: CommandName,
  args: readonly string[],
  terminal: Terminal,
  env: Record<string, string | undefined>,
): Promise<void> => {
  switch (command) {
    case "analyze":
      return analyzeCommand(args, terminal, env);
    case "render":
      return renderCommand(args, terminal);
    case "comment":
      return commentCommand(args, terminal);
    case "validate":
      return validateCommand(args, terminal);
    case "export":
      return exportCommand(args, terminal);
    default:
      return assertNever(command, "Unhandled command");
  }
};

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_MISUSED = 2;

export const run = async (
  argv: readonly string[],
  terminal: Terminal,
  env: Record<string, string | undefined>,
): Promise<number> => {
  const [name, ...args] = argv;

  if (name === undefined) {
    terminal.err(HELP);
    return EXIT_MISUSED;
  }

  if (name === "--help" || name === "-h" || name === "help") {
    terminal.out(HELP);
    return EXIT_OK;
  }

  if (name === "--version" || name === "-v") {
    terminal.out(CLI_VERSION);
    return EXIT_OK;
  }

  if (!isCommand(name)) {
    terminal.err(formatError(new PrLensCliError("USAGE", `unknown command ${JSON.stringify(name)}`)));
    terminal.err(HELP);
    return EXIT_MISUSED;
  }

  if (args.includes("--help") || args.includes("-h")) {
    terminal.out(usageFor(name));
    return EXIT_OK;
  }

  try {
    await dispatch(name, args, terminal, env);
    return EXIT_OK;
  } catch (error) {
    if (!(error instanceof PrLensCliError)) throw error;

    terminal.err(formatError(error));
    if (error.code !== "USAGE") return EXIT_FAILED;

    terminal.err("");
    terminal.err(usageFor(name));
    return EXIT_MISUSED;
  }
};

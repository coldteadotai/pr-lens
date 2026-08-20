#!/usr/bin/env node
import { run } from "./cli.js";
import { processTerminal } from "./terminal.js";

process.exitCode = await run(process.argv.slice(2), processTerminal, process.env).catch(
  (error: unknown) => {
    processTerminal.err(error instanceof Error ? (error.stack ?? error.message) : String(error));
    return 1;
  },
);

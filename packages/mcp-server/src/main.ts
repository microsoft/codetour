#!/usr/bin/env node
import { runMcpCli } from "./cli";

// Thin executable wrapper: the `codetour-mcp` npm binary and the extension's
// bundled MCP server both delegate to the shared programmatic entry in cli.ts.
runMcpCli(process.argv.slice(2)).then(
  code => {
    if (code !== 0) process.exit(code);
  },
  error => {
    console.error(error);
    process.exit(1);
  }
);

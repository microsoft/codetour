import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createContext } from "./context";
import { createServer } from "./server";
import packageJson from "../package.json";
import * as fs from "node:fs";

// Reusable programmatic entry for the MCP server command line. The
// `codetour-mcp` npm binary (src/main.ts), the extension's bundled server and
// the standalone `codetour mcp` subcommand all start the server through
// `runMcpCli`, so argument parsing, diagnostics and startup cannot drift
// between distributions.
//
// The server handles exactly one workspace: the process working directory,
// which every MCP client can set without a proprietary launch argument.
// `--workspace-root` is an explicit override for clients that cannot control
// the working directory of the launched process.

// Text sinks so embedded callers can capture output. The defaults reproduce
// the binary behavior exactly: information on stdout, diagnostics on stderr.
export interface McpCliIO {
  out: (text: string) => void;
  err: (text: string) => void;
}

const consoleIO: McpCliIO = {
  out: text => console.log(text),
  err: text => console.error(text),
};

interface ParsedArgs {
  help: boolean;
  version: boolean;
  workspaceRoot?: string;
}

class UsageError extends Error {}

function usage(): string {
  return [
    `codetour-mcp v${packageJson.version}`,
    "Local MCP server for AI-generated CodeTour Project Tours and Changes Tours.",
    "",
    "Usage: codetour-mcp [--workspace-root <directory>]",
    "",
    "Options:",
    "  --help, -h               Show this help",
    "  --version, -v            Show the version",
    "  --workspace-root <dir>    Workspace to serve instead of the process working directory",
    "",
    "The server serves exactly one workspace: the process working directory by",
    "default, or the directory passed to --workspace-root. Prefer setting the",
    "working directory; use --workspace-root only when the client cannot.",
  ].join("\n");
}

// Parse command-line arguments, rejecting invalid input with the diagnostic
// (including usage) that the caller should report.
function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = { help: false, version: false };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      result.help = true;
    } else if (argument === "--version" || argument === "-v") {
      result.version = true;
    } else if (argument.startsWith("--workspace-root=")) {
      result.workspaceRoot = argument.slice("--workspace-root=".length);
    } else if (argument === "--workspace-root") {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new UsageError(`Missing value for ${argument}\n\n${usage()}`);
      }
      result.workspaceRoot = value;
      index++;
    } else {
      throw new UsageError(`Unknown argument: ${argument}\n\n${usage()}`);
    }
  }
  if (result.workspaceRoot !== undefined && result.workspaceRoot.trim() === "") {
    throw new UsageError(`Empty value for --workspace-root\n\n${usage()}`);
  }
  return result;
}

// Parse `argv` (not process.argv), report diagnostics through `io` and start
// the stdio server. Returns the process exit code: 0 for --help, --version
// and a completed session, 1 for invalid arguments and unusable workspaces.
// Diagnostics are emitted before the protocol starts; during a session the
// entry owns stdin/stdout and writes nothing else to them.
export async function runMcpCli(
  argv: string[],
  io: McpCliIO = consoleIO
): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    return 1;
  }
  if (args.help) {
    io.out(usage());
    return 0;
  }
  if (args.version) {
    io.out(packageJson.version);
    return 0;
  }
  const workspaceRoot = args.workspaceRoot ?? process.cwd();
  // Verify the workspace before starting, so failures are clear.
  try {
    createContext(workspaceRoot);
    fs.accessSync(workspaceRoot, fs.constants.R_OK | fs.constants.X_OK);
    // Probe actual enumeration as well: Windows access() does not check ACLs.
    fs.readdirSync(workspaceRoot);
  } catch {
    io.err(
      `Error: the workspace is not an accessible directory: ${workspaceRoot}`
    );
    return 1;
  }

  const server = createServer(workspaceRoot);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // The client owns stdin; closing it ends the session. Resolve then so the
  // calling process can exit cleanly, mirroring the binary's lifecycle.
  await new Promise<void>(resolve => {
    process.stdin.once("end", resolve);
    process.stdin.once("close", resolve);
  });
  return 0;
}

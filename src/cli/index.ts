#!/usr/bin/env node
import { randomUUID } from "crypto";
import { execFileSync, spawn } from "child_process";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { pathToFileURL } from "url";
import { Command, CommanderError } from "commander";
import type { CodeTour } from "../store";
import { loadTour } from "../store/tourSchema";
import { discoverToursFromRoot, visibleTours } from "../core/tourDiscovery";
import { renderDescription } from "codetour-description-renderer";
import { runMcpCli } from "codetour-mcp";
import { createStandaloneTourHtml } from "./html";
import { doctor, findAgentIntegration, listAgents, agentIds } from "./agentIntegrations";
import { resolveReadonlyStepContext } from "./stepContext";
import { readTourImages } from "./stepImages";
import { launchTerminalReader } from "./terminalLauncher";
import { runTerminalTour } from "./terminal";
import { resolveTourSelection } from "./tourResolution";
import { fileURLToPath } from "node:url";

const USAGE = "Usage: codetour [tour] [--renderer html|terminal]";

interface Options {
  renderer?: string;
  install?: string;
  uninstall?: string;
  force: boolean;
  agents: boolean;
  doctor: boolean;
  internalListTours: boolean;
  internalResolveTour?: string | boolean;
  internalTourId?: string;
  internalTour?: string[]; }

function buildProgram(): Command {
  const command = new Command()
    .name("codetour")
    .enablePositionalOptions()
    .allowExcessArguments(false)
    .description("Read guided Tours of a codebase, and generate them with AI agents.")
    .argument("[title]", "Tour title or Tour file name")
    .option("--renderer <type>", "open the Tour as html (default) or terminal")
    .option("--install <agent>", "install an agent integration: " + agentIds())
    .option("--uninstall <agent>", "remove an agent integration installed by this CLI")
    .option("--force", "replace a pre-existing installation whose content differs")
    .option("--agents", "list every agent integration and its state")
    .option("--doctor", "diagnose this CLI and every agent integration")
    .option("--internal-list-tours", "print the discoverable Tours as JSON")
    .option("--internal-resolve-tour [title]", "resolve a Tour by title or file name and print its identity as JSON")
    .option("--internal-tour-id <id>", "open the Tour with this discovered identity")
    .option("--internal-tour <args...>", "internal: run the terminal reader on a Tour file")
    .action(async (title: string | undefined, options: Options) => runWithOptions(options, title))
    .exitOverride()
    // The mapped messages in toCliError are the CLI's error contract; the
    // framework's own line would duplicate them.
    .configureOutput({ outputError: () => {} });
  command
    .command("mcp [args...]")
    .description("start the CodeTour MCP server over stdio; run 'codetour mcp --help' for its options")
    .allowUnknownOption()
    .passThroughOptions()
    .helpOption(false)
    .action(async (args: string[]) => {
      // Raw forwarding: the shared MCP entry owns its own argument parsing,
      // validation and help, in every directory, Git or not.
      const exitCode = await runMcpCli(args);
      if (exitCode !== 0) process.exit(exitCode);
    });
  return command;
}

// Commander errors keep the established CLI message contract: the tests and
// the Copilot adapter rely on these exact wordings.
function toCliError(error: CommanderError): Error {
  if (error.code === "commander.helpDisplayed") return error as unknown as Error;
  const message = error.message.replace(/^error: /, "");
  const unknownOption = message.match(/unknown option '([^']+)'/);
  if (unknownOption) return new Error(`Unknown option: ${unknownOption[1]}. ${USAGE}`);
  const missingValue = message.match(/option '([^']+)'.*argument missing/);
  if (missingValue) {
    const option = missingValue[1].split(" ")[0];
    return new Error(
      option === "--renderer"
        ? "Missing value for --renderer (html or terminal)."
        : `Missing value for ${option}.`
    );
  }
  if (message.includes("too many arguments")) {
    return new Error(`Only one Tour name is allowed. ${USAGE}`);
  }
  return new Error(message);
}

function repositoryRoot(cwd: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd, encoding: "utf8", stdio: [ "ignore", "pipe", "ignore" ]
    }).trim();
  } catch {
    throw new Error("Not inside a Git worktree. Run codetour from a Git repository.");
  }
}

async function discover(root: string): Promise<CodeTour[]> {
  let customDirectory: string | undefined;
  try {
    const settings = JSON.parse(await fs.readFile(path.join(root, ".vscode", "settings.json"), "utf8"));
    if (typeof settings["codetour.customTourDirectory"] === "string") {
      customDirectory = settings["codetour.customTourDirectory"];
    }
  } catch {
    // A VS Code user setting is unavailable to the autonomous reader.
  }

  const tours = await discoverToursFromRoot(root, {
    join: path.join,
    read: uri => fs.readFile(uri, "utf8"),
    list: async uri => (await fs.readdir(uri, { withFileTypes: true })).map(entry => ({
      name: entry.name,
      isDirectory: entry.isDirectory()
    })),
    id: uri => pathToFileURL(uri).toString()
  }, customDirectory);
  return visibleTours(tours, {
    isLinux: process.platform === "linux",
    isMac: process.platform === "darwin",
    isWindows: process.platform === "win32",
    isWeb: false
  });
}

async function pickTour(tours: CodeTour[], requested?: string): Promise<CodeTour> {
  // Resolution rules (exact title, file-name fallback, unique-Tour
  // shortcut) live in the shared contract; the interactive prompt below
  // only handles the case it can serve: no requested title, many Tours.
  if (!requested && tours.length > 1) {
    console.log("Select an existing CodeTour:");
    tours.forEach((tour, index) => console.log("  " + (index + 1) + ". " + tour.title));
    const answer = await new Promise<string>((resolve, reject) => {
      const readline = require("readline").createInterface({ input: process.stdin });
      let answered = false;
      process.stdout.write("Tour number: ");
      readline.once("line", (value: string) => {
        answered = true;
        resolve(value);
        readline.close();
      });
      readline.once("close", () => {
        if (!answered) reject(new Error("Tour selection cancelled."));
      });
    });
    const selection = Number(answer);
    if (!Number.isInteger(selection) || selection < 1 || selection > tours.length) {
      throw new Error("Invalid Tour selection: " + answer);
    }
    return tours[selection - 1];
  }
  return resolveTourSelection(tours, requested);
}

async function openFileInBrowser(file: string): Promise<void> {
  const platform = process.platform;
  const command = platform === "darwin" ? "open" :
    platform === "win32" ? "powershell.exe" : "xdg-open";
  const args = platform === "darwin" ? [file] :
    platform === "win32"
      ? ["-NoProfile", "-NonInteractive", "-Command",
          "Start-Process -FilePath '" + file.replace(/'/g, "''") + "'"]
      : [file];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolve() :
      reject(new Error("Browser launcher failed: " + (signal || code))));
  });
}

async function runWithOptions(options: Options, title: string | undefined): Promise<void> {
  // Agent integrations run before Tour discovery: an installation is a
  // machine-level action, valid outside any Git worktree.
  if (options.agents) {
    await listAgents();
    return;
  }
  if (options.doctor) {
    await doctor();
    return;
  }
  if (options.install) {
    await findAgentIntegration(options.install).install({ force: options.force });
    return;
  }
  if (options.uninstall) {
    await findAgentIntegration(options.uninstall).uninstall();
    return;
  }

  if (options.internalTour) {
    if (options.internalTour.length < 1 || options.internalTour.length > 2) {
      throw new Error("Internal terminal runner requires a Tour path and optional workspace root.");
    }
    const source = loadTour(
      await fs.readFile(options.internalTour[0], "utf8"),
      pathToFileURL(options.internalTour[0]).toString()
    );
    await runTerminalTour(source, repositoryRoot(options.internalTour[1] || path.dirname(options.internalTour[0])));
    return;
  }

  // The renderer is validated before Git worktree detection, exactly as the
  // previous hand-rolled parser did: a bad renderer fails anywhere.
  if (options.renderer !== undefined && options.renderer !== "html" && options.renderer !== "terminal") {
    throw new Error("Unknown renderer '" + options.renderer + "'. Use html or terminal.");
  }

  const root = repositoryRoot(process.cwd());
  const tours = await discover(root);
  if (options.internalListTours) {
    console.log(JSON.stringify(tours.map(tour => ({id: tour.id, title: tour.title}))));
    return;
  }
  // Non-interactive resolution surface for the Copilot adapter: resolve the
  // shared selection contract for an optional requested title and print the
  // resolved identity, or fail with the exact resolution error. No prompt.
  if (options.internalResolveTour !== undefined) {
    if (title) throw new Error("Only one Tour name is allowed. " + USAGE);
    const requested = typeof options.internalResolveTour === "string" ? options.internalResolveTour : undefined;
    const resolved = resolveTourSelection(tours, requested);
    console.log(JSON.stringify({id: resolved.id, title: resolved.title}));
    return;
  }
  // Only select identities from this workspace's discovered list. Copilot
  let selected: CodeTour | undefined;
  if (options.internalTourId) {
    selected = tours.find(tour => tour.id === options.internalTourId);
    if (!selected) throw new Error("Selected Tour is no longer available.");
    if (title) throw new Error("Only one Tour can be selected.");
  }
  const tour = selected ?? await pickTour(tours, title);

  if (options.renderer === "terminal") {
    await launchTerminalReader(fileURLToPath(tour.id), root);
    console.log("CodeTour: opened independent terminal reader for " + tour.title);
    return;
  }

  const output = process.env.CODETOUR_TEST_HTML_OUTPUT ||
    path.join(os.tmpdir(), "codetour-" + randomUUID() + ".html");
  const contexts = tour.steps.map(step => resolveReadonlyStepContext(root, tour, step));
  const html = await createStandaloneTourHtml(tour, contexts, {
    // The browser is a real HTML surface: the sanitized SVG stays sharp at
    // every zoom level, unlike the terminal's half-block preview (ADR 0024).
    renderStepDescription: async description => {
      const { images } = await readTourImages(root, description);
      return renderDescription(description, "dark", {
        diagramFormat: "svg",
        resolveImageBytes: imagePath => images.get(imagePath)
      });
    }
  });
  await fs.writeFile(output, html, "utf8");
  if (!process.env.CODETOUR_TEST_HTML_OUTPUT) {
    await openFileInBrowser(output);
  }
  console.log("CodeTour: opened " + tour.title + " (" + output + ")");
}

async function main(): Promise<void> {
  const command = buildProgram();
  try {
    await command.parseAsync(process.argv, { from: "node" });
  } catch (error) {
    if ((error as CommanderError).code === "commander.helpDisplayed") return;
    throw toCliError(error as CommanderError);
  }
}

void main().catch(error => {
  console.error("CodeTour: " + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});

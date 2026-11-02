#!/usr/bin/env node
import { randomUUID } from "crypto";
import { execFileSync, spawn } from "child_process";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { pathToFileURL } from "url";
import type { CodeTour } from "../store";
import { discoverToursFromRoot, visibleTours } from "../core/tourDiscovery";
import { renderDescription } from "codetour-description-renderer";
import { runMcpCli } from "codetour-mcp";
import { createStandaloneTourHtml } from "./html";
import { resolveReadonlyStepContext } from "./stepContext";
import { readTourImages } from "./stepImages";
import { launchTerminalReader } from "./terminalLauncher";
import { runTerminalTour } from "./terminal";
import { fileURLToPath } from "node:url";

interface Arguments { tourName?: string; renderer: "html" | "terminal"; }

function parseArguments(args: string[]): Arguments {
  let tourName: string | undefined;
  let renderer: string = "html";
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--renderer") {
      if (!args[index + 1]) throw new Error("Missing value for --renderer (html or terminal).");
      renderer = args[++index];
    } else if (arg.startsWith("--renderer=")) {
      renderer = arg.slice("--renderer=".length);
    } else if (arg.startsWith("-")) {
      throw new Error("Unknown option: " + arg + ". Usage: codetour [tour] [--renderer html|terminal]");
    } else if (tourName) {
      throw new Error("Only one Tour name is allowed. Usage: codetour [tour] [--renderer html|terminal]");
    } else {
      tourName = arg;
    }
  }
  if (renderer !== "html" && renderer !== "terminal") {
    throw new Error("Unknown renderer '" + renderer + "'. Use html or terminal.");
  }
  return { tourName, renderer };
}

function repositoryRoot(cwd: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]
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
  if (tours.length === 0) {
    throw new Error("No existing Tours found in this Git worktree.");
  }
  if (requested) {
    const matches = tours.filter(tour =>
      tour.title === requested ||
      path.basename(fileURLToPath(tour.id), ".tour") === requested
    );
    if (matches.length !== 1) {
      throw new Error("Tour '" + requested + "' not found or ambiguous. Available Tours: " +
        tours.map(tour => tour.title).join(", "));
    }
    return matches[0];
  }
  if (tours.length === 1) return tours[0];

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

async function main(): Promise<void> {
  // `mcp` is a reserved command token, dispatched before Tour discovery,
  // renderer parsing and Git worktree detection: the MCP server starts in
  // any directory, Git or not, and every remaining argument is forwarded.
  if (process.argv[2] === "mcp") {
    const exitCode = await runMcpCli(process.argv.slice(3));
    if (exitCode !== 0) process.exit(exitCode);
    return;
  }
  if (process.argv[2] === "--internal-tour") {
    if (process.argv.length !== 4 && process.argv.length !== 5) throw new Error("Internal terminal runner requires a Tour path and optional workspace root.");
    const source = JSON.parse(await fs.readFile(process.argv[3], "utf8")) as CodeTour;
    source.id = pathToFileURL(process.argv[3]).toString();
    await runTerminalTour(source, repositoryRoot(process.argv[4] || path.dirname(process.argv[3])));
    return;
  }
  const args = process.argv.slice(2);
  const root = repositoryRoot(process.cwd());
  const tours = await discover(root);
  if (args.length === 1 && args[0] === "--internal-list-tours") {
    console.log(JSON.stringify(tours.map(tour => ({id: tour.id, title: tour.title}))));
    return;
  }
  // Only select identities from this workspace's discovered list. Copilot
  // passes the chosen identity so duplicate titles remain unambiguous.
  let selected: CodeTour | undefined;
  if (args[0] === "--internal-tour-id") {
    const id = args[1];
    if (!id) throw new Error("Missing internal Tour identity.");
    selected = tours.find(tour => tour.id === id);
    if (!selected) throw new Error("Selected Tour is no longer available.");
    args.splice(0, 2);
  }
  const options = parseArguments(args);
  if (selected && options.tourName) throw new Error("Only one Tour can be selected.");
  const tour = selected ?? await pickTour(tours, options.tourName);

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

void main().catch(error => {
  console.error("CodeTour: " + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});

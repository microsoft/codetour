import { execFile, spawnSync } from "child_process";
import { promises as fs, readdirSync, existsSync } from "fs";
import * as os from "os";
import * as path from "path";
import { COPILOT_EXTENSION_FILES } from "./copilot-extension.generated";

// Agent integrations registry (spec: agent-integrations-copilot-codex.md).
// Every integration owns detection, status, installation, uninstallation and
// diagnostics through the same contract. The registry grows one entry per
// agent; an unregistered id stays explicitly unsupported.

export interface DetectionResult {
  state: "detected" | "absent";
  detail: string;
}

export type InstallationState = "not-installed" | "installed" | "outdated" | "incomplete";

export interface InstallationStatus {
  state: InstallationState;
  detail: string;
}

export interface InstallOptions {
  force: boolean;
}

export interface AgentIntegration {
  id: string;
  displayName: string;
  detect(): Promise<DetectionResult>;
  status(): Promise<InstallationStatus>;
  install(options: InstallOptions): Promise<void>;
  uninstall(): Promise<void>;
}

const execFileAsync = (executable: string, args: string[]): Promise<string | undefined> =>
  new Promise(resolve => {
    execFile(executable, args, { encoding: "utf8", windowsHide: true }, (error, stdout) => {
      resolve(error ? undefined : stdout);
    });
  });

async function runAgentCommand(executable: string, args: string[]): Promise<string> {
  const output = await execFileAsync(executable, args);
  if (output === undefined) {
    throw new Error(`'${executable}' could not be executed. Make sure it is installed and on PATH.`);
  }
  return output;
}

function firstLine(output: string): string {
  return output.trim().split(/\r?\n/)[0] || "";
}

function copilotExtensionDirectory(): string {
  return process.env.CODETOUR_COPILOT_EXTENSIONS_DIR ||
    path.join(os.homedir(), ".copilot", "extensions", "codetour");
}

interface FileState {
  name: string;
  state: "current" | "modified" | "missing";
}

async function copilotFileStates(directory: string): Promise<FileState[]> {
  const states: FileState[] = [];
  for (const [name, content] of Object.entries(COPILOT_EXTENSION_FILES)) {
    const target = path.join(directory, name);
    let existing: string;
    try {
      existing = await fs.readFile(target, "utf8");
    } catch {
      states.push({ name, state: "missing" });
      continue;
    }
    states.push({ name, state: existing === content ? "current" : "modified" });
  }
  return states;
}

const copilotIntegration: AgentIntegration = {
  id: "copilot",
  displayName: "GitHub Copilot CLI",
  async detect() {
    const version = await execFileAsync("copilot", ["--version"]);
    return version
      ? { state: "detected", detail: firstLine(version) }
      : { state: "absent", detail: "The 'copilot' command was not found on PATH." };
  },
  async status() {
    const directory = copilotExtensionDirectory();
    const states = await copilotFileStates(directory);
    if (states.every(file => file.state === "current")) {
      return { state: "installed" as const, detail: `The adapter files are installed in ${directory}.` };
    }
    if (states.every(file => file.state === "missing")) {
      return { state: "not-installed" as const, detail: `No CodeTour adapter in ${directory}.` };
    }
    const changed = states.filter(file => file.state !== "current").map(file => file.name).join(", ");
    return {
      state: "outdated" as const,
      detail: `The installed adapter differs from this CLI (${changed}). Re-run with --force to replace it.`
    };
  },
  async install({ force }) {
    const directory = copilotExtensionDirectory();
    const states = await copilotFileStates(directory);
    const conflicting = states.filter(file => file.state === "modified");
    if (conflicting.length && !force) {
      throw new Error(
        `${directory} already contains a different adapter (${conflicting.map(file => file.name).join(", ")}). ` +
        "A pre-existing installation is never overwritten without consent; re-run with --force to replace it."
      );
    }
    await fs.mkdir(directory, { recursive: true });
    for (const [name, content] of Object.entries(COPILOT_EXTENSION_FILES)) {
      const target = path.join(directory, name);
      await fs.writeFile(target, content, "utf8");
      // Verify the written file and its path before reporting success.
      if (await fs.readFile(target, "utf8") !== content) {
        throw new Error(`Could not verify ${target} after installation.`);
      }
    }
    console.log(`Installed the CodeTour adapter in ${directory}.`);
    console.log("Start 'copilot --experimental' in a trusted Git worktree, accept the extension");
    console.log("(Load Only or Load & Augment), then run /codetour.");
    const onPath = spawnSync("codetour", ["mcp", "--version"], { encoding: "utf8", windowsHide: true }).status === 0;
    if (!onPath) {
      console.log(
        `The adapter resolves the CodeTour CLI through CODETOUR_CLI or PATH. Keep this command on PATH or set:`
      );
      console.log(`  CODETOUR_CLI="${path.resolve(process.argv[1] || "codetour")}"`);
    }
  },
  async uninstall() {
    const directory = copilotExtensionDirectory();
    const states = await copilotFileStates(directory);
    const foreign = states.filter(file => file.state === "modified");
    if (foreign.length) {
      throw new Error(
        `${foreign.map(file => file.name).join(", ")} in ${directory} differ from this installation ` +
        "and were left untouched. Only files this CLI owns are removed."
      );
    }
    for (const file of states) {
      if (file.state === "current") await fs.rm(path.join(directory, file.name));
    }
    const remaining = await fs.readdir(directory).catch(() => [] as string[]);
    if (!remaining.length) await fs.rmdir(directory);
    console.log(`Removed the CodeTour adapter from ${directory}.`);
  }
};

const VSCODE_EXTENSION_ID = "maurice30120.codetour";

function findVsix(): string | undefined {
  const candidates: string[] = [];
  if (process.env.CODETOUR_VSIX) candidates.push(process.env.CODETOUR_VSIX);
  const cliDirectory = path.dirname(path.resolve(process.argv[1] || "."));
  for (const directory of [process.cwd(), cliDirectory, path.dirname(cliDirectory)]) {
    try {
      for (const entry of readdirSync(directory)) {
        if (entry.endsWith(".vsix")) candidates.push(path.join(directory, entry));
      }
    } catch {
      // A directory that cannot be listed contributes no candidate.
    }
  }
  return candidates.find(candidate => existsSync(candidate));
}

const vscodeIntegration: AgentIntegration = {
  id: "vscode",
  displayName: "Visual Studio Code",
  async detect() {
    const version = await execFileAsync("code", ["--version"]);
    return version
      ? { state: "detected", detail: firstLine(version) }
      : { state: "absent", detail: "The 'code' command was not found on PATH." };
  },
  async status() {
    let listing: string;
    try {
      listing = await runAgentCommand("code", ["--list-extensions"]);
    } catch {
      // An unavailable VS Code CLI keeps --agents and --doctor usable; the
      // integration state is simply unknown rather than a failed command.
      return { state: "not-installed" as const, detail: "The 'code' command is not available; the state is unknown." };
    }
    const installed = listing.split(/\r?\n/).some(id => id.trim() === VSCODE_EXTENSION_ID);
    return installed
      ? { state: "installed" as const, detail: `Extension ${VSCODE_EXTENSION_ID} is installed.` }
      : { state: "not-installed" as const, detail: `Extension ${VSCODE_EXTENSION_ID} is not installed.` };
  },
  async install() {
    const vsix = findVsix();
    if (!vsix) {
      throw new Error(
        "No CodeTour .vsix was found in the current directory or next to the CLI. " +
        "Package one with 'npm run package' or point CODETOUR_VSIX at it."
      );
    }
    console.log(await runAgentCommand("code", ["--install-extension", vsix]));
    const status = await this.status();
    if (status.state !== "installed") {
      throw new Error(`Visual Studio Code did not report ${VSCODE_EXTENSION_ID} after installation.`);
    }
  },
  async uninstall() {
    const status = await this.status();
    if (status.state === "not-installed") {
      console.log(`Extension ${VSCODE_EXTENSION_ID} is not installed; nothing to remove.`);
      return;
    }
    console.log(await runAgentCommand("code", ["--uninstall-extension", VSCODE_EXTENSION_ID]));
  }
};

export const agentIntegrations: AgentIntegration[] = [copilotIntegration, vscodeIntegration];

export function agentIds(): string {
  return agentIntegrations.map(integration => integration.id).join(", ");
}

export function findAgentIntegration(id: string): AgentIntegration {
  const integration = agentIntegrations.find(candidate => candidate.id === id);
  if (!integration) {
    throw new Error(
      `Unsupported agent: ${id}. Available agents: ${agentIntegrations.map(candidate => candidate.id).join(", ")}.`
    );
  }
  return integration;
}

export async function listAgents(): Promise<void> {
  for (const integration of agentIntegrations) {
    const detection = await integration.detect();
    const status = await integration.status();
    console.log(`${integration.id}\t${integration.displayName}`);
    console.log(`  ${detection.state === "detected" ? `detected (${detection.detail})` : detection.detail}`);
    console.log(`  ${status.state}: ${status.detail}`);
  }
}

export async function doctor(): Promise<void> {
  const git = spawnSync("git", ["--version"], { encoding: "utf8", windowsHide: true });
  console.log(git.status === 0 ? `OK: ${firstLine(git.stdout)}` : "Missing: git is not available on PATH.");
  for (const integration of agentIntegrations) {
    const detection = await integration.detect();
    const status = await integration.status();
    console.log(`${integration.id}: ${detection.state} (${detection.detail}); integration ${status.state}. ${status.detail}`);
  }
}

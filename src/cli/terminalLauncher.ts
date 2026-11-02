import { spawn } from "node:child_process";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const quoteShell = (s: string): string => "'" + s.replace(/'/g, "'\\''") + "'";

/**
 * One independent terminal for one selected Tour. The launcher exits without
 * owning an agent, a pipe, a local server or the Tour process lifecycle.
 */
export async function launchTerminalReader(tourPath: string, root: string): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "codetour-terminal-"));
  const platform = process.platform;
  const exe = process.execPath;
  const entry = process.argv[1];
  if (!entry) throw new Error("Cannot locate the CodeTour CLI executable.");

  const command = [exe, entry, "--internal-tour", tourPath, root];
  let host: string;
  let args: string[];
  if (platform === "win32") {
    const script = path.join(dir, "codetour.cmd");
    // Quote each Windows path and escape percent expansion in batch files.
    // Disable delayed expansion so exclamation marks remain literal.
    await writeFile(script, [
      "@echo off",
      "@title CodeTour",
      '"' + exe.replace(/%/g, '%%') + '" "' + entry.replace(/%/g, '%%') +
        '" --internal-tour "' + tourPath.replace(/%/g, '%%') + '" "' + root.replace(/%/g, '%%') + '"',
      "if errorlevel 1 pause"
    ].join("\r\n"), "utf8");
    host = "powershell.exe";
    args = ["-NoProfile", "-NonInteractive", "-Command",
      "$ErrorActionPreference='Stop'; Start-Process -FilePath $env:ComSpec -ArgumentList @('/d', '/v:off', '/k', '" +
      "\"" + script.replace(/'/g, "''") + "\"') -WindowStyle Normal"];
  } else {
    const script = path.join(dir, "codetour.command");
    await writeFile(script, "#!/bin/sh\nexec " + command.map(quoteShell).join(" ") + "\n");
    await chmod(script, 0o700);
    if (platform === "darwin") {
      host = "open";
      args = ["-a", "Terminal", script];
    } else {
      // Explicit host discovery; never silently embed in the caller's tty.
      const candidates: [string, string[]][] = [
        ["x-terminal-emulator", ["-e", script]],
        ["gnome-terminal", ["--", script]],
        ["konsole", ["-e", script]],
        ["xfce4-terminal", ["--command", script]],
        ["xterm", ["-e", script]]
      ];
      let lastError: unknown;
      for (const [candidate, candidateArgs] of candidates) {
        try {
          await spawnDetached(candidate, candidateArgs);
          return;
        } catch (error) {
          lastError = error;
        }
      }
      throw new Error("No supported graphical terminal host found for CodeTour: " + String(lastError));
    }
  }
  await runLauncher(host, args);
}

function spawnDetached(command: string, args: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

// open/PowerShell are short-lived launchers; wait for their status, not the
// independent reader they start. A nonzero launcher exit must be visible.
function runLauncher(command: string, args: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolve() :
      reject(new Error("Terminal launcher failed: " + (signal || code))));
  });
}

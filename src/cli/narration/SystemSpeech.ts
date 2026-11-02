import { spawn, type ChildProcess } from "node:child_process";

/**
 * The local OS text-to-speech facility the narration speaks through (spec
 * #79). One utterance at a time: `speak` settles when the utterance is over,
 * and `cancel` cuts it immediately — an interrupted utterance is completed,
 * not failed, so cancellation can never surface as an engine error.
 */
export interface NarrationEngine {
  /** Speak `text` to completion, with the OS default voice and language. */
  speak(text: string): Promise<void>;
  /** Stop the current utterance immediately; never throws. */
  cancel(): void;
  /** Release the engine's subprocess; the engine is unusable afterwards. */
  dispose(): void;
}

/** How the utterance reaches the speech command: argv data or stdin data. */
export type SpeechChannel = "argv" | "stdin";

export interface CommandSpeechOptions {
  channel?: SpeechChannel;
}

/**
 * One speech command per utterance. The utterance is always data, never a
 * command: it is passed as a single argv element after `--` (so a description
 * starting with a dash cannot become an option) or as UTF-8 stdin bytes
 * behind a fixed command — it is never interpolated into a shell.
 */
export class CommandSpeech implements NarrationEngine {
  private active?: { child: ChildProcess; settle: (error?: Error) => void };

  constructor(
    private readonly command: string,
    private readonly args: readonly string[] = [],
    private readonly options: CommandSpeechOptions = {}
  ) {}

  speak(text: string): Promise<void> {
    // One utterance at a time: replacing speech cancels the previous one.
    this.cancel();
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const channel = this.options.channel ?? "argv";
      const child = spawn(this.command,
        channel === "argv" ? [...this.args, "--", text] : [...this.args],
        { stdio: ["pipe", "ignore", "ignore"] });
      const settle = (error?: Error): void => {
        if (settled) return;
        settled = true;
        if (this.active?.child === child) this.active = undefined;
        error ? reject(error) : resolve();
      };
      this.active = { child, settle };
      child.once("exit", (code, signal) =>
        settle(code === 0 ? undefined
          : new Error(this.command + " exited with " + (signal ?? "code " + code))));
      child.once("error", error => settle(error));
      if (channel === "stdin") {
        // A dying command closes its stdin; the exit or error event settles.
        child.stdin.on("error", () => undefined);
        child.stdin.end(text, "utf8");
      }
    });
  }

  cancel(): void {
    const active = this.active;
    this.active = undefined;
    if (!active) return;
    // An interrupted utterance completes; only real engine failures reject.
    active.settle();
    try {
      active.child.kill();
    } catch {
      // An already-exited child has nothing left to release.
    }
  }

  dispose(): void {
    this.cancel();
  }
}

/** A platform with no local speech facility: every utterance fails cleanly. */
export class UnavailableSpeech implements NarrationEngine {
  constructor(private readonly reason: string) {}

  speak(): Promise<void> {
    return Promise.reject(new Error(this.reason));
  }

  cancel(): void {}

  dispose(): void {}
}

// A fixed PowerShell script: the utterance is stdin data the script reads as
// UTF-8, so quotes, newlines and command characters in a description are
// inert. System.Speech speaks with the default installed voice.
const POWERSHELL_ARGS = [
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  "$r = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), " +
    "[System.Text.Encoding]::UTF8); " +
    "Add-Type -AssemblyName System.Speech; " +
    "(New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak($r.ReadToEnd())"
];

/**
 * The local speech engine of the host: `say` on macOS and PowerShell
 * System.Speech on Windows, both with the system-selected default voice; any
 * other platform has no audio and reading stays fully usable. Like
 * `CODETOUR_ACP_COMMAND`, `CODETOUR_SPEECH_COMMAND` runs one explicit speech
 * command instead — the deterministic tests use it to put a fake engine at
 * the real process boundary.
 */
export function createSystemSpeech(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): NarrationEngine {
  const command = env.CODETOUR_SPEECH_COMMAND?.trim();
  if (command) return new CommandSpeech(command);
  switch (platform) {
    case "darwin":
      return new CommandSpeech("say");
    case "win32":
      return new CommandSpeech("powershell", POWERSHELL_ARGS, { channel: "stdin" });
    default:
      return new UnavailableSpeech(
        "Local speech synthesis is not available on " + platform + ".");
  }
}

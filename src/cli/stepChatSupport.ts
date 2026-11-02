import { execFileSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import * as path from "node:path";
import { acpProviders, type AcpProvider } from "../agent/acpProviders";
import { createFallbackStepChatResponder } from "../agent/fallbackStepChatAgent";
import type { StepChatContext, StepChatResponder } from "../agent/stepChatContract";
import type { CodeTour, CodeTourStep } from "../store";
import type { ReadonlyStepContext } from "./stepContext";

export interface TerminalChatSession {
  /** The first installed candidate, as the panel names the agent. */
  provider?: AcpProvider;
  /**
   * The Tour Step Conversation responder: one failover policy over every
   * installed candidate (ADR 0014), shared with the extension's chat.
   */
  responder?: StepChatResponder;
  dispose(): Promise<void>;
}

/**
 * The terminal reader's Tour Step Conversation session. Only installed
 * candidates are tried, in the extension's order, and the ordered failover
 * between them is the single policy of ADR 0014 — the same one the
 * extension's chat uses. Nothing is downloaded and no provider is started
 * until the reader asks a question.
 */
export function openTerminalChat(
  root: string,
  options: {
    providers?: AcpProvider[];
    exists?: (command: string) => boolean;
    createResponder?: (providers: AcpProvider[]) => StepChatResponder;
    env?: NodeJS.ProcessEnv;
  } = {}
): TerminalChatSession {
  const env = options.env ?? process.env;
  const exists = options.exists ?? commandExists;
  const providers = (options.providers ?? configuredProviders(root, env))
    .filter(candidate => exists(candidate.entry.command));
  if (!providers.length) {
    return { dispose: async () => undefined };
  }
  const create = options.createResponder ??
    ((candidates: AcpProvider[]) => createFallbackStepChatResponder(() => candidates));
  const responder = create(providers);
  return {
    provider: providers[0],
    responder,
    async dispose() {
      await responder.dispose?.();
    }
  };
}

/**
 * `CODETOUR_ACP_COMMAND` (with `CODETOUR_ACP_ARGS`) runs one explicit ACP
 * command, as the tests and an advanced reader do; `CODETOUR_ACP_PROVIDER`
 * restricts the installed providers by name. Otherwise every provider on
 * PATH is a candidate, in the extension's order.
 */
function configuredProviders(root: string, env: NodeJS.ProcessEnv): AcpProvider[] {
  const command = env.CODETOUR_ACP_COMMAND?.trim();
  if (command) {
    return [{
      name: "custom",
      entry: {
        command,
        args: (env.CODETOUR_ACP_ARGS ?? "").split(" ").filter(Boolean),
        cwd: root
      }
    }];
  }
  const only = env.CODETOUR_ACP_PROVIDER?.trim().toLowerCase();
  const providers = acpProviders(root);
  if (!only) return providers;
  return providers.filter(candidate => candidate.name.toLowerCase().includes(only));
}

/** True when a command is an executable on PATH (or a path to one). */
export function commandExists(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): boolean {
  if (command.includes("/") || command.includes("\\")) {
    return isExecutable(command, platform);
  }
  const extensions = platform === "win32"
    ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];
  for (const directory of (env.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      if (isExecutable(path.join(directory, command + extension), platform)) {
        return true;
      }
    }
  }
  return false;
}

function isExecutable(file: string, platform: NodeJS.Platform): boolean {
  try {
    accessSync(file, platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The Step context a question is grounded in: the code the reader sees, or
 * both snapshots of a diff Step. A target that cannot be read is reported as
 * unavailable rather than replaced by another file.
 */
export function buildStepChatContext(
  tour: CodeTour,
  step: CodeTourStep,
  context: ReadonlyStepContext,
  readCommitFile: (ref: string, file: string) => string | undefined = () => undefined
): StepChatContext {
  const description = step.description ?? "";
  const file = step.file || step.uri;
  if (context.kind === "code") {
    return { available: true, path: file, code: context.text ?? "", description };
  }
  if (context.kind === "diff" && step.file && tour.baseRef && tour.ref) {
    const basePath = step.baseFile || step.file;
    const original = readCommitFile(tour.baseRef, basePath);
    const modified = readCommitFile(tour.ref, step.file);
    if (original !== undefined && modified !== undefined) {
      return {
        available: true,
        path: step.file,
        diff: {
          original: { path: basePath, ref: tour.baseRef, code: original },
          modified: { path: step.file, ref: tour.ref, code: modified }
        },
        description
      };
    }
  }
  return { available: false, path: file, description };
}

/** Reads one file as it exists at a commit, or undefined when it cannot. */
export function commitFileReader(root: string): (ref: string, file: string) => string | undefined {
  return (ref, file) => {
    if (!/^[a-f0-9]{40}$/.test(ref)) return undefined;
    try {
      return execFileSync("git", ["show", ref + ":" + file.replace(/\\/g, "/")], {
        cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 20 * 1024 * 1024
      });
    } catch {
      return undefined;
    }
  };
}

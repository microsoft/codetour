import { spawn } from "node:child_process";

/**
 * Terminal-native Mermaid rendering goes through `termaid`, an external
 * command that draws a diagram with Unicode box-drawing characters. The reader
 * keeps working without it: a missing or failing command falls back to the
 * validated Mermaid source (ADR 0026).
 */
export interface DiagramTextOptions {
  /** Terminal columns the drawing may occupy, including its own padding. */
  width: number;
  /** Executable to run; defaults to `CODETOUR_TERMAID` or `termaid` on PATH. */
  command?: string;
  /** Arguments before the diagram source on stdin; replaces the defaults. */
  args?: string[];
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_CACHE_ENTRIES = 16;
const cache = new Map<string, string | undefined>();

/** The configured command, or undefined when terminal diagrams are disabled. */
export function diagramTextCommand(): string | undefined {
  const override = process.env.CODETOUR_TERMAID;
  if (override !== undefined) return override.trim() || undefined;
  return "termaid";
}

/**
 * Draw a Mermaid source as terminal text, or return undefined when no renderer
 * can be used. The source is written to stdin so no author text reaches a
 * command line.
 */
export async function renderMermaidText(
  source: string,
  options: DiagramTextOptions
): Promise<string | undefined> {
  const width = Math.max(20, Math.floor(options.width));
  const command = options.command ?? diagramTextCommand();
  if (!command) return undefined;

  const key = width + "\u0000" + command + "\u0000" + source;
  if (cache.has(key)) return cache.get(key);

  let text: string | undefined;
  try {
    const stdout = await run(
      command,
      options.args ?? ["--width", String(width)],
      source,
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    );
    text = normalize(stdout);
  } catch {
    text = undefined;
  }

  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, text);
  return text;
}

/** Reset the per-process memo used by repeated step navigation. */
export function clearDiagramTextCache(): void {
  cache.clear();
}

function normalize(stdout: string): string | undefined {
  const text = stdout.replace(/\r\n/g, "\n").replace(/\s+$/, "");
  if (!text.trim()) return undefined;
  return text;
}

function run(
  command: string,
  args: string[],
  input: string,
  timeoutMs: number
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      child.kill();
      reject(new Error("termaid timed out"));
    }, timeoutMs);

    const finish = (error: Error | undefined, value?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value ?? "");
    };

    child.once("error", error => finish(error as Error));
    child.stdout?.on("data", chunk => { stdout += chunk; });
    child.stderr?.on("data", chunk => { stderr += chunk; });
    child.once("close", code => {
      if (code === 0) finish(undefined, stdout);
      else finish(new Error("termaid exited with " + code + ": " + stderr.trim()));
    });
    // A renderer that exits before reading stdin must not crash the reader.
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(input);
  });
}

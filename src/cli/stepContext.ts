import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { CodeTour, CodeTourStep } from "../store";

export interface ReadonlyStepContext {
  kind: "none" | "code" | "diff" | "directory" | "unavailable";
  label?: string;
  text?: string;
  diagnostic?: string;
}

const COMMIT_SHA = /^[a-f0-9]{40}$/;
const CONTEXT_LINES = 5;

function git(root: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 20 * 1024 * 1024
  });
}

function worktreePath(root: string, file: string): string {
  return path.resolve(root, file);
}

function gitPath(root: string, file: string): string {
  return path.relative(root, worktreePath(root, file)).replace(/\\/g, "/");
}

function regularFileAtCommit(root: string, ref: string, file: string): boolean {
  // git ls-tree is authoritative for whether the snapshot exists and is a
  // regular file. A missing path must not be confused with a missing commit.
  const rows = git(root, ["ls-tree", ref, "--", file]);
  return /^(100644|100755) blob /m.test(rows);
}

function verifyCommit(root: string, ref: string): void {
  if (!COMMIT_SHA.test(ref) || git(root, ["cat-file", "-t", ref]).trim() !== "commit") {
    throw new Error("Invalid persisted Git commit " + ref);
  }
}

function resolveDiff(root: string, tour: CodeTour, step: CodeTourStep): ReadonlyStepContext | undefined {
  if (step.display !== "diff" || !step.file || step.uri ||
    step.contents !== undefined || !tour.baseRef || !tour.ref ||
    !COMMIT_SHA.test(tour.baseRef) || !COMMIT_SHA.test(tour.ref)) {
    return undefined;
  }
  try {
    verifyCommit(root, tour.baseRef);
    verifyCommit(root, tour.ref);
    const head = gitPath(root, step.file);
    const base = gitPath(root, step.baseFile || step.file);
    if (!regularFileAtCommit(root, tour.ref, head)) return undefined;
    const baseExists = regularFileAtCommit(root, tour.baseRef, base);
    if (step.baseFile && !baseExists) return undefined;
    const args = ["diff", "--no-ext-diff", "--no-color", "--find-renames",
      "--unified=5", tour.baseRef, tour.ref, "--", base];
    if (head !== base) args.push(head);
    const text = git(root, args);
    return {
      kind: "diff",
      label: (step.baseFile ? step.baseFile + " → " : "") + step.file +
        " (" + tour.baseRef + " ↔ " + tour.ref + ")",
      text
    };
  } catch {
    // Match the existing VS Code fallback: an unresolved comparison is not
    // fabricated as an added file and the normal target remains readable.
    return undefined;
  }
}

function targetPath(root: string, step: CodeTourStep): string | undefined {
  if (step.file) return worktreePath(root, step.file);
  if (step.uri) {
    try {
      const uri = new URL(step.uri);
      return uri.protocol === "file:" ? fileURLToPath(uri) : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function contextForCode(source: string, step: CodeTourStep): string {
  const lines = source.split(/\r?\n/);
  if (!lines.length) return source;
  let line = step.line;
  if (step.selection) line = step.selection.start.line;
  if (line === undefined && step.pattern) {
    try {
      const match = new RegExp(step.pattern, "m").exec(source);
      if (match) line = source.slice(0, match.index).split("\n").length;
    } catch {
      // Keep the file readable even with an invalid or unmatched pattern.
    }
  }
  if (line === undefined) return source;
  const start = Math.max(0, line - 1 - CONTEXT_LINES);
  const end = Math.min(lines.length,
    (step.selection ? step.selection.end.line : line) + CONTEXT_LINES);
  return lines.slice(start, end)
    .map((text, index) => String(start + index + 1).padStart(5, " ") + "  " + text)
    .join("\n");
}

export function resolveReadonlyStepContext(
  root: string,
  tour: CodeTour,
  step: CodeTourStep
): ReadonlyStepContext {
  const diff = resolveDiff(root, tour, step);
  if (diff) return diff;
  if (step.contents !== undefined) {
    return { kind: "code", label: step.file || "Embedded content", text: contextForCode(step.contents, step) };
  }
  const file = targetPath(root, step);
  if (file) {
    try {
      let source: string;
      // The editor uses the live worktree for HEAD/current branch and a Git
      // document for a reference that resolves to a different commit.
      if (tour.ref && tour.ref !== "HEAD" && step.display !== "diff") {
        const ref = git(root, ["rev-parse", "--verify", "--end-of-options", tour.ref + "^{commit}"]).trim();
        const head = git(root, ["rev-parse", "--verify", "HEAD^{commit}"]).trim();
        if (ref !== head) {
          const relative = path.relative(root, file).replace(/\\/g, "/");
          if (!relative || relative.startsWith("../") || path.isAbsolute(relative)) {
            throw new Error("Referenced file is outside the Git worktree");
          }
          if (!regularFileAtCommit(root, ref, relative)) throw new Error("File missing from referenced Git snapshot");
          source = git(root, ["show", ref + ":" + relative]);
        } else {
          source = readFileSync(file, "utf8");
        }
      } else {
        source = readFileSync(file, "utf8");
      }
      return { kind: "code", label: step.file || step.uri, text: contextForCode(source, step) };
    } catch (error) {
      return { kind: "unavailable", label: step.file || step.uri,
        diagnostic: "File unavailable: " + (error instanceof Error ? error.message : String(error)) };
    }
  }
  if (step.directory) return { kind: "directory", label: step.directory };
  if (step.uri) return { kind: "unavailable", label: step.uri,
    diagnostic: "Unsupported or unavailable URI target." };
  return { kind: "none" };
}

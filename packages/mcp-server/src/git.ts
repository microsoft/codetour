import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { WorkspaceContext } from "./types";

// All server Git operations invoke the `git` command line in the configured
// workspace. The Changes Tour depends on this history for merge-base lookup,
// HEAD SHA verification, changed-file listing, and uncommitted-change
// detection.

export interface GitResult {
  stdout: string;
  stderr: string;
  code: number;
}

export function git(args: string[], cwd: string): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code =
          error == null
            ? 0
            : typeof (error as { code?: unknown }).code === "number"
            ? ((error as { code?: unknown }).code as number)
            : 1;
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "", code });
      }
    );
  });
}

export async function isGitRepository(ctx: WorkspaceContext): Promise<boolean> {
  const result = await git(["rev-parse", "--is-inside-work-tree"], ctx.root);
  return result.code === 0 && result.stdout.trim() === "true";
}

export async function currentHeadSha(
  ctx: WorkspaceContext
): Promise<string | null> {
  const result = await git(["rev-parse", "HEAD"], ctx.root);
  return result.code === 0 ? result.stdout.trim() : null;
}

export async function currentBranchName(
  ctx: WorkspaceContext
): Promise<string | null> {
  const result = await git(["rev-parse", "--abbrev-ref", "HEAD"], ctx.root);
  return result.code === 0 ? result.stdout.trim() : null;
}

// Resolve an agent-supplied Git reference to a full commit SHA before it is
// used in any Git invocation: a raw string passed as a positional argument
// could otherwise be parsed as a Git option (e.g. `--output=...`) and alter
// the command's behavior. The validation layer rejects references starting
// with `-`, so the compound argument below can only ever be parsed as a rev.
export async function resolveCommit(
  ctx: WorkspaceContext,
  ref: string
): Promise<string | null> {
  const result = await git(
    ["rev-parse", "--verify", `${ref}^{commit}`],
    ctx.root
  );
  return result.code === 0 && result.stdout.trim().length > 0
    ? result.stdout.trim()
    : null;
}

export async function mergeBase(
  ctx: WorkspaceContext,
  a: string,
  b: string
): Promise<string> {
  const result = await git(["merge-base", a, b], ctx.root);
  if (result.code !== 0) {
    throw new Error(
      result.stderr.trim() || `git merge-base failed (exit code ${result.code})`
    );
  }
  return result.stdout.trim();
}

export async function committedDiffIsEmpty(
  ctx: WorkspaceContext,
  a: string,
  b: string
): Promise<boolean> {
  const result = await git(["diff", "--quiet", a, b], ctx.root);
  return result.code === 0;
}

export async function changedFiles(
  ctx: WorkspaceContext,
  a: string,
  b: string
): Promise<string[]> {
  const result = await git(["diff", "--name-only", "-z", a, b], ctx.root);
  if (result.code !== 0) {
    throw new Error(
      result.stderr.trim() || `git diff failed (exit code ${result.code})`
    );
  }
  return result.stdout.split("\0").filter((entry) => entry.length > 0);
}

export async function workspacePrefix(ctx: WorkspaceContext): Promise<string> {
  const result = await git(["rev-parse", "--show-prefix"], ctx.root);
  return result.code === 0 ? result.stdout.trim() : "";
}

export const RESERVED_TOUR_FILES = [
  ".tours/project.tour",
  ".tours/changes.tour",
];

export interface UncommittedEntry {
  path: string;
  status: string;
}

export function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

// Staged, unstaged, and untracked workspace changes, except for the two
// reserved Tour files: a previous generation must not trigger its own dirty
// workspace warning.
export async function uncommittedChanges(
  ctx: WorkspaceContext
): Promise<UncommittedEntry[]> {
  const result = await git(
    ["status", "--porcelain=v1", "--untracked-files=normal"],
    ctx.root
  );
  if (result.code !== 0) {
    return [];
  }
  const prefix = normalizeSlashes(await workspacePrefix(ctx));
  const entries: UncommittedEntry[] = [];
  for (const line of result.stdout.split("\n")) {
    if (line.length < 4) {
      continue;
    }
    const status = line.slice(0, 2);
    let repoPath = line.slice(3);
    if ((status.includes("R") || status.includes("C")) && repoPath.includes(" -> ")) {
      repoPath = repoPath.slice(0, repoPath.indexOf(" -> "));
    }
    if (!normalizeSlashes(repoPath).startsWith(prefix)) {
      continue;
    }
    let workspacePath = normalizeSlashes(repoPath).slice(prefix.length);
    if (status === "??" && workspacePath.endsWith("/")) {
      const directory = workspacePath.slice(0, -1);
      if (directory === ".tours" && toursDirectoryOnlyContainsReserved(ctx, directory)) {
        continue;
      }
    }
    if (RESERVED_TOUR_FILES.includes(workspacePath)) {
      continue;
    }
    entries.push({ path: workspacePath, status });
  }
  return entries;
}

// An untracked `.tours` directory appears as one `?? .tours/` entry in normal
// mode. Ignore it only when its contents are limited to the reserved Tour
// files.
function toursDirectoryOnlyContainsReserved(
  ctx: WorkspaceContext,
  directory: string
): boolean {
  const absolute = path.resolve(ctx.root, directory);
  let files: string[];
  try {
    files = fs.readdirSync(absolute, { recursive: true }) as string[];
  } catch {
    return false;
  }
  return (
    files.length > 0 &&
    files.every((file) =>
      RESERVED_TOUR_FILES.includes(
        normalizeSlashes(path.posix.join(directory, file))
      )
    )
  );
}

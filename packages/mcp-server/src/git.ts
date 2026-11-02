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

export interface CommitAnchor {
  kind: "file" | "directory" | "other";
  contents?: string;
}

// Read anchors from the commit tree, never through the checkout (which can
// contain excluded edits, deletions, or symlinks). Only requested file blobs
// are loaded; tree modes distinguish regular files from symlinks/submodules.
export async function readCommitAnchors(
  ctx: WorkspaceContext,
  ref: string,
  files: string[]
): Promise<Map<string, CommitAnchor>> {
  const prefix = normalizeSlashes(await workspacePrefix(ctx));
  const result = await git(["ls-tree", "--full-tree", "-r", "-t", "-z", ref], ctx.root);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "Unable to read the commit tree.");
  }
  const requested = new Set(files.map((file) => path.posix.normalize(normalizeSlashes(file))));
  const anchors = new Map<string, CommitAnchor>([[".", { kind: "directory" }]]);
  for (const entry of result.stdout.split("\0")) {
    const separator = entry.indexOf("\t");
    if (separator < 0) continue;
    const [mode, type, object] = entry.slice(0, separator).split(" ");
    const repoPath = entry.slice(separator + 1);
    if (!repoPath.startsWith(prefix)) continue;
    const file = repoPath.slice(prefix.length);
    const kind = type === "tree" ? "directory"
      : mode === "100644" || mode === "100755" ? "file" : "other";
    const anchor: CommitAnchor = { kind };
    if (kind === "file" && requested.has(file)) {
      const blob = await git(["cat-file", "blob", object], ctx.root);
      if (blob.code !== 0) {
        throw new Error(blob.stderr.trim() || `Unable to read ${file} at ${ref}.`);
      }
      anchor.contents = blob.stdout;
    }
    anchors.set(file, anchor);
  }
  return anchors;
}

export async function renamedFiles(
  ctx: WorkspaceContext,
  base: string,
  head: string
): Promise<Map<string, string>> {
  const prefix = normalizeSlashes(await workspacePrefix(ctx));
  const result = await git(["diff", "--name-status", "--find-renames", "-z", base, head], ctx.root);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "Unable to read file renames.");
  }
  const fields = result.stdout.split("\0");
  const renames = new Map<string, string>();
  for (let index = 0; index < fields.length && fields[index];) {
    const status = fields[index++];
    const oldPath = fields[index++];
    if (status.startsWith("R") || status.startsWith("C")) {
      const newPath = fields[index++];
      if (status.startsWith("R") && oldPath.startsWith(prefix) && newPath.startsWith(prefix)) {
        renames.set(newPath.slice(prefix.length), oldPath.slice(prefix.length));
      }
    }
  }
  return renames;
}

export async function workspacePrefix(ctx: WorkspaceContext): Promise<string> {
  const result = await git(["rev-parse", "--show-prefix"], ctx.root);
  return result.code === 0 ? result.stdout.trim() : "";
}

export interface UncommittedEntry {
  path: string;
  status: string;
}

export function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

// Any `.tour` file under `.tours/` is a Tour artifact: a previous generation
// must not trigger its own dirty workspace warning.
function isTourFile(workspacePath: string): boolean {
  return workspacePath.startsWith(".tours/") && workspacePath.endsWith(".tour");
}

// Staged, unstaged, and untracked workspace changes, except for Tour files
// under `.tours/`: a previous generation must not trigger its own dirty
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
      if (directory === ".tours" && toursDirectoryOnlyContainsTours(ctx, directory)) {
        continue;
      }
    }
    if (isTourFile(workspacePath)) {
      continue;
    }
    entries.push({ path: workspacePath, status });
  }
  return entries;
}

// An untracked `.tours` directory appears as one `?? .tours/` entry in normal
// mode. Ignore it only when its contents are limited to Tour files.
function toursDirectoryOnlyContainsTours(
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
    files.every((file) => normalizeSlashes(file).endsWith(".tour"))
  );
}

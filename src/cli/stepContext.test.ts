import { test } from "node:test";
import * as assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, renameSync, writeFileSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveReadonlyStepContext } from "./stepContext";
import type { CodeTour } from "../store";

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "codetour-diff-e2e-"));
  git(root, "init", "-q");
  git(root, "config", "user.name", "Test");
  git(root, "config", "user.email", "test@example.invalid");
  mkdirSync(path.join(root, "src"));
  const original = [
    "// shared header",
    "const alpha = 1;",
    "const beta = 2;",
    "const gamma = 3;",
    "const delta = 4;",
    "const epsilon = 5;",
    "const answer = 42;"
  ].join("\n") + "\n";
  writeFileSync(path.join(root, "src", "old.ts"), original);
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");
  const baseRef = git(root, "rev-parse", "HEAD");
  renameSync(path.join(root, "src", "old.ts"), path.join(root, "src", "new.ts"));
  writeFileSync(path.join(root, "src", "new.ts"), original + "const newlyAdded = 1;\n");
  writeFileSync(path.join(root, "src", "added.ts"), "export const added = true;\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "head");
  const ref = git(root, "rev-parse", "HEAD");
  return { root, baseRef, ref };
}

test("Project Tour anchors use current files, ranges, patterns and unanchored steps", () => {
  const { root } = fixture();
  try {
    const tour: CodeTour = { id: "test", title: "Project", steps: [] };
    const pattern = resolveReadonlyStepContext(root, tour, {
      description: "explain", file: "src/new.ts", pattern: "gamma"
    });
    assert.equal(pattern.kind, "code");
    assert.match(pattern.text || "", /gamma/);
    const embedded = resolveReadonlyStepContext(root, tour, {
      description: "inline", contents: "const inline = true;", line: 1
    });
    assert.equal(embedded.kind, "code");
    assert.match(embedded.text || "", /inline/);
    assert.equal(resolveReadonlyStepContext(root, tour, { description: "only" }).kind, "none");
    assert.equal(resolveReadonlyStepContext(root, tour, {
      description: "folder", directory: "src"
    }).kind, "directory");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Changes Tour uses exact base/head snapshots for rename and added file", () => {
  const { root, baseRef, ref } = fixture();
  try {
    const tour: CodeTour = { id: "changes", title: "Changes",
      baseRef, ref, steps: [] };
    const renamedStep = { description: "renamed", file: "src/new.ts",
      baseFile: "src/old.ts", display: "diff" as const };
    const renamed = resolveReadonlyStepContext(root, tour, renamedStep);
    assert.equal(renamed.kind, "diff");
    assert.match(renamed.label || "", /old.ts → src\/new.ts/);
    assert.match(renamed.text || "", /newlyAdded/);

    const added = resolveReadonlyStepContext(root, tour, {
      description: "new", file: "src/added.ts", display: "diff"
    });
    assert.equal(added.kind, "diff");
    assert.match(added.text || "", /\+export const added = true/);

    // The persisted head must not be replaced by a later dirty buffer.
    writeFileSync(path.join(root, "src", "new.ts"), "WRONG WORKTREE CONTENT\n");
    const replayed = resolveReadonlyStepContext(root, tour, renamedStep);
    assert.equal(replayed.text, renamed.text);
    assert.doesNotMatch(replayed.text || "", /WRONG WORKTREE CONTENT/);

    // Missing revisions use the existing fallback, not fake additions.
    const broken: CodeTour = { ...tour, ref: "f".repeat(40) };
    const fallback = resolveReadonlyStepContext(root, broken, renamedStep);
    assert.notEqual(fallback.kind, "diff");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const cli = path.resolve("dist/cli.js");

function runCli(repo, args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: repo, encoding: "utf8"
  });
}

function createTourRepo(tours) {
  const repo = mkdtempSync(path.join(os.tmpdir(), "codetour-cli-resolution-"));
  execFileSync("git", ["init", "-q", repo]);
  mkdirSync(path.join(repo, ".tours"));
  for (const [fileName, title] of tours) {
    writeFileSync(path.join(repo, ".tours", `${fileName}.tour`),
      JSON.stringify({ title, steps: [{ description: `Content for ${title}` }] }));
  }
  return repo;
}

function expectedIdentity(repo, fileName) {
  return { id: "file://" + path.join(realpathSync(repo), ".tours", `${fileName}.tour`) };
}

test("--internal-resolve-tour resolves an exact title to the Tour identity as JSON", () => {
  const repo = createTourRepo([["a", "First Tour"], ["b", "Second Tour"]]);
  try {
    const result = runCli(repo, ["--internal-resolve-tour", "First Tour"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    const resolved = JSON.parse(result.stdout);
    assert.equal(resolved.title, "First Tour");
    assert.deepEqual({ id: resolved.id }, expectedIdentity(repo, "a"));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("--internal-resolve-tour falls back to the Tour file name without the extension", () => {
  const repo = createTourRepo([["a", "First Tour"], ["b", "Second Tour"]]);
  try {
    const result = runCli(repo, ["--internal-resolve-tour", "b"]);
    assert.equal(result.status, 0, result.stderr);
    const resolved = JSON.parse(result.stdout);
    assert.equal(resolved.title, "Second Tour");
    assert.deepEqual({ id: resolved.id }, expectedIdentity(repo, "b"));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("--internal-resolve-tour without a title resolves a workspace with a single Tour", () => {
  const repo = createTourRepo([["only", "Sole Tour"]]);
  try {
    const result = runCli(repo, ["--internal-resolve-tour"]);
    assert.equal(result.status, 0, result.stderr);
    const resolved = JSON.parse(result.stdout);
    assert.equal(resolved.title, "Sole Tour");
    assert.deepEqual({ id: resolved.id }, expectedIdentity(repo, "only"));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("--internal-resolve-tour fails with the resolution error listing available titles", () => {
  const repo = createTourRepo([["a", "First Tour"], ["b", "Second Tour"]]);
  try {
    const result = runCli(repo, ["--internal-resolve-tour", "Missing Tour"]);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
    assert.match(result.stderr,
      /Tour 'Missing Tour' not found or ambiguous\. Available Tours: First Tour, Second Tour/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("--internal-resolve-tour reports duplicate titles as ambiguous with both titles listed", () => {
  const repo = createTourRepo([["one", "Duplicated"], ["two", "Duplicated"]]);
  try {
    const result = runCli(repo, ["--internal-resolve-tour", "Duplicated"]);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
    assert.match(result.stderr,
      /Tour 'Duplicated' not found or ambiguous\. Available Tours: Duplicated, Duplicated/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("--internal-resolve-tour without a title fails non-interactively when Tours are ambiguous", () => {
  const repo = createTourRepo([["a", "First Tour"], ["b", "Second Tour"]]);
  try {
    const result = runCli(repo, ["--internal-resolve-tour"]);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
    assert.match(result.stderr,
      /Tour selection is ambiguous\. Available Tours: First Tour, Second Tour/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("--internal-resolve-tour fails when the workspace has no Tours", () => {
  const repo = createTourRepo([]);
  try {
    const result = runCli(repo, ["--internal-resolve-tour", "First Tour"]);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /No existing Tours found in this Git worktree\./);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

import { test } from "node:test";
import * as assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import * as os from "os";
import * as path from "path";
import { COPILOT_EXTENSION_FILES } from "./copilot-extension.generated";

const cli = path.resolve(__dirname, "../../cli.js");

function temporaryDirectory(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Agent commands are machine-level actions: they must work outside any Git
// worktree, so every run uses an empty temporary directory as its workspace.
function run(cwd: string, args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd, encoding: "utf8",
    env: { ...process.env, ...env }
  });
}

test("the embedded Copilot adapter matches the repository sources", () => {
  // The generated module travels inside the CLI bundle; the .mjs files are
  // the readable source of truth and must never diverge from it.
  const sourceDir = path.resolve(__dirname, "../../../.github/extensions/codetour");
  for (const [name, content] of Object.entries(COPILOT_EXTENSION_FILES)) {
    assert.equal(
      readFileSync(path.join(sourceDir, name), "utf8"),
      content,
      `${name} in the bundle diverges from .github/extensions/codetour; run node scripts/embed-copilot-extension.js`
    );
  }
});

test("an install writes the adapter files and repeats without changing anything", () => {
  const workspace = temporaryDirectory("codetour-install-");
  const extensionDir = path.join(workspace, "copilot-extensions");
  try {
    const env = { CODETOUR_COPILOT_EXTENSIONS_DIR: extensionDir };
    const first = run(workspace, ["--install", "copilot"], env);
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /Installed the CodeTour adapter/);
    for (const [name, content] of Object.entries(COPILOT_EXTENSION_FILES)) {
      assert.equal(readFileSync(path.join(extensionDir, name), "utf8"), content);
    }
    const second = run(workspace, ["--install", "copilot"], env);
    assert.equal(second.status, 0, second.stderr);
    for (const [name, content] of Object.entries(COPILOT_EXTENSION_FILES)) {
      assert.equal(readFileSync(path.join(extensionDir, name), "utf8"), content);
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("a differing adapter is never replaced without explicit consent", () => {
  const workspace = temporaryDirectory("codetour-conflict-");
  const extensionDir = path.join(workspace, "copilot-extensions");
  try {
    const env = { CODETOUR_COPILOT_EXTENSIONS_DIR: extensionDir };
    assert.equal(run(workspace, ["--install", "copilot"], env).status, 0);
    writeFileSync(path.join(extensionDir, "extension.mjs"), "// a pre-existing custom installation\n");
    const refused = run(workspace, ["--install", "copilot"], env);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /never overwritten without consent/);
    assert.match(refused.stderr, /--force/);
    assert.equal(
      readFileSync(path.join(extensionDir, "extension.mjs"), "utf8"),
      "// a pre-existing custom installation\n",
      "the pre-existing file was preserved without consent"
    );
    const forced = run(workspace, ["--install", "copilot", "--force"], env);
    assert.equal(forced.status, 0, forced.stderr);
    assert.equal(
      readFileSync(path.join(extensionDir, "extension.mjs"), "utf8"),
      COPILOT_EXTENSION_FILES["extension.mjs"],
      "--force restored the adapter of this CLI"
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("an uninstall removes only the files this installation owns", () => {
  const workspace = temporaryDirectory("codetour-uninstall-");
  const extensionDir = path.join(workspace, "copilot-extensions");
  try {
    const env = { CODETOUR_COPILOT_EXTENSIONS_DIR: extensionDir };
    assert.equal(run(workspace, ["--install", "copilot"], env).status, 0);
    writeFileSync(path.join(extensionDir, "other.mjs"), "// a foreign file this CLI never installed\n");
    const removed = run(workspace, ["--uninstall", "copilot"], env);
    assert.equal(removed.status, 0, removed.stderr);
    assert.ok(!existsSync(path.join(extensionDir, "adapter.mjs")));
    assert.ok(!existsSync(path.join(extensionDir, "extension.mjs")));
    assert.equal(
      readFileSync(path.join(extensionDir, "other.mjs"), "utf8"),
      "// a foreign file this CLI never installed\n",
      "files outside this installation were left untouched"
    );
    // A modified managed file blocks the uninstall instead of deleting user work.
    assert.equal(run(workspace, ["--install", "copilot", "--force"], env).status, 0);
    writeFileSync(path.join(extensionDir, "adapter.mjs"), "// edited by the user\n");
    const blocked = run(workspace, ["--uninstall", "copilot"], env);
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.stderr, /left untouched/);
    assert.equal(readFileSync(path.join(extensionDir, "adapter.mjs"), "utf8"), "// edited by the user\n");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("an unsupported agent is explicit and an install works outside a Git worktree", () => {
  const workspace = temporaryDirectory("codetour-agents-");
  try {
    const unsupported = run(workspace, ["--install", "xxxxx"]);
    assert.notEqual(unsupported.status, 0);
    assert.match(unsupported.stderr, /Unsupported agent: xxxxx/);
    assert.match(unsupported.stderr, /Available agents: copilot, vscode/);
    // --agents reports every registered agent without failing on machines
    // where an agent CLI is missing.
    const agents = run(workspace, ["--agents"]);
    assert.equal(agents.status, 0, agents.stderr);
    assert.match(agents.stdout, /copilot\tGitHub Copilot CLI/);
    assert.match(agents.stdout, /vscode\tVisual Studio Code/);
    const doctor = run(workspace, ["--doctor"]);
    assert.equal(doctor.status, 0, doctor.stderr);
    assert.match(doctor.stdout, /git/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

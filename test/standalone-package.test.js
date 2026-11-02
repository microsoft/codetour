"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync, spawn } = require("node:child_process");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "..");
const packaging = require("../scripts/package-standalone.js");
const { verifyCriticalResource } = require("../scripts/verify-critical-resource.js");

// The MCP SDK client comes from the MCP server package's installed
// dependencies; the standalone tests are its consumer-side counterpart.
const mcpRequire = createRequire(path.join(root, "packages", "mcp-server", "package.json"));
const { Client } = mcpRequire("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = mcpRequire("@modelcontextprotocol/sdk/client/stdio.js");

const mcpVersion = JSON.parse(
  fs.readFileSync(path.join(root, "packages", "mcp-server", "package.json"), "utf8")
).version;

function listFilesRecursively(rootDirectory) {
  const entries = [];
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      // Windows path.relative joins with "\" while the expected entries are
      // forward-slash strings; normalize like the MCP package's test helper
      // (packages/mcp-server/test/helpers/test-utils.ts, issue #84).
      entries.push(path.relative(rootDirectory, entryPath).split(path.sep).join("/"));
      if (entry.isDirectory()) walk(entryPath);
    }
  };
  walk(rootDirectory);
  return entries.sort();
}

// Git stays available; no global Node executable is in this restricted PATH
// on macOS, so every launch below uses the artifact's bundled runtime only.
function restrictedEnv() {
  if (process.platform === "darwin") {
    return { PATH: "/usr/bin:/bin", HOME: os.homedir() };
  }
  return process.env;
}

function packagedLaunchSpec(args) {
  if (process.platform === "win32") {
    // cmd.exe splits an unquoted launcher path or argument at spaces. Quote
    // each known fixture value before passing it through the shell.
    return {
      command: `"${shared.launcher}"`,
      args: args.map(argument => `"${argument}"`),
      shell: true,
    };
  }
  return { command: shared.launcher, args, shell: false };
}

function spawnPackagedSync(args, options = {}) {
  const launch = packagedLaunchSpec(args);
  return spawnSync(launch.command, launch.args, { ...options, shell: launch.shell });
}

function spawnPackaged(args, options = {}) {
  const launch = packagedLaunchSpec(args);
  return spawn(launch.command, launch.args, { ...options, shell: launch.shell });
}

async function callTool(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  return {
    isError: result.isError ?? false,
    text: (result.content ?? [])
      .filter(item => item.type === "text")
      .map(item => item.text)
      .join("\n"),
    structured: result.structuredContent ?? {},
  };
}

// One real artifact for the running host, shared by every test in this file.
let shared;
before(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codetour-package-suite-"));
  // The parent directory contains a space on purpose: launchers and clients
  // must cope with spaced paths (Windows and macOS smoke coverage).
  const output = path.join(tmp, "codetour distribution", "artifact");
  const pack = spawnSync(
    process.execPath,
    [path.join(root, "scripts/package-standalone.js"), "--output", output],
    { encoding: "utf8" }
  );
  assert.equal(pack.status, 0, pack.stderr);
  shared = {
    tmp,
    artifact: output,
    launcher: path.join(output, process.platform === "win32" ? "codetour.cmd" : "codetour"),
  };
});

after(() => {
  if (shared) fs.rmSync(shared.tmp, { recursive: true, force: true });
});

test("packaged CLI reads a Tour without a globally available Node executable", () => {
  const repo = path.join(shared.tmp, "reader-repo");
  fs.mkdirSync(repo);
  const git = spawnSync("git", ["init", "-q", repo], { encoding: "utf8" });
  assert.equal(git.status, 0, git.stderr);
  fs.mkdirSync(path.join(repo, ".tours"));
  const tour = JSON.stringify({ title: "Package fixture", steps: [{ title: "Introduction", description: "Standalone works" }] });
  fs.writeFileSync(path.join(repo, ".tours", "fixture.tour"), tour);
  const html = path.join(shared.tmp, "rendered.html");
  const env = { ...process.env, CODETOUR_TEST_HTML_OUTPUT: html };
  if (process.platform === "darwin") env.PATH = "/usr/bin:/bin";
  const result = spawnPackagedSync(["fixture", "--renderer", "html"], {
    cwd: repo, env, encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(html, "utf8"), /Standalone works/);
  assert.equal(fs.readFileSync(path.join(repo, ".tours", "fixture.tour"), "utf8"), tour);
  if (process.platform === "darwin") {
    const terminal = spawnSync("/usr/bin/python3", [
      path.join(root, "test/standalone-terminal-smoke.py"),
      shared.launcher,
      path.join(repo, ".tours", "fixture.tour")
    ], { cwd: repo, env, encoding: "utf8", timeout: 30000 });
    assert.equal(terminal.status, 0, terminal.stdout + "\n" + terminal.stderr);
  }
});

test("packaged codetour mcp creates a Project Tour in a non-Git workspace without global Node", async () => {
  const workspace = path.join(shared.tmp, "tour workspace");
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, "hello.txt"), "hello standalone\n");
  const before = listFilesRecursively(workspace);
  const client = new Client(
    { name: "standalone-mcp-test-client", version: "0.0.0" },
    { capabilities: {} }
  );
  const transport = new StdioClientTransport({
    command: shared.launcher,
    args: ["mcp"],
    cwd: workspace,
    env: restrictedEnv(),
    stderr: "pipe",
  });
  const stderrChunks = [];
  await client.connect(transport);
  transport.stderr?.on("data", chunk => stderrChunks.push(String(chunk)));
  try {
    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map(tool => tool.name).sort(),
      ["create_changes_tour", "create_project_tour"]
    );
    const response = await callTool(client, "create_project_tour", {
      title: "Standalone Tour",
      steps: [{ file: "hello.txt", description: "Created by the packaged MCP server." }],
    });
    assert.equal(response.isError, false, response.text);
    assert.equal(response.structured.status, "created");
    const tour = JSON.parse(fs.readFileSync(path.join(workspace, ".tours", "project.tour"), "utf8"));
    assert.equal(tour.title, "Standalone Tour");
    // The session wrote exactly the reserved Tour file and nothing else.
    const after = listFilesRecursively(workspace);
    assert.deepEqual(
      after.filter(entry => !before.includes(entry)),
      [".tours", ".tours/project.tour"]
    );
    assert.equal(stderrChunks.join(""), "");
  } finally {
    await client.close();
  }
});

test("packaged codetour mcp serves --workspace-root from a different working directory", async () => {
  const workspace = path.join(shared.tmp, "remote workspace");
  const elsewhere = path.join(shared.tmp, "unrelated cwd");
  fs.mkdirSync(workspace);
  fs.mkdirSync(elsewhere);
  fs.writeFileSync(path.join(workspace, "hello.txt"), "hello remote\n");
  const client = new Client(
    { name: "standalone-mcp-test-client", version: "0.0.0" },
    { capabilities: {} }
  );
  const transport = new StdioClientTransport({
    command: shared.launcher,
    args: ["mcp", "--workspace-root", workspace],
    cwd: elsewhere,
    env: restrictedEnv(),
  });
  await client.connect(transport);
  try {
    const response = await callTool(client, "create_project_tour", {
      steps: [{ file: "hello.txt", description: "Anchored inside the workspace passed to --workspace-root." }],
    });
    assert.equal(response.isError, false, response.text);
    assert.ok(fs.existsSync(path.join(workspace, ".tours", "project.tour")));
    assert.equal(fs.existsSync(path.join(elsewhere, ".tours")), false);
  } finally {
    await client.close();
  }
});

test("the standalone MCP serves the complete critical review skill offline", async () => {
  const runtime = path.join(shared.artifact, process.platform === "win32" ? "node.exe" : "node");
  await verifyCriticalResource(runtime,
    [path.join(shared.artifact, "dist", "cli.js"), "mcp"], shared.tmp);
});

test("packaged creation and both readers preserve Project and neutral or critical Changes Tours", async () => {
  const workspace = path.join(shared.tmp, "generation playback");
  fs.mkdirSync(workspace);
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: workspace, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init", "-q");
  fs.writeFileSync(path.join(workspace, "code.ts"), "export const baseline = 1;\n");
  git("add", "code.ts");
  git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "base");
  const baseRef = git("rev-parse", "HEAD");
  fs.writeFileSync(path.join(workspace, "code.ts"), "export const delivered = 2;\n");
  git("add", "code.ts");
  git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "feature");
  let headRef = git("rev-parse", "HEAD");
  const client = new Client({ name: "generation-playback-test", version: "0.0.0" }, { capabilities: {} });
  const transport = new StdioClientTransport({ command: shared.launcher, args: ["mcp"], cwd: workspace, env: restrictedEnv() });
  const cases = [
    { fileName: "project", tool: "create_project_tour" },
    { fileName: "neutral", tool: "create_changes_tour", reviewMode: "neutral" },
    { fileName: "critical-no-spec", tool: "create_changes_tour", reviewMode: "critical",
      description: "Spec axis not evaluated: no spec source was found." },
    { fileName: "critical-with-spec", tool: "create_changes_tour", reviewMode: "critical",
      description: "Spec source: docs/spec.md. No defect established." }
  ];
  await client.connect(transport);
  try {
    for (const scenario of cases) {
      if (scenario.fileName === "critical-with-spec") {
        fs.mkdirSync(path.join(workspace, "docs"));
        fs.writeFileSync(path.join(workspace, "docs", "spec.md"), "# Requirement\n\nThe delivered constant is 2.\n");
        git("add", "docs/spec.md");
        git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "record docs/spec.md");
        headRef = git("rev-parse", "HEAD");
      }
      scenario.headRef = headRef;
      // Fake Tour Generator: the packaged server supplies instructions before
      // the author submits steps. MCP validates proposals; it does not review.
      if (scenario.reviewMode === "critical") {
        const resource = await client.readResource({ uri: "codetour://review/critical-instructions" });
        assert.ok(resource.contents.some(content => "text" in content && content.text.includes("Standards")));
      }
      const response = await callTool(client, scenario.tool, {
        title: scenario.fileName, fileName: scenario.fileName,
        ...(scenario.reviewMode ? { baseRef, headRef, reviewMode: scenario.reviewMode } : {}),
        ...(scenario.description ? { description: scenario.description } : {}),
        steps: [{ title: "Introduction", file: "code.ts", line: 1, description: "The delivered constant is 2." }]
      });
      assert.equal(response.isError, false, response.text);
    }
  } finally { await client.close(); }
  // Readers must resolve committed diff snapshots despite a later dirty edit.
  fs.writeFileSync(path.join(workspace, "code.ts"), "export const dirty = 99;\n");
  for (const scenario of cases) {
    const tourPath = path.join(workspace, ".tours", `${scenario.fileName}.tour`);
    const original = fs.readFileSync(tourPath, "utf8");
    const tour = JSON.parse(original);
    assert.equal("reviewMode" in tour, false);
    const html = path.join(shared.tmp, `${scenario.fileName}.html`);
    const result = spawnPackagedSync([scenario.fileName, "--renderer", "html"], {
      cwd: workspace, env: { ...process.env, ...restrictedEnv(), CODETOUR_TEST_HTML_OUTPUT: html },
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr);
    const rendered = fs.readFileSync(html, "utf8");
    assert.match(rendered, /The delivered constant is 2/);
    if (scenario.reviewMode) {
      assert.equal(tour.ref, scenario.headRef);
      assert.equal(tour.baseRef, baseRef);
      assert.equal(tour.steps[0].display, "diff");
      assert.match(rendered, /baseline = 1/);
      assert.match(rendered, /delivered = 2/);
      assert.doesNotMatch(rendered, /dirty = 99/);
    }
    if (process.platform === "darwin") {
      const terminal = spawnSync("/usr/bin/python3", [path.join(root, "test/standalone-terminal-smoke.py"), shared.launcher, tourPath,
        ...(scenario.reviewMode ? ["baseline", "delivered"] : [])], {
        cwd: workspace, env: { ...process.env, ...restrictedEnv() }, encoding: "utf8", timeout: 30000
      });
      assert.equal(terminal.status, 0, terminal.stdout + "\n" + terminal.stderr);
    }
    assert.equal(fs.readFileSync(tourPath, "utf8"), original);
  }
});

test("packaged codetour mcp help, version and argument diagnostics match codetour-mcp", () => {
  const workspace = path.join(shared.tmp, "diagnostics workspace");
  fs.mkdirSync(workspace);
  const env = { ...restrictedEnv() };
  const run = args => spawnPackagedSync(args, {
    cwd: workspace, env, encoding: "utf8"
  });

  const help = run(["mcp", "--help"]);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage: codetour-mcp/);
  assert.match(help.stdout, /--workspace-root <dir>/);

  const version = run(["mcp", "--version"]);
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), mcpVersion);
  assert.equal(version.stderr, "");

  const unknown = run(["mcp", "--bogus"]);
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /Unknown argument: --bogus/);
  assert.equal(unknown.stdout, "");

  const missing = run(["mcp", "--workspace-root"]);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /Missing value for --workspace-root/);
  assert.equal(missing.stdout, "");

  const inaccessible = run(["mcp", "--workspace-root", path.join(workspace, "missing")]);
  assert.notEqual(inaccessible.status, 0);
  assert.match(inaccessible.stderr, /not an accessible directory/);
  assert.equal(inaccessible.stdout, "");
});

test("packaged codetour mcp keeps stdout protocol-only and exits when stdin closes", async () => {
  const workspace = path.join(shared.tmp, "protocol workspace");
  fs.mkdirSync(workspace);
  const child = spawnPackaged(["mcp"], {
    cwd: workspace,
    env: restrictedEnv(),
  });
  let stdout = "";
  let stderrText = "";
  child.stdout.on("data", chunk => (stdout += String(chunk)));
  child.stderr.on("data", chunk => (stderrText += String(chunk)));
  const exited = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not exit after stdin close: ${stdout}`)), 10000);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
    child.once("error", error => { clearTimeout(timer); reject(error); });
  });
  // Raw JSON-RPC handshake: any banner or reader output on stdout would make
  // a line fail to parse as a protocol message.
  const request = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "raw-client", version: "0.0.0" },
    },
  }) + "\n";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no initialize response: ${stdout}`)), 15000);
    child.stdout.on("data", chunk => {
      if (String(chunk).includes('"result"')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stdin.write(request);
  });
  child.stdin.end();
  const { code } = await exited;
  assert.equal(code, 0);
  assert.equal(stderrText, "");
  const lines = stdout.split("\n").filter(line => line.trim() !== "");
  assert.ok(lines.length >= 1);
  for (const line of lines) {
    assert.doesNotThrow(() => JSON.parse(line), `non-protocol stdout: ${line}`);
  }
});

test("the artifact contains the MCP server exactly once and preserves permissions and licenses", () => {
  // Single-server invariant on the real artifact.
  assert.doesNotThrow(() => packaging.assertSingleMcpServer(shared.artifact));
  assert.equal(fs.existsSync(path.join(shared.artifact, "dist", "mcp-server.js")), false);
  // Licenses travel with the distribution.
  for (const license of ["NODE-LICENSE", "RESVG-LICENSE", path.join("dist", "cli.js.LICENSE.txt")]) {
    assert.ok(fs.existsSync(path.join(shared.artifact, license)), `missing ${license}`);
  }
  // The launchers and the bundled runtime stay executable on POSIX.
  if (process.platform !== "win32") {
    for (const executable of [
      path.join(shared.artifact, "codetour"),
      path.join(shared.artifact, "node"),
    ]) {
      const mode = fs.statSync(executable).mode;
      assert.equal(mode & 0o111, 0o111, `${executable} must be executable`);
    }
  }
  // The Windows launcher, when present, forwards every argument.
  const cmdPath = path.join(shared.artifact, "codetour.cmd");
  if (process.platform === "win32") {
    const cmd = fs.readFileSync(cmdPath, "utf8");
    assert.match(cmd, /node\.exe/);
    assert.match(cmd, /dist\\cli\.js/);
    assert.match(cmd, /%\*/);
  }
});

test("the Windows launcher template forwards every argument to the CLI", () => {
  const cmd = packaging.launcherScript("win32");
  assert.match(cmd, /node\.exe/);
  assert.match(cmd, /dist\\cli\.js/);
  assert.match(cmd, /%\*/);
  const sh = packaging.launcherScript("darwin");
  assert.match(sh, /"\$DIR\/node"/);
  assert.match(sh, /dist\/cli\.js/);
  assert.match(sh, /"\$@"/);
});

test("the packager rejects a CLI bundle over the measured size budget", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codetour-package-budget-"));
  try {
    // Guard level: an oversized bundle is rejected with the budget message.
    const oversized = path.join(tmp, "oversized.js");
    fs.writeFileSync(oversized, "x".repeat(64));
    assert.throws(() => packaging.assertWithinBudget(oversized, 32), /budget/);
    const fits = path.join(tmp, "fits.js");
    fs.writeFileSync(fits, "x".repeat(16));
    assert.doesNotThrow(() => packaging.assertWithinBudget(fits, 32));
    // Packaging level: the budget fails before any download or output.
    const badArchive = path.join(tmp, "invalid-archive");
    fs.writeFileSync(badArchive, "invalid");
    const output = path.join(tmp, "artifact");
    const result = spawnSync(
      process.execPath,
      [path.join(root, "scripts/package-standalone.js"), "--output", output],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          CODETOUR_NODE_ARCHIVE: badArchive,
          CODETOUR_CLI_BUDGET_BYTES: "1000",
        },
      }
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /budget/);
    assert.equal(fs.existsSync(output), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("the packager rejects an artifact that contains a second MCP server entry", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codetour-package-duplicate-"));
  try {
    const fake = path.join(tmp, "artifact");
    fs.mkdirSync(path.join(fake, "dist"), { recursive: true });
    const marker = 'console.log("Usage: codetour-mcp");\n';
    // A single embedded server passes.
    fs.writeFileSync(path.join(fake, "dist", "cli.js"), marker);
    assert.doesNotThrow(() => packaging.assertSingleMcpServer(fake));
    // A second standalone server entry is rejected.
    fs.writeFileSync(path.join(fake, "dist", "mcp-server.js"), marker);
    assert.throws(() => packaging.assertSingleMcpServer(fake), /second MCP server entry/);
    fs.rmSync(path.join(fake, "dist", "mcp-server.js"));
    // A second embedded copy in the bundle is rejected too.
    fs.writeFileSync(path.join(fake, "dist", "cli.js"), marker + marker);
    assert.throws(() => packaging.assertSingleMcpServer(fake), /exactly once/);
    // A server marker outside dist/cli.js is rejected.
    fs.mkdirSync(path.join(fake, "dist", "node_modules", "evil"), { recursive: true });
    fs.writeFileSync(path.join(fake, "dist", "node_modules", "evil", "evil.js"), marker);
    fs.rmSync(path.join(fake, "dist", "node_modules", "evil"), { recursive: true, force: true });
    fs.writeFileSync(path.join(fake, "dist", "cli.js"), marker);
    fs.mkdirSync(path.join(fake, "dist", "node_modules", "server"), { recursive: true });
    fs.writeFileSync(path.join(fake, "dist", "node_modules", "server", "server.js"), marker);
    assert.throws(() => packaging.assertSingleMcpServer(fake), /exactly once/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("packaging rejects a modified Node archive before producing an artifact", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codetour-package-integrity-"));
  try {
    const bad = path.join(tmp, "invalid-archive"); fs.writeFileSync(bad, "invalid");
    const output = path.join(tmp, "artifact");
    const result = spawnSync(process.execPath, [path.join(root, "scripts/package-standalone.js"), "--output", output], {
      encoding: "utf8", env: { ...process.env, CODETOUR_NODE_ARCHIVE: bad }
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /checksum mismatch/);
    assert.equal(fs.existsSync(output), false);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

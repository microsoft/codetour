#!/usr/bin/env node
"use strict";
// Build on the target OS/architecture so the rasterizer matches the artifact.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "..");
const version = "24.18.0";
const targets = {
  "darwin-arm64": ["tar.gz", "e1a97e14c99c803e96c7339403282ea05a499c32f8d83defe9ef5ec66f979ed1"],
  "darwin-x64": ["tar.gz", "dfd0dbd3e721503434df7b7205e719f61b3a3a31b2bcf9729b8b91fea240f080"],
  "win32-x64": ["zip", "0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821"]
};

// Measured standalone budget for dist/cli.js. The bundle carried the reader
// at 5,948,925 bytes; embedding the shared MCP entry (SDK, validation and
// their dependencies) measured 6,855,754 bytes, so the budget leaves a finite
// margin above the measured size instead of growing unbounded. Update it with
// a new measurement when the bundle intentionally grows.
const MAX_CLI_BUNDLE_BYTES = 8_000_000;

// The MCP server entry must ship exactly once, inside dist/cli.js. The usage
// banner is the marker: it appears once per copy of the shared entry.
const MCP_ENTRY_MARKER = "Usage: codetour-mcp";

function command(bin, args) {
  const result = spawnSync(bin, args, { encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error(`${bin} failed: ${result.error || result.stderr}`);
}

// Reject a CLI bundle over the standalone size budget. `budget` defaults to
// the measured budget; the packaging test overrides it through
// CODETOUR_CLI_BUDGET_BYTES to prove the rejection path.
function assertWithinBudget(file, budget = MAX_CLI_BUNDLE_BYTES) {
  const size = fs.statSync(file).size;
  if (size > budget) {
    throw new Error(
      `${path.basename(file)} is ${size} bytes, over the ${budget}-byte standalone budget`
    );
  }
}

// Reject an artifact that carries a second MCP server entry: a standalone
// server file anywhere in dist, or a second copy of the entry marker in any
// bundle. The one allowed carrier is dist/cli.js, with exactly one copy.
function assertSingleMcpServer(output) {
  const carriers = [];
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
        continue;
      }
      if (entry.name === "mcp-server.js") {
        throw new Error(
          `The standalone artifact must not ship a second MCP server entry: ${path.relative(output, entryPath)}`
        );
      }
      if (entry.name.endsWith(".js")) {
        const occurrences =
          fs.readFileSync(entryPath, "utf8").split(MCP_ENTRY_MARKER).length - 1;
        if (occurrences > 0) {
          carriers.push({ file: path.relative(output, entryPath), occurrences });
        }
      }
    }
  };
  walk(path.join(output, "dist"));
  const single =
    carriers.length === 1 &&
    carriers[0].file === path.join("dist", "cli.js") &&
    carriers[0].occurrences === 1;
  if (!single) {
    throw new Error(
      `The standalone artifact must contain the MCP server exactly once, inside dist/cli.js (found ${JSON.stringify(carriers)})`
    );
  }
}

// Launcher scripts for the single `codetour` command: reading and `mcp` are
// both served by dist/cli.js, and every argument is forwarded (`%*` on
// Windows, `"$@"` on POSIX).
function launcherScript(platform) {
  return platform === "win32"
    ? '@echo off\r\n"%~dp0node.exe" "%~dp0dist\\cli.js" %*\r\nexit /b %errorlevel%\r\n'
    : '#!/bin/sh\nDIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$DIR/node" "$DIR/dist/cli.js" "$@"\n';
}

function main() {
  const target = `${process.platform}-${process.arch}`;
  const spec = targets[target];
  if (!spec) throw new Error(`Unsupported standalone build host ${target}`);
  const index = process.argv.indexOf("--output");
  if (index < 0 || !process.argv[index + 1]) throw new Error("Usage: node scripts/package-standalone.js --output <new-directory>");
  const output = path.resolve(process.argv[index + 1]);
  if (fs.existsSync(output)) throw new Error(`Output already exists: ${output}`);
  const build = path.join(root, "dist");
  // Fail fast on the size budget, before any download or output.
  const budget = Number(process.env.CODETOUR_CLI_BUDGET_BYTES) || MAX_CLI_BUNDLE_BYTES;
  assertWithinBudget(path.join(build, "cli.js"), budget);
  const manifest = JSON.parse(fs.readFileSync(path.join(build, "resvg-runtime", "manifest.json"), "utf8"));
  if (manifest.target !== target) throw new Error(`Rasterizer target ${manifest.target} does not match ${target}`);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "codetour-distribution-"));
  try {
    const nodePlatform = process.platform === "win32" ? "win" : process.platform;
    const archiveName = `node-v${version}-${nodePlatform}-${process.arch}.${spec[0]}`;
    const archive = process.env.CODETOUR_NODE_ARCHIVE || path.join(temp, archiveName);
    if (!process.env.CODETOUR_NODE_ARCHIVE) command("curl", ["-fsSL", `https://nodejs.org/dist/v${version}/${archiveName}`, "-o", archive]);
    const hash = crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
    if (hash !== spec[1]) throw new Error(`Node archive checksum mismatch for ${target}`);
    command("tar", ["-xf", archive, "-C", temp]);
    const runtime = path.join(temp, `node-v${version}-${nodePlatform}-${process.arch}`);
    fs.mkdirSync(output, { recursive: true });
    const exeName = process.platform === "win32" ? "node.exe" : "node";
    fs.copyFileSync(path.join(runtime, process.platform === "win32" ? "node.exe" : "bin/node"), path.join(output, exeName));
    fs.copyFileSync(path.join(runtime, "LICENSE"), path.join(output, "NODE-LICENSE"));
    if (process.platform !== "win32") fs.chmodSync(path.join(output, exeName), 0o755);
    fs.mkdirSync(path.join(output, "dist"));
    fs.copyFileSync(path.join(build, "cli.js"), path.join(output, "dist", "cli.js"));
    fs.copyFileSync(path.join(build, "cli.js.LICENSE.txt"), path.join(output, "dist", "cli.js.LICENSE.txt"));
    fs.copyFileSync(path.join(root, "node_modules", "@resvg", "resvg-js", "LICENSE"), path.join(output, "RESVG-LICENSE"));
    fs.cpSync(path.join(build, "resvg-runtime"), path.join(output, "dist", "resvg-runtime"), { recursive: true });
    // Copy only the external dependency closures, preserving npm's nested resolution.
    const modules = fs.realpathSync(path.join(root, "node_modules"));
    const visited = new Set();
    function copyDependency(request, from) {
      // A trailing slash bypasses core-module names (punycode/), so compare
      // package names without it.
      const packageName = request.replace(/\/$/, "");
      const requireFrom = createRequire(path.join(from, "package.json"));
      let folder = path.dirname(requireFrom.resolve(request));
      while (folder !== path.dirname(folder)) {
        const file = path.join(folder, "package.json");
        if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file, "utf8")).name === packageName) break;
        folder = path.dirname(folder);
      }
      folder = fs.realpathSync(folder);
      const relative = path.relative(modules, folder);
      if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Dependency outside node_modules: ${folder}`);
      if (visited.has(folder)) return;
      visited.add(folder);
      fs.cpSync(folder, path.join(output, "dist", "node_modules", relative), {
        recursive: true, filter: source => path.basename(source) !== "node_modules"
      });
      const pkg = JSON.parse(fs.readFileSync(path.join(folder, "package.json"), "utf8"));
      for (const child of Object.keys(pkg.dependencies || {})) copyDependency(child, folder);
    }
    // @b9g/termdom backs the terminal reader; punycode is the userland package
    // the CLI bundle requires instead of the deprecated core module (the
    // trailing slash bypasses the core-module name).
    copyDependency("@b9g/termdom", root);
    copyDependency("punycode/", root);
    // Enforce the single-server invariant on the assembled artifact.
    try {
      assertSingleMcpServer(output);
    } catch (error) {
      fs.rmSync(output, { recursive: true, force: true });
      throw error;
    }
    if (process.platform === "win32") {
      fs.writeFileSync(path.join(output, "codetour.cmd"), launcherScript("win32"));
    } else {
      fs.writeFileSync(path.join(output, "codetour"), launcherScript(process.platform), { mode: 0o755 });
    }
    console.log(`Standalone ${target} distribution created at ${output}`);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

// Exported for the standalone packaging tests.
module.exports = { main, assertSingleMcpServer, assertWithinBudget, launcherScript, MAX_CLI_BUNDLE_BYTES };

"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { spawn } = require("node:child_process");

// Exercise the extracted bundle over stdio without relying on its dependency
// tree or on an installed MCP SDK. This verifier runs outside the artifact.
async function verifyCriticalResource(command, args, cwd) {
  const child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map();
  let nextId = 0;
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  const lines = readline.createInterface({ input: child.stdout });
  lines.on("line", line => {
    try {
      const message = JSON.parse(line);
      const request = pending.get(message.id);
      if (request) {
        pending.delete(message.id);
        message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result);
      }
    } catch (error) {
      for (const request of pending.values()) request.reject(error);
      pending.clear();
    }
  });
  const failed = error => {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  child.on("error", failed);
  child.on("exit", code => failed(new Error(`MCP exited ${code}: ${stderr}`)));
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const timer = setTimeout(() => {
    failed(new Error("Timed out reading the packaged critical review resource"));
    child.kill();
  }, 15000);
  try {
    await send("initialize", {
      protocolVersion: "2025-06-18", capabilities: {},
      clientInfo: { name: "codetour-artifact-verifier", version: "1.0.0" }
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    const uri = "codetour://review/critical-instructions";
    const response = await send("resources/read", { uri });
    const text = response.contents.map(content => content.text || "").join("\n");
    const sources = path.join(__dirname, "..", "packages", "mcp-server", "review-skill");
    for (const file of ["upstream-code-review.md", "codetour-adaptation.md", "upstream-LICENSE.txt"]) {
      assert.ok(text.includes(fs.readFileSync(path.join(sources, file), "utf8")), `Packaged resource is missing ${file}`);
    }
    assert.match(text, /7739eaed7f8f3915437a8def198a6d0d7206dbc7/);
    assert.match(text, /Copyright \(c\) 2026 Matt Pocock/);
    return text;
  } finally {
    clearTimeout(timer);
    lines.close();
    child.stdin.end();
    child.kill();
  }
}

module.exports = { verifyCriticalResource };

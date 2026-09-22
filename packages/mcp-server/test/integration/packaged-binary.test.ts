import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as assert from "node:assert";
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import {
  callTool,
  commitFile,
  headSha,
  initGitRepo,
  readTourFile,
  rmrf,
  tempDir,
} from "../helpers/test-utils";

const execFileAsync = promisify(execFile);
const packageRoot = path.join(__dirname, "..", "..", "..");

async function npm(args: string[], cwd: string, cache: string): Promise<string> {
  const npmCli = process.env.npm_execpath;
  const command = npmCli ? process.execPath : "npm";
  const commandArgs = npmCli ? [npmCli, ...args] : args;
  const result = await execFileAsync(command, commandArgs, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_cache: cache,
      npm_config_update_notifier: "false",
    },
  });
  return result.stdout;
}

test("the installed codetour-mcp binary serves both public MCP tools", async () => {
  const sandbox = tempDir("codetour-mcp-package-test-");
  const archiveDir = path.join(sandbox, "archive");
  const installationRoot = path.join(sandbox, "consumer");
  const workspaceRoot = path.join(sandbox, "workspace");
  const npmCache = path.join(sandbox, "npm-cache");

  try {
    fs.mkdirSync(archiveDir, { recursive: true });
    await npm(
      ["pack", "--json", "--pack-destination", archiveDir],
      packageRoot,
      npmCache
    );
    const filename = fs
      .readdirSync(archiveDir)
      .find((entry) => entry.endsWith(".tgz"));
    assert.ok(filename, "npm pack should create a package archive");
    const archivePath = path.join(archiveDir, filename);

    // Seed the consumer with the already-installed dependency tree. This keeps
    // the package-install smoke test deterministic and fully offline.
    fs.mkdirSync(installationRoot, { recursive: true });
    fs.cpSync(
      path.join(packageRoot, "node_modules"),
      path.join(installationRoot, "node_modules"),
      { recursive: true }
    );
    await npm(
      [
        "install",
        "--prefix",
        installationRoot,
        "--ignore-scripts",
        "--offline",
        "--package-lock=false",
        "--no-audit",
        "--no-fund",
        archivePath,
        path.join(packageRoot, "node_modules", "@modelcontextprotocol", "sdk"),
        path.join(packageRoot, "node_modules", "ajv"),
        path.join(packageRoot, "node_modules", "safe-regex2"),
        path.join(packageRoot, "node_modules", "zod"),
      ],
      sandbox,
      npmCache
    );

    fs.mkdirSync(workspaceRoot, { recursive: true });
    await initGitRepo(workspaceRoot);
    await commitFile(workspaceRoot, "base.txt", "base\n", "add base");
    const baseRef = await headSha(workspaceRoot);
    await commitFile(workspaceRoot, "feature.txt", "feature\n", "add feature");
    const headRef = await headSha(workspaceRoot);
    assert.match(baseRef, /^[0-9a-f]{40}$/);
    assert.match(headRef, /^[0-9a-f]{40}$/);

    const binaryPath = path.join(
      installationRoot,
      "node_modules",
      ".bin",
      "codetour-mcp"
    );
    const client = new Client(
      { name: "packaged-binary-test-client", version: "0.0.0" },
      { capabilities: {} }
    );
    const transport = new StdioClientTransport({
      command: binaryPath,
      args: ["--workspace-root", workspaceRoot],
    });
    await client.connect(transport);
    try {
      const tools = await client.listTools();
      const changesTool = tools.tools.find((tool) => tool.name === "create_changes_tour");
      assert.ok(changesTool);
      assert.ok(
        Object.prototype.hasOwnProperty.call(
          (changesTool.inputSchema.properties ?? {}) as object,
          "headRef"
        ),
        JSON.stringify(changesTool.inputSchema)
      );
      const changesTour = await callTool(client, "create_changes_tour", {
        baseRef,
        headRef,
        steps: [{ description: "The feature.", file: "feature.txt" }],
      });
      assert.equal(changesTour.isError, false, changesTour.text);

      const projectTour = await callTool(client, "create_project_tour", {
        steps: [{ description: "The project base.", file: "base.txt" }],
      });
      assert.equal(projectTour.isError, false);
    } finally {
      await client.close();
    }

    assert.equal(readTourFile(workspaceRoot, ".tours/project.tour").title, "Project Overview");
    assert.equal(readTourFile(workspaceRoot, ".tours/changes.tour").ref, headRef);
  } finally {
    rmrf(sandbox);
  }
});

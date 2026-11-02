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
  // npm sets npm_execpath to its CLI JavaScript entry, which runs under this
  // Node. Fall back to the npm executable when no CLI entry is provided.
  const npmCli = process.env.npm_execpath?.endsWith(".js") ? process.env.npm_execpath : undefined;
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

    // Seed the consumer with the already-installed dependency tree, then pass
    // every registry dependency exposed by the packed manifest as a local
    // source. npm still resolves direct dependencies during an install even
    // when their directories already exist; without the local sources, a cold
    // platform-specific cache (notably macOS ARM) fails in --offline mode.
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
        path.join(packageRoot, "node_modules", "@resvg", "resvg-js"),
        path.join(packageRoot, "node_modules", "jsdom"),
        path.join(packageRoot, "node_modules", "mermaid"),
        path.join(packageRoot, "node_modules", "safe-regex2"),
        path.join(packageRoot, "node_modules", "zod"),
      ],
      sandbox,
      npmCache
    );

    // The shared renderer is a local monorepo package, so npm pack cannot
    // carry its sibling path dependency into the isolated consumer. Seed the
    // consumer with the already-built package and its already-installed
    // dependency tree, preserving the test's fully offline contract.
    const rendererRoot = path.join(packageRoot, "..", "description-renderer");
    const rendererTarget = path.join(
      installationRoot,
      "node_modules",
      "codetour-description-renderer"
    );
    let rendererIsAlreadyLinked = false;
    try {
      rendererIsAlreadyLinked = fs.lstatSync(rendererTarget).isSymbolicLink();
    } catch {
      // The package installer may not have created the local dependency.
    }
    if (rendererIsAlreadyLinked) {
      fs.unlinkSync(rendererTarget);
    }
    if (!rendererIsAlreadyLinked || !fs.existsSync(rendererTarget)) {
      fs.cpSync(rendererRoot, rendererTarget, {
        recursive: true,
        filter: (source) =>
          path.basename(source) !== "node_modules" &&
          !source.includes(`${path.sep}node_modules${path.sep}`),
      });
      fs.cpSync(
        path.join(rendererRoot, "node_modules"),
        path.join(installationRoot, "node_modules"),
        { recursive: true }
      );
    }

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
      cwd: workspaceRoot,
    });
    await client.connect(transport);
    try {
      const resource = await client.readResource({ uri: "codetour://review/critical-instructions" });
      const skillText = resource.contents.map(content => "text" in content ? content.text : "").join("\n");
      const installedSkill = path.join(installationRoot, "node_modules", "codetour-mcp", "review-skill");
      for (const file of ["upstream-code-review.md", "codetour-adaptation.md", "upstream-LICENSE.txt"]) {
        assert.ok(skillText.includes(fs.readFileSync(path.join(installedSkill, file), "utf8")), file);
      }
      assert.match(skillText, /7739eaed7f8f3915437a8def198a6d0d7206dbc7/);
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

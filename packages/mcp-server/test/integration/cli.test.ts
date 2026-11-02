import { test } from "node:test";
import * as assert from "node:assert";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { runMcpCli } from "../../src/cli";
import {
  CLI_PATH,
  callTool,
  listFilesRecursively,
  rmrf,
  startServer,
  stopServer,
  tempDir,
  writeFile,
} from "../helpers/test-utils";

const packageRoot = path.join(__dirname, "..", "..", "..");
const serverVersion = JSON.parse(
  fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")
).version as string;
// The standalone CLI bundle (the `codetour mcp` dev seam). Built by the
// repository root `npm run build`; the tests below skip when it is absent.
const cliBundle = path.join(packageRoot, "..", "..", "dist", "cli.js");

test("the programmatic entry reports help on the out sink and returns 0", async () => {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runMcpCli(["--help"], {
    out: text => out.push(text),
    err: text => err.push(text),
  });
  assert.equal(code, 0);
  assert.equal(err.length, 0);
  assert.match(out.join("\n"), new RegExp(`codetour-mcp v${serverVersion}`));
  assert.match(out.join("\n"), /--workspace-root <dir>/);
});

test("the programmatic entry reports the MCP server version", async () => {
  const out: string[] = [];
  const code = await runMcpCli(["--version"], {
    out: text => out.push(text),
    err: () => assert.fail("version must not write diagnostics"),
  });
  assert.equal(code, 0);
  assert.deepEqual(out, [serverVersion]);
});

test("the programmatic entry rejects an unknown argument on the err sink", async () => {
  const err: string[] = [];
  const code = await runMcpCli(["--bogus"], {
    out: () => assert.fail("an argument error must not write to out"),
    err: text => err.push(text),
  });
  assert.equal(code, 1);
  assert.match(err.join("\n"), /Unknown argument: --bogus/);
  assert.match(err.join("\n"), /Usage: codetour-mcp/);
});

test("the programmatic entry reports a missing --workspace-root value", async () => {
  const err: string[] = [];
  const code = await runMcpCli(["--workspace-root"], {
    out: () => assert.fail("an argument error must not write to out"),
    err: text => err.push(text),
  });
  assert.equal(code, 1);
  assert.match(err.join("\n"), /Missing value for --workspace-root/);
});

test("the programmatic entry reports an inaccessible workspace before the protocol", async () => {
  const root = tempDir();
  try {
    const err: string[] = [];
    const code = await runMcpCli(["--workspace-root", `${root}/missing`], {
      out: () => assert.fail("a workspace failure must not write to out"),
      err: text => err.push(text),
    });
    assert.equal(code, 1);
    assert.match(err.join("\n"), /not an accessible directory/);
  } finally {
    rmrf(root);
  }
});

test("the codetour-mcp binary prints help and version with a zero exit code", () => {
  const help = spawnSync(process.execPath, [CLI_PATH, "--help"], {
    encoding: "utf8",
    timeout: 5_000,
  });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage: codetour-mcp/);
  assert.equal(help.stderr, "");

  const version = spawnSync(process.execPath, [CLI_PATH, "--version"], {
    encoding: "utf8",
    timeout: 5_000,
  });
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), serverVersion);
  assert.equal(version.stderr, "");
});

test("--workspace-root serves a directory other than the process working directory", async () => {
  const root = tempDir();
  const elsewhere = tempDir();
  let client;
  try {
    writeFile(root, "hello.txt", "hello workspace\n");
    client = await startServer(elsewhere, {}, ["--workspace-root", root]);
    const response = await callTool(client, "create_project_tour", {
      title: "Served Workspace",
      steps: [{ file: "hello.txt", description: "Anchored inside the workspace passed to --workspace-root." }],
    });
    assert.equal(response.isError, false, response.text);
    assert.equal(response.structured.status, "created");
    assert.equal(response.structured.path, ".tours/project.tour");
    assert.ok(fs.existsSync(`${root}/.tours/project.tour`));
    assert.ok(!fs.existsSync(`${elsewhere}/.tours/project.tour`));
  } finally {
    if (client) {
      await stopServer(client);
    }
    rmrf(root);
    rmrf(elsewhere);
  }
});

test("--workspace-root=<directory> is accepted like the spaced form", async () => {
  const root = tempDir();
  const elsewhere = tempDir();
  let client;
  try {
    writeFile(root, "hello.txt", "hello workspace\n");
    client = await startServer(elsewhere, {}, [`--workspace-root=${root}`]);
    const response = await callTool(client, "create_project_tour", {
      steps: [{ file: "hello.txt", description: "Anchored inside the workspace passed to --workspace-root." }],
    });
    assert.equal(response.isError, false, response.text);
    assert.ok(fs.existsSync(`${root}/.tours/project.tour`));
  } finally {
    if (client) {
      await stopServer(client);
    }
    rmrf(root);
    rmrf(elsewhere);
  }
});

test("a missing value or an unknown argument is rejected", () => {
  const root = tempDir();
  try {
    const missingValue = spawnSync(
      process.execPath,
      [CLI_PATH, "--workspace-root"],
      { cwd: root, encoding: "utf8", timeout: 5_000 }
    );
    assert.equal(missingValue.status, 1);
    assert.match(missingValue.stderr, /Missing value for --workspace-root/);

    const unknown = spawnSync(process.execPath, [CLI_PATH, "--bogus"], {
      cwd: root,
      encoding: "utf8",
      timeout: 5_000,
    });
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /Unknown argument: --bogus/);
  } finally {
    rmrf(root);
  }
});

test("an inaccessible --workspace-root fails at startup with a clear error", () => {
  const root = tempDir();
  try {
    const result = spawnSync(
      process.execPath,
      [CLI_PATH, "--workspace-root", `${root}/missing`],
      { cwd: root, encoding: "utf8", timeout: 5_000 }
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not an accessible directory/);
  } finally {
    rmrf(root);
  }
});

test("an unreadable workspace fails before the MCP handshake", { skip: process.platform === "win32" }, t => {
  const root = tempDir();
  try {
    fs.chmodSync(root, 0o100);
    try {
      fs.readdirSync(root);
      t.skip("this account can read directories despite their permission bits");
      return;
    } catch {
      // The fixture is effectively unreadable to the current process.
    }
    const result = spawnSync(process.execPath, [CLI_PATH, "--workspace-root", root], {
      encoding: "utf8",
      input: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
        protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" }
      } }) + "\n",
      timeout: 5000
    });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /not an accessible directory/);
  } finally {
    fs.chmodSync(root, 0o700);
    rmrf(root);
  }
});

test(
  "the codetour mcp subcommand serves both tools through the CLI bundle",
  { skip: fs.existsSync(cliBundle) ? false : "build the repository root first (npm run build)" },
  async () => {
    // Dev seam for the standalone distribution: `node dist/cli.js mcp` in a
    // Tour Workspace that is not a Git repository.
    const root = tempDir("codetour-cli-mcp-");
    let client;
    try {
      writeFile(root, "hello.txt", "hello workspace\n");
      const before = listFilesRecursively(root);
      client = await startServer(root, {}, ["mcp"], cliBundle);
      const tools = await client.listTools();
      assert.deepEqual(
        tools.tools.map(tool => tool.name).sort(),
        ["create_changes_tour", "create_project_tour"]
      );
      const response = await callTool(client, "create_project_tour", {
        title: "Subcommand Tour",
        steps: [{ file: "hello.txt", description: "Created through the codetour mcp subcommand." }],
      });
      assert.equal(response.isError, false, response.text);
      assert.equal(response.structured.status, "created");
      assert.equal(response.structured.path, ".tours/project.tour");
      // The session wrote exactly the reserved Tour file and nothing else.
      const after = listFilesRecursively(root);
      assert.deepEqual(
        after.filter(entry => !before.includes(entry)),
        [".tours", ".tours/project.tour"]
      );
    } finally {
      if (client) await stopServer(client);
      rmrf(root);
    }
  }
);

test(
  "the CLI bundle forwards --workspace-root to the MCP entry",
  { skip: fs.existsSync(cliBundle) ? false : "build the repository root first (npm run build)" },
  async () => {
    const root = tempDir("codetour-cli-mcp-");
    const elsewhere = tempDir("codetour-cli-mcp-");
    let client;
    try {
      writeFile(root, "hello.txt", "hello workspace\n");
      client = await startServer(elsewhere, {}, ["mcp", "--workspace-root", root], cliBundle);
      const response = await callTool(client, "create_project_tour", {
        steps: [{ file: "hello.txt", description: "Anchored inside the workspace passed to --workspace-root." }],
      });
      assert.equal(response.isError, false, response.text);
      assert.ok(fs.existsSync(`${root}/.tours/project.tour`));
      assert.ok(!fs.existsSync(`${elsewhere}/.tours/project.tour`));
    } finally {
      if (client) await stopServer(client);
      rmrf(root);
      rmrf(elsewhere);
    }
  }
);

test(
  "the mcp path of the CLI bundle needs no node_modules beyond its shipped closure",
  { skip: fs.existsSync(cliBundle) ? false : "build the repository root first (npm run build)" },
  async () => {
    // A directory holding only the bundle, the rasterizer runtime and the
    // punycode closure: if the MCP path required vscode, @b9g/termdom or any
    // other package, the session would fail to start here.
    const bare = tempDir("codetour-cli-bare-");
    const root = tempDir("codetour-cli-bare-workspace-");
    let client;
    try {
      fs.copyFileSync(cliBundle, path.join(bare, "cli.js"));
      fs.cpSync(
        path.join(packageRoot, "..", "..", "dist", "resvg-runtime"),
        path.join(bare, "resvg-runtime"),
        { recursive: true }
      );
      fs.mkdirSync(path.join(bare, "node_modules"), { recursive: true });
      fs.cpSync(
        path.join(packageRoot, "..", "..", "node_modules", "punycode"),
        path.join(bare, "node_modules", "punycode"),
        { recursive: true }
      );
      writeFile(root, "hello.txt", "hello bare bundle\n");
      const entry = path.join(bare, "cli.js");
      client = await startServer(root, {}, ["mcp"], entry);
      const response = await callTool(client, "create_project_tour", {
        title: "Bare Bundle Tour",
        steps: [{ file: "hello.txt", description: "The MCP path carries no hidden dependency." }],
      });
      assert.equal(response.isError, false, response.text);
      assert.ok(fs.existsSync(`${root}/.tours/project.tour`));
    } finally {
      if (client) await stopServer(client);
      rmrf(bare);
      rmrf(root);
    }
  }
);

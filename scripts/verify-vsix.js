const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { verifyCriticalResource } = require("./verify-critical-resource");

function fail(message) {
  throw new Error(message);
}

function extract(artifact, destination) {
  const result = process.platform === "win32"
    ? spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Expand-Archive -LiteralPath '${artifact.replace(/'/gu, "''")}' -DestinationPath '${destination.replace(/'/gu, "''")}' -Force`
        ],
        { stdio: "inherit" }
      )
    : spawnSync("unzip", ["-q", "-o", artifact, "-d", destination], {
        stdio: "inherit"
      });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    fail(`Unable to extract ${artifact}`);
  }
}

function listFiles(directory, prefix = "") {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(fullPath, relative));
    } else {
      files.push(relative);
    }
  }
  return files;
}

async function verify(artifact, target) {
  const extractionRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codetour-vsix-"));
  try {
    extract(artifact, extractionRoot);
    const extensionRoot = path.join(extractionRoot, "extension");
    const files = listFiles(extensionRoot).map((file) => file.split(path.sep).join("/"));
    if (files.some((file) => file.includes("extension-web"))) {
      fail("The VSIX contains the removed extension-web artifact.");
    }

    const packageJson = JSON.parse(
      fs.readFileSync(path.join(extensionRoot, "package.json"), "utf8")
    );
    if (packageJson.browser || packageJson.main !== "./dist/extension-node.js") {
      fail("The VSIX package manifest is not Node-extension-only.");
    }

    const manifest = JSON.parse(
      fs.readFileSync(path.join(extensionRoot, "dist", "resvg-runtime", "manifest.json"), "utf8")
    );
    if (manifest.target !== target) {
      fail(`The VSIX runtime target is ${manifest.target}, expected ${target}.`);
    }
    const binary = path.join(
      extensionRoot,
      "dist",
      "resvg-runtime",
      "resvg-js",
      manifest.binary
    );
    if (!fs.existsSync(binary)) {
      fail(`The VSIX is missing its native rasterizer: ${manifest.binary}.`);
    }

    const resvg = spawnSync(
      process.execPath,
      [
        path.join(__dirname, "verify-resvg-runtime.js"),
        path.join(extensionRoot, "dist", "resvg-runtime", "resvg-js")
      ],
      { encoding: "utf8" }
    );
    if (resvg.error) {
      throw resvg.error;
    }
    if (resvg.status !== 0) {
      fail(
        `The unpacked VSIX rasterizer did not produce a PNG: ${resvg.stderr || resvg.stdout}`
      );
    }

    const mcp = spawnSync(
      process.execPath,
      [path.join(extensionRoot, "dist", "mcp-server.js"), "--version"],
      { cwd: extensionRoot, encoding: "utf8" }
    );
    if (mcp.status !== 0 || !/^\d+\.\d+\.\d+/u.test((mcp.stdout || "").trim())) {
      fail(`The unpacked MCP server did not start: ${mcp.stderr || mcp.stdout}`);
    }

    await verifyCriticalResource(process.execPath,
      [path.join(extensionRoot, "dist", "mcp-server.js")], extensionRoot);

    const size = fs.statSync(artifact).size;
    console.log(`Verified unpacked ${path.basename(artifact)}: ${files.length} files, ${size} bytes, PNG OK.`);
  } finally {
    fs.rmSync(extractionRoot, { recursive: true, force: true });
  }
}

const artifact = process.argv[2];
const target = process.argv[3];
if (!artifact || !target) {
  fail("Usage: node scripts/verify-vsix.js <artifact.vsix> <target>");
}
verify(path.resolve(artifact), target).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});

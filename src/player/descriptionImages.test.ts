import { test } from "node:test";
import * as assert from "node:assert";
import * as nodeModule from "module";
import { createVscodeHost } from "../test/vscodeHost";

const host = createVscodeHost();
const moduleLoader = nodeModule as unknown as {
  _load: (request: string, ...args: unknown[]) => unknown;
};
const originalLoad = moduleLoader._load;
moduleLoader._load = function (request: string, ...args: unknown[]) {
  return request === "vscode"
    ? host.vscode
    : originalLoad.apply(this, [request, ...args]);
};

const { renderPreviewDescription } = require("./description");

const workspaceRoot = host.vscode.Uri.parse("file:///workspace");

const PNG_BYTES = Buffer.from([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  0x00,
  0x00,
  0x00,
  0x0d
]);

function patchReadFile(
  readFile: (uri: { path: string }) => Promise<Uint8Array>
): () => void {
  const original = host.vscode.workspace.fs.readFile;
  host.vscode.workspace.fs.readFile = readFile as typeof original;
  return () => {
    host.vscode.workspace.fs.readFile = original;
  };
}

test("local images inline as data URIs through the shared pipeline", async () => {
  const restore = patchReadFile(async uri =>
    uri.path.endsWith("architecture.png") ? PNG_BYTES : Promise.reject(new Error("missing"))
  );

  try {
    const content = await renderPreviewDescription(
      "![Architecture](.tours/images/project/architecture.png)",
      undefined,
      { workspaceRoot }
    );

    assert.match(content, /^!\[Architecture\]\(data:image\/png;base64,/);
    assert.ok(
      content.includes(`data:image/png;base64,${PNG_BYTES.toString("base64")}`)
    );
    assert.ok(!content.includes(".tours/images/project/architecture.png"));
  } finally {
    restore();
  }
});

test("missing local images render a compact warning through the shared pipeline", async () => {
  const restore = patchReadFile(async () => {
    throw new Error("File not found");
  });

  try {
    const content = await renderPreviewDescription(
      "Intro\n\n![Architecture](.tours/images/project/architecture.png)\n\nOutro",
      undefined,
      { workspaceRoot }
    );

    assert.ok(content.includes("referenced image could not be loaded"));
    assert.ok(!content.includes(".tours/images/project/architecture.png"));
    assert.ok(!content.includes("data:image"));
  } finally {
    restore();
  }
});

test("local images never leak a local path when no workspace is found", async () => {
  const content = await renderPreviewDescription(
    "![Architecture](.tours/images/project/architecture.png)"
  );

  assert.ok(content.includes("referenced image could not be loaded"));
  assert.ok(!content.includes(".tours/images/project/architecture.png"));
  assert.ok(!content.includes("file://"));
});

test("references escaping the workspace are never inlined", async () => {
  const readPaths: string[] = [];
  const restore = patchReadFile(async uri => {
    readPaths.push(uri.path);
    return PNG_BYTES;
  });

  try {
    for (const description of [
      "![Escape](../outside/architecture.png)",
      "![Absolute](/etc/architecture.png)"
    ]) {
      const content = await renderPreviewDescription(description, undefined, {
        workspaceRoot
      });

      assert.ok(content.includes("referenced image could not be loaded"), description);
      assert.ok(!content.includes("data:image"), description);
    }
    assert.ok(readPaths.every(path => path.startsWith("/workspace/")));
  } finally {
    restore();
  }
});

import { test } from "node:test";
import * as assert from "node:assert";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { CLI_PATH, rmrf, tempDir } from "../helpers/test-utils";

test("rejects more than one --workspace-root argument", () => {
  const root = tempDir();
  try {
    const result = spawnSync(
      process.execPath,
      [
        CLI_PATH,
        "--workspace-root",
        root,
        `--workspace-root=${root}`,
      ],
      { encoding: "utf8", timeout: 5_000 }
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /--workspace-root must be provided exactly once/);
  } finally {
    rmrf(root);
  }
});

test("rejects a workspace root that is a file", () => {
  const root = tempDir();
  const file = path.join(root, "workspace.txt");
  fs.writeFileSync(file, "not a directory");
  try {
    const result = spawnSync(
      process.execPath,
      [CLI_PATH, "--workspace-root", file],
      { encoding: "utf8", timeout: 5_000 }
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /not an accessible directory/);
  } finally {
    rmrf(root);
  }
});

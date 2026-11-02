import * as assert from "node:assert";
import * as path from "node:path";
import { test } from "node:test";
import {
  listFilesRecursively,
  rmrf,
  tempDir,
  toForwardSlashes,
  writeFile,
} from "../helpers/test-utils";

test("toForwardSlashes normalizes Windows path.relative separators", () => {
  // On windows-latest, path.relative joins entries with "\" (issue #84), so
  // the CLI seam test compared ".tours\project.tour" against the reserved
  // Tour path ".tours/project.tour". Node's win32 semantics reproduce the
  // exact CI value here, on any platform.
  const windowsListing = path.win32.relative(
    "C:\\tour workspace",
    "C:\\tour workspace\\.tours\\project.tour"
  );
  assert.equal(windowsListing, ".tours\\project.tour");
  assert.equal(
    toForwardSlashes(windowsListing, path.win32.sep),
    ".tours/project.tour"
  );
  // POSIX separators pass through unchanged.
  assert.equal(
    toForwardSlashes(".tours/project.tour", path.posix.sep),
    ".tours/project.tour"
  );
});

test("listFilesRecursively lists a Tour Workspace with forward slashes only", () => {
  const root = tempDir("codetour-listing-");
  try {
    writeFile(root, "hello.txt", "hello workspace\n");
    writeFile(root, ".tours/project.tour", "{}\n");
    writeFile(root, ".tours/images/project/overview.svg", "<svg/>\n");
    assert.deepEqual(listFilesRecursively(root), [
      ".tours",
      ".tours/images",
      ".tours/images/project",
      ".tours/images/project/overview.svg",
      ".tours/project.tour",
      "hello.txt",
    ]);
  } finally {
    rmrf(root);
  }
});

import { test } from "node:test";
import * as assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readTourImages } from "./stepImages";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lO0AAAAASUVORK5CYII=",
  "base64"
);

function workspace(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "codetour-images-"));
  mkdirSync(path.join(root, "images"));
  writeFileSync(path.join(root, "images", "tiny.png"), TINY_PNG);
  return root;
}

test("the HTML reader reads workspace images and leaves missing ones to the renderer", async () => {
  const root = workspace();
  try {
    const read = await readTourImages(root, "![Small](images/tiny.png)\n\n![Gone](images/gone.png)");
    assert.deepEqual([...read.images.keys()], ["images/tiny.png"]);
    assert.deepEqual(read.problems, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the terminal reader reports missing, escaping and unsupported images", async () => {
  const root = workspace();
  try {
    writeFileSync(path.join(root, "images", "notes.txt"), "not an image");
    const read = await readTourImages(root,
      "![Gone](images/gone.png)\n\n![Out](../secret.png)\n\n![Text](images/notes.txt)",
      { missingIsProblem: true });
    assert.equal(read.images.size, 0);
    assert.equal(read.problems.length, 3);
    assert.match(read.problems[0], /^cannot read images\/gone\.png: /);
    assert.equal(read.problems[1], "unsafe path: ../secret.png");
    assert.equal(read.problems[2], "not a supported PNG/JPEG: images/notes.txt");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

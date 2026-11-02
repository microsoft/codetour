import { test } from "node:test";
import * as assert from "node:assert/strict";
import {
  clearDiagramTextCache,
  diagramTextCommand,
  renderMermaidText
} from "./termaid";

const echo = ["-e", "process.stdin.pipe(process.stdout)"];

test("a terminal renderer turns the Mermaid source into text", async () => {
  clearDiagramTextCache();
  const text = await renderMermaidText("graph LR; A-->B\n", {
    width: 40, command: process.execPath, args: echo
  });
  assert.equal(text, "graph LR; A-->B");
});

test("a missing, failing or hanging renderer leaves the source path", async () => {
  clearDiagramTextCache();
  assert.equal(await renderMermaidText("graph LR; A-->B", {
    width: 40, command: "codetour-no-such-diagram-renderer"
  }), undefined);
  assert.equal(await renderMermaidText("graph LR; A-->B", {
    width: 40,
    command: process.execPath,
    args: ["-e", "process.exit(3)"]
  }), undefined);
  assert.equal(await renderMermaidText("graph LR; A-->B", {
    width: 40,
    command: process.execPath,
    args: ["-e", "setTimeout(() => {}, 30000)"],
    timeoutMs: 100
  }), undefined);
});

test("an empty renderer output is not shown as a diagram", async () => {
  clearDiagramTextCache();
  assert.equal(await renderMermaidText("graph LR; A-->B", {
    width: 40, command: process.execPath, args: ["-e", ""]
  }), undefined);
});

test("CODETOUR_TERMAID opts out or names the renderer", () => {
  const previous = process.env.CODETOUR_TERMAID;
  try {
    delete process.env.CODETOUR_TERMAID;
    assert.equal(diagramTextCommand(), "termaid");
    process.env.CODETOUR_TERMAID = "";
    assert.equal(diagramTextCommand(), undefined);
    process.env.CODETOUR_TERMAID = "/opt/bin/termaid";
    assert.equal(diagramTextCommand(), "/opt/bin/termaid");
  } finally {
    if (previous === undefined) delete process.env.CODETOUR_TERMAID;
    else process.env.CODETOUR_TERMAID = previous;
  }
});

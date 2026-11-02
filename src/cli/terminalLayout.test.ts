import { test } from "node:test";
import * as assert from "node:assert/strict";
import { fit, railWindow, RAIL_WIDTH, tail, terminalLayout } from "./terminalLayout";

test("a wide terminal shows the Step rail without crowding the Step", () => {
  const layout = terminalLayout(120);
  assert.equal(layout.railWidth, RAIL_WIDTH);
  assert.equal(layout.compactHints, false);
  // The Step, its rail and the chat panel all fit inside the terminal.
  assert.ok(layout.railWidth + layout.chatWidth + layout.textWidth <= 120);
  assert.ok(layout.textWidth >= 40);
  assert.ok(layout.codeWidth <= layout.textWidth);
  assert.ok(layout.titleWidth > 0 && layout.composerWidth > 0);
});

test("a narrow terminal drops the rail so the Step stays readable", () => {
  const layout = terminalLayout(80);
  assert.equal(layout.railWidth, 0);
  assert.equal(layout.compactHints, true);
  assert.ok(layout.textWidth >= 36);
  assert.ok(layout.codeWidth >= 20);
});

test("the rail needs the full 100 columns before it appears", () => {
  assert.equal(terminalLayout(99).railWidth, 0);
  assert.equal(terminalLayout(100).railWidth, RAIL_WIDTH);
  // Wide hints only fit once the panel and the rail have room to spare.
  assert.equal(terminalLayout(100).compactHints, true);
  assert.equal(terminalLayout(119).compactHints, true);
  assert.equal(terminalLayout(120).compactHints, false);
});

test("the layout never goes below the reader's minimum width", () => {
  const layout = terminalLayout(20);
  assert.equal(layout.columns, 60);
  assert.ok(layout.textWidth >= 20);
  assert.ok(layout.codeWidth >= 20);
});

test("the chat panel keeps a readable width at every terminal size", () => {
  for (const columns of [60, 80, 100, 120, 200]) {
    const layout = terminalLayout(columns);
    assert.ok(layout.chatWidth >= 36, "chat too narrow at " + columns);
    assert.ok(layout.chatWidth <= 48, "chat too wide at " + columns);
    assert.ok(layout.textWidth >= 20, "Step too narrow at " + columns);
  }
});

test("fit truncates a label to the cells it may occupy", () => {
  assert.equal(fit("File d'attente", 30), "File d'attente");
  assert.equal(fit("File d'attente", 5), "File…");
  assert.equal(fit("File d'attente", 1), "…");
  assert.equal(fit("File d'attente", 0), "");
  assert.equal(fit("abc", 3), "abc");
});

test("fit never splits a surrogate pair", () => {
  assert.equal(fit("ab😀cd", 3), "ab…");
  assert.equal(fit("ab😀cd", 4), "ab😀…");
});

test("tail keeps the end of a typed question so the caret stays visible", () => {
  assert.equal(tail("short", 10), "short");
  assert.equal(tail("abcdef", 4), "…def");
  assert.equal(tail("abcd", 4), "abcd");
  assert.equal(tail("abc", 0), "");
  assert.equal(tail("ab😀cd", 4), "…😀cd");
});

test("a short Tour shows every Step in the rail", () => {
  assert.deepEqual(railWindow(5, 2, 10),
    { start: 0, end: 5, before: false, after: false });
});

test("a long Tour keeps the active Step inside the rail window", () => {
  const middle = railWindow(50, 25, 10);
  assert.ok(middle.start <= 25 && middle.end > 25);
  assert.equal(middle.before, true);
  assert.equal(middle.after, true);
  assert.equal(middle.end - middle.start, 8);
  assert.deepEqual(railWindow(50, 0, 10),
    { start: 0, end: 8, before: false, after: true });
  assert.deepEqual(railWindow(50, 49, 10),
    { start: 42, end: 50, before: true, after: false });
});

test("a rail row without room for markers still shows the active Step", () => {
  const window = railWindow(50, 7, 1);
  assert.deepEqual(window, { start: 7, end: 8, before: false, after: false });
});

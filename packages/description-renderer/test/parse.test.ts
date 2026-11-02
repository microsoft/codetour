import { test } from "node:test";
import * as assert from "node:assert";
import {
  containsMermaidFenceMarker,
  findCaptionCandidateLine,
  isMermaidFenceLine,
} from "../src/parse";

test("findCaptionCandidateLine returns the nearest non-blank line above the fence", () => {
  const text = ["intro", "", "```mermaid", "flowchart TD", "```"].join("\n");
  const fenceStart = text.indexOf("```mermaid");
  assert.equal(findCaptionCandidateLine(text, fenceStart), "intro");
});

test("findCaptionCandidateLine skips consecutive blank lines", () => {
  const text = ["", "**Diagram — Kept**", "", "", "```mermaid"].join("\n");
  const fenceStart = text.indexOf("```mermaid");
  assert.equal(findCaptionCandidateLine(text, fenceStart), "**Diagram — Kept**");
});

test("findCaptionCandidateLine returns undefined when only blanks precede the fence", () => {
  const text = ["", "   ", "```mermaid"].join("\n");
  const fenceStart = text.indexOf("```mermaid");
  assert.equal(findCaptionCandidateLine(text, fenceStart), undefined);
});

test("findCaptionCandidateLine ignores text at and after the fence start", () => {
  const text = ["above", "```mermaid", "below"].join("\n");
  const fenceStart = text.indexOf("```mermaid");
  assert.equal(findCaptionCandidateLine(text, fenceStart), "above");
});

test("isMermaidFenceLine accepts only bare mermaid fence openings", () => {
  assert.equal(isMermaidFenceLine("```mermaid"), true);
  assert.equal(isMermaidFenceLine("  ```mermaid\t"), true);
  assert.equal(isMermaidFenceLine("```mermaid x"), false);
  assert.equal(isMermaidFenceLine("```js"), false);
  assert.equal(isMermaidFenceLine("```"), false);
  assert.equal(isMermaidFenceLine("text"), false);
});

test("containsMermaidFenceMarker reports the raw fence marker", () => {
  assert.equal(containsMermaidFenceMarker("No fences here."), false);
  assert.equal(
    containsMermaidFenceMarker("```mermaid\nflowchart TD\n```"),
    true
  );
});

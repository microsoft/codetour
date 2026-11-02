import { test } from "node:test";
import * as assert from "node:assert/strict";
import { prepareNarrationText } from "./prepareText";

test("a description speaks prose in order with the fixed rich-content substitutions", () => {
  const description = [
    "# Terminal reader",
    "",
    "The reader renders **steps** with `renderMarkdownToHtml`; see " +
      "[the docs](https://example.com/docs) for details.",
    "",
    "- first item",
    "- second item",
    "",
    "```mermaid",
    "flowchart TD",
    "  A[Start] --> B{Choice}",
    "```",
    "",
    "Text before the picture, then ![screenshot](images/screen.png) and text after.",
    "",
    "```ts",
    "const value = 1;",
    "```",
    "",
    "Closing prose."
  ].join("\n");
  const spoken = [
    "Terminal reader",
    "The reader renders steps with render markdown to html; see the docs for details.",
    "first item",
    "second item",
    "Voir diagramme",
    "Text before the picture, then Voir image and text after.",
    "Bloc de code",
    "Closing prose."
  ].join("\n");
  assert.equal(prepareNarrationText(description), spoken);
});

test("an empty description stays silent", () => {
  assert.equal(prepareNarrationText(""), "");
  assert.equal(prepareNarrationText("   \n\t\n  "), "");
});

test("formatting punctuation is omitted, the text is kept", () => {
  const description = "## A heading\n\n> a quoted **warning** with *emphasis*\n\n" +
    "1. ordered item\n2. another\n\n---\n\nplain __bold__ prose";
  assert.equal(prepareNarrationText(description),
    "A heading\na quoted warning with emphasis\nordered item\nanother\nplain bold prose");
});

test("every Mermaid fence is one Voir diagramme, never its source or labels", () => {
  const spoken = prepareNarrationText(
    "```mermaid\nA[Start] --> B\n```\nmiddle\n```mermaid\nC --> D\n```");
  assert.equal(spoken, "Voir diagramme\nmiddle\nVoir diagramme");
});

test("images and links never speak a path or URL", () => {
  const spoken = prepareNarrationText(
    "![alt text](https://example.com/pic.png) and [visible label](https://example.com/page)");
  assert.equal(spoken, "Voir image and visible label");
  assert.doesNotMatch(spoken, /example\.com|pic\.png/);
});

test("an unclosed code fence is a Bloc de code, not its content", () => {
  const spoken = prepareNarrationText("```js\nsecretCall()\n");
  assert.equal(spoken, "Bloc de code");
});

test("a reference link speaks its label and drops the definition", () => {
  const spoken = prepareNarrationText("[label][ref]\n\n[ref]: https://example.com/x");
  assert.equal(spoken, "label");
});

test("inline identifiers are spoken as ordinary words", () => {
  assert.equal(prepareNarrationText("call `prepare_text` on some_var now"),
    "call prepare text on some_var now");
});

test("a camelCase inline identifier splits at the hump and speaks lowercase words", () => {
  assert.equal(prepareNarrationText("Use `selectContext` then `workspacePath` here."),
    "Use select context then workspace path here.");
});

test("an all-caps acronym stays in capitals and the word after it is its own word", () => {
  assert.equal(prepareNarrationText("The reader parses `parseHTMLFile` first."),
    "The reader parses parse HTML file first.");
});

test("underscores split an inline identifier into spoken words", () => {
  assert.equal(prepareNarrationText("Run `create_changes_tour` now."),
    "Run create changes tour now.");
});

test("an identifier written only in capitals is spoken as lowercase words", () => {
  assert.equal(prepareNarrationText("The `STALE_HEAD` commit is gone."),
    "The stale head commit is gone.");
});

test("hyphens split an inline identifier into spoken words", () => {
  assert.equal(prepareNarrationText("Use the `--force-push` flag."), "Use the force push flag.");
});

test("slashes split an inline path into spoken words", () => {
  assert.equal(prepareNarrationText("Open `src/cli/narration` first."), "Open src cli narration first.");
});

test("a letter-digit transition splits an inline identifier into spoken words", () => {
  assert.equal(prepareNarrationText("Hash with `sha256`, count with `i18n`."),
    "Hash with sha 256, count with i 18 n.");
});

test("a period is not a word boundary: context.ts stays joined", () => {
  assert.equal(prepareNarrationText("Edit `context.ts` only."), "Edit context.ts only.");
});

test("reference images use the image substitution without reading their label or target", () => {
  assert.equal(prepareNarrationText("Before ![screen][shot] and ![shot][] and ![shot].\n\n[shot]: images/screen.png"),
    "Before Voir image and Voir image and Voir image.");
});

test("a code fence closes only with its own marker and at least its opening length", () => {
  assert.equal(prepareNarrationText("````js\n~~~\nsecretCall()\n```\nstillCode()\n````\nAfter."),
    "Bloc de code\nAfter.");
});

test("a blockquoted code fence is substituted without speaking its source", () => {
  assert.equal(prepareNarrationText("> ```js\n> secretCall()\n> ```\nAfter."),
    "Bloc de code\nAfter.");
});

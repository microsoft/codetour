import { test } from "node:test";
import * as assert from "node:assert";
import { renderDescription } from "../src/description";
import { renderMermaidDiagram } from "../src/render";
import {
  ALLOWED_KIND_CAPTIONS,
  ALLOWED_KIND_SOURCES,
  CAPTIONED_FLOWCHART_DESCRIPTION,
  FLOWCHART_SOURCE,
  UNSUPPORTED_KIND_SOURCES,
  captionedDiagram,
  extractPngDataUri,
  extractSvgDataUri,
  flowchartOfExactByteLength,
  assertValidPng
} from "./helpers/fixtures";

const COUNT_NOTICE_MARKER = "at most three Mermaid diagrams";
const CAPTION_NOTICE_MARKER = "**Diagram — …** caption";
const SIZE_NOTICE_MARKER = "20 KB limit";
const KIND_NOTICE_MARKER = "Unsupported Mermaid diagram kind";
const RENDER_NOTICE_MARKER = "could not be rendered";

function assertNotice(content: string, marker: string): void {
  assert.ok(
    content.includes(marker),
    `Expected the notice "${marker}" in:\n${content.slice(0, 400)}`
  );
}

test("renderDescription renders a captioned flowchart as a PNG image", async () => {
  const content = await renderDescription(
    CAPTIONED_FLOWCHART_DESCRIPTION,
    "light"
  );

  const png = extractPngDataUri(content, "Diagram — Request lifecycle");
  assertValidPng(png);
});

test("renderDescription keeps the caption visible and uses it as alt text", async () => {
  const content = await renderDescription(
    CAPTIONED_FLOWCHART_DESCRIPTION,
    "light"
  );

  assert.ok(content.includes("**Diagram — Request lifecycle**"));
  assert.ok(content.includes("![Diagram — Request lifecycle](data:image/png"));
});

test("renderDescription hides the Mermaid source during playback", async () => {
  const content = await renderDescription(
    CAPTIONED_FLOWCHART_DESCRIPTION,
    "light"
  );

  assert.ok(!content.includes("```mermaid"));
  assert.ok(!content.includes("flowchart TD"));
  assert.ok(!content.includes("Client --> Gateway"));
});

test("renderDescription returns descriptions without Mermaid unchanged", async () => {
  const description = [
    "A plain description with text.",
    "",
    "```ts",
    "const answer = 42;",
    "```",
    "",
    "[Next tour](command:codetourIA.startTourByTitle?%5B%22Next%22%5D)"
  ].join("\n");

  assert.equal(await renderDescription(description, "light"), description);
  assert.equal(await renderDescription(description, "dark"), description);
});

test("renderDescription renders every allowed diagram kind through the seam", async () => {
  for (const [kind, source] of Object.entries(ALLOWED_KIND_SOURCES)) {
    const caption = ALLOWED_KIND_CAPTIONS[kind];
    const content = await renderDescription(captionedDiagram(caption, source), "light");

    const png = extractPngDataUri(content, caption);
    assertValidPng(png);
    assert.ok(content.includes(`**${caption}**`), kind);
    assert.ok(!content.includes("```mermaid"), kind);
    assert.ok(!content.includes(source), kind);
  }
});

test("renderDescription renders a sequence diagram with message arrows", async () => {
  const content = await renderDescription(
    captionedDiagram(
      ALLOWED_KIND_CAPTIONS.sequenceDiagram,
      ALLOWED_KIND_SOURCES.sequenceDiagram
    ),
    "light"
  );

  assertValidPng(
    extractPngDataUri(content, ALLOWED_KIND_CAPTIONS.sequenceDiagram)
  );
});

test("renderDescription renders a class diagram with members", async () => {
  const content = await renderDescription(
    captionedDiagram(
      ALLOWED_KIND_CAPTIONS.classDiagram,
      ALLOWED_KIND_SOURCES.classDiagram
    ),
    "light"
  );

  assertValidPng(
    extractPngDataUri(content, ALLOWED_KIND_CAPTIONS.classDiagram)
  );
});

test("renderDescription fails an unsupported kind locally, keeping the caption as alternative text", async () => {
  for (const [label, source] of Object.entries(UNSUPPORTED_KIND_SOURCES)) {
    const caption = `Diagram — ${label} attempt`;
    const content = await renderDescription(captionedDiagram(caption, source), "light");

    assertNotice(content, KIND_NOTICE_MARKER);
    assert.ok(content.includes(`**${caption}**`), label);
    assert.ok(!content.includes("```mermaid"), label);
    assert.ok(!content.includes(source), label);
  }
});

test("renderDescription can hand the sanitized SVG to a real HTML surface", async () => {
  const content = await renderDescription(
    CAPTIONED_FLOWCHART_DESCRIPTION,
    "dark",
    { diagramFormat: "svg" }
  );

  assert.ok(!content.includes("data:image/png"), "no raster is produced");
  const svg = extractSvgDataUri(content, "Diagram — Request lifecycle");
  assert.match(svg, /<svg/);
  assert.match(svg, /viewBox="/);
  assert.doesNotMatch(svg, /<script|<foreignObject/i);
  assert.ok(content.includes("**Diagram — Request lifecycle**"));
  assert.ok(!content.includes("```mermaid"));
});

test("renderDescription keeps PNG as the default image format", async () => {
  const content = await renderDescription(CAPTIONED_FLOWCHART_DESCRIPTION, "light");

  assert.ok(content.includes("data:image/png;base64,"));
  assert.ok(!content.includes("data:image/svg+xml"));
});

test("renderDescription fails a Mermaid fence without a caption, without exposing its source", async () => {
  const description = [
    "Some text that is not a caption.",
    "",
    "```mermaid",
    FLOWCHART_SOURCE,
    "```"
  ].join("\n");

  const content = await renderDescription(description, "light");

  assertNotice(content, CAPTION_NOTICE_MARKER);
  assert.ok(!content.includes("```mermaid"));
  assert.ok(!content.includes(FLOWCHART_SOURCE));
});

test("renderDescription fails a Mermaid fence whose caption is malformed", async () => {
  for (const captionLine of [
    "*Diagram — single stars*",
    "**Diagram – wrong dash**",
    "**Diagram —**",
    "**Diagram — a** and **b**"
  ]) {
    const description = [captionLine, "", "```mermaid", FLOWCHART_SOURCE, "```"].join("\n");

    const content = await renderDescription(description, "light");

    assertNotice(content, CAPTION_NOTICE_MARKER);
    assert.ok(!content.includes("```mermaid"), captionLine);
    assert.ok(!content.includes(FLOWCHART_SOURCE), captionLine);
  }
});

test("renderDescription fails a Mermaid fence with markdown between the caption and the fence", async () => {
  const description = [
    "**Diagram — Interrupted**",
    "",
    "Read this first:",
    "",
    "```mermaid",
    FLOWCHART_SOURCE,
    "```"
  ].join("\n");

  const content = await renderDescription(description, "light");

  assertNotice(content, CAPTION_NOTICE_MARKER);
  assert.ok(!content.includes("```mermaid"));
  assert.ok(!content.includes(FLOWCHART_SOURCE));
});

test("a caption can only introduce a single fence", async () => {
  const description = [
    "**Diagram — First**",
    "",
    "```mermaid",
    FLOWCHART_SOURCE,
    "```",
    "```mermaid",
    FLOWCHART_SOURCE,
    "```"
  ].join("\n");

  const content = await renderDescription(description, "light");

  assertValidPng(extractPngDataUri(content, "Diagram — First"));
  assertNotice(content, CAPTION_NOTICE_MARKER);
  assert.ok(!content.includes("```mermaid"));
});

test("renderDescription fails a diagram source over 20 KB", async () => {
  const source = flowchartOfExactByteLength(20 * 1024 + 1);
  const content = await renderDescription(
    captionedDiagram("Diagram — Too big", source),
    "light"
  );

  assertNotice(content, SIZE_NOTICE_MARKER);
  assert.ok(content.includes("**Diagram — Too big**"));
  assert.ok(!content.includes("```mermaid"));
  assert.ok(!content.includes(source.slice(0, 200)));
});

test("renderDescription renders a diagram source of exactly 20 KB", async () => {
  const source = flowchartOfExactByteLength(20 * 1024);
  const content = await renderDescription(
    captionedDiagram("Diagram — Boundary", source),
    "light"
  );

  assertValidPng(extractPngDataUri(content, "Diagram — Boundary"));
});

test("renderDescription renders at most three diagrams and fails the excess locally", async () => {
  const description = [1, 2, 3, 4, 5]
    .map(number =>
      captionedDiagram(`Diagram — Chart ${number}`, FLOWCHART_SOURCE)
    )
    .join("\n\n");

  const content = await renderDescription(description, "light");

  for (const number of [1, 2, 3]) {
    assertValidPng(
      extractPngDataUri(content, `Diagram — Chart ${number}`)
    );
  }
  const excessNotices = content
    .split("\n")
    .filter(line => line.includes(COUNT_NOTICE_MARKER));
  assert.equal(excessNotices.length, 2);
  assert.ok(content.includes("**Diagram — Chart 4**"));
  assert.ok(content.includes("**Diagram — Chart 5**"));
  assert.ok(!content.includes("```mermaid"));
});

test("the first three fences count toward the limit even when they fail other rules", async () => {
  const description = [
    "Intro text",
    "",
    "```mermaid",
    FLOWCHART_SOURCE,
    "```",
    "",
    captionedDiagram("Diagram — Unsupported", UNSUPPORTED_KIND_SOURCES.pie),
    captionedDiagram("Diagram — Valid", FLOWCHART_SOURCE),
    captionedDiagram("Diagram — Fourth", FLOWCHART_SOURCE)
  ].join("\n");

  const content = await renderDescription(description, "light");

  assertValidPng(extractPngDataUri(content, "Diagram — Valid"));
  assertNotice(content, CAPTION_NOTICE_MARKER);
  assertNotice(content, KIND_NOTICE_MARKER);
  assertNotice(content, COUNT_NOTICE_MARKER);
  assert.ok(!content.includes("```mermaid"));
});

test("renderDescription replaces an invalid diagram with a warning, not its source", async () => {
  const description = [
    "**Diagram — Broken diagram**",
    "",
    "```mermaid",
    "flowchart TD",
    "    this is not mermaid at all (((",
    "```"
  ].join("\n");

  const content = await renderDescription(description, "light");

  assert.ok(!content.includes("```mermaid"));
  assert.ok(!content.includes("this is not mermaid at all"));
  assertNotice(content, RENDER_NOTICE_MARKER);
  assert.ok(content.includes("**Diagram — Broken diagram**"));
});

test("renderDescription renders diagrams in one description independently", async () => {
  const description = [
    "**Diagram — Valid diagram**",
    "",
    "```mermaid",
    FLOWCHART_SOURCE,
    "```",
    "",
    "**Diagram — Broken diagram**",
    "",
    "```mermaid",
    "flowchart TD",
    "    this is not mermaid at all (((",
    "```"
  ].join("\n");

  const content = await renderDescription(description, "light");

  assertValidPng(extractPngDataUri(content, "Diagram — Valid diagram"));
  assertNotice(content, RENDER_NOTICE_MARKER);
  assert.ok(!content.includes("this is not mermaid at all"));
});

test("one rejected diagram never hides its valid siblings", async () => {
  const description = [
    "Plain text above",
    "",
    "```mermaid",
    FLOWCHART_SOURCE,
    "```",
    "",
    captionedDiagram("Diagram — Supported", FLOWCHART_SOURCE),
    captionedDiagram("Diagram — Unsupported", UNSUPPORTED_KIND_SOURCES.gitGraph)
  ].join("\n");

  const content = await renderDescription(description, "light");

  assertValidPng(extractPngDataUri(content, "Diagram — Supported"));
  assertNotice(content, CAPTION_NOTICE_MARKER);
  assertNotice(content, KIND_NOTICE_MARKER);
  assert.ok(!content.includes("```mermaid"));
});

test("renderDescription adapts the rendered diagram to the theme", async () => {
  const light = await renderMermaidDiagram(FLOWCHART_SOURCE, "light");
  const dark = await renderMermaidDiagram(FLOWCHART_SOURCE, "dark");

  assertValidPng(light.png);
  assertValidPng(dark.png);
  assert.notEqual(light.svg, dark.svg);
  assert.ok(Buffer.compare(light.png, dark.png) !== 0);
});

test("renderMermaidDiagram returns a sanitized SVG and an in-memory PNG", async () => {
  const { svg, png } = await renderMermaidDiagram(FLOWCHART_SOURCE, "light");

  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes('viewBox="'));
  assert.ok(svg.includes(">Client</tspan>"));
  assertValidPng(png);
});

test("renderMermaidDiagram refuses unsupported diagram kinds itself", async () => {
  for (const source of [
    UNSUPPORTED_KIND_SOURCES.pie,
    UNSUPPORTED_KIND_SOURCES.mindmap,
    UNSUPPORTED_KIND_SOURCES["unknown kind"]
  ]) {
    await assert.rejects(
      () => renderMermaidDiagram(source, "light"),
      /Unsupported Mermaid diagram kind/u,
      source.split("\n")[0]
    );
  }
});

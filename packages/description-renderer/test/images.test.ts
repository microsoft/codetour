import { test } from "node:test";
import * as assert from "node:assert";
import { renderDescription } from "../src/description";
import {
  NON_IMAGE_BYTES,
  SAMPLE_JPEG_BYTES,
  SAMPLE_PNG_BYTES,
  extractImageDataUri
} from "./helpers/fixtures";

const IMAGE_NOTICE_MARKER = "referenced image could not be loaded";

function assertNotice(content: string, marker: string): void {
  assert.ok(
    content.includes(marker),
    `Expected the notice "${marker}" in:\n${content.slice(0, 400)}`
  );
}

function imageResolver(files: Record<string, Buffer | undefined>) {
  return (path: string) => files[path];
}

const LOCAL_IMAGE_DESCRIPTION = [
  "The architecture is explained by a picture:",
  "",
  "![Architecture](.tours/images/project/architecture.png)",
  "",
  "That is the whole story."
].join("\n");

test("renderDescription inlines a local PNG image as a data URI", async () => {
  const content = await renderDescription(LOCAL_IMAGE_DESCRIPTION, "light", {
    resolveImageBytes: imageResolver({
      ".tours/images/project/architecture.png": SAMPLE_PNG_BYTES
    })
  });

  const bytes = extractImageDataUri(content, "Architecture", "png");
  assert.ok(bytes.equals(SAMPLE_PNG_BYTES));
  assert.ok(content.includes("That is the whole story."));
  assert.ok(!content.includes(".tours/images/project/architecture.png"));
});

test("renderDescription inlines a local JPEG image as a data URI", async () => {
  const description = "![Screenshot](docs/screenshots/step-1.jpg)";

  const content = await renderDescription(description, "light", {
    resolveImageBytes: imageResolver({
      "docs/screenshots/step-1.jpg": SAMPLE_JPEG_BYTES
    })
  });

  const bytes = extractImageDataUri(content, "Screenshot", "jpeg");
  assert.ok(bytes.equals(SAMPLE_JPEG_BYTES));
  assert.ok(!content.includes("docs/screenshots/step-1.jpg"));
});

test("renderDescription renders a compact warning for a missing local image", async () => {
  const content = await renderDescription(LOCAL_IMAGE_DESCRIPTION, "light", {
    resolveImageBytes: imageResolver({})
  });

  assertNotice(content, IMAGE_NOTICE_MARKER);
  assert.ok(!content.includes(".tours/images/project/architecture.png"));
  assert.ok(content.includes("That is the whole story."));
});

test("renderDescription renders a compact warning when the host cannot supply an image", async () => {
  const description = "![Fake](.tours/images/project/fake.png)";

  const content = await renderDescription(description, "light", {
    resolveImageBytes: imageResolver({
      ".tours/images/project/fake.png": NON_IMAGE_BYTES
    })
  });

  assertNotice(content, IMAGE_NOTICE_MARKER);
  assert.ok(!content.includes("base64"));
  assert.ok(!content.includes("not an image"));
  assert.ok(!content.includes(".tours/images/project/fake.png"));
});

test("renderDescription keeps a compact warning when the resolver rejects a path", async () => {
  const description = "![Broken](.tours/images/project/broken.png)";

  const content = await renderDescription(description, "light", {
    resolveImageBytes: () => Promise.reject(new Error("unreadable"))
  });

  assertNotice(content, IMAGE_NOTICE_MARKER);
  assert.ok(!content.includes(".tours/images/project/broken.png"));
});

test("renderDescription leaves HTTPS images untouched when a resolver is supplied", async () => {
  const description = "![Logo](https://example.com/logo.png)";

  const content = await renderDescription(description, "light", {
    resolveImageBytes: imageResolver({ "https://example.com/logo.png": SAMPLE_PNG_BYTES })
  });

  assert.equal(content, description);
});

test("renderDescription renders a compact warning for local images without a resolver", async () => {
  const description = "![Architecture](.tours/images/project/architecture.png)";

  const content = await renderDescription(description, "light");

  assertNotice(content, IMAGE_NOTICE_MARKER);
  assert.ok(!content.includes(".tours/images/project/architecture.png"));
});

test("renderDescription inlines a local image whose path contains spaces", async () => {
  const description =
    "![Architecture](.tours/images/project/my architecture.png)";

  const content = await renderDescription(description, "light", {
    resolveImageBytes: imageResolver({
      ".tours/images/project/my architecture.png": SAMPLE_PNG_BYTES
    })
  });

  const bytes = extractImageDataUri(content, "Architecture", "png");
  assert.ok(bytes.equals(SAMPLE_PNG_BYTES));
  assert.ok(!content.includes(".tours/images/project/my architecture.png"));
});

test("renderDescription renders a compact warning for a titled local image reference", async () => {
  const description = '![Badge](.tours/images/project/badge.png "Official")';

  const content = await renderDescription(description, "light", {
    resolveImageBytes: imageResolver({})
  });

  assertNotice(content, IMAGE_NOTICE_MARKER);
  assert.ok(!content.includes(".tours/images/project/badge.png"));
});

test("renderDescription escapes brackets in the alt text of an inlined image", async () => {
  const description = "![A [B]](docs/diagram.png)";

  const content = await renderDescription(description, "light", {
    resolveImageBytes: imageResolver({ "docs/diagram.png": SAMPLE_PNG_BYTES })
  });

  assert.ok(content.includes("![A \\[B\\]](data:image/png;base64,"));
});

test("renderDescription leaves image markdown inside code blocks alone", async () => {
  const description = [
    "This is how you embed an image:",
    "",
    "```md",
    "![Example](.tours/images/project/example.png)",
    "```"
  ].join("\n");

  const content = await renderDescription(description, "light", {
    resolveImageBytes: imageResolver({ ".tours/images/project/example.png": SAMPLE_PNG_BYTES })
  });

  assert.equal(content, description);
});

test("renderDescription inlines local images and renders diagrams in one description", async () => {
  const description = [
    "**Diagram — Flow**",
    "",
    "```mermaid",
    "flowchart TD",
    "    Client --> Gateway",
    "```",
    "",
    "![Architecture](.tours/images/project/architecture.png)"
  ].join("\n");

  const content = await renderDescription(description, "light", {
    resolveImageBytes: imageResolver({
      ".tours/images/project/architecture.png": SAMPLE_PNG_BYTES
    })
  });

  assert.ok(content.includes("![Diagram — Flow](data:image/png;base64,"));
  const bytes = extractImageDataUri(content, "Architecture", "png");
  assert.ok(bytes.equals(SAMPLE_PNG_BYTES));
  assert.ok(!content.includes("```mermaid"));
  assert.ok(!content.includes(".tours/images/project/architecture.png"));
});

test("every local image reference is inlined or warned, never left as a path", async () => {
  const description = [
    "![Present](docs/present.png)",
    "",
    "![Missing](docs/missing.png)"
  ].join("\n");

  const content = await renderDescription(description, "light", {
    resolveImageBytes: imageResolver({ "docs/present.png": SAMPLE_JPEG_BYTES })
  });

  extractImageDataUri(content, "Present", "jpeg");
  assertNotice(content, IMAGE_NOTICE_MARKER);
  assert.ok(!content.includes("docs/present.png"));
  assert.ok(!content.includes("docs/missing.png"));
});

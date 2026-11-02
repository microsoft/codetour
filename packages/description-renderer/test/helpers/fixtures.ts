export const PNG_SIGNATURE = Buffer.from([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a
]);

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractImageDataUri(
  markdown: string,
  altText: string,
  mime: string
): Buffer {
  const pattern = new RegExp(
    `!\\[${escapeRegExp(altText)}\\]\\(data:image\\/${mime};base64,([A-Za-z0-9+/=]+)\\)`
  );
  const match = markdown.match(pattern);
  if (!match) {
    throw new Error(
      `Expected a ${mime} data URI image with alt text "${altText}" in:\n${markdown.slice(0, 400)}`
    );
  }
  return Buffer.from(match[1], "base64");
}

export function extractPngDataUri(markdown: string, altText: string): Buffer {
  return extractImageDataUri(markdown, altText, "png");
}

export const SAMPLE_PNG_BYTES = Buffer.concat([
  PNG_SIGNATURE,
  Buffer.from([
    0x00,
    0x00,
    0x00,
    0x0d,
    0x49,
    0x48,
    0x44,
    0x52,
    0x00,
    0x00,
    0x00,
    0x20,
    0x00,
    0x00,
    0x00,
    0x20,
    0x08,
    0x06,
    0x00,
    0x00,
    0x00
  ])
]);

export const SAMPLE_JPEG_BYTES = Buffer.from([
  0xff,
  0xd8,
  0xff,
  0xe0,
  0x00,
  0x10,
  0x4a,
  0x46,
  0x49,
  0x46,
  0x00,
  0x01,
  0x00,
  0x00,
  0x00,
  0x20,
  0x00,
  0x20
]);

export const NON_IMAGE_BYTES = Buffer.from(
  "<html><body>definitely not an image</body></html>",
  "utf8"
);

export function assertValidPng(png: Buffer): void {
  if (png.length < 200) {
    throw new Error(`Expected a non-trivial PNG, got ${png.length} bytes`);
  }
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("Expected a PNG signature at the start of the image");
  }
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width < 20 || height < 20) {
    throw new Error(`Expected a visible diagram size, got ${width}x${height}`);
  }
  return void [width, height];
}

export function captionedDiagram(caption: string, source: string): string {
  return ["**" + caption + "**", "", "```mermaid", source, "```"].join("\n");
}

export function findImageLine(markdown: string, altText: string): string {
  const prefix = escapeRegExp(altText).replace(
    /(\\\[|\\\])/g,
    "\\\\?$1"
  );
  const pattern = new RegExp(`^!\\[${prefix}`);
  const line = markdown.split("\n").find(line => pattern.test(line));
  if (!line) {
    throw new Error(
      `Expected an image line with alt text "${altText}" in:\n${markdown.slice(0, 400)}`
    );
  }
  return line;
}

/** Decode the SVG data URI a real HTML surface receives into its markup. */
export function extractSvgDataUri(markdown: string, altText: string): string {
  const line = findImageLine(markdown, altText);
  const dataUri = line.match(/\(data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)\)/);
  if (!dataUri) {
    throw new Error(`Expected an SVG data URI in:\n${line.slice(0, 200)}`);
  }
  return Buffer.from(dataUri[1], "base64").toString("utf8");
}

export const FLOWCHART_SOURCE = [
  "flowchart TD",
  "    Client --> Gateway --> Service",
  "    Service --> Database"
].join("\n");

export const CAPTIONED_FLOWCHART_DESCRIPTION = [
  "The request flows through three layers:",
  "",
  "**Diagram — Request lifecycle**",
  "",
  "```mermaid",
  FLOWCHART_SOURCE,
  "```",
  "",
  "That is the whole story."
].join("\n");

export const ALLOWED_KIND_SOURCES: Record<string, string> = {
  flowchart: FLOWCHART_SOURCE,
  sequenceDiagram: [
    "sequenceDiagram",
    "    autonumber",
    "    participant User",
    "    participant Player as Tour Player",
    "    User->>Player: Start tour",
    "    Player-->>User: Step ready",
    "    note right of Player: Diagrams render per fence"
  ].join("\n"),
  "stateDiagram-v2": [
    "stateDiagram-v2",
    "    [*] --> Idle",
    "    Idle --> Loading: start tour",
    "    Loading --> Playing: step found",
    "    note right of Loading : waiting for the file",
    "    Playing --> Done: finish",
    "    Done --> [*]"
  ].join("\n"),
  classDiagram: [
    "classDiagram",
    "    class CodeTour {",
    "        +string title",
    "        +Step[] steps",
    "        +start() void",
    "        -persist()",
    "    }",
    "    class Step {",
    "        +string description",
    "    }",
    "    CodeTour \"1\" *-- \"many\" Step : contains"
  ].join("\n"),
  erDiagram: [
    "erDiagram",
    "    TOUR ||--o{ STEP : contains",
    "    STEP ||--|| FILE : anchors",
    "    TOUR {",
    "        string title \"the tour title\"",
    "    }",
    "    STEP {",
    "        string description",
    "        int line",
    "    }"
  ].join("\n")
};

export const ALLOWED_KIND_CAPTIONS: Record<string, string> = {
  flowchart: "Diagram — Request lifecycle",
  sequenceDiagram: "Diagram — Tour playback sequence",
  "stateDiagram-v2": "Diagram — Tour playback states",
  classDiagram: "Diagram — Tour data model",
  erDiagram: "Diagram — Tour entity relationships"
};

export const UNSUPPORTED_KIND_SOURCES: Record<string, string> = {
  pie: ['pie title Pets adopted', '    "Dogs" : 386', '    "Cats" : 85'].join(
    "\n"
  ),
  gantt: [
    "gantt",
    "    title Release plan",
    "    dateFormat YYYY-MM-DD",
    "    section Build",
    "    Package :p1, 2024-01-01, 3d"
  ].join("\n"),
  gitGraph: ["gitGraph", "    commit", "    branch feature", "    commit"].join(
    "\n"
  ),
  mindmap: ["mindmap", "    root((tour))", "      steps"].join("\n"),
  journey: [
    "journey",
    "    title Taking a tour",
    "    section Start",
    "      Me: 5: Me"
  ].join("\n"),
  "unknown kind": ["squarewave TD", "    A --> B"].join("\n")
};

export function flowchartOfExactByteLength(bytes: number): string {
  const base = "flowchart TD\n    A --> B\n%%";
  const padding = bytes - Buffer.byteLength(base, "utf8");
  if (padding < 0) {
    throw new Error(`Cannot build a flowchart of only ${bytes} bytes`);
  }
  return base + "x".repeat(padding);
}

export const HOSTILE_LABEL_SOURCES: Record<string, string> = {
  flowchart: [
    "flowchart TD",
    '    A["<img src=x onerror=alert(1)>"] --> B["<script>alert(2)</script>"]'
  ].join("\n"),
  sequenceDiagram: [
    "sequenceDiagram",
    '    participant U as "<img src=x onerror=alert(1)>"',
    '    U->>U: "<script>alert(2)</script>"'
  ].join("\n"),
  "stateDiagram-v2": [
    "stateDiagram-v2",
    "    [*] --> Idle",
    '    Idle --> Playing: "<img src=x onerror=alert(1)>"',
    '    state "<script>alert(2)</script>" as S',
    "    Playing --> S"
  ].join("\n"),
  classDiagram: [
    "classDiagram",
    '    class Foo["<img src=x onerror=alert(1)>"] {',
    "        +string bar",
    "    }",
    '    note for Foo "a note with <script>alert(2)</script>"'
  ].join("\n"),
  erDiagram: [
    "erDiagram",
    "    TOUR {",
    '        string title "comment <script>alert(1)</script>"',
    "    }"
  ].join("\n")
};

export const HOSTILE_INTERACTION_SOURCE = [
  "flowchart TD",
  "    A --> B",
  '    click A "https://example.com" "tooltip"',
  '    click B href "https://example.com/linked" "tooltip"',
  '    click A call alert(1) "tooltip"',
  "    linkStyle 0 stroke:#f66,stroke-width:2px"
].join("\n");

export const HOSTILE_MARKDOWN_LABEL_SOURCE = [
  "flowchart TD",
  '    A["See [docs](https://evil.example) and [run](command:codetourIA.nextTourStep)"] --> B'
].join("\n");

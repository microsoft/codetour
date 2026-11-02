import {
  ALLOWED_DIAGRAM_KINDS,
  MAX_DIAGRAMS_PER_DESCRIPTION,
  MAX_DIAGRAM_SOURCE_BYTES,
  diagramKindOf,
  evaluateDiagramFence,
  findCaptionCandidateLine,
  findDiagramFences,
  matchDiagramCaption,
  renderMermaidDiagram,
} from "codetour-description-renderer";
import { Issue } from "./types";

// The exact caption grammar shared by the caption diagnostic and the tool
// guidance: a single bold line of the form **Diagram — <descriptive text>**,
// with a literal em dash (U+2014) and "…" used only as shorthand for the
// descriptive text, never as a literal ellipsis.
const CAPTION_GRAMMAR =
  "a single bold line of the form **Diagram — <descriptive text>**, with a literal em dash " +
  "(U+2014) between Diagram and the descriptive text, and the … in the shorthand " +
  "**Diagram — …** is a placeholder for descriptive text, not a literal ellipsis";

const MERMAID_TOOL_GUIDANCE =
  `Use Mermaid when it materially clarifies a relationship, flow, state, sequence, class, or entity. ` +
  `For architecture, workflow, lifecycle, or multi-module Tours, include at least one Mermaid diagram ` +
  `when it can summarize relationships spanning several steps. Omit diagrams only when the Tour has ` +
  `no meaningful relationship, flow, state transition, or sequence to visualize. ` +
  "If you use one, put a caption before a bare ```mermaid fence as the nearest non-blank line: " +
  `${CAPTION_GRAMMAR}. Keep that caption visible and descriptive. ` +
  `Only these Mermaid kinds are allowed: ${ALLOWED_DIAGRAM_KINDS.join(", ")}. ` +
  `Each description accepts at most ${MAX_DIAGRAMS_PER_DESCRIPTION} Mermaid fences, each source is limited to ` +
  `${MAX_DIAGRAM_SOURCE_BYTES / 1024} KB, and every source must have valid Mermaid syntax. ` +
  `Validation is offline, reports all diagram errors with their description, fence, and source location, ` +
  `and preserves the previous Tour when any error is found.`;

export { MERMAID_TOOL_GUIDANCE };

async function parseMermaid(source: string): Promise<void> {
  // renderMermaidDiagram uses the exact locked Mermaid engine and the same
  // strict configuration as playback. Its PNG is intentionally discarded:
  // this call is the offline syntax-validation seam for the MCP server.
  await renderMermaidDiagram(source, "light");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function lineAndColumnOf(description: string, offset: number): string {
  const beforeFence = description.slice(0, offset);
  const lastLineBreak = beforeFence.lastIndexOf("\n");
  const line = beforeFence.split("\n").length;
  const column = offset - lastLineBreak;
  return `line ${line}, column ${column}`;
}

function fencePath(descriptionPath: string, index: number, field?: string): string {
  const path = `${descriptionPath}.mermaid[${index}]`;
  return field ? `${path}.${field}` : path;
}

function canonicalCaption(caption: string | undefined): string | undefined {
  // findDiagramFences already applies the shared caption parser. Running the
  // captured value through that same public function keeps this boundary tied
  // to the renderer's caption grammar rather than reimplementing it here.
  return caption === undefined
    ? undefined
    : matchDiagramCaption(`**${caption}**`);
}

// All "found" values in diagnostics are serialized the same way, so quoting
// and escaping stay consistent across the caption, kind, and syntax messages.
function serializeFound(value: string | undefined): string {
  return value === undefined ? "undefined" : JSON.stringify(value);
}

// An invalid-syntax fence can be up to 20 KB; the diagnostic embeds only a
// bounded excerpt so the message stays readable. Short sources are embedded
// in full, unchanged.
const FOUND_EXCERPT_LIMIT = 200;
const TRUNCATION_MARKER = "…[truncated]";

function foundSourceExcerpt(source: string): string {
  return source.length > FOUND_EXCERPT_LIMIT
    ? source.slice(0, FOUND_EXCERPT_LIMIT) + TRUNCATION_MARKER
    : source;
}

async function validateDescription(
  description: string,
  descriptionPath: string
): Promise<Issue[]> {
  const issues: Issue[] = [];
  const fences = findDiagramFences(description);

  for (let index = 0; index < fences.length; index++) {
    const fence = fences[index];
    const location = lineAndColumnOf(description, fence.start);
    if (index >= MAX_DIAGRAMS_PER_DESCRIPTION) {
      issues.push({
        path: fencePath(descriptionPath, index),
        message:
          `the Mermaid fence at ${location} exceeds the limit of ${MAX_DIAGRAMS_PER_DESCRIPTION} ` +
          "fences per description",
      });
      continue;
    }

    if (!fence.closed) {
      issues.push({
        path: fencePath(descriptionPath, index, "source"),
        message: `the Mermaid fence at ${location} is not closed`
      });
      continue;
    }

    const evaluation = evaluateDiagramFence({
      caption: canonicalCaption(fence.caption),
      source: fence.source,
    });
    if (!evaluation.allowed) {
      const field =
        evaluation.reason === "caption"
          ? "caption"
          : evaluation.reason === "kind"
            ? "kind"
            : "source";
      let message: string;
      if (evaluation.reason === "caption") {
        // findDiagramFences keeps only the parsed caption, so when the parser
        // does not match, the offending line is not retained on the fence.
        // Re-derive it through the renderer's shared line walk.
        const foundLine = findCaptionCandidateLine(description, fence.start);
        message =
          `the Mermaid fence at ${location} requires a nearest non-blank caption: ` +
          `${CAPTION_GRAMMAR}; found: ${serializeFound(foundLine)}`;
      } else if (evaluation.reason === "size") {
        message =
          `the Mermaid source at ${location} is ${Buffer.byteLength(fence.source, "utf8")} bytes; ` +
          `the limit is ${MAX_DIAGRAM_SOURCE_BYTES} bytes`;
      } else {
        const detectedKind = diagramKindOf(fence.source);
        message =
          `the Mermaid source at ${location} uses an unsupported kind; ` +
          `found: ${serializeFound(detectedKind)}; ` +
          `supported kinds are ${ALLOWED_DIAGRAM_KINDS.join(", ")}`;
      }
      issues.push({ path: fencePath(descriptionPath, index, field), message });
      continue;
    }

    try {
      await parseMermaid(fence.source);
    } catch {
      issues.push({
        path: fencePath(descriptionPath, index, "source"),
        message:
          `the Mermaid source at ${location} has invalid Mermaid syntax; ` +
          `found: ${serializeFound(foundSourceExcerpt(fence.source))}`,
      });
    }
  }

  return issues;
}

export async function validateMermaidDescriptions(raw: unknown): Promise<Issue[]> {
  if (!isPlainObject(raw)) {
    return [];
  }

  const descriptions: Array<{ value: string; path: string }> = [];
  if (typeof raw.description === "string") {
    descriptions.push({ value: raw.description, path: "description" });
  }
  if (Array.isArray(raw.steps)) {
    for (let index = 0; index < raw.steps.length; index++) {
      const step = raw.steps[index];
      if (isPlainObject(step) && typeof step.description === "string") {
        descriptions.push({
          value: step.description,
          path: `steps[${index}].description`,
        });
      }
    }
  }

  const issues: Issue[] = [];
  for (const description of descriptions) {
    issues.push(...(await validateDescription(description.value, description.path)));
  }
  return issues;
}

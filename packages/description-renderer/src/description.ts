import { findDiagramFences } from "./parse";
import {
  DescriptionTheme,
  RenderedDiagram,
  renderMermaidDiagram
} from "./render";
import {
  DescriptionRenderOptions,
  DiagramImageFormat,
  ImageBytesResolver,
  escapeAltText,
  findLocalImageReferences,
  inlineLocalImages
} from "./images";
import {
  DiagramRuleReason,
  MAX_DIAGRAMS_PER_DESCRIPTION,
  evaluateDiagramFence
} from "./rules";

const RENDER_FAILURE_NOTICES: Record<DiagramRuleReason | "render" | "count", string> = {
  caption:
    "> ⚠️ The Mermaid diagram requires an immediately preceding **Diagram — …** caption.",
  size: "> ⚠️ The Mermaid diagram source exceeds the 20 KB limit.",
  kind:
    "> ⚠️ Unsupported Mermaid diagram kind (supported: flowchart, sequenceDiagram, stateDiagram-v2, classDiagram, erDiagram).",
  count:
    "> ⚠️ A description accepts at most three Mermaid diagrams; this one was not rendered.",
  render: "> ⚠️ The Mermaid diagram could not be rendered."
};

/** Encode a rendered diagram as the data URI the target surface can display. */
function diagramImageDataUri(
  rendered: RenderedDiagram,
  format: DiagramImageFormat
): string {
  if (format === "svg") {
    // The SVG is already sanitized and carries its own theme styles: base64
    // keeps every quote and '#' intact inside a Markdown image destination.
    return "data:image/svg+xml;base64," +
      Buffer.from(rendered.svg, "utf8").toString("base64");
  }
  return "data:image/png;base64," + rendered.png.toString("base64");
}

export async function renderDescription(
  description: string,
  theme: DescriptionTheme,
  options: DescriptionRenderOptions = {}
): Promise<string> {
  // Without a resolver no local image can be inlined: every local reference
  // must still resolve to a data URI or the compact warning, because a local
  // path left in the output would be stripped by the reading surfaces.
  const resolveImageBytes: ImageBytesResolver =
    options.resolveImageBytes ?? (async () => undefined);
  const format: DiagramImageFormat = options.diagramFormat ?? "png";
  const fences = findDiagramFences(description);
  if (
    fences.length === 0 &&
    findLocalImageReferences(description).length === 0
  ) {
    return description;
  }

  let content = description;
  for (let index = fences.length - 1; index >= 0; index--) {
    const fence = fences[index];
    let replacement: string;

    if (index >= MAX_DIAGRAMS_PER_DESCRIPTION) {
      replacement = RENDER_FAILURE_NOTICES.count;
    } else if (!fence.closed) {
      replacement = RENDER_FAILURE_NOTICES.render;
    } else {
      const evaluation = evaluateDiagramFence(fence);
      if (!evaluation.allowed) {
        replacement = RENDER_FAILURE_NOTICES[evaluation.reason];
      } else {
        try {
          const rendered = await renderMermaidDiagram(fence.source, theme);
          replacement = `![${escapeAltText(
            fence.caption!
          )}](${diagramImageDataUri(rendered, format)})`;
        } catch {
          replacement = RENDER_FAILURE_NOTICES.render;
        }
      }
    }

    content =
      content.slice(0, fence.start) + replacement + content.slice(fence.end);
  }

  return inlineLocalImages(content, resolveImageBytes);
}

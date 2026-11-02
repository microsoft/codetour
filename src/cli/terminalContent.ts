import {
  evaluateDiagramFence,
  findDiagramFences,
  MAX_DIAGRAMS_PER_DESCRIPTION,
  renderDescription,
  renderMermaidDiagram
} from "codetour-description-renderer";
import type { DiagramFence } from "codetour-description-renderer";
import { renderMarkdownToHtml } from "../player/markdown";
import type { CodeTour, CodeTourStep } from "../store";
import { readTourImages } from "./stepImages";
import { renderMermaidText } from "./termaid";

/** Where a terminal diagram can come from, injected so tests stay offline. */
export interface TerminalDescriptionOptions {
  /** Columns the rendered description may occupy, diagram art included. */
  width?: number;
  /** Draws a Mermaid source as terminal text; undefined when unavailable. */
  renderDiagramText?: (source: string) => Promise<string | undefined>;
}

/**
 * Fail the entire terminal Tour on the reached step, never prevalidate future
 * steps or quietly replace unsupported content with plain text/HTML.
 */
export class TerminalStepRenderError extends Error {
  constructor(tour: CodeTour, index: number, contentType: string, reason: string) {
    super("CodeTour terminal stopped: Tour '" + tour.title + "', step " +
      (index + 1) + " ('" + (tour.steps[index]?.title || "Untitled") + "'), " +
      contentType + ": " + reason);
    this.name = "TerminalStepRenderError";
  }
}

/**
 * A terminal cell paints one image pixel per column and two per row, so a
 * rasterized Mermaid diagram is downscaled to unreadable blocks. Prefer a
 * terminal-native drawing produced by `termaid`; without one, show the
 * authoritative Mermaid source so the Step stays intelligible (ADR 0024).
 */
function codeBlock(info: string, text: string): string {
  const longestRun = Math.max(0,
    ...(text.match(/`+/g) ?? []).map(run => run.length));
  const marker = "`".repeat(Math.max(3, longestRun + 1));
  return marker + info + "\n" + text + "\n" + marker;
}

/**
 * Replace every validated Mermaid fence with its drawing or its source, from
 * the end of the description so earlier offsets stay valid.
 */
function withDiagramBlocks(
  source: string,
  fences: DiagramFence[],
  blocks: string[]
): string {
  let content = source;
  for (let index = fences.length - 1; index >= 0; index--) {
    const fence = fences[index];
    content = content.slice(0, fence.start) + blocks[index] +
      content.slice(fence.end);
  }
  return content;
}

export async function renderTerminalDescription(
  tour: CodeTour,
  index: number,
  root: string,
  options: TerminalDescriptionOptions = {}
): Promise<string> {
  const step: CodeTourStep = tour.steps[index];
  if (!step) throw new TerminalStepRenderError(tour, index, "step", "does not exist");

  const fail = (kind: string, message: string): never => {
    throw new TerminalStepRenderError(tour, index, kind, message);
  };
  const source = step.description || "";

  // Author CSS and interactive DOM elements cannot be safely preserved by the
  // existing sanitizer; fail rather than silently stripping them in the POC.
  if (/<(?:script|style|iframe|embed|object|svg|canvas)\b|\sstyle\s*=/i.test(source)) {
    fail("HTML/CSS", "unsupported interactive or styled markup");
  }

  const fences = findDiagramFences(source);
  if (fences.length > MAX_DIAGRAMS_PER_DESCRIPTION) {
    fail("Mermaid", "more than " + MAX_DIAGRAMS_PER_DESCRIPTION + " diagrams");
  }
  const width = options.width ?? 0;
  const renderDiagramText = options.renderDiagramText ??
    (width > 0
      ? (diagram: string) => renderMermaidText(diagram, { width })
      : async () => undefined);
  const diagramBlocks: string[] = [];
  for (const fence of fences) {
    if (!fence.closed) fail("Mermaid", "diagram code fence is not closed");
    const evaluation = evaluateDiagramFence(fence);
    if (!evaluation.allowed) {
      fail("Mermaid", "diagram violates existing CodeTour rules: " + evaluation.reason);
    }
    try {
      await renderMermaidDiagram(fence.source, "dark");
    } catch (error) {
      fail("Mermaid", "rasterization failed: " +
        (error instanceof Error ? error.message : String(error)));
    }
    const drawing = await renderDiagramText(fence.source);
    diagramBlocks.push(drawing
      ? codeBlock("diagram", drawing)
      : codeBlock("mermaid-source", fence.source));
  }

  const localImages = await readTourImages(root, source, { missingIsProblem: true });
  if (localImages.problems.length > 0) fail("image", localImages.problems[0]);
  try {
    const rendered = await renderDescription(
      withDiagramBlocks(source, fences, diagramBlocks), "dark", {
        resolveImageBytes: imagePath => localImages.images.get(imagePath)
      });
    if (/⚠️ The Mermaid diagram|⚠️ The referenced image/.test(rendered)) {
      fail("rich content", "the shared renderer reported unsupported content");
    }
    return renderMarkdownToHtml(rendered);
  } catch (error) {
    if (error instanceof TerminalStepRenderError) throw error;
    return fail("rich content", error instanceof Error ? error.message : String(error));
  }
}

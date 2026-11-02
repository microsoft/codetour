import { isMermaidFenceInfo, matchDiagramCaption } from "./rules";

const FENCE_INFO_PATTERN = /^\s*```(.*)$/;
const FENCE_CLOSE_PATTERN = /^\s*```[ \t]*$/;
const FENCE_OPEN_PATTERN = /^\s*```/;

const MERMAID_FENCE_MARKER = "```mermaid";

export function containsMermaidFenceMarker(description: string): boolean {
  return description.includes(MERMAID_FENCE_MARKER);
}

export function isMermaidFenceLine(line: string): boolean {
  const infoMatch = line.match(FENCE_INFO_PATTERN);
  return !!infoMatch && isMermaidFenceInfo(infoMatch[1]);
}

export interface DiagramFence {
  caption?: string;
  source: string;
  closed: boolean;
  start: number;
  end: number;
}

export function findCaptionCandidateLine(
  text: string,
  fenceStart: number
): string | undefined {
  const lines = text.slice(0, fenceStart).split("\n");
  for (let index = lines.length - 1; index >= 0; index--) {
    if (lines[index].trim() === "") {
      continue;
    }
    return lines[index];
  }
  return undefined;
}

function findCaption(
  description: string,
  fenceStart: number
): string | undefined {
  const candidateLine = findCaptionCandidateLine(description, fenceStart);
  return candidateLine === undefined
    ? undefined
    : matchDiagramCaption(candidateLine);
}

export function findDiagramFences(description: string): DiagramFence[] {
  const lines = description.split("\n");
  const lineOffsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineOffsets.push(offset);
    offset += line.length + 1;
  }

  const fences: DiagramFence[] = [];

  let index = 0;
  while (index < lines.length) {
    if (!FENCE_OPEN_PATTERN.test(lines[index])) {
      index++;
      continue;
    }

    let closeIndex = -1;
    for (let candidate = index + 1; candidate < lines.length; candidate++) {
      if (FENCE_CLOSE_PATTERN.test(lines[candidate])) {
        closeIndex = candidate;
        break;
      }
    }

    if (closeIndex === -1) {
      if (isMermaidFenceLine(lines[index])) {
        fences.push({
          caption: findCaption(description, lineOffsets[index]),
          source: lines.slice(index + 1).join("\n"),
          closed: false,
          start: lineOffsets[index],
          end: description.length
        });
      }
      break;
    }

    if (isMermaidFenceLine(lines[index])) {
      fences.push({
        caption: findCaption(description, lineOffsets[index]),
        source: lines.slice(index + 1, closeIndex).join("\n"),
        closed: true,
        start: lineOffsets[index],
        end: lineOffsets[closeIndex] + lines[closeIndex].length
      });
    }

    index = closeIndex + 1;
  }

  return fences;
}

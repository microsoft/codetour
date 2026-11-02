// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ColorThemeKind, Uri, window, workspace } from "vscode";
import {
  DescriptionRenderOptions,
  DescriptionTheme,
  renderDescription
} from "codetour-description-renderer";
import { CodeTour, store } from "../store";
import { getTourTitle } from "../utils";
import { appendInsertCodeLinks } from "./insertCode";
import { spaceDescriptionImages, spaceDescriptionLists } from "./readability";

const SHELL_SCRIPT_PATTERN = /^>>\s+(?<script>.*)$/gm;

const COMMAND_PATTERN =
  /(?<commandPrefix>\(command:[\w+\.]+\?)(?<params>\[[^\]\)]+\])/gm;

const TOUR_REFERENCE_PATTERN =
  /(?:\[(?<linkTitle>[^\]]+)\])?\[(?=\s*[^\]\s])(?<tourTitle>[^\]#]+)?(?:#(?<stepNumber>\d+))?\](?!\()/gm;
const FILE_REFERENCE_PATTERN = /(\!)?(\[[^\]]+\]\()(\.[^\)]+)(?=\))/gm;

export interface PreviewDescriptionContext {
  tour?: CodeTour;
  tours?: CodeTour[];
  workspaceRoot?: Uri;
}

function resolvePreviewWorkspaceUri(
  context: PreviewDescriptionContext
): Uri | undefined {
  const activeTour = context.tour || store.activeTour?.tour;
  return (
    context.workspaceRoot ||
    (activeTour
      ? workspace.getWorkspaceFolder(Uri.parse(activeTour.id))?.uri
      : undefined)
  );
}

/**
 * Supplies local image bytes to the renderer through its render seam so
 * images inline as data URIs; references that leave the workspace, or files
 * the host cannot read, render as a compact warning instead.
 */
function createDescriptionRenderOptions(
  context: PreviewDescriptionContext
): DescriptionRenderOptions {
  const workspaceUri = resolvePreviewWorkspaceUri(context);
  if (!workspaceUri) {
    return {};
  }

  return {
    resolveImageBytes: async path => {
      if (path.startsWith("/") || path.split(/[\\/]/).includes("..")) {
        return undefined;
      }
      try {
        return await workspace.fs.readFile(Uri.joinPath(workspaceUri, path));
      } catch {
        return undefined;
      }
    }
  };
}

export function getDescriptionTheme(): DescriptionTheme {
  const kind = window.activeColorTheme.kind;
  return kind === ColorThemeKind.Dark || kind === ColorThemeKind.HighContrast
    ? "dark"
    : "light";
}

export function generatePreviewContent(
  content: string,
  context: PreviewDescriptionContext = {}
) {
  const transformed = content
    .replace(SHELL_SCRIPT_PATTERN, (_, script) => {
      const args = encodeURIComponent(JSON.stringify([script]));
      const s = `> [${script}](command:codetourIA.sendTextToTerminal?${args} "Run \\"${script.replace(
        /"/g,
        "'"
      )}\\" in a terminal")`;
      return s;
    })
    .replace(COMMAND_PATTERN, (_, commandPrefix, params) => {
      const args = encodeURIComponent(JSON.stringify(JSON.parse(params)));
      return `${commandPrefix}${args}`;
    })
    .replace(FILE_REFERENCE_PATTERN, (_, isImage, prefix, filePath) => {
      const workspaceUri = resolvePreviewWorkspaceUri(context);

      if (!workspaceUri) {
        return _;
      }

      const fileUri = Uri.joinPath(workspaceUri, filePath);

      if (isImage) {
        return `!${prefix}${fileUri.toString()}`;
      } else {
        const args = encodeURIComponent(JSON.stringify([fileUri]));
        return `${prefix}command:vscode.open?${args} "Open ${filePath}"`;
      }
    })
    .replace(TOUR_REFERENCE_PATTERN, (_, linkTitle, tourTitle, stepNumber) => {
      if (!tourTitle) {
        const title = linkTitle || `#${stepNumber}`;
        return `[${title}](command:codetourIA.navigateToStep?${stepNumber} "Navigate to step #${stepNumber}")`;
      }

      const tours = context.tours || store.activeTour?.tours || store.tours;
      const tour = tours.find(tour => getTourTitle(tour) === tourTitle);
      if (tour) {
        const args: [string, number?] = [tour.title];

        if (stepNumber) {
          args.push(Number(stepNumber));
        }
        const argsContent = encodeURIComponent(JSON.stringify(args));
        const title = linkTitle || tour.title;
        return `[${title}](command:codetourIA.startTourByTitle?${argsContent} "Start \\"${tour.title}\\" tour")`;
      }

      return _;
    });

  return appendInsertCodeLinks(transformed);
}

/**
 * Produces the Markdown consumed by every playback surface. Mermaid rendering
 * and local image inlining must happen before preview transformations so the
 * source content cannot be mistaken for insertable code.
 */
export async function renderPreviewDescription(
  content: string,
  theme: DescriptionTheme = getDescriptionTheme(),
  context: PreviewDescriptionContext = {}
): Promise<string> {
  return spaceDescriptionLists(
    spaceDescriptionImages(
      generatePreviewContent(
        await renderDescription(
          content,
          theme,
          createDescriptionRenderOptions(context)
        ),
        context
      )
    )
  );
}

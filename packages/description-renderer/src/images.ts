/**
 * Local image references are inlined as data URIs at render time so the tour
 * file stays portable and reading surfaces never need `file:` origins. The
 * package never touches the filesystem: the extension host supplies the image
 * bytes through the render seam.
 */

const URI_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/;

const LOCAL_IMAGE_PATTERN =
  /!\[([^\]]*(?:\[[^\]]*\][^\]]*)*)\]\(([^)]+)\)/g;

const FENCE_OPEN_PATTERN = /^\s*```/;

export const IMAGE_LOAD_FAILURE_NOTICE =
  "> ⚠️ The referenced image could not be loaded.";

/**
 * Resolves a local, workspace-relative image path to its bytes. Returns
 * nothing when the file is missing or unreadable so the renderer can show a
 * compact warning instead of failing the tour.
 */
export type ImageBytesResolver = (
  path: string
) => Promise<Uint8Array | undefined> | Uint8Array | undefined;

/**
 * The image format a Markdown reading surface receives. Native comments
 * require PNG (ADR 0007); a real HTML surface can embed the sanitized SVG
 * instead, which stays sharp at every zoom level and on Retina displays.
 */
export type DiagramImageFormat = "png" | "svg";

export interface DescriptionRenderOptions {
  resolveImageBytes?: ImageBytesResolver;
  diagramFormat?: DiagramImageFormat;
}

export interface ImageReference {
  alt: string;
  path: string;
  start: number;
  end: number;
}

function isLocalReference(path: string): boolean {
  return path !== "" && !path.startsWith("#") && !URI_SCHEME_PATTERN.test(path);
}

function findImageReferencesOutsideFences(
  lines: string[],
  offsets: number[]
): ImageReference[] {
  const references: ImageReference[] = [];

  let insideFence = false;
  lines.forEach((line, index) => {
    if (FENCE_OPEN_PATTERN.test(line)) {
      insideFence = !insideFence;
      return;
    }
    if (insideFence) {
      return;
    }

    for (const match of line.matchAll(LOCAL_IMAGE_PATTERN)) {
      const [text, alt, rawPath] = match;
      const path = rawPath.trim();
      if (!isLocalReference(path)) {
        continue;
      }
      references.push({
        alt,
        path,
        start: offsets[index] + match.index!,
        end: offsets[index] + match.index! + text.length
      });
    }
  });

  return references;
}

export function findLocalImageReferences(description: string): ImageReference[] {
  const lines = description.split("\n");
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  return findImageReferencesOutsideFences(lines, offsets);
}

export function imageMimeType(
  bytes: Uint8Array
): "image/png" | "image/jpeg" | undefined {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  return undefined;
}

// Shared with the Mermaid caption replacement: both produce Markdown image
// alt text, where raw brackets could break out of the construct.
export function escapeAltText(alt: string): string {
  return alt.replace(/([\[\]])/g, "\\$1");
}

/**
 * Replaces every local image reference with an inlined data URI, or with a
 * compact warning when the host cannot supply displayable PNG/JPEG bytes.
 */
export async function inlineLocalImages(
  content: string,
  resolveImageBytes: ImageBytesResolver
): Promise<string> {
  const references = findLocalImageReferences(content);
  if (references.length === 0) {
    return content;
  }

  const replacements: { start: number; end: number; text: string }[] = [];
  for (const reference of references) {
    let replacement = IMAGE_LOAD_FAILURE_NOTICE;
    try {
      const bytes = await resolveImageBytes(reference.path);
      const mimeType = bytes ? imageMimeType(bytes) : undefined;
      if (bytes && mimeType) {
        replacement = `![${escapeAltText(reference.alt)}](data:${mimeType};base64,${Buffer.from(
          bytes
        ).toString("base64")})`;
      }
    } catch {
      replacement = IMAGE_LOAD_FAILURE_NOTICE;
    }
    replacements.push({ start: reference.start, end: reference.end, text: replacement });
  }

  let inlined = content;
  for (const replacement of replacements.reverse()) {
    inlined =
      inlined.slice(0, replacement.start) +
      replacement.text +
      inlined.slice(replacement.end);
  }

  return inlined;
}

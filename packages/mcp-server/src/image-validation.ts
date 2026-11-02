import * as fs from "fs";
import * as path from "path";
import { findLocalImageReferences, imageMimeType } from "codetour-description-renderer";
import { normalizeSlashes } from "./git";
import { Issue, WorkspaceContext } from "./types";

// Local images follow the geographic split of ADR 0023: images created for a
// Tour (Tour Images) live under .tours/images/<tour-name>/, while images that
// belong to the codebase (Project Images) stay wherever they are and may only
// be referenced, never created, by generation. The MCP server only verifies; it
// never writes or deletes image files.
const TOUR_IMAGES_DIRECTORY = ".tours/images";

// Per-image size limit: image bytes are inlined into descriptions at read
// time, so a large file would slow every reading surface down.
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

// How many leading bytes decide the image type: PNG needs 8, JPEG 3.
const MAGIC_BYTES = 8;

// Storage and validation rules for local images, stated at the point of use so
// the agent complies before calling (the server only verifies; it never
// writes or deletes image files).
export const IMAGE_TOOL_GUIDANCE =
  "Images: embed them with Markdown image syntax, `![caption](relative/path.png)`, " +
  "with a path relative to the workspace root; ordinary links remain HTTPS-only, and " +
  "https: and data: images keep their usual behavior. " +
  "Write image files you create for this tour under .tours/images/<tour-name>/ — where " +
  "<tour-name> is this tour's fileName without the .tour suffix (project or changes for " +
  "the reserved tours) — and organize files freely inside it. " +
  "Never reference another tour's image directory, and reference images elsewhere in the " +
  "workspace only when they already exist. " +
  "Every local image must exist on disk, be a PNG or JPEG verified by its content (SVG and " +
  "other formats are rejected), and be at most 2 MB; a failing reference rejects the tour " +
  "with the offending path.";

// The directory a Tour owns its images in: the fileName without the `.tour`
// suffix, with the reserved Tours mapping to `project` and `changes`.
export function tourImageDirectoryName(
  defaultName: "project" | "changes",
  fileName?: string
): string {
  return fileName === undefined || fileName === ""
    ? defaultName
    : fileName.replace(/\.tour$/, "");
}

// Resolve the reference against the workspace root and report the first rule
// it violates. The message names the exact offending reference so the agent
// can fix it without guessing.
function imageReferenceIssue(
  url: string,
  ctx: WorkspaceContext,
  tourName: string
): string | undefined {
  if (url.includes("\0")) {
    return "must be a relative path without NUL characters";
  }
  if (path.isAbsolute(url) || path.win32.isAbsolute(url)) {
    return "must be a path relative to the workspace root";
  }
  const normalized = path.posix.normalize(normalizeSlashes(url));
  if (normalized === ".." || normalized.startsWith("../")) {
    return "resolves outside the workspace root";
  }
  // Tour Images belong to their Tour: a reference may point into the current
  // Tour's image directory (the agent may have just written the file) or at
  // a Project Image elsewhere in the workspace, never into another Tour's
  // image directory.
  const ownImagesDirectory = `${TOUR_IMAGES_DIRECTORY}/${tourName}`;
  const inTourImages =
    normalized === TOUR_IMAGES_DIRECTORY ||
    normalized.startsWith(`${TOUR_IMAGES_DIRECTORY}/`);
  const inOwnImagesDirectory =
    normalized === ownImagesDirectory ||
    normalized.startsWith(`${ownImagesDirectory}/`);
  if (inTourImages && !inOwnImagesDirectory) {
    return "points into the image directory of another tour; images created for this tour must be stored under " +
      `${ownImagesDirectory}/`;
  }
  const target = path.resolve(ctx.root, normalized);
  let realPath: string;
  try {
    realPath = fs.realpathSync(target);
  } catch {
    return "does not exist in the workspace";
  }
  const relative = path.relative(ctx.realRoot, realPath);
  if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return "resolves outside the workspace root (symlinks escaping the workspace are not allowed)";
  }
  if (!fs.statSync(realPath).isFile()) {
    return "is not a file";
  }
  // Content is verified by magic bytes, never by extension: a lying extension
  // must not let hostile or accidental content reach the reading surfaces.
  // SVG is rejected with them, because unlike Mermaid it is not sanitized
  // upstream (see ADR 0023).
  if (!isPngOrJpeg(realPath)) {
    return "is not a PNG or JPEG image; content is verified by magic bytes and SVG is rejected";
  }
  const size = fs.statSync(realPath).size;
  if (size > MAX_IMAGE_BYTES) {
    return `is ${size} bytes; the limit is ${MAX_IMAGE_BYTES} bytes (2 MB)`;
  }
  return undefined;
}

// The same magic-byte decision the description-renderer applies when the
// player inlines image bytes, read from the file's first bytes.
function isPngOrJpeg(realPath: string): boolean {
  const header = Buffer.alloc(MAGIC_BYTES);
  const fd = fs.openSync(realPath, "r");
  try {
    fs.readSync(fd, header, 0, header.length, 0);
    return imageMimeType(header) !== undefined;
  } finally {
    fs.closeSync(fd);
  }
}

// Scan every description the server validates (the Tour-level description and
// each step description) for local image references, mirroring the Mermaid
// scan: all failures aggregate into one INVALID_PROPOSAL response.
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateImageDescriptions(
  raw: unknown,
  ctx: WorkspaceContext,
  tourName: string
): Issue[] {
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
    // The renderer's own reference grammar decides what counts as a local
    // image, so a reference the player would inline is exactly a reference
    // validated here (code fences excluded, schemes skipped).
    const references = findLocalImageReferences(description.value);
    for (let index = 0; index < references.length; index++) {
      const url = references[index].path;
      const reason = imageReferenceIssue(url, ctx, tourName);
      if (reason !== undefined) {
        issues.push({
          path: `${description.path}.image[${index}]`,
          message: `the image reference "${url}" ${reason}`,
        });
      }
    }
  }
  return issues;
}

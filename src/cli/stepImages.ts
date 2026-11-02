import { readFile, realpath } from "node:fs/promises";
import * as path from "node:path";
import { findLocalImageReferences, imageMimeType } from "codetour-description-renderer";

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export interface TourImages {
  /** PNG/JPEG bytes keyed by the path written in the step description. */
  images: Map<string, Uint8Array>;
  /** One readable reason per reference a reading surface must report. */
  problems: string[];
}

export interface ReadTourImagesOptions {
  /**
   * Report an unreadable file as a problem. The terminal reader fails the
   * reached step; the HTML reader leaves the reference to the shared
   * renderer, which shows its compact warning instead.
   */
  missingIsProblem?: boolean;
}

/**
 * Reads the local PNG/JPEG files one step description references outside code
 * fences, resolved against the Tour workspace root. Paths escaping the
 * workspace, unsupported bytes and oversized files are always problems.
 */
export async function readTourImages(
  root: string,
  description: string,
  options: ReadTourImagesOptions = {}
): Promise<TourImages> {
  const images = new Map<string, Uint8Array>();
  const problems: string[] = [];
  // Resolve real paths once so local image references cannot escape the
  // workspace through symlinks, whatever surface reads the images.
  let realRoot: string;
  try {
    realRoot = await realpath(root);
  } catch (error) {
    return {
      images,
      problems: ["cannot read workspace root: " +
        (error instanceof Error ? error.message : String(error))]
    };
  }

  for (const reference of findLocalImageReferences(description)) {
    const imagePath = reference.path;
    if (path.isAbsolute(imagePath) || imagePath.split(/[\\/]/).includes("..")) {
      problems.push("unsafe path: " + imagePath);
      continue;
    }

    let bytes: Uint8Array;
    try {
      const image = await realpath(path.resolve(realRoot, imagePath));
      const relative = path.relative(realRoot, image);
      if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
        throw new Error("escapes the Tour workspace");
      }
      bytes = await readFile(image);
    } catch (error) {
      if (options.missingIsProblem) {
        problems.push("cannot read " + imagePath + ": " +
          (error instanceof Error ? error.message : String(error)));
      }
      continue;
    }

    if (!imageMimeType(bytes)) {
      problems.push("not a supported PNG/JPEG: " + imagePath);
      continue;
    }
    if (bytes.length > MAX_IMAGE_BYTES) {
      problems.push("exceeds 2 MB: " + imagePath);
      continue;
    }
    images.set(imagePath, bytes);
  }

  return { images, problems };
}

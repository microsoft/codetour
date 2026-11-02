import * as fs from "node:fs";
import * as path from "node:path";

// A real 1x1 transparent PNG (valid magic bytes and chunk structure).
export const TINY_PNG: Buffer = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

// A minimal JPEG: SOI, a JFIF APP0 segment, and EOI (valid magic bytes).
export const TINY_JPEG: Buffer = Buffer.from(
  "ffd8ffe000104a46494600010100004800480000ffd9",
  "hex"
);

export const SVG_IMAGE: Buffer = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>\n',
  "utf8"
);

// Bytes that are not an image at all, used behind a lying `.png` extension.
export const HTML_BYTES: Buffer = Buffer.from(
  "<html><body>not an image</body></html>\n",
  "utf8"
);

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

// One byte above the 2 MB limit the MCP server enforces per image file.
export function oversizedPng(): Buffer {
  const bytes = Buffer.alloc(2 * 1024 * 1024 + 1);
  PNG_SIGNATURE.copy(bytes, 0);
  return bytes;
}

export function writeImageFile(
  workspaceRoot: string,
  relativePath: string,
  bytes: Buffer
): void {
  const target = path.join(workspaceRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
}

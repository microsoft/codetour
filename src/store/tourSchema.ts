// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * The single source of truth for the on-disk `.tour` file format. The editor
 * keeps `schema.json` for authoring-time validation, but the runtime types
 * derive from these schemas so the two cannot silently diverge (the hand
 * written interfaces had already drifted from `schema.json`).
 *
 * Unknown properties are preserved (`looseObject`) exactly like the raw
 * `JSON.parse` the loader used, so fields this extension does not know about
 * survive a round trip through discovery and a later save.
 */
import { z } from "zod";

/** Full commit SHA of a persisted Git snapshot (Changes Tour diffs). */
const COMMIT_SHA = /^[0-9a-f]{40}$/;

export const CodeTourStepPositionSchema = z.object({
  line: z.number(),
  character: z.number()
});

export const CodeTourStepSchema = z.looseObject({
  title: z.string().optional(),
  // Recorded and hand-written tours omit the description on some steps; the
  // reading surfaces already render the empty description, so missing becomes
  // empty instead of invalid.
  description: z.string().default(""),
  questions: z.array(z.string().min(1).regex(/\S/)).max(4).optional(),
  icon: z.string().optional(),

  // A step guides the reader to a single type of destination: a file,
  // a directory, virtual content, a resource, or a VS Code view.
  file: z.string().optional(),
  baseFile: z.string().min(1).optional(),
  display: z.literal("diff").optional(),
  directory: z.string().optional(),
  contents: z.string().optional(),
  uri: z.string().optional(),
  view: z.string().min(1).optional(),

  // Line and selection narrow the region to show inside a file. Without a
  // position, the step is presented as an explanation of the whole file.
  line: z.number().optional(),
  selection: z
    .object({
      start: CodeTourStepPositionSchema,
      end: CodeTourStepPositionSchema
    })
    .optional(),

  commands: z.array(z.string()).optional(),

  pattern: z.string().optional(),
  markerTitle: z.string().optional()
});

export const TourFileSchema = z.looseObject({
  title: z.string(),
  description: z.string().optional(),
  steps: z.array(CodeTourStepSchema),
  ref: z.string().optional(),
  baseRef: z.string().regex(COMMIT_SHA).optional(),
  isPrimary: z.boolean().optional(),
  nextTour: z.string().optional(),
  stepMarker: z.string().optional(),
  when: z.string().optional()
});

export type CodeTourStepPosition = z.infer<typeof CodeTourStepPositionSchema>;
export type CodeTourStep = z.infer<typeof CodeTourStepSchema>;
/** The contents of a `.tour` file, before the host assigns its identity. */
export type TourFile = z.infer<typeof TourFileSchema>;
/** A loaded tour: the file plus the discovery-assigned id. */
export type CodeTour = TourFile & { id: string };

/**
 * Parses and validates the contents of a `.tour` file. Throws on content that
 * is not valid JSON or does not match the format, with the offending paths in
 * the error, so callers that surface errors can point at the actual problem.
 */
export function parseTourFile(contents: string): TourFile {
  return TourFileSchema.parse(JSON.parse(contents));
}

/**
 * A loaded tour: the file's contents with the identity the host assigns on
 * load (a URI for the extension, a file URL for the standalone reader).
 */
export function loadTour(contents: string, id: string): CodeTour {
  return Object.assign(parseTourFile(contents), { id });
}

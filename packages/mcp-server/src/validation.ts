import * as fs from "fs";
import * as path from "path";
import safeRegex from "safe-regex2";
import {
  ChangesParams,
  Issue,
  Position,
  ProjectParams,
  Selection,
  TourStep,
  WorkspaceContext,
} from "./types";

// Deterministic validation engine for Tour proposals.
//
// Every detected error is aggregated in an `Issue` list (path plus message)
// before responding, so the agent can correct the proposal in one cycle. A
// step may be purely explanatory (without a Tour Anchor); when it has a
// locator, that locator is validated against the real workspace state
// (existence, line and selection bounds, pattern uniqueness, and symlink
// confinement to the configured root).

export const STEP_FIELDS = [
  "title",
  "description",
  "file",
  "directory",
  "line",
  "pattern",
  "selection",
] as const;

export const MAX_RECOMMENDED_STEPS = 15;

// Cap the length of agent-supplied anchor patterns: a hand-crafted regular
// expression can hang the server process through catastrophic backtracking
// when matched against an entire file, so only short, focused patterns are
// accepted.
export const MAX_PATTERN_LENGTH = 200;

// Reject active URI schemes in Markdown: a generated description must not be
// able to trigger an action in the editor or terminal.
const FORBIDDEN_URI_SCHEME =
  /(?:command|file|vscode|vscode-insiders|javascript):/i;

const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/;

type RawObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is RawObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isOptionalString(
  raw: RawObject,
  key: string,
  errorPath: string,
  issues: Issue[]
): string | undefined {
  const value = raw[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    issues.push({ path: errorPath, message: "must be a string" });
    return undefined;
  }
  return value;
}

function reportUnknownFields(
  raw: RawObject,
  allowed: readonly string[],
  errorPath: string,
  issues: Issue[]
): void {
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) {
      issues.push({
        path: errorPath === "$" ? key : `${errorPath}.${key}`,
        message:
          "unknown field (V1 tours only allow title, description, file, directory, line, pattern and selection)",
      });
    }
  }
}

const PROJECT_PARAM_FIELDS = ["title", "description", "steps"] as const;
const CHANGES_PARAM_FIELDS = [
  "title",
  "description",
  "steps",
  "baseRef",
  "headRef",
  "includeUncommittedChanges",
] as const;

export function validateProjectParams(
  raw: unknown
): { params?: ProjectParams; issues: Issue[] } {
  const issues: Issue[] = [];
  if (!isPlainObject(raw)) {
    issues.push({ path: "$", message: "the arguments must be an object" });
    return { issues };
  }
  // The V1 input schema is strict: unknown fields are rejected, including
  // `when`, `commands`, `uri`, and V2 capabilities.
  reportUnknownFields(raw, PROJECT_PARAM_FIELDS, "$", issues);
  const params = validateCommonParams(raw, issues);
  return { params, issues };
}

export function validateChangesParams(
  raw: unknown
): { params?: ChangesParams; issues: Issue[] } {
  const issues: Issue[] = [];
  if (!isPlainObject(raw)) {
    issues.push({ path: "$", message: "the arguments must be an object" });
    return { issues };
  }
  reportUnknownFields(raw, CHANGES_PARAM_FIELDS, "$", issues);
  const params = validateCommonParams(raw, issues) as ChangesParams;
  if (typeof raw.baseRef !== "string" || raw.baseRef.trim() === "") {
    issues.push({ path: "baseRef", message: "is required and must be a non-empty string" });
  } else if (raw.baseRef.startsWith("-")) {
    issues.push({
      path: "baseRef",
      message: "must be a branch, tag, or commit SHA and must not start with '-'",
    });
  } else {
    params.baseRef = raw.baseRef;
  }
  if (typeof raw.headRef !== "string") {
    issues.push({ path: "headRef", message: "is required and must be the full 40-character commit SHA" });
  } else if (!FULL_SHA_PATTERN.test(raw.headRef)) {
    issues.push({ path: "headRef", message: "must be the full 40-character commit SHA" });
  } else {
    params.headRef = raw.headRef;
  }
  if (raw.includeUncommittedChanges !== undefined) {
    if (typeof raw.includeUncommittedChanges !== "boolean") {
      issues.push({ path: "includeUncommittedChanges", message: "must be a boolean" });
    } else {
      params.includeUncommittedChanges = raw.includeUncommittedChanges;
    }
  }
  return { params, issues };
}

// Fields shared by both tools: optional title, optional description (with
// active URI scheme filtering), and a required step list.
function validateCommonParams(raw: RawObject, issues: Issue[]): ProjectParams {
  const params: ProjectParams = {};
  const title = isOptionalString(raw, "title", "title", issues);
  if (title !== undefined) {
    params.title = title;
  }
  const description = isOptionalString(raw, "description", "description", issues);
  if (description !== undefined) {
    if (FORBIDDEN_URI_SCHEME.test(description)) {
      issues.push({
        path: "description",
        message:
          "contains a forbidden URI scheme (command:, file:, vscode:, vscode-insiders:, javascript:)",
      });
    }
    params.description = description;
  }
  if (raw.steps === undefined) {
    issues.push({ path: "steps", message: "is required" });
  } else if (!Array.isArray(raw.steps)) {
    issues.push({ path: "steps", message: "must be an array" });
  } else {
    params.steps = raw.steps;
  }
  return params;
}

export function validateSteps(
  rawSteps: unknown[],
  ctx: WorkspaceContext
): { steps?: TourStep[]; issues: Issue[] } {
  const allIssues: Issue[] = [];
  const steps: TourStep[] = [];
  for (let index = 0; index < rawSteps.length; index++) {
    const { step, issues } = validateStep(rawSteps[index], index, ctx);
    allIssues.push(...issues);
    if (step) {
      steps.push(step);
    }
  }
  if (allIssues.length > 0) {
    return { issues: allIssues };
  }
  return { steps, issues: [] };
}

// Validate each step against Tour Anchor rules:
// - at most one primary locator (file or directory);
// - line, pattern, and selection are valid only with a file;
// - line and pattern are mutually exclusive;
// - the pattern must identify exactly one occurrence in the file;
// - line and selection bounds are checked against the actual content.
function validateStep(
  raw: unknown,
  index: number,
  ctx: WorkspaceContext
): { step?: TourStep; issues: Issue[] } {
  const issues: Issue[] = [];
  const base = `steps[${index}]`;
  if (!isPlainObject(raw)) {
    issues.push({ path: base, message: "must be an object" });
    return { issues };
  }
  reportUnknownFields(raw, STEP_FIELDS, base, issues);

  const description = isOptionalString(raw, "description", `${base}.description`, issues);
  if (description === undefined && raw.description === undefined) {
    issues.push({ path: `${base}.description`, message: "is required and must be a string" });
  }

  const title = isOptionalString(raw, "title", `${base}.title`, issues);

  const file = isOptionalString(raw, "file", `${base}.file`, issues);
  const directory = isOptionalString(raw, "directory", `${base}.directory`, issues);

  if (file !== undefined && directory !== undefined) {
    issues.push({ path: base, message: "a step cannot have both a file and a directory" });
  }

  let line: number | undefined;
  if (raw.line !== undefined) {
    if (!isPositiveInteger(raw.line)) {
      issues.push({ path: `${base}.line`, message: "must be a positive integer" });
    } else {
      line = raw.line;
    }
    if (file === undefined) {
      issues.push({ path: `${base}.line`, message: "is only valid together with a file" });
    }
  }

  let pattern: string | undefined;
  if (raw.pattern !== undefined) {
    if (typeof raw.pattern !== "string") {
      issues.push({ path: `${base}.pattern`, message: "must be a string" });
    } else if (raw.pattern.length > MAX_PATTERN_LENGTH) {
      issues.push({
        path: `${base}.pattern`,
        message: `must be at most ${MAX_PATTERN_LENGTH} characters long (concise patterns are also more resistant to accidental edits in the anchored file)`,
      });
    } else {
      pattern = raw.pattern;
    }
    if (file === undefined) {
      issues.push({ path: `${base}.pattern`, message: "is only valid together with a file" });
    }
  }

  if (line !== undefined && pattern !== undefined) {
    issues.push({ path: base, message: "line and pattern are mutually exclusive" });
  }

  let selection: Selection | undefined;
  if (raw.selection !== undefined) {
    selection = validateSelection(raw.selection, `${base}.selection`, issues);
    if (file === undefined) {
      issues.push({ path: `${base}.selection`, message: "is only valid together with a file" });
    }
  }

  // Step Markdown may contain only ordinary HTTPS links and images; active
  // schemes are rejected.
  if (description !== undefined && FORBIDDEN_URI_SCHEME.test(description)) {
    issues.push({
      path: `${base}.description`,
      message:
        "contains a forbidden URI scheme (command:, file:, vscode:, vscode-insiders:, javascript:)",
    });
  }

  // Resolve the anchor's real path: read only after checking confinement to the
  // workspace.
  let fileContent: string | undefined;
  let fileAnchorOk = true;
  if (file !== undefined) {
    const anchor = checkAnchor(ctx, file, "file", `${base}.file`, issues);
    if (anchor.ok && anchor.realPath !== undefined) {
      try {
        fileContent = fs.readFileSync(anchor.realPath, "utf8");
      } catch {
        issues.push({ path: `${base}.file`, message: "could not be read" });
      }
    }
    fileAnchorOk = anchor.ok;
  }
  if (directory !== undefined) {
    checkAnchor(ctx, directory, "directory", `${base}.directory`, issues);
  }

  if (fileContent === undefined && !fileAnchorOk) {
    for (const field of ["line", "pattern", "selection"] as const) {
      if (raw[field] !== undefined) {
        issues.push({
          path: `${base}.${field}`,
          message: "cannot be validated because the file anchor is invalid",
        });
      }
    }
  }

  if (line !== undefined && fileContent !== undefined) {
    const lineCount = fileContent.split("\n").length;
    if (line > lineCount) {
      issues.push({
        path: `${base}.line`,
        message: `is out of range: the file has ${lineCount} line(s)`,
      });
    }
  }

  if (pattern !== undefined && fileContent !== undefined) {
    let regex: RegExp;
    try {
      regex = new RegExp(pattern);
    } catch (error) {
      issues.push({
        path: `${base}.pattern`,
        message: `is not a valid regular expression: ${(error as Error).message}`,
      });
      regex = undefined as unknown as RegExp;
    }
    if (regex) {
      if (!safeRegex(regex)) {
        issues.push({
          path: `${base}.pattern`,
          message: "may cause excessive backtracking and is not allowed",
        });
      } else {
        const matches = fileContent.match(new RegExp(regex.source, "g")) ?? [];
        if (matches.length !== 1) {
          issues.push({
            path: `${base}.pattern`,
            message: `must match exactly one occurrence in the file (matched ${matches.length})`,
          });
        }
      }
    }
  }

  if (selection && fileContent !== undefined) {
    validateSelectionBounds(selection, fileContent, base, issues);
  }

  if (issues.length > 0) {
    return { issues };
  }
  return {
    step: {
      title,
      description: description as string,
      file,
      directory,
      line,
      pattern,
      selection,
    },
    issues: [],
  };
}

function validateSelection(
  raw: unknown,
  base: string,
  issues: Issue[]
): Selection | undefined {
  if (!isPlainObject(raw)) {
    issues.push({ path: base, message: "must be an object with start and end" });
    return undefined;
  }
  reportUnknownFields(raw, ["start", "end"], base, issues);
  const start = validatePosition(raw.start, `${base}.start`, issues);
  const end = validatePosition(raw.end, `${base}.end`, issues);
  if (!start || !end) {
    return undefined;
  }
  if (
    start.line > end.line ||
    (start.line === end.line && start.character > end.character)
  ) {
    issues.push({ path: base, message: "the start position must be before the end position" });
    return undefined;
  }
  return { start, end };
}

function validatePosition(
  raw: unknown,
  base: string,
  issues: Issue[]
): Position | undefined {
  if (!isPlainObject(raw)) {
    issues.push({ path: base, message: "must be an object with line and character" });
    return undefined;
  }
  reportUnknownFields(raw, ["line", "character"], base, issues);
  let line: number | undefined;
  if (!isPositiveInteger(raw.line)) {
    issues.push({ path: `${base}.line`, message: "is required and must be a positive integer" });
  } else {
    line = raw.line;
  }
  let character: number | undefined;
  if (!isPositiveInteger(raw.character)) {
    issues.push({ path: `${base}.character`, message: "is required and must be a positive integer" });
  } else {
    character = raw.character;
  }
  if (line === undefined || character === undefined) {
    return undefined;
  }
  return { line, character };
}

function validateSelectionBounds(
  selection: Selection,
  fileContent: string,
  base: string,
  issues: Issue[]
): void {
  const lines = fileContent.split("\n");
  const maxLine = lines.length;
  if (selection.start.line > maxLine) {
    issues.push({
      path: `${base}.selection.start.line`,
      message: `is out of range: the file has ${maxLine} line(s)`,
    });
  } else {
    const maxCharacter = lines[selection.start.line - 1].length + 1;
    if (selection.start.character > maxCharacter) {
      issues.push({
        path: `${base}.selection.start.character`,
        message: `is out of range: line ${selection.start.line} has ${maxCharacter} character slot(s)`,
      });
    }
  }
  if (selection.end.line > maxLine) {
    issues.push({
      path: `${base}.selection.end.line`,
      message: `is out of range: the file has ${maxLine} line(s)`,
    });
  } else {
    const maxCharacter = lines[selection.end.line - 1].length + 1;
    if (selection.end.character > maxCharacter) {
      issues.push({
        path: `${base}.selection.end.character`,
        message: `is out of range: line ${selection.end.line} has ${maxCharacter} character slot(s)`,
      });
    }
  }
}

interface AnchorResult {
  ok: boolean;
  realPath?: string;
}

// Verify that a file or directory anchor exists and remains confined to the
// workspace: resolve its real path before reading, and reject symlinks that
// escape the configured root.
function checkAnchor(
  ctx: WorkspaceContext,
  value: string,
  kind: "file" | "directory",
  errorPath: string,
  issues: Issue[]
): AnchorResult {
  if (value.trim() === "") {
    issues.push({ path: errorPath, message: "must not be empty" });
    return { ok: false };
  }
  if (path.isAbsolute(value)) {
    issues.push({ path: errorPath, message: "must be relative to the workspace root" });
    return { ok: false };
  }
  const target = path.resolve(ctx.root, value);
  let realPath: string;
  try {
    realPath = fs.realpathSync(target);
  } catch {
    issues.push({ path: errorPath, message: "does not exist in the workspace" });
    return { ok: false };
  }
  const relative = path.relative(ctx.realRoot, realPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    issues.push({
      path: errorPath,
      message: "resolves outside the workspace root (symlinks escaping the workspace are not allowed)",
    });
    return { ok: false };
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(realPath);
  } catch {
    issues.push({ path: errorPath, message: "does not exist in the workspace" });
    return { ok: false };
  }
  if (kind === "file" && !stat.isFile()) {
    issues.push({ path: errorPath, message: "is not a file" });
    return { ok: false };
  }
  if (kind === "directory" && !stat.isDirectory()) {
    issues.push({ path: errorPath, message: "is not a directory" });
    return { ok: false };
  }
  return { ok: true, realPath };
}

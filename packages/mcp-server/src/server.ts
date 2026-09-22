import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createContext } from "./context";
import {
  changedFiles,
  committedDiffIsEmpty,
  currentBranchName,
  currentHeadSha,
  isGitRepository,
  mergeBase,
  normalizeSlashes,
  resolveCommit,
  uncommittedChanges,
  workspacePrefix,
} from "./git";
import { OutputPathError, writeTourAtomic } from "./persistence";
import { validateCodetourTour } from "./codetour-schema";
import {
  ErrorResult,
  Issue,
  SuccessResult,
  TourFile,
  TourStep,
  Warning,
  WorkspaceContext,
} from "./types";
import {
  MAX_RECOMMENDED_STEPS,
  validateChangesParams,
  validateProjectParams,
  validateSteps,
} from "./validation";
import packageJson from "../package.json";

// MCP V1 exposes exactly two tools: `create_project_tour` and
// `create_changes_tour`. The AI agent writes the content; the server only
// validates the proposal, applies Git and security rules, and atomically writes
// the corresponding reserved Tour file.
//
// Tool input schemas remain intentionally permissive (`z.unknown()` plus
// `.passthrough()`): the MCP SDK would reject arguments that do not match a
// strict schema itself, which would break the requirement to aggregate all
// validation errors into one response. Full field-by-field validation is
// therefore performed in validation.ts.

const CODETOUR_SCHEMA_URI = "https://aka.ms/codetour-schema";
const SERVER_NAME = "codetour-mcp";
const SERVER_VERSION = packageJson.version;

// Fixed destinations reserved for generated Tours. They are replaced only
// after complete validation and ignored while detecting a dirty workspace (see
// git.ts).
const PROJECT_TOUR_PATH = ".tours/project.tour";
const CHANGES_TOUR_PATH = ".tours/changes.tour";

const PROJECT_TOUR_DESCRIPTION =
  "Creates a CodeTour Project Tour that explains a codebase as a whole, persisted at " +
  ".tours/project.tour (replacing any previously generated tour of the same kind). " +
  "You provide the fully written content; the server only validates and persists it deterministically. " +
  "A good Project Tour ideally covers: the project's purpose, its main entry points, its important " +
  "components, and its main execution flows. " +
  "Arguments: an optional title (defaults to \"Project Overview\"), an optional description, and a " +
  "required non-empty steps array. Each step takes an optional title, a required Markdown description, " +
  "and at most one locator: a file or a directory (workspace-relative paths). A step may also target a " +
  "line, a unique stable pattern, or a selection, but only together with a file; line and pattern are " +
  "mutually exclusive. Prefer a unique stable pattern over a line number so the anchor resists file " +
  "evolution, and use a line only as a fallback. Steps without any locator are allowed for general " +
  "context. Every anchor is " +
  "validated against the real workspace state, and all validation errors are reported in a single " +
  "response. On failure, the previous tour file is preserved.";

const CHANGES_TOUR_DESCRIPTION =
  "Creates a CodeTour Changes Tour that explains the committed changes on the current branch since it " +
  "diverged from a base ref, persisted at .tours/changes.tour (replacing any previously generated tour " +
  "of the same kind). You provide the fully written content; the server only validates and persists it " +
  "deterministically. A good Changes Tour ideally covers: the intent of the changes, the major " +
  "modifications, their impact, and the relevant tests. An introductory step explaining the overall " +
  "intent should anchor the main directory of the changes (a step takes at most one locator: a file or " +
  "a directory, workspace-relative), so the reader sees where the work happened. " +
  "Arguments: baseRef (required Git ref), headRef (required full 40-character SHA of the analyzed commit, " +
  "which must equal the current HEAD), includeUncommittedChanges (optional boolean, default false), an optional " +
  "title (defaults to \"Changes on <branch>\"), an optional description, and a required non-empty steps " +
  "array. Steps follow the same rules as the Project Tour (prefer a unique stable pattern over a line " +
  "number); steps may anchor unchanged files when they " +
  "provide essential context, and deleted files must be explained with steps that have no locator. " +
  "Uncommitted changes are excluded by default and reported as a warning; pass includeUncommittedChanges to " +
  "include them explicitly. The description is automatically enriched with the base, merge-base and " +
  "head. On failure, the previous tour file is preserved.";

const warningSchema = z.object({
  code: z.string(),
  message: z.string(),
});
const issueSchema = z.object({
  path: z.string(),
  message: z.string(),
});
const toolResultSchema = z.object({
  status: z.enum(["created", "error"]),
  path: z.string().optional(),
  stepCount: z.number().int().nonnegative().optional(),
  warnings: z.array(warningSchema).optional(),
  code: z.string().optional(),
  message: z.string().optional(),
  issues: z.array(issueSchema).optional(),
});

const projectToolInputSchema = z
  .object({
    title: z.unknown().optional(),
    description: z.unknown().optional(),
    steps: z.unknown().optional(),
  })
  .passthrough();

const changesToolInputSchema = z
  .object({
    title: z.unknown().optional(),
    description: z.unknown().optional(),
    steps: z.unknown().optional(),
    baseRef: z.unknown().optional(),
    headRef: z.unknown().optional(),
    includeUncommittedChanges: z.unknown().optional(),
  })
  .passthrough();

export function createServer(workspaceRoot: string): McpServer {
  const ctx = createContext(workspaceRoot);
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } }
  );

  server.registerTool(
    "create_project_tour",
    {
      description: PROJECT_TOUR_DESCRIPTION,
      inputSchema: projectToolInputSchema,
      outputSchema: toolResultSchema,
    },
    (args) => handleCreateProjectTour(ctx, args)
  );

  server.registerTool(
    "create_changes_tour",
    {
      description: CHANGES_TOUR_DESCRIPTION,
      inputSchema: changesToolInputSchema,
      outputSchema: toolResultSchema,
    },
    (args) => handleCreateChangesTour(ctx, args)
  );

  return server;
}

// Create a Project Tour: no Git access is required, the tour works in any
// workspace, and it is never attached to a `ref` so it remains viewable as the
// project evolves.
async function handleCreateProjectTour(
  ctx: WorkspaceContext,
  args: unknown
): Promise<ToolResponse> {
  const rawSteps = extractSteps(args);
  if (rawSteps === undefined || (Array.isArray(rawSteps) && rawSteps.length === 0)) {
    return errorResponse("TOUR_STEPS_REQUIRED", "A tour requires at least one step.");
  }

  // Aggregate all validation errors (parameters and then steps) before
  // responding so the agent can correct the proposal in one cycle.
  const { params, issues: paramIssues } = validateProjectParams(args);
  const allIssues = [...paramIssues];
  let steps: TourStep[] | undefined;
  if (Array.isArray(rawSteps)) {
    const validated = validateSteps(rawSteps, ctx);
    steps = validated.steps;
    allIssues.push(...validated.issues);
  }
  if (!params || allIssues.length > 0) {
    return errorResponse(
      "INVALID_PROPOSAL",
      "The create_project_tour arguments are invalid.",
      allIssues
    );
  }
  const finalSteps = steps as TourStep[];

  const warnings = stepLimitWarnings(finalSteps);

  const tour: TourFile = {
    $schema: CODETOUR_SCHEMA_URI,
    title: params.title ?? "Project Overview",
    ...(params.description !== undefined ? { description: params.description } : {}),
    steps: finalSteps,
  };

  const writeFailure = await persistTour(ctx, PROJECT_TOUR_PATH, tour);
  if (writeFailure) {
    return writeFailure;
  }

  return successResponse(
    PROJECT_TOUR_PATH,
    finalSteps.length,
    warnings,
    `Created Project Tour at ${PROJECT_TOUR_PATH} with ${finalSteps.length} step(s).`
  );
}

// Create a Changes Tour: analyze committed changes from the merge-base of
// `baseRef` to `headRef`. `headRef` must be the full SHA of the current HEAD;
// otherwise generation fails with STALE_HEAD to avoid a stale explanation. By
// default only committed changes are included; `includeUncommittedChanges`
// enables explaining local work.
async function handleCreateChangesTour(
  ctx: WorkspaceContext,
  args: unknown
): Promise<ToolResponse> {
  const rawSteps = extractSteps(args);
  if (rawSteps === undefined || (Array.isArray(rawSteps) && rawSteps.length === 0)) {
    return errorResponse("TOUR_STEPS_REQUIRED", "A tour requires at least one step.");
  }

  // Use the same aggregation strategy as the Project Tour: collect all
  // validation errors before responding.
  const { params, issues: paramIssues } = validateChangesParams(args);
  const allIssues = [...paramIssues];
  let steps: TourStep[] | undefined;
  if (Array.isArray(rawSteps)) {
    const validated = validateSteps(rawSteps, ctx);
    steps = validated.steps;
    allIssues.push(...validated.issues);
  }
  if (!params || allIssues.length > 0) {
    return errorResponse(
      "INVALID_PROPOSAL",
      "The create_changes_tour arguments are invalid.",
      allIssues
    );
  }

  const baseRef = params.baseRef as string;
  const headRef = params.headRef as string;
  const includeUncommittedChanges = params.includeUncommittedChanges === true;

  // The Changes Tour depends on Git history and fails outside a repository.
  if (!(await isGitRepository(ctx))) {
    return errorResponse(
      "GIT_REPOSITORY_REQUIRED",
      "create_changes_tour requires a Git repository, but the workspace root is not inside one."
    );
  }

  // The analyzed SHA must exactly match the current HEAD; otherwise the
  // explanation might not correspond to the snapshot read again.
  const currentHead = await currentHeadSha(ctx);
  if (currentHead === null) {
    return errorResponse(
      "STALE_HEAD",
      "The repository has no commits, so there is no HEAD to analyze."
    );
  }
  if (headRef !== currentHead) {
    return errorResponse(
      "STALE_HEAD",
      `The provided headRef ${headRef} does not match the current HEAD (${currentHead}). The analysis is stale; re-run it against the current HEAD.`
    );
  }

  // Resolve the base reference to a full commit SHA up front: only a verified
  // SHA is ever passed as a positional Git argument, so an agent-supplied
  // string can never be interpreted as a Git option.
  const resolvedBaseSha = await resolveCommit(ctx, baseRef);
  if (resolvedBaseSha === null) {
    return errorResponse(
      "INVALID_BASE_REF",
      `Unable to resolve the base ref ${baseRef} to a commit in this repository.`
    );
  }

  let mergeBaseSha: string;
  try {
    mergeBaseSha = await mergeBase(ctx, resolvedBaseSha, headRef);
  } catch (error) {
    return errorResponse(
      "INVALID_BASE_REF",
      `Unable to compute the merge-base between ${baseRef} and ${headRef}: ${(error as Error).message}`
    );
  }

  // Without committed changes (and without included local work), return
  // NO_CHANGES and preserve the previous Changes Tour: an empty tour never
  // replaces a useful one.
  const uncommitted = await uncommittedChanges(ctx);
  if (
    (await committedDiffIsEmpty(ctx, mergeBaseSha, headRef)) &&
    (!includeUncommittedChanges || uncommitted.length === 0)
  ) {
    return errorResponse(
      "NO_CHANGES",
      `No committed changes between the merge-base of ${baseRef} (${mergeBaseSha}) and ${headRef}. The previous tour file was preserved.`
    );
  }

  // Uncommitted changes are excluded by default with a warning, or explicitly
  // included; in that case the Tour has no `ref` and reports that the result
  // describes a non-reproducible local state.
  const warnings: Warning[] = [];
  if (includeUncommittedChanges) {
    warnings.push({
      code: "UNCOMMITTED_CHANGES_INCLUDED",
      message:
        "Uncommitted changes were explicitly included; the tour describes a local state that is not reproducible from Git.",
    });
  } else if (uncommitted.length > 0) {
    warnings.push({
      code: "UNCOMMITTED_CHANGES_EXCLUDED",
      message: `${uncommitted.length} uncommitted change(s) were excluded from the analysis (staged, unstaged or untracked).`,
    });
  }

  const finalSteps = steps as TourStep[];
  const warningsFromStepLimit = stepLimitWarnings(finalSteps);
  warnings.push(...warningsFromStepLimit);

  // Set of changed files (committed, plus uncommitted files when
  // includeUncommittedChanges is active), used for the NO_CHANGED_FILE_ANCHOR
  // warning.
  const changedInWorkspace = await changedFilesInWorkspace(ctx, mergeBaseSha, headRef);
  if (includeUncommittedChanges) {
    for (const entry of uncommitted) {
      if (!changedInWorkspace.includes(entry.path)) {
        changedInWorkspace.push(entry.path);
      }
    }
  }
  if (
    changedInWorkspace.length > 0 &&
    !finalSteps.some(
      (step) =>
        step.file !== undefined &&
        changedInWorkspace.includes(normalizeSlashes(step.file))
    )
  ) {
    warnings.push({
      code: "NO_CHANGED_FILE_ANCHOR",
      message:
        "No step anchors a file modified by these changes; consider anchoring steps on changed files.",
    });
  }

  const title = params.title ?? (await defaultChangesTitle(ctx, headRef));
  // Enrich the description automatically with the provenance, base, and head
  // so the reader always knows the analyzed scope.
  const provenance = includeUncommittedChanges
    ? `Generated from the merge-base of \`${baseRef}\` (\`${mergeBaseSha}\`) to \`${headRef}\`, including uncommitted changes (non-reproducible local state).`
    : `Generated from the merge-base of \`${baseRef}\` (\`${mergeBaseSha}\`) to \`${headRef}\`.`;
  const description =
    params.description !== undefined
      ? `${params.description}\n\n${provenance}`
      : provenance;

  const tour: TourFile = {
    $schema: CODETOUR_SCHEMA_URI,
    title,
    description,
    ...(!includeUncommittedChanges ? { ref: headRef } : {}),
    steps: finalSteps,
  };

  // HEAD may advance during the Git reads above. Reading it again at the last
  // moment prevents stale analysis from replacing the previous Changes Tour.
  const headImmediatelyBeforePersistence = await currentHeadSha(ctx);
  if (headImmediatelyBeforePersistence !== headRef) {
    return errorResponse(
      "STALE_HEAD",
      headImmediatelyBeforePersistence === null
        ? "The repository no longer has a HEAD to persist this analysis against. The previous tour file was preserved."
        : `The provided head ${headRef} no longer matches the current HEAD (${headImmediatelyBeforePersistence}). The analysis became stale before persistence; re-run it against the current HEAD.`
    );
  }

  const writeFailure = await persistTour(ctx, CHANGES_TOUR_PATH, tour);
  if (writeFailure) {
    return writeFailure;
  }

  return successResponse(
    CHANGES_TOUR_PATH,
    finalSteps.length,
    warnings,
    `Created Changes Tour at ${CHANGES_TOUR_PATH} with ${finalSteps.length} step(s) for head ${headRef} (base ${baseRef}).`
  );
}

// Non-blocking warning when a Tour exceeds fifteen steps.
function stepLimitWarnings(steps: TourStep[]): Warning[] {
  if (steps.length <= MAX_RECOMMENDED_STEPS) {
    return [];
  }
  return [
    {
      code: "STEP_LIMIT_EXCEEDED",
      message: `The tour has ${steps.length} steps; the recommended maximum is ${MAX_RECOMMENDED_STEPS}.`,
    },
  ];
}

// Validate the generated Tour against the general CodeTour schema, then write
// it atomically. If validation fails, the previous file remains intact.
async function persistTour(
  ctx: WorkspaceContext,
  relativePath: string,
  tour: TourFile
): Promise<ToolResponse | null> {
  const schemaResult = validateCodetourTour(tour);
  if (!schemaResult) {
    return errorResponse(
      "SCHEMA_VALIDATION_FAILED",
      "The generated tour did not validate against the CodeTour schema.",
      []
    );
  }
  try {
    await writeTourAtomic(ctx, relativePath, serializeTour(tour));
  } catch (error) {
    if (error instanceof OutputPathError) {
      return errorResponse("OUTPUT_PATH_ESCAPES_WORKSPACE", error.message);
    }
    throw error;
  }
  return null;
}

function extractSteps(args: unknown): unknown {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return undefined;
  }
  return (args as Record<string, unknown>).steps;
}

// Files modified by the committed diff, converted to paths relative to the
// workspace (the workspace may be a repository subdirectory).
async function changedFilesInWorkspace(
  ctx: WorkspaceContext,
  mergeBaseSha: string,
  headRef: string
): Promise<string[]> {
  const files = await changedFiles(ctx, mergeBaseSha, headRef);
  const prefix = normalizeSlashes(await workspacePrefix(ctx));
  return files
    .map(normalizeSlashes)
    .filter((file) => file.startsWith(prefix))
    .map((file) => file.slice(prefix.length));
}

// Default Changes Tour title: "Changes on <branch>", falling back to the short
// SHA when HEAD is detached.
async function defaultChangesTitle(
  ctx: WorkspaceContext,
  headRef: string
): Promise<string> {
  const branch = await currentBranchName(ctx);
  if (branch && branch !== "HEAD") {
    return `Changes on ${branch}`;
  }
  return `Changes at ${headRef.slice(0, 7)}`;
}

function serializeTour(tour: TourFile): string {
  return JSON.stringify(tour, null, 2) + "\n";
}

interface ToolResponse {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  structuredContent: Record<string, unknown>;
  isError?: boolean;
}

function successResponse(
  relativePath: string,
  stepCount: number,
  warnings: Warning[],
  message: string
): ToolResponse {
  const result: SuccessResult = {
    status: "created",
    path: relativePath,
    stepCount,
    warnings,
  };
  const text = [
    message,
    ...warnings.map((warning) => `Warning (${warning.code}): ${warning.message}`),
  ].join("\n");
  return {
    content: [{ type: "text", text }],
    structuredContent: result as unknown as Record<string, unknown>,
  };
}

function errorResponse(
  code: string,
  message: string,
  issues?: Issue[]
): ToolResponse {
  const result: ErrorResult = {
    status: "error",
    code,
    message,
    ...(issues && issues.length > 0 ? { issues } : {}),
  };
  const text =
    issues && issues.length > 0
      ? `Error (${code}): ${message}\n` +
        issues.map((issue) => `- ${issue.path}: ${issue.message}`).join("\n")
      : `Error (${code}): ${message}`;
  return {
    content: [{ type: "text", text }],
    structuredContent: result as unknown as Record<string, unknown>,
    isError: true,
  };
}

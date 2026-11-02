import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as path from "path";
import { createContext, selectContext } from "./context";
import {
  changedFiles,
  committedDiffIsEmpty,
  currentBranchName,
  currentHeadSha,
  isGitRepository,
  mergeBase,
  normalizeSlashes,
  readCommitAnchors,
  renamedFiles,
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
  ValidatedResult,
  Warning,
  WorkspaceContext,
} from "./types";
import {
  MAX_RECOMMENDED_DIAGRAM_NODES,
  MAX_RECOMMENDED_STEPS,
  orientationStepWarnings,
  validateChangesParams,
  validateProjectParams,
  validateSteps,
} from "./validation";
import {
  MERMAID_TOOL_GUIDANCE,
  validateMermaidDescriptions,
} from "./mermaid-validation";
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

// A custom `fileName` is always confined to the `.tours` directory next to the
// reserved destinations; without one the reserved default applies.
function tourTargetPath(defaultPath: string, fileName?: string): string {
  return fileName === undefined ? defaultPath : `.tours/${fileName}`;
}

const MARKDOWN_WRITING_GUIDANCE =
  "Each step may include an optional questions array of at most four non-empty strings. " +
  "When useful, propose three or four concise questions specific to that step, in the same language as the user's request. " +
  "These appear as buttons that immediately send the question to the read-only ACP step conversation, " +
  "which answers in the language of the question asked and asks a clarifying question when it does not understand. " +
  "Write the Tour-level description and every step description as readable Markdown. " +
  "Split distinct ideas into short paragraphs separated by blank lines (`\n\n`), because " +
  "a single newline (`\n`) is a Markdown soft break and may render as a space. Use a short " +
  "heading when a description covers multiple topics, and use bullet or numbered lists " +
  "for collections, alternatives, or sequences. Use **bold** sparingly for important " +
  "concepts and backticks for code identifiers. Avoid dense monolithic paragraphs, and " +
  "aim for two or three sentences per paragraph. Separate top-level list items with " +
  "blank lines so they remain readable in the narrow editor comment panel. " +
  "keep each explanation concise and tied to the current Tour Anchor. Do not add " +
  "structure mechanically: a short, single-purpose description may remain one paragraph. ";

const PROJECT_TOUR_WORKFLOW_GUIDANCE =
  "Recommended workflow: (1) explore the codebase before writing — read the entry points and the " +
  "main modules, not just file names; (2) author the complete content yourself; (3) call this tool " +
  "once with dryRun true to rehearse the proposal: the complete validation runs and every issue is " +
  "reported, but nothing is written; (4) correct the reported issues; (5) call again with dryRun " +
  "omitted to persist the tour. Rehearse especially for large tours or unfamiliar workspaces. " +
  "What makes a useful Project Tour: orient the reader first (a directory or no-locator step on " +
  "where the work lives), then follow one coherent route — entry point, main components, how they " +
  "collaborate — rather than a flat file listing. Explain each step's role and why it matters, and " +
  "connect it to the surrounding flow instead of restating names or syntax. Anchor each claim at the " +
  "code that justifies it, preferring a short unique pattern over a line number so the anchor " +
  "survives edits. One step covers one idea; prefer several focused steps over one long paragraph. ";

const PROJECT_TOUR_ORIENTATION_GUIDANCE =
  "The first step must be an orientation step with an explicit title such as \"Overview\" " +
  "and no locator: omit both file and directory. Structure its description in this order: " +
  "(1) two or three sentences explaining what the system does and for whom; " +
  "(2) a Mermaid flowchart introduced by the exact caption **Diagram — Context view**, showing " +
  "the actors, the system under study, and external systems; every edge must state an interaction " +
  "verb and its mechanism, for example `Client --> API: places orders (HTTPS)`; " +
  "(3) a second Mermaid flowchart introduced by the exact caption **Diagram — Containers**, but only " +
  "when the project has more than one execution or storage boundary—otherwise omit it and never draw " +
  "a boundary that does not exist; (4) a short zone-to-workspace-directory mapping with relative " +
  "Markdown links to the relevant directories, connecting the map to the following steps. " +
  "Use these C4 meanings strictly: an Actor is a person in a role, with their need; a System is " +
  "software that delivers value to its users, and a repository is not automatically a system; an " +
  "External system is outside the described boundary, so explain the interaction rather than its " +
  "internals; a Container is an application or store with an execution or storage boundary, such as " +
  "a web app, CLI, worker, or database—it is not a Docker container. A directory, package, or import " +
  "alone never creates a boundary. Describe the existing design, not a proposed redesign. When code " +
  "evidence does not establish a boundary or relationship, state the uncertainty in the text instead " +
  "of inventing a box. In these diagrams, use one subgraph per container, verbal edge labels, no " +
  "decorative or meaningless arrows, and at most " +
  `${MAX_RECOMMENDED_DIAGRAM_NODES} nodes so they remain readable. `;

const CHANGES_TOUR_WORKFLOW_GUIDANCE =
  "Recommended workflow: (1) inspect the actual comparison before writing — the diff from the " +
  "merge-base to headRef, the affected source, and the tests — and base every statement on what " +
  "the code does, never on commit messages or file names alone; (2) call this tool with dryRun " +
  "true to rehearse: every check runs (HEAD match, base resolution, merge-base, anchors against " +
  "headRef, renames, Mermaid) and nothing is written; (3) correct the reported issues; (4) call " +
  "again with dryRun omitted to persist — if HEAD moved in between, re-read the comparison and " +
  "resubmit the new SHA with matching content. " +
  "What makes a useful Changes Tour: open with a directory step orienting the reader to where the " +
  "work happened; group related changes into one coherent review path; for each major change " +
  "explain what it does, how it is implemented, and its observable behavioral effect; anchor the " +
  "discussion at the changed lines; report test coverage factually and never claim tests passed " +
  "without having run them; explain deleted files with no-locator steps. ";

const PROJECT_TOUR_DESCRIPTION =
  "Create a CodeTour guided walkthrough for understanding a codebase. Use this tool for onboarding " +
  "or explaining the project's architecture and execution flows. Read the relevant source before " +
  "writing the tour; every explanation and anchor must be supported by the code. " +
  "Build a coherent route from the project's purpose and entry points through its key components " +
  "and how they collaborate. Choose representative files rather than listing every module. " +
  "Each step should explain the anchored code's role, why it matters, and its connection to the " +
  "surrounding flow; avoid merely restating names or syntax. Adapt the depth and step count to the " +
  "requested audience and scope. " +
  PROJECT_TOUR_WORKFLOW_GUIDANCE +
  PROJECT_TOUR_ORIENTATION_GUIDANCE +
  "Input: a required non-empty steps array, an optional title (default: \"Project Overview\"), an " +
  "optional description summarizing the tour, and an optional fileName: a bare file name (no path " +
  "separators) under which the tour is written inside .tours/, with the .tour suffix appended when " +
  "absent. Omit fileName to write the reserved .tours/project.tour. Each step requires a Markdown description and may " +
  "have a title. Use at most one locator per step: file or directory, relative to the workspace root. " +
  "Anchor code explanations to the relevant file and location; use a directory for structural " +
  "orientation, or no locator for general context. File steps may use line (1-based), pattern " +
  "(a regular expression matching exactly once in the file), or selection (start/end positions " +
  "with 1-based line and character). line and pattern are mutually exclusive. Prefer a short, " +
  "stable pattern when it identifies the intended code reliably; otherwise use a verified line. " +
  "Project Tours use ordinary file navigation and anchors are checked against the current workspace. " +
  "You author the complete content; the server validates it and atomically writes the tour file, " +
  "replacing the previous file at that destination only on success. Validation issues are returned together; " +
  "correct the reported issues before retrying. Failure preserves the previous tour. " +
  "Pass dryRun true to rehearse a complete proposal: the same validation runs (anchors, Mermaid, rules), " +
  "the response reports status \"validated\" with the same warnings, and no file is written even when " +
  "the proposal is valid. " +
  "Optional workspacePath selects a directory relative to the configured workspace root for this call. " +
  "All anchors and .tours paths are relative to that directory. It must remain inside the configured workspace. " +
  MARKDOWN_WRITING_GUIDANCE +
  MERMAID_TOOL_GUIDANCE;

const CHANGES_TOUR_DESCRIPTION =
  "Create a CodeTour guided review of the current branch's changes from the merge-base of a base " +
  "reference to an analyzed commit. Present the major changes, their implementation, observable " +
  "behavioral effects, and relevant tests factually. Describe intent only when supported by source " +
  "or supplied context. Do not give opinions on the changes, judge their quality, recommend " +
  "alternatives, or approve or reject them. Inspect the Git comparison and the affected source before " +
  "writing; explain the actual changes rather than inferring them from filenames or commit messages. " +
  "Organize steps into a coherent review path, grouping related changes and focusing on decisions " +
  "and behavior that help the reader understand the change set. Let review value determine the " +
  "step count: add steps when they clarify distinct changes, design decisions, behavioral impacts, " +
  "or test coverage, including multiple steps in the same file at different relevant locations. " +
  "Avoid redundant steps that repeat the same explanation. More than fifteen steps is allowed; " +
  "the server's step-count warning is advisory, so do not compress useful review guidance merely " +
  "to stay below it. An introductory directory step " +
  "can orient the reader to where the work happened. Anchor each code discussion at the relevant " +
  "changed lines in the analyzed head snapshot, so the tour comment appears beside the change. " +
  "Use unchanged code only when it supplies essential context. Do not claim tests passed without " +
  "verification; distinguish observed behavior from intended behavior. " +
  CHANGES_TOUR_WORKFLOW_GUIDANCE +
  "Input: baseRef (required Git reference), headRef (required full 40-character commit SHA equal to " +
  "the current HEAD), a required non-empty steps array, optional title (default: \"Changes on <branch>\"), " +
  "optional description, optional fileName, and includeUncommittedChanges (optional boolean, default false). " +
  "fileName is a bare file name (no path separators) under which the tour is written inside .tours/, " +
  "with the .tour suffix appended when absent; omit it to write the reserved .tours/changes.tour. " +
  "Each step requires a Markdown description and may have a title. Use at most one workspace-relative " +
  "locator: file or directory. File steps may use line (1-based), pattern (a regular expression " +
  "matching exactly once), or selection (start/end positions with 1-based line and character). " +
  "line and pattern are mutually exclusive. Prefer a short, stable pattern identifying the discussed " +
  "change; otherwise use a verified line in headRef. Explain deleted files with no-locator steps. " +
  "For committed-only tours, anchors are validated against headRef, the persisted baseRef is the " +
  "resolved merge-base SHA, and ref is headRef. The server marks file steps with display: \"diff\"; " +
  "directory and no-locator steps retain ordinary navigation. New files have an empty original side. " +
  "For renames, file names the head path and the server supplies baseFile for the original path. " +
  "Optional display accepts only \"diff\" and requires file; optional baseFile also requires file " +
  "and must match the detected rename for a committed-only tour. " +
  "Local changes are excluded by default and reported when present. Set includeUncommittedChanges " +
  "to true only when the requested scope includes them; inspect the local changes as well. When " +
  "local changes are actually included, anchors are checked against the workspace and the server " +
  "omits the commit pair and diff metadata: file steps open current files. If the workspace is " +
  "clean, the tour remains a committed comparison. If a saved diff's revisions or file become " +
  "unavailable, the reader falls back to the current file. " +
  "You author the complete content; the server validates it, adds comparison provenance to the " +
  "description, and atomically writes the tour file, replacing the previous file at that destination " +
  "only on success. Failure preserves it. Correct reported validation issues before retrying; if HEAD " +
  "changed, re-analyze the comparison and submit the new SHA with matching content. " +
  "Pass dryRun true to rehearse the proposal: the Git checks (HEAD match, base resolution, merge-base, " +
  "anchors against headRef) and the same validation still run, the response reports status \"validated\" " +
  "with the same warnings, and no file is written even when the proposal is valid. " +
  "Optional workspacePath selects a repository or subdirectory relative to the configured workspace root for this call. " +
  "All anchors and .tours paths are relative to that directory. It must remain inside the configured workspace. " +
  MARKDOWN_WRITING_GUIDANCE +
  MERMAID_TOOL_GUIDANCE;

const warningSchema = z.object({
  code: z.string(),
  message: z.string(),
});
const issueSchema = z.object({
  path: z.string(),
  message: z.string(),
});
const toolResultSchema = z.object({
  status: z.enum(["created", "error", "validated"]),
  path: z.string().optional(),
  stepCount: z.number().int().nonnegative().optional(),
  warnings: z.array(warningSchema).optional(),
  code: z.string().optional(),
  message: z.string().optional(),
  issues: z.array(issueSchema).optional(),
});

const projectToolInputSchema = z
  .object({
    workspacePath: z.unknown().optional(),
    title: z.unknown().optional(),
    description: z
      .unknown()
      .optional()
      .describe(
        "Optional readable Markdown overview; separate distinct ideas with blank lines between paragraphs."
      ),
    fileName: z
      .unknown()
      .optional()
      .describe(
        "Optional bare file name (no path separators) under which the tour is written inside .tours/; the .tour suffix is appended when absent."
      ),
    dryRun: z
      .unknown()
      .optional()
      .describe(
        "Validate the complete proposal (rules, anchors, Mermaid) without writing the tour file."
      ),
    steps: z
      .unknown()
      .optional()
      .describe(
        "Non-empty array whose descriptions use concise Markdown with blank lines between paragraphs."
      ),
  })
  .passthrough();

const changesToolInputSchema = z
  .object({
    workspacePath: z.unknown().optional(),
    title: z.unknown().optional(),
    description: z
      .unknown()
      .optional()
      .describe(
        "Optional readable Markdown overview; separate distinct ideas with blank lines between paragraphs."
      ),
    fileName: z
      .unknown()
      .optional()
      .describe(
        "Optional bare file name (no path separators) under which the tour is written inside .tours/; the .tour suffix is appended when absent."
      ),
    dryRun: z
      .unknown()
      .optional()
      .describe(
        "Validate the complete proposal (rules, anchors, Mermaid, Git checks) without writing the tour file."
      ),
    steps: z
      .unknown()
      .optional()
      .describe(
        "Non-empty array whose descriptions use concise Markdown with blank lines between paragraphs."
      ),
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
    (args) => safeToolCall(args, (input) => handleCreateProjectTour(ctx, input))
  );

  server.registerTool(
    "create_changes_tour",
    {
      description: CHANGES_TOUR_DESCRIPTION,
      inputSchema: changesToolInputSchema,
      outputSchema: toolResultSchema,
    },
    (args) => safeToolCall(args, (input) => handleCreateChangesTour(ctx, input))
  );

  return server;
}

// An unexpected exception escaping a handler surfaces as an MCP protocol
// error, whose payload many clients replace with a generic message. Reporting
// it as a structured error result instead keeps the diagnostic text in the
// tool response, in the same shape as every other failure.
function safeToolCall(
  args: unknown,
  handler: (args: unknown) => Promise<ToolResponse>
): Promise<ToolResponse> {
  return handler(args).catch((error: unknown) =>
    errorResponse(
      "INTERNAL_ERROR",
      `Unexpected server failure: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  );
}

// Create a Project Tour: no Git access is required, the tour works in any
// workspace, and it is never attached to a `ref` so it remains viewable as the
// project evolves.
async function handleCreateProjectTour(
  defaultContext: WorkspaceContext,
  args: unknown
): Promise<ToolResponse> {
  const rawSteps = extractSteps(args);
  // Aggregate all validation errors (parameters and then steps) before
  // responding so the agent can correct the proposal in one cycle.
  const { params, issues: paramIssues } = validateProjectParams(args);
  const mermaidIssues = await validateMermaidDescriptions(args);
  if (rawSteps === undefined || (Array.isArray(rawSteps) && rawSteps.length === 0)) {
    if (mermaidIssues.length === 0) {
      return errorResponse("TOUR_STEPS_REQUIRED", "A tour requires at least one step.");
    }
    return errorResponse(
      "INVALID_PROPOSAL",
      "The create_project_tour arguments are invalid.",
      [
        ...mermaidIssues,
        { path: "steps", message: "is required and must contain at least one step" }
      ]
    );
  }
  const selected = selectContext(defaultContext, params?.workspacePath);
  const ctx = selected.context ?? defaultContext;
  const allIssues = [...paramIssues, ...mermaidIssues, ...selected.issues];
  let steps: TourStep[] | undefined;
  if (Array.isArray(rawSteps)) {
    const validated = validateSteps(rawSteps, ctx,
      selected.context ? { kind: "workspace" } : { kind: "structure" });
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

  const warnings = [
    ...stepLimitWarnings(finalSteps),
    ...orientationStepWarnings(finalSteps),
  ];

  // Rehearsal: the proposal is fully validated but never written, so an
  // agent can verify its content before replacing the previous tour.
  if (params.dryRun === true) {
    return validatedResponse(
      finalSteps.length,
      warnings,
      `Validated Project Tour proposal with ${finalSteps.length} step(s); nothing was written (dryRun).`
    );
  }

  const tour: TourFile = {
    $schema: CODETOUR_SCHEMA_URI,
    title: params.title ?? "Project Overview",
    ...(params.description !== undefined ? { description: params.description } : {}),
    steps: finalSteps,
  };

  const targetPath = tourTargetPath(PROJECT_TOUR_PATH, params.fileName);
  const writeFailure = await persistTour(ctx, targetPath, tour);
  if (writeFailure) {
    return writeFailure;
  }

  return successResponse(
    normalizeSlashes(path.relative(defaultContext.root, path.join(ctx.root, targetPath))),
    finalSteps.length,
    warnings,
    `Created Project Tour at ${targetPath} with ${finalSteps.length} step(s).`
  );
}

// Create a Changes Tour: analyze committed changes from the merge-base of
// `baseRef` to `headRef`. `headRef` must be the full SHA of the current HEAD;
// otherwise generation fails with STALE_HEAD to avoid a stale explanation. By
// default only committed changes are included; `includeUncommittedChanges`
// enables explaining local work.
async function handleCreateChangesTour(
  defaultContext: WorkspaceContext,
  args: unknown
): Promise<ToolResponse> {
  const rawSteps = extractSteps(args);
  // Use the same aggregation strategy as the Project Tour: collect all
  // validation errors before responding.
  const { params, issues: paramIssues } = validateChangesParams(args);
  const mermaidIssues = await validateMermaidDescriptions(args);
  if (rawSteps === undefined || (Array.isArray(rawSteps) && rawSteps.length === 0)) {
    if (mermaidIssues.length === 0) {
      return errorResponse("TOUR_STEPS_REQUIRED", "A tour requires at least one step.");
    }
    return errorResponse(
      "INVALID_PROPOSAL",
      "The create_changes_tour arguments are invalid.",
      [
        ...mermaidIssues,
        { path: "steps", message: "is required and must contain at least one step" }
      ]
    );
  }
  const selected = selectContext(defaultContext, params?.workspacePath);
  const ctx = selected.context ?? defaultContext;
  const allIssues = [...paramIssues, ...mermaidIssues, ...selected.issues];
  let steps: TourStep[] | undefined;
  if (Array.isArray(rawSteps)) {
    const validated = validateSteps(rawSteps, ctx, { kind: "structure" });
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
      `create_changes_tour requires a Git repository, but the configured workspace root (${ctx.root}) is not inside one. ` +
        "Select a repository with workspacePath, or restart codetour-mcp in the repository to analyze (or pass it via --workspace-root), rather than its parent directory."
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
  const includesLocalChanges = includeUncommittedChanges && uncommitted.length > 0;
  const proposedSteps = steps as TourStep[];
  const anchors = includesLocalChanges ? undefined : await readCommitAnchors(
    ctx, headRef, proposedSteps.flatMap((step) => step.file === undefined ? [] : [step.file])
  );
  const validated = validateSteps(rawSteps as unknown[], ctx,
    anchors ? { kind: "commit", anchors } : { kind: "workspace" });
  const renames = includesLocalChanges ? new Map<string, string>()
    : await renamedFiles(ctx, mergeBaseSha, headRef);
  for (const [index, step] of proposedSteps.entries()) {
    if (!includesLocalChanges && step.baseFile !== undefined &&
        path.posix.normalize(normalizeSlashes(step.baseFile)) !==
          renames.get(path.posix.normalize(normalizeSlashes(step.file!)))) {
      validated.issues.push({
        path: `steps[${index}].baseFile`,
        message: "must match the old path of the detected Git rename",
      });
    }
  }
  if (validated.issues.length > 0) {
    return errorResponse("INVALID_PROPOSAL", "The create_changes_tour arguments are invalid.", validated.issues);
  }
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
  if (includesLocalChanges) {
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

  const finalSteps = (validated.steps as TourStep[]).map((step) => {
    const { display, baseFile, ...ordinaryStep } = step;
    if (includesLocalChanges || step.file === undefined) return ordinaryStep;
    const file = path.posix.normalize(normalizeSlashes(step.file));
    return { ...ordinaryStep, file, display: "diff" as const, baseFile: renames.get(file) };
  });
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
  // Rehearsal: every check has run (Git, anchors against headRef, renames,
  // Mermaid, warnings) but the tour is never written.
  if (params.dryRun === true) {
    return validatedResponse(
      finalSteps.length,
      warnings,
      `Validated Changes Tour proposal with ${finalSteps.length} step(s) for head ${headRef} (base ${baseRef}); nothing was written (dryRun).`
    );
  }
  // Enrich the description automatically with the provenance, base, and head
  // so the reader always knows the analyzed scope.
  const provenance = includesLocalChanges
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
    ...(!includesLocalChanges ? { ref: headRef, baseRef: mergeBaseSha } : {}),
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

  const targetPath = tourTargetPath(CHANGES_TOUR_PATH, params.fileName);
  const writeFailure = await persistTour(ctx, targetPath, tour);
  if (writeFailure) {
    return writeFailure;
  }

  return successResponse(
    normalizeSlashes(path.relative(defaultContext.root, path.join(ctx.root, targetPath))),
    finalSteps.length,
    warnings,
    `Created Changes Tour at ${targetPath} with ${finalSteps.length} step(s) for head ${headRef} (base ${baseRef}).`
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

function validatedResponse(
  stepCount: number,
  warnings: Warning[],
  message: string
): ToolResponse {
  const result: ValidatedResult = {
    status: "validated",
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

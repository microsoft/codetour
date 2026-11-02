import * as path from "path";
import { selectContext } from "./context";
import { normalizeSlashes, readCommitAnchors, renamedFiles } from "./git";
import { tourImageDirectoryName, validateImageDescriptions } from "./image-validation";
import { validateMermaidDescriptions } from "./mermaid-validation";
import {
  ChangesParams,
  ErrorResult,
  Issue,
  ProjectParams,
  TourStep,
  WorkspaceContext,
} from "./types";
import {
  validateChangesParams,
  validateProjectParams,
  validateSteps,
} from "./validation";

// Tour proposal validation pipeline.
//
// Both generation tools share one validation prelude: parameters, Mermaid
// fences, workspace selection, local image references, and the structural
// phase of step validation, with every issue aggregated into a single
// INVALID_PROPOSAL response. It lives here once, so each new check is
// inserted once instead of once per tool.
//
// Changes Tour step validation is two-phase by nature: the structure of a
// proposal is checked here, and its anchors are staged against the analyzed
// commit only after the caller has resolved the Git comparison (HEAD match,
// base resolution, merge-base). Those Git checks answer with their own tool
// error codes (STALE_HEAD, INVALID_BASE_REF, ...), so they stay in the tool
// handler and the handler sequences the phases — but the staging order
// itself (commit anchors, then declared baseFile values against the detected
// renames) lives in `stageCommitAnchors`, not in the caller.

export type TourProposalKind = "project" | "changes";

// A rejection is already the error payload of the tool response (the shared
// ErrorResult shape), so a handler relays it without re-deriving messages or
// issue lists.
export type ProposalRejection = ErrorResult;

export interface ValidatedProposal<P extends ProjectParams> {
  // Effective context for anchors and persistence: the selected workspace, or
  // the configured root when the call did not narrow it.
  ctx: WorkspaceContext;
  params: P;
  // The raw steps array, kept for the Changes Tour second phase.
  rawSteps: unknown[];
  steps: TourStep[];
}

export type ProposalValidation<P extends ProjectParams> =
  | { ok: false; rejection: ProposalRejection }
  | { ok: true; proposal: ValidatedProposal<P> };

export async function validateTourProposal(
  kind: "project",
  args: unknown,
  defaultContext: WorkspaceContext
): Promise<ProposalValidation<ProjectParams>>;
export async function validateTourProposal(
  kind: "changes",
  args: unknown,
  defaultContext: WorkspaceContext
): Promise<ProposalValidation<ChangesParams>>;
export async function validateTourProposal(
  kind: TourProposalKind,
  args: unknown,
  defaultContext: WorkspaceContext
): Promise<ProposalValidation<ProjectParams | ChangesParams>> {
  const invalid = (issues: Issue[]): ProposalRejection => ({
    status: "error",
    code: "INVALID_PROPOSAL",
    message: `The create_${kind}_tour arguments are invalid.`,
    issues,
  });
  const { params, issues: paramIssues } =
    kind === "project"
      ? validateProjectParams(args)
      : validateChangesParams(args);
  const rawSteps = extractSteps(args);
  const mermaidIssues = await validateMermaidDescriptions(args);
  const selected = selectContext(defaultContext, params?.workspacePath);
  const ctx = selected.context ?? defaultContext;
  // Image references are workspace-root relative, the same base the player
  // inlines them from, so an accepted reference always renders; step anchors
  // keep the selected context root.
  const imageIssues = validateImageDescriptions(
    args,
    defaultContext,
    tourImageDirectoryName(kind, params?.fileName)
  );
  if (rawSteps === undefined || (Array.isArray(rawSteps) && rawSteps.length === 0)) {
    if (mermaidIssues.length === 0 && imageIssues.length === 0) {
      return {
        ok: false,
        rejection: {
          status: "error",
          code: "TOUR_STEPS_REQUIRED",
          message: "A tour requires at least one step.",
        },
      };
    }
    return {
      ok: false,
      rejection: invalid([
        ...mermaidIssues,
        ...imageIssues,
        { path: "steps", message: "is required and must contain at least one step" },
      ]),
    };
  }
  // Aggregate all validation errors (parameters and then steps) before
  // responding so the agent can correct the proposal in one cycle. A Project
  // Tour anchors against the effective workspace; the first phase is
  // structural only when an invalid workspacePath left no selected context. A
  // Changes Tour is always structural here, because its anchors are staged
  // against the analyzed commit in the second phase.
  const allIssues = [...paramIssues, ...mermaidIssues, ...selected.issues, ...imageIssues];
  let steps: TourStep[] | undefined;
  if (Array.isArray(rawSteps)) {
    const validated = validateSteps(
      rawSteps,
      ctx,
      kind === "project" && selected.context ? { kind: "workspace" } : { kind: "structure" }
    );
    steps = validated.steps;
    allIssues.push(...validated.issues);
  }
  if (!params || allIssues.length > 0) {
    return { ok: false, rejection: invalid(allIssues) };
  }
  return {
    ok: true,
    proposal: { ctx, params, rawSteps: rawSteps as unknown[], steps: steps as TourStep[] },
  };
}

// The Git comparison a Changes Tour is generated against, already resolved
// and verified by the caller: the merge-base the analyzed HEAD SHA
// (proposal.params.headRef) compares to, and whether explicitly included
// local changes take part.
export interface CommitComparison {
  mergeBaseSha: string;
  includesLocalChanges: boolean;
}

export interface StagedCommitAnchors {
  steps: TourStep[];
  issues: Issue[];
  renames: ReadonlyMap<string, string>;
}

// Second phase of Changes Tour step validation: stage the structurally valid
// steps against the analyzed commit, or against the workspace when local
// changes are included, and check every declared baseFile against the
// detected Git renames. The detected renames are returned so the caller can
// decorate the persisted steps.
export async function stageCommitAnchors(
  proposal: ValidatedProposal<ChangesParams>,
  comparison: CommitComparison
): Promise<StagedCommitAnchors> {
  const { ctx } = proposal;
  const headRef = proposal.params.headRef as string;
  const anchors = comparison.includesLocalChanges
    ? undefined
    : await readCommitAnchors(
        ctx,
        headRef,
        proposal.steps.flatMap((step) =>
          step.file === undefined ? [] : [step.file]
        )
      );
  const validated = validateSteps(
    proposal.rawSteps,
    ctx,
    anchors ? { kind: "commit", anchors } : { kind: "workspace" }
  );
  const renames = comparison.includesLocalChanges
    ? new Map<string, string>()
    : await renamedFiles(ctx, comparison.mergeBaseSha, headRef);
  for (const [index, step] of proposal.steps.entries()) {
    if (
      !comparison.includesLocalChanges &&
      step.baseFile !== undefined &&
      path.posix.normalize(normalizeSlashes(step.baseFile)) !==
        renames.get(path.posix.normalize(normalizeSlashes(step.file!)))
    ) {
      validated.issues.push({
        path: `steps[${index}].baseFile`,
        message: "must match the old path of the detected Git rename",
      });
    }
  }
  return {
    steps: validated.steps as TourStep[],
    issues: validated.issues,
    renames,
  };
}

function extractSteps(args: unknown): unknown {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return undefined;
  }
  return (args as Record<string, unknown>).steps;
}

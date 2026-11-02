export interface Position {
  line: number;
  character: number;
}

export interface Selection {
  start: Position;
  end: Position;
}

export interface TourStep {
  title?: string;
  description: string;
  questions?: string[];
  file?: string;
  baseFile?: string;
  display?: "diff";
  directory?: string;
  line?: number;
  pattern?: string;
  selection?: Selection;
}

export interface ProjectParams {
  workspacePath?: string;
  title?: string;
  description?: string;
  fileName?: string;
  dryRun?: boolean;
  steps?: unknown[];
}

export interface ChangesParams extends ProjectParams {
  baseRef?: string;
  headRef?: string;
  includeUncommittedChanges?: boolean;
}

export interface TourFile {
  $schema?: string;
  title: string;
  description?: string;
  ref?: string;
  baseRef?: string;
  steps: TourStep[];
}

export interface Issue {
  path: string;
  message: string;
}

export interface Warning {
  code: string;
  message: string;
}

export interface SuccessResult {
  status: "created";
  path: string;
  stepCount: number;
  warnings: Warning[];
}

export interface ValidatedResult {
  status: "validated";
  stepCount: number;
  warnings: Warning[];
}

export interface ErrorResult {
  status: "error";
  code: string;
  message: string;
  issues?: Issue[];
}

export type ToolResult = SuccessResult | ValidatedResult | ErrorResult;

export interface WorkspaceContext {
  root: string;
  realRoot: string;
}

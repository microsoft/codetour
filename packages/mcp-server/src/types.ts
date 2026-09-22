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
  file?: string;
  directory?: string;
  line?: number;
  pattern?: string;
  selection?: Selection;
}

export interface ProjectParams {
  title?: string;
  description?: string;
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

export interface ErrorResult {
  status: "error";
  code: string;
  message: string;
  issues?: Issue[];
}

export type ToolResult = SuccessResult | ErrorResult;

export interface WorkspaceContext {
  root: string;
  realRoot: string;
}

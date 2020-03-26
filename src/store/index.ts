import { observable } from "mobx";
import { CommentThread, Uri } from "vscode";

export const PENDING_TOUR_ID = "@@RECORDING";

export interface CodeTourStepPosition {
  line: number;
  character: number;
}

export interface CodeTourStep {
  title?: string;
  description: string;
  file?: string;
  uri?: string;
  line?: number;
  selection?: { start: CodeTourStepPosition; end: CodeTourStepPosition };
  contents?: string;
}

export interface CodeTour {
  id: string;
  title: string;
  description?: string;
  steps: CodeTourStep[];
  ref?: string;
}

export interface ActiveTour {
  tour: CodeTour;
  step: number;

  // When recording, a tour can be active, without
  // having created an actual comment yet.
  thread: CommentThread | null | undefined;

  // In order to resolve relative file
  // paths, we need to know the workspace root
  workspaceRoot?: Uri;
}

export interface Store {
  tours: CodeTour[];
  activeTour: ActiveTour | null;
  hasTours: boolean;
  isRecording: boolean;
}

export const store: Store = observable({
  tours: [],
  activeTour: null,
  isRecording: false,
  get hasTours() {
    return this.tours.length > 0;
  }
});

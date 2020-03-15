import { observable } from "mobx";
import { CommentThread } from "vscode";

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
  line: number;
  selection?: { start: CodeTourStepPosition; end: CodeTourStepPosition };
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

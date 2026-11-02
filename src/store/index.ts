// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { observable } from "mobx";
import { CommentThread, Uri } from "vscode";
import type { CodeTour, CodeTourStep } from "./tourSchema";

// The tour file format's types derive from the zod schemas: the single source
// of truth lives in `./tourSchema`, next to the runtime validation.
export type {
  CodeTour,
  CodeTourStep,
  CodeTourStepPosition,
  TourFile
} from "./tourSchema";
export {
  CodeTourStepSchema,
  TourFileSchema,
  loadTour,
  parseTourFile
} from "./tourSchema";

export interface ActiveTour {
  tour: CodeTour;
  step: number;

  // While recording, the tour can be active before its first comment is
  // placed in the editor.
  thread: CommentThread | null | undefined;

  // The root indicates in which project to open the tour's relative paths.
  workspaceRoot?: Uri;

  // Associated tours make it possible to follow a link to another tour, even
  // when the set comes from a source outside the project.
  tours?: CodeTour[];
}

type CodeTourProgress = [string, number[]];
export type CodeTourStepTuple = [CodeTour, CodeTourStep, number, number?];

export interface Store {
  tours: CodeTour[];
  activeTour: ActiveTour | null;
  activeEditorSteps?: CodeTourStepTuple[];
  hasTours: boolean;
  isRecording: boolean;
  isEditing: boolean;
  // Whether the current permissions allow editing the active tour. It is
  // the store-side mirror of the codetour:canEditTour context, so surfaces
  // can enforce it in their UI and commands.
  canEditTour: boolean;
  isExpandedViewOpen: boolean;
  showMarkers: boolean;
  progress: CodeTourProgress[];
}

export const store: Store = observable({
  tours: [],
  activeTour: null,
  isRecording: false,
  isEditing: false,
  canEditTour: true,
  isExpandedViewOpen: false,
  get hasTours() {
    return this.tours.length > 0;
  },
  showMarkers: false,
  progress: []
});

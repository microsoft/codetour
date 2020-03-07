import { Uri } from "vscode";
import { observable } from "mobx";

export interface CodeTourStep {
  file?: string;
  uri?: Uri;
  line: number;
  description: string;
}

export interface CodeTour {
  title: string;
  description?: string;
  steps: CodeTourStep[];
  isMain: boolean;
}

export interface Store {
  mainTour: CodeTour | null;
  subTours: CodeTour[];
  currentTour: CodeTour | null;
  currentStep: number;
  hasTours: boolean;
}

export const store: Store = observable({
  mainTour: null,
  subTours: [],
  currentTour: null,
  currentStep: 0,
  get hasTours() {
    return !!this.mainTour || this.subTours.length > 0;
  }
});

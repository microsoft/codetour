import { observable } from "mobx";

export interface CodeTourStep {
  file?: string;
  uri?: string;
  line: number;
  description: string;
}

export interface CodeTour {
  title: string;
  description?: string;
  steps: CodeTourStep[];
}

export interface Store {
  mainTour: CodeTour | null;
  subTours: CodeTour[];
  currentTour: CodeTour | null;
  currentStep: number;
  hasTours: boolean;
  isRecording: boolean;
}

export const store: Store = observable({
  mainTour: null,
  subTours: [],
  currentTour: null,
  currentStep: 0,
  isRecording: false,
  get hasTours() {
    return !!this.mainTour || this.subTours.length > 0;
  }
});

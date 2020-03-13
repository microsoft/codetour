import { observable } from "mobx";

export interface CodeTourStep {
  title?: string;
  description: string;
  file?: string;
  uri?: string;
  line: number;
}

export interface CodeTour {
  id: string;
  title: string;
  description?: string;
  steps: CodeTourStep[];
  ref?: string;
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
    return (
      !!this.mainTour ||
      this.subTours.length > 0 ||
      (this.isRecording && this.currentTour)
    );
  }
});

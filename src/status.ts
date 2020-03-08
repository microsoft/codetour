import * as vscode from "vscode";
import { store, CodeTour } from "./store";
import { EXTENSION_NAME } from "./constants";
import { reaction } from "mobx";

function createCurrentTourItem() {
  const currentTourItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left
  );

  currentTourItem.command = `${EXTENSION_NAME}.resumeTour`;
  currentTourItem.color = new vscode.ThemeColor(
    "statusBarItem.prominentForeground"
  );

  currentTourItem.show();

  return currentTourItem;
}

function createStartTourItem() {
  const startTourItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left
  );

  startTourItem.text = "$(play) Start Code Tour";
  startTourItem.command = `${EXTENSION_NAME}.startTour`;
  startTourItem.show();

  return startTourItem;
}

let currentTourItem: vscode.StatusBarItem | null = null;
export function registerStatusBar() {
  if (store.hasTours) {
    const startTourItem = createStartTourItem();

    reaction(
      // @ts-ignore
      () => [
        store.currentTour,
        store.currentStep,
        store.isRecording,
        store.currentTour ? store.currentTour.steps.length : null
      ],
      ([tour, step, isRecording]: [CodeTour | null, number, boolean]) => {
        if (tour) {
          if (!currentTourItem) {
            currentTourItem = createCurrentTourItem();
          }

          const prefix = isRecording ? "Recording " : "";
          currentTourItem.text = `${prefix}Code Tour: #${step + 1} of ${
            tour.steps.length
          } (${tour.title})`;

          if (step === 0) {
            startTourItem.hide();
          }
        } else {
          if (currentTourItem) {
            currentTourItem.dispose();
            currentTourItem = null;
          }

          startTourItem.show();
        }
      }
    );
  }
}

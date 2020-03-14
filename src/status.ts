import * as vscode from "vscode";
import { store } from "./store";
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

  startTourItem.text = "$(play) Start CodeTour";
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
        store.currentTour
          ? [store.currentTour.title, store.currentTour.steps.length]
          : null,
        store.currentStep,
        store.isRecording
      ],
      () => {
        if (store.currentTour) {
          if (!currentTourItem) {
            currentTourItem = createCurrentTourItem();
          }

          const prefix = store.isRecording ? "Recording " : "";
          currentTourItem.text = `${prefix}CodeTour: #${store.currentStep +
            1} of ${store.currentTour.steps.length} (${
            store.currentTour.title
          })`;

          if (store.currentStep === 0) {
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

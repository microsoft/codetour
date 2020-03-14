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
        store.activeTour
          ? [
              store.activeTour.step,
              store.activeTour.tour.title,
              store.activeTour.tour.steps.length
            ]
          : null,
        store.isRecording
      ],
      () => {
        if (store.activeTour) {
          if (!currentTourItem) {
            currentTourItem = createCurrentTourItem();
          }

          const prefix = store.isRecording ? "Recording " : "";
          currentTourItem.text = `${prefix}CodeTour: #${store.activeTour.step +
            1} of ${store.activeTour.tour.steps.length} (${
            store.activeTour.tour.title
          })`;

          if (store.activeTour.step === 0) {
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

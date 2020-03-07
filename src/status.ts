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

  startTourItem.text = "$(play) Start Tour";
  startTourItem.command = `${EXTENSION_NAME}.startTour`;
  startTourItem.show();

  return startTourItem;
}

let currentTourItem: vscode.StatusBarItem | null = null;
export function registerStatusBar() {
  if (store.hasTours) {
    const startTourItem = createStartTourItem();

    reaction(
      () => [store.currentTour, store.currentStep],
      ([tour, step]) => {
        if (tour) {
          if (!currentTourItem) {
            currentTourItem = createCurrentTourItem();
          }

          // @ts-ignore
          currentTourItem.text = `Step #${step + 1} of ${tour.steps.length} (${
            // @ts-ignore
            tour.title
          })`;

          if (step === 0) {
            startTourItem.hide();
          }
        } else {
          currentTourItem && currentTourItem.dispose();
          currentTourItem = null;

          startTourItem.show();
        }
      }
    );
  }
}

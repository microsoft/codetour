import * as vscode from "vscode";
import { EXTENSION_NAME } from "./constants";
import { CodeTour, store } from "./store";
import {
  endCurrentCodeTour,
  moveCurrentCodeTourBackward,
  moveCurrentCodeTourForward,
  startCodeTour,
  resumeCurrentCodeTour
} from "./store/actions";

interface CodeTourQuickPickItem extends vscode.QuickPickItem {
  tour: CodeTour;
}

export function registerCommands() {
  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.startTour`,
    async (tour?: CodeTour) => {
      if (tour) {
        return startCodeTour(tour);
      }

      let items: CodeTourQuickPickItem[] = store.subTours
        .map(tour => ({
          label: tour.title!,
          tour: tour,
          detail: tour.description
        }))
        .sort((a, b) => a.label.localeCompare(b.label));

      if (store.mainTour) {
        items.unshift({
          label: store.mainTour.title,
          tour: store.mainTour,
          detail: store.mainTour.description
        });
      }

      if (items.length === 1) {
        return startCodeTour(items[0].tour);
      }

      const response = await vscode.window.showQuickPick(items, {
        placeHolder: "Select the tour to start..."
      });

      if (response) {
        startCodeTour(response.tour);
      }
    }
  );

  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.endTour`,
    endCurrentCodeTour
  );

  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.previousTourStep`,
    moveCurrentCodeTourBackward
  );

  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.nextTourStep`,
    moveCurrentCodeTourForward
  );

  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.resumeTour`,
    resumeCurrentCodeTour
  );
}

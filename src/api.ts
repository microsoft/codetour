import { ExtensionContext } from "vscode";
import {
  endCurrentCodeTour,
  exportTour,
  onDidEndTour,
  promptForTour,
  recordTour,
  selectTour,
  startCodeTour
} from "./store/actions";

export function initializeApi(context: ExtensionContext) {
  return {
    endCurrentTour: endCurrentCodeTour,
    exportTour,
    onDidEndTour,
    promptForTour: promptForTour.bind(null, context.globalState),
    recordTour,
    startTour: startCodeTour,
    selectTour
  };
}

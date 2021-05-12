// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ExtensionContext } from "vscode";
import {
  endCurrentCodeTour,
  exportTour,
  onDidEndTour,
  onDidStartTour,
  promptForTour,
  recordTour,
  selectTour,
  startCodeTour,
  startCodeTourByUri
} from "./store/actions";

export function initializeApi(context: ExtensionContext) {
  return {
    endCurrentTour: endCurrentCodeTour,
    exportTour,
    onDidStartTour,
    onDidEndTour,
    promptForTour: promptForTour.bind(null, context.globalState),
    recordTour,
    startTour: startCodeTour,
    startTourByUri: startCodeTourByUri,
    selectTour
  };
}

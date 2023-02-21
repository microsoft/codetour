// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { reaction } from "mobx";
import { debounce } from "throttle-debounce";
import * as vscode from "vscode";
import { store } from "../store";
import { saveTour } from "./commands";

const debouncedSaveTour = debounce(5000, saveTour);
const changeWatcher = async (e: vscode.TextDocumentChangeEvent) => {
  if (!store.activeEditorSteps) {
    return;
  }

  const impactedSteps = store.activeEditorSteps!.filter(
    ([, step, , line]) =>
      step.pattern &&
      e.contentChanges.some(change => line === change.range.start.line)
  );

  if (impactedSteps.length === 0) {
    return;
  }

  await Promise.all(
    e.contentChanges.map(async () => {
      for (let [tour, step, , line] of impactedSteps) {
        const changedText = e.document.lineAt(line!).text;

        // If the text is empty, then that means the user
        // delete the step line, but we can't delete the
        // steo, since we don't know if it was a delete
        // or if theyy're doing a cut/paste of the line.
        if (changedText === "") {
          continue;
        }

        const newPattern = changedText
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          .trim();

        if (newPattern !== step.pattern) {
          step.pattern = newPattern;
          await debouncedSaveTour(tour);
        }
      }
    })
  );
};

let disposable: vscode.Disposable;
function initializeWatcher() {
  if (disposable) {
    disposable.dispose();
  }

  if (store.tours.length > 0) {
    disposable = vscode.workspace.onDidChangeTextDocument(changeWatcher);
  }
}

export async function registerEditorWatcher() {
  reaction(() => store.tours.length, initializeWatcher);

  initializeWatcher();
}

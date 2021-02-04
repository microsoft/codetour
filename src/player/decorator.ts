// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { reaction } from "mobx";
import * as vscode from "vscode";
import { FS_SCHEME_CONTENT, ICON_URL } from "../constants";
import { CodeTour, CodeTourStep, store } from "../store";
import { getStepFileUri, getWorkspaceUri } from "../utils";

const DISABLED_SCHEMES = [FS_SCHEME_CONTENT, "comment"];

const TOUR_DECORATOR = vscode.window.createTextEditorDecorationType({
  gutterIconPath: vscode.Uri.parse(ICON_URL),
  gutterIconSize: "contain",
  overviewRulerColor: "rgb(246,232,154)",
  overviewRulerLane: vscode.OverviewRulerLane.Right
});

type CodeTourStepTuple = [CodeTour, CodeTourStep, number];

// TODO: Add support for regex/market steps.
async function getTourSteps(
  document: vscode.TextDocument,
  lineNumber?: number
): Promise<CodeTourStepTuple[]> {
  const steps: CodeTourStepTuple[] = store.tours.flatMap(tour =>
    tour.steps.map(
      (step, stepNumber) => [tour, step, stepNumber] as CodeTourStepTuple
    )
  );

  const tourSteps = await Promise.all(
    steps.map(async ([tour, step, stepNumber]) => {
      const workspaceRoot = getWorkspaceUri(tour);
      const uri = await getStepFileUri(step, workspaceRoot);

      if (
        uri.toString().localeCompare(document.uri.toString()) === 0 &&
        (!lineNumber || step.line! - 1 === lineNumber)
      ) {
        return [tour, step, stepNumber];
      }
    })
  );

  // @ts-ignore
  return tourSteps.filter(i => i);
}

async function setDecorations(editor: vscode.TextEditor) {
  if (DISABLED_SCHEMES.includes(editor.document.uri.scheme)) {
    return;
  }

  const tourSteps = await getTourSteps(editor.document);
  if (tourSteps.length === 0) {
    return;
  }

  const ranges = tourSteps.map(
    ([, step]) => new vscode.Range(step.line! - 1, 0, step.line! - 1, 1000)
  );

  editor.setDecorations(TOUR_DECORATOR, ranges);
}

let hoverProviderDisposable: vscode.Disposable | undefined;
function registerHoverProvider() {
  return vscode.languages.registerHoverProvider("*", {
    provideHover: async (
      document: vscode.TextDocument,
      position: vscode.Position
    ) => {
      const tourSteps = await getTourSteps(document, position.line);
      if (tourSteps.length === 0) {
        return;
      }

      const hovers = tourSteps.map(([tour, _, stepNumber]) => {
        const args = encodeURIComponent(JSON.stringify([tour.id, stepNumber]));
        const command = `command:codetour._startTourById?${args}`;
        return `CodeTour: ${tour.title} (Step #${
          stepNumber + 1
        }) &nbsp;[Start Tour](${command} "Start Tour")\n`;
      });

      const content = new vscode.MarkdownString(hovers.join("\n"));
      content.isTrusted = true;
      return new vscode.Hover(content);
    }
  });
}

let disposables: vscode.Disposable[] = [];
export async function registerDecorators() {
  reaction(
    () => [
      store.showMarkers,
      store.tours.map(tour => [tour.title, tour.steps])
    ],
    () => {
      const activeEditor = vscode.window.activeTextEditor;

      if (store.showMarkers) {
        if (hoverProviderDisposable === undefined) {
          hoverProviderDisposable = registerHoverProvider();
          disposables.push(hoverProviderDisposable);
        }

        disposables.push(
          vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) {
              setDecorations(editor);
            }
          })
        );

        if (activeEditor) {
          setDecorations(activeEditor);
        }
      } else if (activeEditor) {
        activeEditor.setDecorations(TOUR_DECORATOR, []);
        disposables.forEach(disposable => disposable.dispose());
        hoverProviderDisposable = undefined;
        disposables = [];
      }
    }
  );
}

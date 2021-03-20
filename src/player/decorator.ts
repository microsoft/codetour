// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { reaction } from "mobx";
import * as vscode from "vscode";
import { FS_SCHEME_CONTENT, ICON_URL } from "../constants";
import { CodeTourStepTuple, store } from "../store";
import { getStepFileUri, getWorkspaceUri } from "../utils";

const DISABLED_SCHEMES = [FS_SCHEME_CONTENT, "comment"];

const TOUR_DECORATOR = vscode.window.createTextEditorDecorationType({
  gutterIconPath: vscode.Uri.parse(ICON_URL),
  gutterIconSize: "contain",
  overviewRulerColor: "rgb(246,232,154)",
  overviewRulerLane: vscode.OverviewRulerLane.Right,
  rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
});

async function getTourSteps(
  document: vscode.TextDocument
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
        uri.toString().localeCompare(document.uri.toString()) === 0
      ) {
        return [tour, step, stepNumber];
      }
    })
  );

  // @ts-ignore
  return tourSteps.filter(i => i);
}

let hoverProviderDisposable: vscode.Disposable | undefined;
function registerHoverProvider() {
  return vscode.languages.registerHoverProvider("*", {
    provideHover: async (
      document: vscode.TextDocument,
      position: vscode.Position
    ) => {
      if (!store.activeEditorSteps) {
        return;
      }

      const tourSteps = store.activeEditorSteps.filter(([,,,line]) => line === position.line);
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

async function updateDecorations(editor: vscode.TextEditor) {
  if (DISABLED_SCHEMES.includes(editor.document.uri.scheme)) {
    return;
  }

  const tourSteps = await getTourSteps(editor.document);
  if (tourSteps.length === 0) {
    return clearDecorations(editor);
  }

  const contents = editor.document.getText();

  // @ts-ignore
  store.activeEditorSteps = (await Promise.all(tourSteps.map(
    async (tourStep) => {
      let line, step = tourStep[1];
      if (step.line) {
        line = step.line - 1;
      } else if (step.pattern) {
        const match = contents.match(new RegExp(step.pattern, "m"));
        if (match) {
          line = editor.document.positionAt(match.index!).line;
        }
      }

      if (line) {
        tourStep.push(line);
        return tourStep;
      }
    }
  ))).filter(tourStep => tourStep);

  const ranges = store.activeEditorSteps!.map(([,,,line]) => new vscode.Range(line!, 0, line!, 1000));
  editor.setDecorations(TOUR_DECORATOR, ranges);
}

function clearDecorations(editor: vscode.TextEditor) {
  store.activeEditorSteps = undefined;
  editor.setDecorations(TOUR_DECORATOR, []);
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
              updateDecorations(editor);
            }
          })
        );

   

        /*disposables.push(vscode.workspace.onDidChangeTextDocument(e => {
          if (!store.activeEditorSteps) {
            return;
          }

          e.contentChanges.map(async (change) => {
            const tourSteps = store.activeEditorSteps!.filter(([,,,line]) => line === change.range.start.line);
            for (let [tour, step] of tourSteps) {
              step.pattern = change.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').trim();
              await saveTour(tour);
            }
          })
        }));*/

        if (activeEditor) {
          updateDecorations(activeEditor);
        }
      } else if (activeEditor) {
        clearDecorations(activeEditor);
        
        disposables.forEach(disposable => disposable.dispose());
        hoverProviderDisposable = undefined;
        disposables = [];
      }
    }
  );
}

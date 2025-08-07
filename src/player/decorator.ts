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

export async function getTourSteps(
  editor: vscode.TextEditor
): Promise<CodeTourStepTuple[]> {
  const steps: CodeTourStepTuple[] = store.tours.flatMap(tour =>
    tour.steps.map(
      (step, stepNumber) => [tour, step, stepNumber] as CodeTourStepTuple
    )
  );

  const contents = editor.document.getText();
  const tourSteps = await Promise.all(
    steps.map(async ([tour, step, stepNumber]) => {
      const workspaceRoot = getWorkspaceUri(tour);
      const uri = await getStepFileUri(step, workspaceRoot);

      if (uri.toString().localeCompare(editor.document.uri.toString()) === 0) {
        let line;
        if (step.line) {
          line = step.line - 1;
        } else if (step.pattern) {
          const match = contents.match(new RegExp(step.pattern, "m"));
          if (match) {
            line = editor.document.positionAt(match.index!).line;
          }
        }

        return [tour, step, stepNumber, line];
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

      const tourSteps = store.activeEditorSteps.filter(
        ([, , , line]) => line === position.line
      );
      const hovers = tourSteps.map(([tour, _, stepNumber]) => {
        const args = encodeURIComponent(JSON.stringify([tour.id, stepNumber]));
        const command = `command:codetour._startTourById?${args}`;
        return `CodeTour: ${tour.title} (Step #${stepNumber + 1
          }) &nbsp;[Start Tour](${command} "Start Tour")\n`;
      });

      const content = new vscode.MarkdownString(hovers.join("\n"));
      content.isTrusted = true;
      return new vscode.Hover(content);
    }
  });
}

export async function updateDecorations(
  editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor
) {
  if (!editor || DISABLED_SCHEMES.includes(editor.document.uri.scheme)) {
    return;
  }

  store.activeEditorSteps = await getTourSteps(editor);
  if (store.activeEditorSteps.length === 0) {
    return clearDecorations(editor);
  }

  const ranges = store.activeEditorSteps!.map(
    ([, , , line]) => new vscode.Range(line!, 0, line!, 1000)
  );
  editor.setDecorations(TOUR_DECORATOR, ranges);
}

function clearDecorations(editor: vscode.TextEditor) {
  store.activeEditorSteps = undefined;
  editor.setDecorations(TOUR_DECORATOR, []);
}

let disposables: vscode.Disposable[] = [];
let codeLensProviderDisposable: vscode.Disposable | undefined;
let codeLensChangeEmitter: vscode.EventEmitter<void> | undefined;

function registerCodeLensProvider() {
  codeLensChangeEmitter = new vscode.EventEmitter<void>();

  return vscode.languages.registerCodeLensProvider("*", {
    onDidChangeCodeLenses: codeLensChangeEmitter.event,
    provideCodeLenses: async (
      document: vscode.TextDocument,
      token: vscode.CancellationToken
    ): Promise<vscode.CodeLens[]> => {
      if (!store.showMarkers) {
        return [];
      }

      const editor = vscode.window.visibleTextEditors.find(
        e => e.document.uri.toString() === document.uri.toString()
      );

      if (!editor || DISABLED_SCHEMES.includes(document.uri.scheme)) {
        return [];
      }

      const tourSteps = await getTourSteps(editor);

      return tourSteps
        .filter(([tour, , stepNumber]) => {
          // Don't show codelens for the currently active step
          if (store.activeTour &&
            store.activeTour.tour.id === tour.id &&
            store.activeTour.step === stepNumber) {
            return false;
          }
          return true;
        })
        .map(([tour, , stepNumber, line]) => {
          const range = new vscode.Range(line!, 0, line!, 0);
          const command: vscode.Command = {
            title: `Start CodeTour: ${tour.title} (Step ${stepNumber + 1})`,
            command: "codetour._startTourById",
            arguments: [tour.id, stepNumber]
          };

          return new vscode.CodeLens(range, command);
        });
    }
  });
}

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

        if (codeLensProviderDisposable === undefined) {
          codeLensProviderDisposable = registerCodeLensProvider();
          disposables.push(codeLensProviderDisposable);
        }

        disposables.push(
          vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) {
              updateDecorations(editor);
            }
          })
        );

        if (activeEditor) {
          updateDecorations(activeEditor);
        }
      } else if (activeEditor) {
        clearDecorations(activeEditor);

        disposables.forEach(disposable => disposable.dispose());
        hoverProviderDisposable = undefined;
        codeLensProviderDisposable = undefined;
        codeLensChangeEmitter?.dispose();
        codeLensChangeEmitter = undefined;
        disposables = [];
      }
    }
  );

  // React to activeTour changes to refresh CodeLenses
  reaction(
    () => store.activeTour,
    () => {
      if (codeLensChangeEmitter) {
        codeLensChangeEmitter.fire();
      }
    }
  );

  store.showMarkers = vscode.workspace
    .getConfiguration("codetour")
    .get("showMarkers", true);

  vscode.commands.executeCommand(
    "setContext",
    "codetour:showingMarkers",
    store.showMarkers
  );
}

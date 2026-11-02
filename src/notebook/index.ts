// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import { EXTENSION_NAME, SMALL_ICON_URL } from "../constants";
import { renderPreviewDescription } from "../player/description";
import { CodeTour } from "../store";
import { parseTourFile } from "../store/tourSchema";
import { getStepFileUri, getWorkspaceUri } from "../utils";

class CodeTourNotebookProvider implements vscode.NotebookSerializer {
  originalContent: Uint8Array = new TextEncoder().encode("");

  async deserializeNotebook(
    content: Uint8Array,
    token: any
  ): Promise<vscode.NotebookData> {
    this.originalContent = content;
    let contents = new TextDecoder().decode(content);

    let tour = parseTourFile(contents) as CodeTour;
    const workspaceRoot = getWorkspaceUri(tour);
    let steps: any[] = [];

    for (let item of tour.steps) {
      const uri = await getStepFileUri(item, workspaceRoot, tour.ref);
      const document = await vscode.workspace.openTextDocument(uri);

      const startLine = item.line! > 10 ? item.line! - 10 : 0;
      const endLine = item.line! > 1 ? item.line! - 1 : 0;
      const contents = document.getText(
        new vscode.Range(
          new vscode.Position(startLine, 0),
          new vscode.Position(endLine, 10000)
        )
      );
      steps.push({
        contents,
        language: document.languageId,
        description: await renderPreviewDescription(item.description, undefined, {
          tour,
          workspaceRoot
        }),
        uri
      });
    }

    let cells: vscode.NotebookCellData[] = [];

    const titleDescription =
      tour.description === undefined
        ? ""
        : await renderPreviewDescription(tour.description, undefined, {
            tour,
            workspaceRoot
          });

    // Title cell
    cells.push(
      new vscode.NotebookCellData(
        1,
        `## ![Icon](${SMALL_ICON_URL})&nbsp;&nbsp; CodeTour (${tour.title}) - ${
          steps.length
        } steps\n\n${titleDescription}`,
        "markdown"
      )
    );

    steps.forEach((step, index) => {
      const cell = new vscode.NotebookCellData(2, step.contents, step.language);
      cell.outputs = [
        new vscode.NotebookCellOutput([
          new vscode.NotebookCellOutputItem(
            new TextEncoder().encode(
              `_Step #${index + 1} of ${steps.length}:_ ${
                step.description
              } ([View File](${step.uri}))`
            ),
            "text/markdown"
          )
        ])
      ];
      cells.push(cell);
    });

    return new vscode.NotebookData(cells);
  }

  async serializeNotebook(
    data: vscode.NotebookData,
    token: any
  ): Promise<Uint8Array> {
    return this.originalContent;
  }
}

export function registerNotebookProvider(): vscode.Disposable | undefined {
  if (typeof vscode.notebook === "undefined") {
    return undefined;
  }

  return vscode.notebook.registerNotebookSerializer(
    EXTENSION_NAME,
    new CodeTourNotebookProvider()
  );
}

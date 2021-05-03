// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextDecoder, TextEncoder } from "util";
import * as vscode from "vscode";
import { EXTENSION_NAME, SMALL_ICON_URL } from "../constants";
import { CodeTour } from "../store";
import { getStepFileUri, getWorkspaceUri } from "../utils";

class CodeTourNotebookProvider implements vscode.NotebookSerializer {
  async deserializeNotebook(content: Uint8Array, token: any): Promise<vscode.NotebookData> {
    let contents = new TextDecoder().decode(content);

    let tour = <CodeTour>JSON.parse(contents);
    const workspaceRoot = getWorkspaceUri(tour);
    let steps: any[] = [];

    for (let item of tour.steps) {
      const uri = await getStepFileUri(item, workspaceRoot, tour.ref);
      const document = await vscode.workspace.openTextDocument(uri);
      const contents = document.getText(
        new vscode.Range(
          new vscode.Position(item.line! - 10, 0),
          new vscode.Position(item.line! - 1, 10000)
        )
      );
      steps.push({
        contents,
        language: document.languageId,
        description: item.description,
        uri
      });
    }

    let cells: vscode.NotebookCellData[] = [];

    // Title cell
    cells.push(new vscode.NotebookCellData(0,
      `## ![Icon](${SMALL_ICON_URL})&nbsp;&nbsp; CodeTour (${tour.title}) - ${steps.length} steps\n\n${tour.description}`,
      'markdown'))

    steps.forEach((step, index) => {
      cells.push(new vscode.NotebookCellData(1,
        step.contents,
        step.language,
        [new vscode.NotebookCellOutput([
          new vscode.NotebookCellOutputItem('text/markdown', `_Step #${index + 1} of ${steps.length}:_ ${step.description} ([View File](${step.uri}))`)
        ])]
      ))
    })

    return new vscode.NotebookData(cells, new vscode.NotebookDocumentMetadata(true))
  }

  async serializeNotebook(data: vscode.NotebookData, token: any): Promise<Uint8Array> {
    return new TextEncoder().encode('');
  }
}

export function registerNotebookProvider() {
  vscode.notebook.registerNotebookSerializer(
    EXTENSION_NAME,
    new CodeTourNotebookProvider()
  );
}
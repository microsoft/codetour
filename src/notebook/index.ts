import * as vscode from "vscode";
import { EXTENSION_NAME, SMALL_ICON_URL } from "../constants";
import { CodeTour } from "../store";
import { getStepFileUri, getWorkspaceUri } from "../utils";

class CodeTourNotebookProvider implements vscode.NotebookProvider {
  async resolveNotebook(editor: vscode.NotebookEditor): Promise<void> {
    editor.document.metadata = {
      editable: false,
      cellRunnable: false,
      cellEditable: false
    };

    let contents = new TextDecoder().decode(
      await vscode.workspace.fs.readFile(editor.document.uri)
    );

    let tour = <CodeTour>JSON.parse(contents);
    tour.id = editor.document.uri.toString();

    let steps: any[] = [];
    const workspaceRoot = getWorkspaceUri(tour);

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

    await editor.edit(editBuilder => {
      editBuilder.insert(
        0,
        `## ![Icon](${SMALL_ICON_URL})&nbsp;&nbsp; CodeTour (${tour.title}) - ${steps.length} steps\n\n${tour.description}`,
        "markdown",
        vscode.CellKind.Markdown,
        [],
        { editable: false, runnable: false, executionOrder: 1 }
      );

      steps.forEach((step, index) => {
        editBuilder.insert(
          0,
          step.contents,
          step.language,
          vscode.CellKind.Code,
          [
            {
              outputKind: vscode.CellOutputKind.Rich,
              data: {
                "text/markdown": `_Step #${index + 1} of ${steps.length}:_ ${
                  step.description
                } ([View File](${step.uri}))`
              }
            }
          ],
          {
            editable: false,
            runnable: false,
            executionOrder: index + 1
          }
        );
      });
    });
  }

  async executeCell(
    document: vscode.NotebookDocument,
    cell: vscode.NotebookCell | undefined,
    token: vscode.CancellationToken
  ): Promise<void> {}

  async save(document: vscode.NotebookDocument): Promise<boolean> {
    return true;
  }
}

export function registerNotebookProvider() {
  vscode.notebook.registerNotebookProvider(
    EXTENSION_NAME,
    new CodeTourNotebookProvider()
  );
}

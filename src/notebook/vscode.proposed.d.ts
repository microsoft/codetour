// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

declare module "vscode" {
  export enum CellKind {
    Markdown = 1,
    Code = 2
  }

  export enum CellOutputKind {
    Text = 1,
    Error = 2,
    Rich = 3
  }

  export interface CellStreamOutput {
    outputKind: CellOutputKind.Text;
    text: string;
  }

  export interface CellErrorOutput {
    outputKind: CellOutputKind.Error;
    /**
     * Exception Name
     */
    ename: string;
    /**
     * Exception Value
     */
    evalue: string;
    /**
     * Exception call stack
     */
    traceback: string[];
  }

  export interface CellDisplayOutput {
    outputKind: CellOutputKind.Rich;
    /**
     * { mime_type: value }
     *
     * Example:
     * ```json
     * {
     *   "outputKind": vscode.CellOutputKind.Rich,
     *   "data": {
     *      "text/html": [
     *          "<h1>Hello</h1>"
     *       ],
     *      "text/plain": [
     *        "<IPython.lib.display.IFrame at 0x11dee3e80>"
     *      ]
     *   }
     * }
     */
    data: { [key: string]: any };
  }

  export type CellOutput =
    | CellStreamOutput
    | CellErrorOutput
    | CellDisplayOutput;

  export interface NotebookCellMetadata {
    /**
     * Controls if the content of a cell is editable or not.
     */
    editable?: boolean;

    /**
     * Controls if the cell is executable.
     * This metadata is ignored for markdown cell.
     */
    runnable?: boolean;

    /**
     * The order in which this cell was executed.
     */
    executionOrder?: number;
  }

  export interface NotebookCell {
    readonly uri: Uri;
    readonly cellKind: CellKind;
    readonly source: string;
    language: string;
    outputs: CellOutput[];
    metadata: NotebookCellMetadata;
  }

  export interface NotebookDocumentMetadata {
    /**
     * Controls if users can add or delete cells
     * Defaults to true
     */
    editable?: boolean;

    /**
     * Default value for [cell editable metadata](#NotebookCellMetadata.editable).
     * Defaults to true.
     */
    cellEditable?: boolean;

    /**
     * Default value for [cell runnable metadata](#NotebookCellMetadata.runnable).
     * Defaults to true.
     */
    cellRunnable?: boolean;

    /**
     * Whether the [execution order](#NotebookCellMetadata.executionOrder) indicator will be displayed.
     * Defaults to true.
     */
    hasExecutionOrder?: boolean;
  }

  export interface NotebookDocument {
    readonly uri: Uri;
    readonly fileName: string;
    readonly isDirty: boolean;
    readonly cells: NotebookCell[];
    languages: string[];
    displayOrder?: GlobPattern[];
    metadata: NotebookDocumentMetadata;
  }

  export interface NotebookEditorCellEdit {
    insert(
      index: number,
      content: string | string[],
      language: string,
      type: CellKind,
      outputs: CellOutput[],
      metadata: NotebookCellMetadata | undefined
    ): void;
    delete(index: number): void;
  }

  export interface NotebookEditor {
    readonly document: NotebookDocument;
    viewColumn?: ViewColumn;
    /**
     * Fired when the output hosting webview posts a message.
     */
    readonly onDidReceiveMessage: Event<any>;
    /**
     * Post a message to the output hosting webview.
     *
     * Messages are only delivered if the editor is live.
     *
     * @param message Body of the message. This must be a string or other json serilizable object.
     */
    postMessage(message: any): Thenable<boolean>;

    edit(
      callback: (editBuilder: NotebookEditorCellEdit) => void
    ): Thenable<boolean>;
  }

  export interface NotebookProvider {
    resolveNotebook(editor: NotebookEditor): Promise<void>;
    executeCell(
      document: NotebookDocument,
      cell: NotebookCell | undefined,
      token: CancellationToken
    ): Promise<void>;
    save(document: NotebookDocument): Promise<boolean>;
  }

  export interface NotebookOutputSelector {
    type: string;
    subTypes?: string[];
  }

  export interface NotebookOutputRenderer {
    /**
     *
     * @returns HTML fragment. We can probably return `CellOutput` instead of string ?
     *
     */
    render(
      document: NotebookDocument,
      output: CellOutput,
      mimeType: string
    ): string;
    preloads?: Uri[];
  }

  export interface NotebookDocumentChangeEvent {
    /**
     * The affected document.
     */
    readonly document: NotebookDocument;

    /**
     * An array of content changes.
     */
    // readonly contentChanges: ReadonlyArray<TextDocumentContentChangeEvent>;
  }

  export namespace notebook {
    export function registerNotebookProvider(
      notebookType: string,
      provider: NotebookProvider
    ): Disposable;

    export function registerNotebookOutputRenderer(
      type: string,
      outputSelector: NotebookOutputSelector,
      renderer: NotebookOutputRenderer
    ): Disposable;

    export let activeNotebookDocument: NotebookDocument | undefined;

    // export const onDidChangeNotebookDocument: Event<NotebookDocumentChangeEvent>;
  }
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import { FS_SCHEME_CONTENT } from "../../constants";

class CodeTourTextDocumentContentProvider
  implements vscode.TextDocumentContentProvider {
  onDidChange?: vscode.Event<vscode.Uri> | undefined;

  provideTextDocumentContent(
    uri: vscode.Uri,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<string> {
    return "";
  }
}

export function registerTextDocumentContentProvider() {
  vscode.workspace.registerTextDocumentContentProvider(
    FS_SCHEME_CONTENT,
    new CodeTourTextDocumentContentProvider()
  );
}

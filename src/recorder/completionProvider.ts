import * as vscode from "vscode";

const COMMANDS = [
  {
    label: "Navigate to tour step",
    detail: "Navigates the end-user to the specified step in the current tour.",
    insertText: new vscode.SnippetString(
      "codetour.navigateToStep?"
    ).appendPlaceholder("stepNumber")
  },
  {
    label: "Open URL",
    detail: "Launches the end-users default browser to the specified URL.",
    insertText: new vscode.SnippetString('vscode.open?["')
      .appendPlaceholder("url")
      .appendText('"]')
  },
  {
    label: "Run terminal command",
    detail: "Executes a shell command in the end-user's integrated terminal.",
    insertText: new vscode.SnippetString('codetour.sendTextToTerminal?["')
      .appendPlaceholder("shellCommand")
      .appendText('"]')
  },
  {
    label: "Start tour",
    detail: 'Starts another tour using it\'s title (e.g. "Status Bar")',
    insertText: new vscode.SnippetString('codetour.startTourByTitle?["')
      .appendPlaceholder("tourTitle")
      .appendText('"]')
  }
];

class CodeTourCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext
  ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
    const line = document.lineAt(position);
    if (line.text.includes("command:")) {
      return COMMANDS;
    }
  }
}

export function registerCompletionProvider() {
  vscode.languages.registerCompletionItemProvider(
    { scheme: "comment" },
    new CodeTourCompletionProvider(),
    ":"
  );
}

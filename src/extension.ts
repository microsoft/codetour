import * as vscode from "vscode";
import { registerCommands } from "./commands";
import { EXTENSION_NAME } from "./constants";
import { registerStatusBar } from "./status";
import { store } from "./store";
import { startCodeTour } from "./store/actions";
import { discoverTours } from "./store/provider";
import { registerTreeProvider } from "./tree";

async function promptForMainTour(
  workspaceRoot: string,
  globalState: vscode.Memento
) {
  const key = `${EXTENSION_NAME}:${workspaceRoot}`;
  if (store.mainTour && !globalState.get(key)) {
    if (
      await vscode.window.showInformationMessage(
        "This workspace has a guided tour you can take to get familiar with the codebase.",
        "Start Tour"
      )
    ) {
      startCodeTour(store.mainTour);
    }

    globalState.update(key, true);
  }
}

export async function activate(context: vscode.ExtensionContext) {
  if (vscode.workspace.workspaceFolders) {
    const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.toString();
    await discoverTours(workspaceRoot);

    registerCommands();
    registerTreeProvider(context.extensionPath);
    registerStatusBar();

    promptForMainTour(workspaceRoot, context.globalState);
  }
}

import * as vscode from "vscode";
import { registerCommands } from "./commands";
import { EXTENSION_NAME } from "./constants";
import { registerStatusBar } from "./status";
import { store } from "./store";
import { discoverTours } from "./store/provider";
import { registerTreeProvider } from "./tree";
import { initializeGitApi } from "./git";
import { startCodeTour, endCurrentCodeTour } from "./store/actions";
import { registerFileSystemProvider } from "./fileSystem";

async function promptForTour(
  workspaceRoot: string,
  globalState: vscode.Memento
) {
  const key = `${EXTENSION_NAME}:${workspaceRoot}`;
  if (store.hasTours && !globalState.get(key)) {
    globalState.update(key, true);

    if (
      await vscode.window.showInformationMessage(
        "This workspace has guided tours you can take to get familiar with the codebase.",
        "Start CodeTour"
      )
    ) {
      vscode.commands.executeCommand(`${EXTENSION_NAME}.startTour`);
    }
  }
}

export async function activate(context: vscode.ExtensionContext) {
  registerCommands();

  if (vscode.workspace.workspaceFolders) {
    const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.toString();
    await discoverTours(workspaceRoot);

    registerTreeProvider(context.extensionPath);
    promptForTour(workspaceRoot, context.globalState);

    initializeGitApi();
  }

  registerFileSystemProvider();
  registerStatusBar();

  return {
    startTour: startCodeTour,
    endCurrentTour: endCurrentCodeTour
  };
}

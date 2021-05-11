// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import { initializeApi } from "./api";
import { EXTENSION_NAME } from "./constants";
import { initializeGitApi } from "./git";
import { registerLiveShareModule } from "./liveShare";
import { registerNotebookProvider } from "./notebook";
import { registerPlayerModule } from "./player";
import { registerRecorderModule } from "./recorder";
import { promptForTour, startDefaultTour } from "./store/actions";
import { discoverTours } from "./store/provider";

export async function activate(context: vscode.ExtensionContext) {
  registerPlayerModule(context);
  registerRecorderModule();
  registerLiveShareModule();
  registerNotebookProvider();

  let skipTourPrompt = false;
  const skipTourPromptCommand = vscode.commands.registerCommand(
    `${EXTENSION_NAME}._startTourOnActivation`,
    () => skipTourPrompt = true
  );

  if (vscode.workspace.workspaceFolders) {
    await discoverTours();

    skipTourPromptCommand.dispose();

    if (skipTourPrompt) {
      startDefaultTour();
    } else {
      promptForTour(context.globalState);
    }

    initializeGitApi();
  }

  return initializeApi(context);
}

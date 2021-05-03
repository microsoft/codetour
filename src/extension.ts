// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import { initializeApi } from "./api";
import { initializeGitApi } from "./git";
import { registerLiveShareModule } from "./liveShare";
import { registerNotebookProvider } from "./notebook";
import { registerPlayerModule } from "./player";
import { registerRecorderModule } from "./recorder";
import { promptForTour } from "./store/actions";
import { discoverTours } from "./store/provider";

export async function activate(context: vscode.ExtensionContext) {
  registerPlayerModule(context);
  registerRecorderModule();
  registerLiveShareModule();
  registerNotebookProvider();

  if (vscode.workspace.workspaceFolders) {
    await discoverTours();
    promptForTour(context.globalState);

    initializeGitApi();
  }

  return initializeApi(context);
}

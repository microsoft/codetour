// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import { initializeApi } from "./api";
import { initializeGitApi } from "./git";
import { registerLiveShareModule } from "./liveShare";
import { registerNotebookProvider } from "./notebook";
import { registerPlayerModule } from "./player";
import { registerRecorderModule } from "./recorder";
import { promptForTour, startDefaultTour } from "./store/actions";
import { discoverTours as _discoverTours } from "./store/provider";

/**
 * In order to check whether the URI handler was called on activation,
 * we must do this dance around `discoverTours`. The same call to
 * `discoverTours` is shared between `activate` and the URI handler.
 */
let cachedDiscoverTours: Promise<void> | undefined;
function discoverTours(): Promise<void> {
  return cachedDiscoverTours ?? (cachedDiscoverTours = _discoverTours());
}

class URIHandler implements vscode.UriHandler {

  private _didStartDefaultTour = false;
  get didStartDefaultTour(): boolean { return this._didStartDefaultTour; }

  async handleUri(uri: vscode.Uri): Promise<void> {
    if (uri.path === '/startDefaultTour') {
      this._didStartDefaultTour = true;

      await discoverTours();
      startDefaultTour();
    }

    return;
  }
}

export async function activate(context: vscode.ExtensionContext) {
  registerPlayerModule(context);
  registerRecorderModule();
  registerLiveShareModule();
  registerNotebookProvider();

  const uriHandler = new URIHandler();
  context.subscriptions.push(vscode.window.registerUriHandler(uriHandler));

  if (vscode.workspace.workspaceFolders) {
    await discoverTours();

    if (!uriHandler.didStartDefaultTour) {
      promptForTour(context.globalState);
    }

    initializeGitApi();
  }

  return initializeApi(context);
}

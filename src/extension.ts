// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import { initializeApi } from "./api";
import { initializeGitApi } from "./git";
import { registerLiveShareModule } from "./liveShare";
import { registerPlayerModule } from "./player";
import { registerRecorderModule } from "./recorder";
import { store } from "./store";
import {
  promptForTour,
  startCodeTour,
  startDefaultTour
} from "./store/actions";
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

function startTour(params: URLSearchParams) {
  let tourPath = params.get("tour");
  const step = params.get("step");

  let stepNumber;
  if (step) {
    // Allow the step number to be
    // provided as 1-based vs. 0-based
    stepNumber = Number(step) - 1;
  }

  if (tourPath) {
    if (!tourPath.endsWith(".tour")) {
      tourPath = `${tourPath}.tour`;
    }

    const tour = store.tours.find(tour => tour.id.endsWith(tourPath as string));
    if (tour) {
      startCodeTour(tour, stepNumber);
    }
  } else {
    startDefaultTour(undefined, undefined, stepNumber);
  }
}

class URIHandler implements vscode.UriHandler {
  private _didStartDefaultTour = false;
  get didStartDefaultTour(): boolean {
    return this._didStartDefaultTour;
  }

  async handleUri(uri: vscode.Uri): Promise<void> {
    this._didStartDefaultTour = true;
    await discoverTours();

    let query = uri.query;
    if (uri.path === "/startDefaultTour") {
      query = vscode.Uri.parse(uri.query).query;
    }

    if (query) {
      const params = new URLSearchParams(query);
      startTour(params);
    } else {
      startDefaultTour();
    }
  }
}

export async function activate(context: vscode.ExtensionContext) {
  await registerPlayerModule(context);
  registerRecorderModule();
  registerLiveShareModule();

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

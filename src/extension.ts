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

  console.log("CT Tour: ", tourPath);
  console.log("CT Step: ", step);

  let stepNumber;
  if (step) {
    stepNumber = Number(step);
  }

  if (tourPath) {
    if (!tourPath.endsWith(".tour")) {
      tourPath = `${tourPath}.tour`;
    }

    console.log("CT Tour Path: ", tourPath);

    console.log("CT Tours: ", store.tours);

    const tour = store.tours.find(tour => tour.id.endsWith(tourPath as string));

    console.log("CT Tour: ", tour);

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

    if (uri.path === "/startDefaultTour") {
      if (uri.query) {
        console.log("CT Query: ", uri.query);
        try {
          const origin = vscode.Uri.parse(uri.query);
          if (origin.query) {
            const params = new URLSearchParams(origin.query);
            startTour(params);
          }
        } catch {}
      }
    } else if (uri.path === "/starTour") {
      const params = new URLSearchParams(uri.query);
      startTour(params);
    }
  }
}

export async function activate(context: vscode.ExtensionContext) {
  registerPlayerModule(context);
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

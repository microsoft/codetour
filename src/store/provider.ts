// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { comparer, runInAction, set } from "mobx";
import * as os from "os";
import * as vscode from "vscode";
import { store } from ".";
import { EXTENSION_NAME } from "../constants";
import {
  discoverToursFromRoot,
  MAIN_TOUR_FILES,
  tourDirectories,
  visibleTours
} from "../core/tourDiscovery";
import { readUriContents, updateMarkerTitles } from "../utils";
import { endCurrentCodeTour } from "./actions";

export { MAIN_TOUR_FILES };

const HAS_TOURS_KEY = `${EXTENSION_NAME}:hasTours`;
const PLATFORM = os.platform();
const TOUR_CONTEXT = {
  isLinux: PLATFORM === "linux",
  isMac: PLATFORM === "darwin",
  isWindows: PLATFORM === "win32",
  isWeb: vscode.env.uiKind === vscode.UIKind.Web
};

const customDirectory = vscode.workspace
  .getConfiguration(EXTENSION_NAME)
  .get<string | null>("customTourDirectory", null);

export async function discoverTours(): Promise<void> {
  const tours = await Promise.all(
    vscode.workspace.workspaceFolders!.map(workspaceFolder =>
      discoverToursFromRoot(workspaceFolder.uri, {
        join: (root, relative) => vscode.Uri.joinPath(root, relative),
        read: readUriContents,
        list: async uri =>
          (await vscode.workspace.fs.readDirectory(uri)).map(([name, type]) => ({
            name,
            isDirectory: type !== vscode.FileType.File &&
              type !== vscode.FileType.SymbolicLink
          })),
        id: uri => decodeURIComponent(uri.toString())
      }, customDirectory)
    )
  );

  runInAction(() => {
    store.tours = visibleTours(tours.flat(), TOUR_CONTEXT);

    if (store.activeTour) {
      const tour = store.tours.find(tour => tour.id === store.activeTour!.tour.id);

      if (tour) {
        if (!comparer.structural(store.activeTour.tour, tour)) {
          // Reload without interrupting the current reading session.
          set(store.activeTour.tour, tour);
        }
      } else {
        endCurrentCodeTour();
      }
    }
  });

  vscode.commands.executeCommand("setContext", HAS_TOURS_KEY, store.hasTours);
  updateMarkerTitles();
}

vscode.workspace.onDidChangeWorkspaceFolders(discoverTours);

const watcher = vscode.workspace.createFileSystemWatcher(
  `**/{${tourDirectories(customDirectory).join(",")}}/**/*.tour`
);

watcher.onDidChange(discoverTours);
watcher.onDidCreate(discoverTours);
watcher.onDidDelete(discoverTours);

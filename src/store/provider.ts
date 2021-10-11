// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as jexl from "jexl";
import { comparer, runInAction, set } from "mobx";
import * as os from "os";
import * as vscode from "vscode";
import { CodeTour, store } from ".";
import { EXTENSION_NAME, VSCODE_DIRECTORY } from "../constants";
import { CodeTourNode, FolderCodeTourNode } from "../player/tree/nodes";
import { readUriContents, updateMarkerTitles } from "../utils";
import { endCurrentCodeTour } from "./actions";

export const MAIN_TOUR_FILES = [
  ".tour",
  `${VSCODE_DIRECTORY}/main.tour`,
  "main.tour"
];

const SUB_TOUR_DIRECTORIES = [
  `${VSCODE_DIRECTORY}/tours`,
  ".github/tours",
  `.tours`
];

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
  .get("customTourDirectory", null);

if (customDirectory) {
  SUB_TOUR_DIRECTORIES.push(customDirectory);
}

export async function discoverTours(): Promise<void> {
  const tours = await Promise.all(
    vscode.workspace.workspaceFolders!.map(async workspaceFolder => {
      const mainTours = await discoverMainTours(workspaceFolder.uri);
      const tours = await discoverSubTours(workspaceFolder.uri);
      const folders = await discoverFolders(workspaceFolder.uri)

      if (mainTours) {
        tours.push(...mainTours);
      }

      if (folders) {
        tours.push(...folders)
      }

      return tours;
    })
  );

  runInAction(() => {
    tours.map(tour => {
      if (tour instanceof CodeTourNode) {
        store.tours.push(tour)
      }
    })
    store.tours = tours
      .flat()
      .sort((a, b) => a.title.localeCompare(b.title))
      .filter(tour => !tour.when || jexl.evalSync(tour.when, TOUR_CONTEXT));

    if (store.activeTour) {
      const tour = store.tours.find(
        tour => tour.id === store.activeTour!.tour.id
      );

      if (tour) {
        if (!comparer.structural(store.activeTour.tour, tour)) {
          // Since the active tour could be already observed,
          // we want to update it in place with the new properties.
          set(store.activeTour.tour, tour);
        }
      } else {
        // The user deleted the tour
        // file that's associated with
        // the active tour, so end it
        endCurrentCodeTour();
      }
    }
  });

  vscode.commands.executeCommand("setContext", HAS_TOURS_KEY, store.hasTours);

  updateMarkerTitles();
}

async function discoverMainTours(
  workspaceUri: vscode.Uri
): Promise<vscode.TreeItem[]> {
  const tours = await Promise.all(
    MAIN_TOUR_FILES.map(async tourFile => {
      try {
        const uri = vscode.Uri.joinPath(workspaceUri, tourFile);

        const mainTourContent = await readUriContents(uri);
        const tour = JSON.parse(mainTourContent);
        tour.id = decodeURIComponent(uri.toString());
        return tour;
      } catch {}
    })
  );

  return tours.filter(tour => tour);
}

async function readTours(uri: vscode.Uri, folder?: String): Promise<vscode.TreeItem[]> {
  try {
    const tourFiles = await vscode.workspace.fs.readDirectory(uri);
    const tours = await Promise.all(
      tourFiles.map(async ([file, type]) => {
        const fileUri = vscode.Uri.joinPath(uri, file);
        if (type === vscode.FileType.File) {
          return readTourFile(fileUri, folder);
        }
      })
    );

    // @ts-ignore
    return tours.flat().filter(tour => tour);
  } catch {
    return [];
  }
}

async function readTourDirectory(uri: vscode.Uri, folder?: String): Promise<vscode.TreeItem[]> {
  try {
    const tourFiles = await vscode.workspace.fs.readDirectory(uri);
    const folders = await Promise.all(
      tourFiles.map(async ([file, type]) => {
        const fileUri = vscode.Uri.joinPath(uri, file);
        if (type !== vscode.FileType.File) {
          const folder = { name: file, steps: readTourDirectory(fileUri, file) }
          return folder;
        }
      })
    );

    // @ts-ignore
    return folders.flat().filter(folder => folder);
  } catch {
    return [];
  }
}

async function readTourFile(
  tourUri: vscode.Uri,
  folder?: String,
): Promise<CodeTour | undefined> {
  try {
    const tourContent = await readUriContents(tourUri);
    const tour = JSON.parse(tourContent);
    tour.id = decodeURIComponent(tourUri.toString());
    tour.folder = folder;
    return tour;
  } catch {}
}

async function discoverSubTours(workspaceUri: vscode.Uri): Promise<CodeTour[]]> {
  const tours = await Promise.all(
    SUB_TOUR_DIRECTORIES.map(directory => {
      const uri = vscode.Uri.joinPath(workspaceUri, directory);
      return readTours(uri);
    })
  );

  return tours.flat();
}

async function discoverFolders(workspaceUri: vscode.Uri): Promise<FolderCodeTourNode[]> {
  const folders = await Promise.all(
    SUB_TOUR_DIRECTORIES.map(directory => {
      const uri = vscode.Uri.joinPath(workspaceUri, directory);
      return readTourDirectory(uri);
    })
  );

  return folders.flat();
}

vscode.workspace.onDidChangeWorkspaceFolders(discoverTours);

const watcher = vscode.workspace.createFileSystemWatcher(
  `**/{${SUB_TOUR_DIRECTORIES.join(",")}/**/*.tour`
);

watcher.onDidChange(discoverTours);
watcher.onDidCreate(discoverTours);
watcher.onDidDelete(discoverTours);

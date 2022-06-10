// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as jexl from "jexl";
import { comparer, runInAction, set } from "mobx";
import * as os from "os";
import * as vscode from "vscode";
import { CodeTour, CodeTourFolder, store } from ".";
import { EXTENSION_NAME, VSCODE_DIRECTORY } from "../constants";
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
  const root: CodeTourFolder = {
    title: "",
    tours: []
  };
  
  for (const workspaceFolder of vscode.workspace.workspaceFolders!) {
    await discoverSubTours(workspaceFolder.uri, root);
    
    const mainTours = await discoverMainTours(workspaceFolder.uri);

    if (mainTours) {
      root.tours.push(...mainTours);
    }
  }

  runInAction(() => {
    const tours: CodeTour[] = [];
    
    sortAndFilterFolder(root, tours);
    
    store.root = root;
    store.tours = tours;

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

function sortAndFilterFolder(folder: CodeTourFolder, tours: CodeTour[]): void {
  folder.tours
    .sort((a, b) => a.title.localeCompare(b.title))
    .filter(tour => 'tours' in tour || !tour.when || jexl.evalSync(tour.when, TOUR_CONTEXT));
  
  for (const tour of folder.tours) {
    if ('tours' in tour) {
      sortAndFilterFolder(tour, tours)
    } else {
      tours.push(tour);
    }
  }
}

async function discoverMainTours(workspaceUri: vscode.Uri): Promise<CodeTour[]> {
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

async function readTourDirectory(uri: vscode.Uri, folder: CodeTourFolder): Promise<void> {
  try {
    const tourFiles = await vscode.workspace.fs.readDirectory(uri);

    await Promise.all(
      tourFiles.map(async ([file, type]) => {
        const fileUri = vscode.Uri.joinPath(uri, file);
        if (type === vscode.FileType.File) {
          return readTourFile(fileUri, folder);
        } else {
          const newFolder = findOrCreateFolder(file, folder);

          return readTourDirectory(fileUri, newFolder);
        }
      })
    );
  } catch {}
}

async function readTourFile(tourUri: vscode.Uri, folder: CodeTourFolder): Promise<void> {
  try {
    const tourContent = await readUriContents(tourUri);
    const tour = JSON.parse(tourContent);
    tour.id = decodeURIComponent(tourUri.toString());
    folder.tours.push(tour);
  } catch {}
}

async function discoverSubTours(workspaceUri: vscode.Uri, folder: CodeTourFolder): Promise<void> {
  await Promise.all(
    SUB_TOUR_DIRECTORIES.map(directory => {
      const uri = vscode.Uri.joinPath(workspaceUri, directory);
      return readTourDirectory(uri, folder);
    })
  );
}

function findOrCreateFolder(title: string, folder: CodeTourFolder): CodeTourFolder {
  for(const tour of folder.tours) {
    if ('tours' in tour && tour.title === title) {
      return tour;
    }
  }

  const newFolder = {
    title,
    tours: []
  };

  folder.tours.push(newFolder);
  
  return newFolder;
}

vscode.workspace.onDidChangeWorkspaceFolders(discoverTours);

const watcher = vscode.workspace.createFileSystemWatcher(
  `**/{${SUB_TOUR_DIRECTORIES.join(",")}}/**`
);

watcher.onDidChange(discoverTours);
watcher.onDidCreate(discoverTours);
watcher.onDidDelete(discoverTours);

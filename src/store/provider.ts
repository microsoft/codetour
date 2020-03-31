import { comparer, runInAction, set } from "mobx";
import * as vscode from "vscode";
import { CodeTour, store } from ".";
import { EXTENSION_NAME, VSCODE_DIRECTORY } from "../constants";
import { endCurrentCodeTour } from "./actions";

const MAIN_TOUR_FILES = [
  `${EXTENSION_NAME}.json`,
  "tour.json",
  `${VSCODE_DIRECTORY}/${EXTENSION_NAME}.json`,
  `${VSCODE_DIRECTORY}/tour.json`
];

const SUB_TOUR_DIRECTORY = `${VSCODE_DIRECTORY}/tours`;
const HAS_TOURS_KEY = `${EXTENSION_NAME}:hasTours`;

export async function discoverTours(workspaceRoot: string): Promise<void> {
  const mainTours = await discoverMainTours(workspaceRoot);
  const tours = await discoverSubTours(workspaceRoot);

  if (mainTours) {
    tours.push(...mainTours);
  }

  runInAction(() => {
    store.tours = tours.sort((a, b) => a.title.localeCompare(b.title));

    if (store.activeTour) {
      const tour = tours.find(tour => tour.id === store.activeTour!.tour.id);

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
}

async function discoverMainTours(workspaceRoot: string): Promise<CodeTour[]> {
  const tours = await Promise.all(
    MAIN_TOUR_FILES.map(async tourFile => {
      try {
        const uri = vscode.Uri.parse(`${workspaceRoot}/${tourFile}`);
        const mainTourContent = (
          await vscode.workspace.fs.readFile(uri)
        ).toString();
        const tour = JSON.parse(mainTourContent);
        tour.id = uri.toString();
        return tour;
      } catch {}
    })
  );

  return tours.filter(tour => tour);
}

async function discoverSubTours(workspaceRoot: string): Promise<CodeTour[]> {
  try {
    const tourDirectory = `${workspaceRoot}/${SUB_TOUR_DIRECTORY}`;
    const uri = vscode.Uri.parse(tourDirectory);
    const tourFiles = await vscode.workspace.fs.readDirectory(uri);
    return Promise.all(
      tourFiles
        .filter(([, type]) => type === vscode.FileType.File)
        .map(async ([file]) => {
          const tourUri = vscode.Uri.parse(`${tourDirectory}/${file}`);
          const tourContent = (
            await vscode.workspace.fs.readFile(tourUri)
          ).toString();
          const tour = JSON.parse(tourContent);
          tour.id = tourUri.toString();
          return tour;
        })
    );
  } catch {
    return [];
  }
}

function updateTours() {
  const workspaceRoot = vscode.workspace.workspaceFolders![0].uri.toString();
  discoverTours(workspaceRoot);
}

const watcher = vscode.workspace.createFileSystemWatcher(
  "**/.vscode/tours/*.json"
);

watcher.onDidChange(updateTours);
watcher.onDidCreate(updateTours);
watcher.onDidDelete(updateTours);

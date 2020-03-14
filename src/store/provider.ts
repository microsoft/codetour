import * as vscode from "vscode";
import { CodeTour } from ".";
import { store } from ".";
import { VSCODE_DIRECTORY, EXTENSION_NAME } from "../constants";
import { endCurrentCodeTour } from "./actions";
import { set } from "mobx";

const MAIN_TOUR_FILES = [
  `${EXTENSION_NAME}.json`,
  "tour.json",
  `${VSCODE_DIRECTORY}/${EXTENSION_NAME}.json`,
  `${VSCODE_DIRECTORY}/tour.json`
];

const SUB_TOUR_DIRECTORY = `${VSCODE_DIRECTORY}/tours`;
const HAS_TOURS_KEY = `${EXTENSION_NAME}:hasTours`;

export async function discoverTours(workspaceRoot: string): Promise<void> {
  const mainTour = await discoverMainTour(workspaceRoot);
  const tours = await discoverSubTours(workspaceRoot);

  if (mainTour) {
    tours.push(mainTour);
  }

  store.tours = tours.sort((a, b) => a.title.localeCompare(b.title));

  if (store.activeTour) {
    const tour = tours.find(tour => tour.id === store.activeTour!.id);

    if (tour) {
      // Since the active tour could be already observed,
      // we want to update it in place with the new properties.
      set(store.activeTour.tour, tour);
    } else {
      // The user deleted the tour
      // file that's associated with
      // the active tour
      endCurrentCodeTour();
    }
  }

  vscode.commands.executeCommand("setContext", HAS_TOURS_KEY, store.hasTours);
}

async function discoverMainTour(
  workspaceRoot: string
): Promise<CodeTour | null> {
  for (const tourFile of MAIN_TOUR_FILES) {
    try {
      const uri = vscode.Uri.parse(`${workspaceRoot}/${tourFile}`);
      const mainTourContent = (
        await vscode.workspace.fs.readFile(uri)
      ).toString();
      const tour = JSON.parse(mainTourContent);
      tour.id = uri.toString();
      return tour;
    } catch {}
  }

  return null;
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

const watcher = vscode.workspace.createFileSystemWatcher(
  "**/.vscode/tours/*.json"
);

function updateTours() {
  const workspaceRoot = vscode.workspace.workspaceFolders![0].uri.toString();
  discoverTours(workspaceRoot);
}

watcher.onDidChange(updateTours);
watcher.onDidCreate(updateTours);
watcher.onDidDelete(updateTours);

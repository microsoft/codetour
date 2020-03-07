import * as vscode from "vscode";
import { CodeTour } from ".";
import { store } from ".";
import { VSCODE_DIRECTORY, EXTENSION_NAME } from "../constants";

const MAIN_TOUR_FILES = [
  `${EXTENSION_NAME}.json`,
  "tour.json",
  `${VSCODE_DIRECTORY}/${EXTENSION_NAME}.json`,
  `${VSCODE_DIRECTORY}/tour.json`
];

const SUB_TOUR_DIRECTORY = `${VSCODE_DIRECTORY}/tours`;

const HAS_TOURS_KEY = `${EXTENSION_NAME}:hasTours`;

export async function discoverTours(workspaceRoot: string): Promise<void> {
  store.mainTour = await discoverMainTour(workspaceRoot);
  store.subTours = await discoverSubTours(workspaceRoot);

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
      return JSON.parse(mainTourContent);
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
          return JSON.parse(tourContent);
        })
    );
  } catch {
    return [];
  }
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
  commands,
  EventEmitter,
  Memento,
  Uri,
  window,
  workspace
} from "vscode";
import { CodeTour, store } from ".";
import { EXTENSION_NAME, FS_SCHEME, FS_SCHEME_CONTENT } from "../constants";
import { startPlayer, stopPlayer } from "../player";
import {
  getStepFileUri,
  getWorkspaceKey,
  getWorkspaceUri,
  readUriContents
} from "../utils";
import { progress } from "./storage";

const CAN_EDIT_TOUR_KEY = `${EXTENSION_NAME}:canEditTour`;
const IN_TOUR_KEY = `${EXTENSION_NAME}:inTour`;
const RECORDING_KEY = `${EXTENSION_NAME}:recording`;
export const EDITING_KEY = `${EXTENSION_NAME}:isEditing`;

const _onDidEndTour = new EventEmitter<CodeTour>();
export const onDidEndTour = _onDidEndTour.event;

const _onDidStartTour = new EventEmitter<[CodeTour, number]>();
export const onDidStartTour = _onDidStartTour.event;

export function startCodeTour(
  tour: CodeTour,
  stepNumber?: number,
  workspaceRoot?: Uri,
  startInEditMode: boolean = false,
  canEditTour: boolean = true,
  tours?: CodeTour[]
) {
  startPlayer();

  if (!workspaceRoot) {
    workspaceRoot = getWorkspaceUri(tour);
  }

  const step = stepNumber ? stepNumber : tour.steps.length ? 0 : -1;
  store.activeTour = {
    tour,
    step,
    workspaceRoot,
    thread: null,
    tours
  };

  commands.executeCommand("setContext", IN_TOUR_KEY, true);
  commands.executeCommand("setContext", CAN_EDIT_TOUR_KEY, canEditTour);

  if (startInEditMode) {
    store.isRecording = true;
    store.isEditing = true;
    commands.executeCommand("setContext", RECORDING_KEY, true);
    commands.executeCommand("setContext", EDITING_KEY, true);
  } else {
    _onDidStartTour.fire([tour, step]);
  }
}

export async function selectTour(
  tours: CodeTour[],
  workspaceRoot?: Uri
): Promise<boolean> {
  const items: any[] = tours.map(tour => ({
    label: tour.title!,
    tour: tour,
    detail: tour.description
  }));

  if (items.length === 1) {
    startCodeTour(items[0].tour, 0, workspaceRoot, false, true, tours);
    return true;
  }

  const response = await window.showQuickPick(items, {
    placeHolder: "Select the tour to start..."
  });

  if (response) {
    startCodeTour(response.tour, 0, workspaceRoot, false, true, tours);
    return true;
  }

  return false;
}

export async function endCurrentCodeTour(fireEvent: boolean = true) {
  if (fireEvent) {
    _onDidEndTour.fire(store.activeTour!.tour);
  }

  if (store.isRecording) {
    store.isRecording = false;
    store.isEditing = false;
    commands.executeCommand("setContext", RECORDING_KEY, false);
    commands.executeCommand("setContext", EDITING_KEY, false);
  }

  stopPlayer();

  store.activeTour = null;
  commands.executeCommand("setContext", IN_TOUR_KEY, false);

  window.visibleTextEditors.forEach(editor => {
    if (
      editor.document.uri.scheme === FS_SCHEME ||
      editor.document.uri.scheme === FS_SCHEME_CONTENT
    ) {
      editor.hide();
    }
  });
}

export function moveCurrentCodeTourBackward() {
  --store.activeTour!.step;

  _onDidStartTour.fire([store.activeTour!.tour, store.activeTour!.step]);
}

export async function moveCurrentCodeTourForward() {
  await progress.update();

  store.activeTour!.step++;

  _onDidStartTour.fire([store.activeTour!.tour, store.activeTour!.step]);
}

function isLiveShareWorkspace(uri: Uri) {
  return (
    uri.path.endsWith("Visual Studio Live Share.code-workspace") ||
    uri.scheme === "vsls"
  );
}

export async function promptForTour(
  globalState: Memento,
  workspaceRoot: Uri = getWorkspaceKey(),
  tours: CodeTour[] = store.tours
): Promise<boolean> {
  const key = `${EXTENSION_NAME}:${workspaceRoot}`;
  if (
    tours.length > 0 &&
    !globalState.get(key) &&
    !isLiveShareWorkspace(workspaceRoot) &&
    workspace.getConfiguration("codetour").get("promptForWorkspaceTours", true)
  ) {
    globalState.update(key, true);

    if (
      await window.showInformationMessage(
        "This workspace has guided tours you can take to get familiar with the codebase.",
        "Start CodeTour"
      )
    ) {
      const primaryTour =
        tours.find(tour => tour.isPrimary) ||
        tours.find(tour => tour.title.match(/^#?1\s+-/));

      if (primaryTour) {
        startCodeTour(primaryTour, 0, workspaceRoot, false, undefined, tours);
        return true;
      } else {
        return selectTour(tours, workspaceRoot);
      }
    }
  }

  return false;
}

export async function exportTour(tour: CodeTour) {
  const newTour = {
    ...tour
  };

  newTour.steps = await Promise.all(
    newTour.steps.map(async step => {
      if (step.contents || step.uri || !step.file) {
        return step;
      }

      const workspaceRoot = getWorkspaceUri(tour);
      const stepFileUri = await getStepFileUri(step, workspaceRoot, tour.ref);
      const contents = await readUriContents(stepFileUri);

      delete step.markerTitle;

      return {
        ...step,
        contents
      };
    })
  );

  delete newTour.id;
  delete newTour.ref;

  return JSON.stringify(newTour, null, 2);
}

export async function recordTour(workspaceRoot: Uri) {
  commands.executeCommand(`${EXTENSION_NAME}.recordTour`, workspaceRoot);
}

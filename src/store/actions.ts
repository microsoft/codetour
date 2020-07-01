import { commands, EventEmitter, Memento, Uri, window } from "vscode";
import { CodeTour, store } from ".";
import { EXTENSION_NAME, FS_SCHEME, FS_SCHEME_CONTENT } from "../constants";
import { startPlayer, stopPlayer } from "../player";
import {
  getStepFileUri,
  getWorkspaceKey,
  getWorkspaceUri,
  readUriContents
} from "../utils";

const CAN_EDIT_TOUR_KEY = `${EXTENSION_NAME}:canEditTour`;
const IN_TOUR_KEY = `${EXTENSION_NAME}:inTour`;
const RECORDING_KEY = `${EXTENSION_NAME}:recording`;

const _onDidEndTour = new EventEmitter<CodeTour>();
export const onDidEndTour = _onDidEndTour.event;

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

  store.activeTour = {
    tour,
    step: stepNumber ? stepNumber : tour.steps.length ? 0 : -1,
    workspaceRoot,
    thread: null,
    tours
  };

  commands.executeCommand("setContext", IN_TOUR_KEY, true);
  commands.executeCommand("setContext", CAN_EDIT_TOUR_KEY, canEditTour);

  if (startInEditMode) {
    store.isRecording = true;
    commands.executeCommand("setContext", RECORDING_KEY, true);
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

export async function endCurrentCodeTour() {
  _onDidEndTour.fire(store.activeTour!.tour);

  if (store.isRecording) {
    store.isRecording = false;
    commands.executeCommand("setContext", RECORDING_KEY, false);
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
}

export function moveCurrentCodeTourForward() {
  store.activeTour!.step++;
}

export async function promptForTour(
  globalState: Memento,
  workspaceRoot: Uri = getWorkspaceKey(),
  tours: CodeTour[] = store.tours
): Promise<boolean> {
  const key = `${EXTENSION_NAME}:${workspaceRoot}`;
  if (tours.length > 0 && !globalState.get(key)) {
    globalState.update(key, true);

    if (
      await window.showInformationMessage(
        "This workspace has guided tours you can take to get familiar with the codebase.",
        "Start CodeTour"
      )
    ) {
      const primaryTour = tours.find(tour => tour.isPrimary);

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

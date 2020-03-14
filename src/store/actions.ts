import {
  commands,
  Comment,
  CommentAuthorInformation,
  CommentMode,
  comments,
  CommentThread,
  CommentThreadCollapsibleState,
  MarkdownString,
  Range,
  TextEditorRevealType,
  Uri,
  window,
  workspace,
  TextDocument,
  CommentController
} from "vscode";
import { CodeTour, store } from ".";
import { EXTENSION_NAME } from "../constants";
import { reaction } from "mobx";
import { api } from "../git";

const IN_TOUR_KEY = `${EXTENSION_NAME}:inTour`;

const CONTROLLER_ID = "codetour";
const CONTROLLER_LABEL = "CodeTour";
const CONTROLLER_ICON = Uri.parse(
  "https://cdn.jsdelivr.net/gh/vsls-contrib/code-tour/images/icon.png"
);

let id = 0;
export class CodeTourComment implements Comment {
  public id: string = (++id).toString();
  public contextValue: string = "";
  public mode: CommentMode = CommentMode.Preview;
  public author: CommentAuthorInformation = {
    name: CONTROLLER_LABEL,
    iconPath: CONTROLLER_ICON
  };

  constructor(
    public body: string | MarkdownString,
    public label: string = "",
    public parent: CommentThread
  ) {}
}

let controller: CommentController;

async function showDocument(uri: Uri, range: Range) {
  const document =
    window.visibleTextEditors.find(
      editor => editor.document.uri.toString() === uri.toString()
    ) || (await window.showTextDocument(uri));

  document.revealRange(range, TextEditorRevealType.InCenter);
}

async function renderCurrentStep() {
  if (store.activeTour!.thread) {
    store.activeTour!.thread.dispose();
  }

  const currentTour = store.activeTour!.tour;
  const currentStep = store.activeTour!.step;

  const step = currentTour!.steps[currentStep];

  if (!step) {
    return;
  }

  // Adjust the line number, to allow the user to specify
  // them in 1-based format, not 0-based
  const line = step.line - 1;
  const range = new Range(line, 0, line, 0);
  let label = `Step #${currentStep + 1} of ${currentTour!.steps.length}`;

  if (currentTour.title) {
    label += ` (${currentTour.title})`;
  }

  const workspaceRoot = workspace.workspaceFolders
    ? workspace.workspaceFolders[0].uri.toString()
    : "";
  let uri = step.uri
    ? Uri.parse(step.uri)
    : Uri.parse(`${workspaceRoot}/${step.file}`);

  if (currentTour.ref && currentTour.ref !== "HEAD") {
    const repo = api.getRepository(uri);

    if (
      repo &&
      repo.state.HEAD &&
      repo.state.HEAD.name !== currentTour.ref &&
      repo.state.HEAD.commit !== currentTour.ref
    ) {
      uri = await api.toGitUri(uri, currentTour.ref);
    }
  }

  store.activeTour!.thread = controller.createCommentThread(uri, range, []);
  store.activeTour!.thread.comments = [
    new CodeTourComment(step.description, label, store.activeTour!.thread!)
  ];

  const contextValues = [];
  if (currentStep > 0) {
    contextValues.push("hasPrevious");
  }

  if (currentStep < currentTour.steps.length - 1) {
    contextValues.push("hasNext");
  }

  store.activeTour!.thread.contextValue = contextValues.join(".");
  store.activeTour!.thread.collapsibleState =
    CommentThreadCollapsibleState.Expanded;

  showDocument(uri, range);
}

export function startCodeTour(tour: CodeTour, stepNumber?: number) {
  if (controller) {
    controller.dispose();
  }

  controller = comments.createCommentController(
    CONTROLLER_ID,
    CONTROLLER_LABEL
  );

  controller.commentingRangeProvider = {
    provideCommentingRanges: (document: TextDocument) => {
      if (store.isRecording) {
        return [new Range(0, 0, document.lineCount, 0)];
      } else {
        return null;
      }
    }
  };

  store.activeTour = {
    id: tour.id,
    tour,
    step: stepNumber ? stepNumber : tour.steps.length ? 0 : -1,
    thread: null
  };

  commands.executeCommand("setContext", IN_TOUR_KEY, true);
}

const KEEP_RECORDING_RESPONSE = "Continue Recording";
export async function endCurrentCodeTour() {
  if (
    store.isRecording &&
    store.activeTour &&
    store.activeTour.tour.steps.length > 0
  ) {
    const response = await window.showInformationMessage(
      "Are you sure you want to exit the current recording?",
      "Exit",
      KEEP_RECORDING_RESPONSE
    );
    if (response === KEEP_RECORDING_RESPONSE) {
      return;
    } else {
      store.isRecording = false;
      commands.executeCommand("setContext", "codetour:recording", false);
    }
  }

  if (store.activeTour?.thread) {
    store.activeTour!.thread.dispose();
    store.activeTour!.thread = null;
  }

  if (controller) {
    controller.dispose();
  }

  store.activeTour = null;
  commands.executeCommand("setContext", IN_TOUR_KEY, false);
}

export function moveCurrentCodeTourBackward() {
  --store.activeTour!.step;
}

export function moveCurrentCodeTourForward() {
  store.activeTour!.step++;
}

export function resumeCurrentCodeTour() {
  showDocument(store.activeTour!.thread!.uri, store.activeTour!.thread!.range);
}

reaction(
  () => [
    store.activeTour
      ? [
          store.activeTour.step,
          store.activeTour.tour.title,
          store.activeTour.tour.steps.map(step => [
            step.title,
            step.description,
            step.line
          ])
        ]
      : null
  ],
  () => {
    if (store.activeTour) {
      renderCurrentStep();
    }
  }
);

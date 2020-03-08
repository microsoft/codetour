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

const IN_TOUR_KEY = `${EXTENSION_NAME}:inTour`;

const CONTROLLER_ID = "codetour";
const CONTROLLER_LABEL = "Code Tour";
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

export let currentThread: CommentThread | null = null;

export function updateCurrentThread(thread: CommentThread) {
  currentThread = thread;
}

async function showDocument(uri: Uri, range: Range) {
  const document =
    window.visibleTextEditors.find(
      editor => editor.document.uri.toString() === uri.toString()
    ) || (await window.showTextDocument(uri));

  document.revealRange(range, TextEditorRevealType.InCenter);
}

export async function renderCurrentStep() {
  if (currentThread) {
    currentThread.dispose();
  }

  const currentTour = store.currentTour!;
  const currentStep = store.currentStep;

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
  const uri = step.uri
    ? Uri.parse(step.uri)
    : Uri.parse(`${workspaceRoot}/${step.file}`);

  currentThread = controller.createCommentThread(uri, range, []);
  currentThread.comments = [
    new CodeTourComment(step.description, label, currentThread!)
  ];

  const contextValues = [];
  if (store.currentStep > 0) {
    contextValues.push("hasPrevious");
  }

  if (currentStep < currentTour.steps.length - 1) {
    contextValues.push("hasNext");
  }

  currentThread.contextValue = contextValues.join(".");
  currentThread.collapsibleState = CommentThreadCollapsibleState.Expanded;

  showDocument(uri, range);
}

export function startCodeTour(tour: CodeTour, stepNumber?: number) {
  store.currentTour = tour;
  store.currentStep = stepNumber ? stepNumber : tour.steps.length ? 0 : -1;

  commands.executeCommand("setContext", IN_TOUR_KEY, true);

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

  renderCurrentStep();
}

const KEEP_RECORDING_RESPONSE = "Continue Recording";
export async function endCurrentCodeTour() {
  if (store.isRecording) {
    const response = await window.showInformationMessage(
      "Are you sure you want to exit the current recording?",
      "Exit",
      KEEP_RECORDING_RESPONSE
    );
    if (response === KEEP_RECORDING_RESPONSE) {
      return;
    } else {
      commands.executeCommand("setContext", "codetour:recording", false);
    }
  }
  if (currentThread) {
    currentThread.dispose();
    currentThread = null;
  }

  if (controller) {
    controller.dispose();
  }

  commands.executeCommand("setContext", IN_TOUR_KEY, false);

  store.currentTour = null;
}

export function moveCurrentCodeTourBackward() {
  --store.currentStep;

  renderCurrentStep();
}

export function moveCurrentCodeTourForward() {
  store.currentStep++;

  renderCurrentStep();
}

export function resumeCurrentCodeTour() {
  showDocument(currentThread!.uri, currentThread!.range);
}

import {
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
  workspace
} from "vscode";
import { CodeTour, store } from ".";

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
    public label: string = ""
  ) {}
}

const controller = comments.createCommentController(
  CONTROLLER_ID,
  CONTROLLER_LABEL
);

let currentThread: CommentThread | null = null;

async function showDocument(uri: Uri, range: Range) {
  const document =
    window.visibleTextEditors.find(
      editor => editor.document.uri.toString() === uri.toString()
    ) || (await window.showTextDocument(uri));

  document.revealRange(range, TextEditorRevealType.InCenter);
}

async function renderStep() {
  currentThread && currentThread.dispose();

  const currentTour = store.currentTour!;
  const currentStep = store.currentStep;

  const step = currentTour!.steps[currentStep];
  const range = new Range(step.line, 0, step.line, 0);
  let label = `Step #${currentStep + 1} of ${currentTour!.steps.length}`;

  if (currentTour.title) {
    label += ` (${currentTour.title})`;
  }

  const comment = new CodeTourComment(step.description, label);

  const workspaceRoot = workspace.workspaceFolders
    ? workspace.workspaceFolders[0].uri.toString()
    : "";
  const uri = step.uri || Uri.parse(`${workspaceRoot}/${step.file}`);
  currentThread = controller.createCommentThread(uri, range, [comment]);

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

export function startCodeTour(tour: CodeTour) {
  store.currentTour = tour;
  store.currentStep = 0;

  renderStep();
}

export function endCurrentCodeTour() {
  currentThread && currentThread.dispose();
  currentThread = null;

  store.currentTour = null;
}

export function moveCurrentCodeTourBackward() {
  --store.currentStep;

  renderStep();
}

export function moveCurrentCodeTourForward() {
  store.currentStep++;

  renderStep();
}

export function resumeCurrentCodeTour() {
  showDocument(currentThread!.uri, currentThread!.range);
}

import { reaction } from "mobx";
import {
  commands,
  Comment,
  CommentAuthorInformation,
  CommentController,
  CommentMode,
  comments,
  CommentThread,
  CommentThreadCollapsibleState,
  MarkdownString,
  Range,
  Selection,
  TextDocument,
  TextEditorRevealType,
  Uri,
  window
} from "vscode";
import { ICON_URL } from "../constants";
import { store } from "../store";
import { getActiveWorkspacePath, getFileUri, getStepFileUri } from "../utils";

const CONTROLLER_ID = "codetour";
const CONTROLLER_LABEL = "CodeTour";

let id = 0;

const SHELL_SCRIPT_PATTERN = /^>>\s+(.*)$/gm;

export class CodeTourComment implements Comment {
  public id: string = (++id).toString();
  public contextValue: string = "";
  public author: CommentAuthorInformation = {
    name: CONTROLLER_LABEL,
    iconPath: Uri.parse(ICON_URL)
  };
  public body: MarkdownString;

  constructor(
    content: string,
    public label: string = "",
    public parent: CommentThread,
    public mode: CommentMode
  ) {
    const body =
      mode === CommentMode.Preview
        ? this.generatePreviewContent(content)
        : content;

    this.body = new MarkdownString(body);
    this.body.isTrusted = true;
  }

  private generatePreviewContent(content: string) {
    return content.replace(SHELL_SCRIPT_PATTERN, (_, script) => {
      const args = encodeURIComponent(JSON.stringify([script]));
      return `> [${script}](command:codetour._sendTextToTerminal?${args} "Run \\"${script}\\" in a terminal")`;
    });
  }
}

let controller: CommentController | null;

export async function focusPlayer() {
  const currentThread = store.activeTour!.thread!;
  showDocument(currentThread.uri, currentThread.range);
}

export async function startPlayer() {
  if (controller) {
    controller.dispose();
  }

  controller = comments.createCommentController(
    CONTROLLER_ID,
    CONTROLLER_LABEL
  );

  // TODO: Correctly limit the commenting ranges
  // to files within the workspace root
  controller.commentingRangeProvider = {
    provideCommentingRanges: (document: TextDocument) => {
      if (store.isRecording) {
        return [new Range(0, 0, document.lineCount, 0)];
      } else {
        return null;
      }
    }
  };
}

export async function stopPlayer() {
  if (store.activeTour?.thread) {
    store.activeTour!.thread.dispose();
    store.activeTour!.thread = null;
  }

  if (controller) {
    controller.dispose();
    controller = null;
  }
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
  const line = step.line ? step.line - 1 : 2000;
  const range = new Range(line, 0, line, 0);
  let label = `Step #${currentStep + 1} of ${currentTour!.steps.length}`;

  if (currentTour.title) {
    label += ` (${currentTour.title})`;
  }

  const workspaceRoot = getActiveWorkspacePath();
  const uri = await getStepFileUri(step, workspaceRoot, currentTour.ref);
  store.activeTour!.thread = controller!.createCommentThread(uri, range, []);

  const mode = store.isRecording ? CommentMode.Editing : CommentMode.Preview;
  const comment = new CodeTourComment(
    step.description,
    label,
    store.activeTour!.thread!,
    mode
  );

  store.activeTour!.thread.comments = [comment];

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

  let selection;
  if (step.selection) {
    // Adjust the 1-based positions
    // to the 0-based positions that
    // VS Code's editor uses.
    selection = new Selection(
      step.selection.start.line - 1,
      step.selection.start.character - 1,
      step.selection.end.line - 1,
      step.selection.end.character - 1
    );
  } else {
    selection = new Selection(range.start, range.end);
  }

  await showDocument(uri, range, selection);

  if (step.directory) {
    const directoryUri = getFileUri(workspaceRoot, step.directory);
    commands.executeCommand("revealInExplorer", directoryUri);
  }
}

async function showDocument(uri: Uri, range: Range, selection?: Selection) {
  const document =
    window.visibleTextEditors.find(
      editor => editor.document.uri.toString() === uri.toString()
    ) || (await window.showTextDocument(uri, { preserveFocus: true }));

  // TODO: Figure out how to force focus when navigating
  // to documents which are already open.

  if (selection) {
    document.selection = selection;
  }

  document.revealRange(range, TextEditorRevealType.InCenter);
}

// Watch for changes to the active tour property,
// and automatically re-render the current step in response.
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

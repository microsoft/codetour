import * as vscode from "vscode";
import { EXTENSION_NAME } from "./constants";
import { CodeTour, store } from "./store";
import {
  endCurrentCodeTour,
  moveCurrentCodeTourBackward,
  moveCurrentCodeTourForward,
  startCodeTour,
  resumeCurrentCodeTour,
  CodeTourComment,
  renderCurrentStep,
  currentThread,
  updateCurrentThread
} from "./store/actions";
import { discoverTours } from "./store/provider";
import * as path from "path";

interface CodeTourQuickPickItem extends vscode.QuickPickItem {
  tour: CodeTour;
}

export function registerCommands() {
  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.startTour`,
    async (tour?: CodeTour) => {
      if (tour) {
        return startCodeTour(tour);
      }

      let items: CodeTourQuickPickItem[] = store.subTours
        .map(tour => ({
          label: tour.title!,
          tour: tour,
          detail: tour.description
        }))
        .sort((a, b) => a.label.localeCompare(b.label));

      if (store.mainTour) {
        items.unshift({
          label: store.mainTour.title,
          tour: store.mainTour,
          detail: store.mainTour.description
        });
      }

      if (items.length === 1) {
        return startCodeTour(items[0].tour);
      }

      const response = await vscode.window.showQuickPick(items, {
        placeHolder: "Select the tour to start..."
      });

      if (response) {
        startCodeTour(response.tour);
      }
    }
  );

  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.endTour`,
    endCurrentCodeTour
  );

  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.previousTourStep`,
    moveCurrentCodeTourBackward
  );

  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.nextTourStep`,
    moveCurrentCodeTourForward
  );

  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.refreshTours`,
    async () => {
      if (vscode.workspace.workspaceFolders) {
        const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.toString();
        await discoverTours(workspaceRoot);
      }
    }
  );

  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.resumeTour`,
    resumeCurrentCodeTour
  );

  vscode.commands.registerCommand(`${EXTENSION_NAME}.recordTour`, async () => {
    const title = await vscode.window.showInputBox({
      prompt: "Specify the title of the tour"
    });

    if (!title) {
      return;
    }

    const description = await vscode.window.showInputBox({
      prompt: "Specify the description of the tour"
    });

    store.isRecording = true;
    await vscode.commands.executeCommand(
      "setContext",
      "codetour:recording",
      true
    );

    startCodeTour({
      title,
      description,
      steps: []
    });

    if (
      await vscode.window.showInformationMessage(
        "Code tour recording started! Start creating steps now.",
        "Cancel"
      )
    ) {
      endCurrentCodeTour();
      store.isRecording = false;
      vscode.commands.executeCommand("setContext", "codetour:recording", false);
    }
  });

  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.addTourStep`,
    (reply: vscode.CommentReply) => {
      if (currentThread) {
        currentThread.dispose();
      }

      store.currentStep++;
      updateCurrentThread(reply.thread);

      store.currentTour!.steps.push({
        file: vscode.workspace.asRelativePath(currentThread!.uri),
        line: currentThread!.range.start.line,
        description: reply.text
      });

      let label = `Step #${store.currentTour!.steps.length} of ${
        store.currentTour!.steps.length
      }`;

      if (store.currentTour!.steps.length > 1) {
        currentThread!.contextValue = "hasPrevious";
      }

      currentThread!.comments = [
        new CodeTourComment(reply.text, label, currentThread!)
      ];
    }
  );

  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.editTourStep`,
    async (comment: CodeTourComment) => {
      comment.parent.comments = comment.parent.comments.map(comment => {
        comment.mode = vscode.CommentMode.Editing;
        return comment;
      });
    }
  );

  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.saveTourStep`,
    async (comment: CodeTourComment) => {
      if (!comment.parent) {
        return;
      }

      const content =
        comment.body instanceof vscode.MarkdownString
          ? comment.body.value
          : comment.body;

      store.currentTour!.steps[store.currentStep].description = content;

      comment.parent.comments = comment.parent.comments.map(cmt => {
        if ((cmt as CodeTourComment).id === comment.id) {
          cmt.mode = vscode.CommentMode.Preview;
        }

        return cmt;
      });
    }
  );

  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.deleteTourStep`,
    async (comment: CodeTourComment) => {
      let thread = comment.parent;
      if (!thread) {
        return;
      }

      store.currentTour?.steps.splice(store.currentStep, 1);

      thread.dispose();

      if (store.currentTour?.steps.length === 0) {
        store.currentStep = -1;
      } else if (store.currentStep > 0) {
        store.currentStep--;
      }

      renderCurrentStep();
    }
  );

  vscode.commands.registerCommand(`${EXTENSION_NAME}.saveTour`, async () => {
    const file = await vscode.window.showInputBox({
      prompt: "Specify the name of the tour"
    });

    if (!file) {
      return;
    }

    const tour = JSON.stringify(store.currentTour, null, 2);
    const uri = vscode.Uri.parse(
      path.join(
        vscode.workspace.workspaceFolders![0].uri.toString(),
        ".vscode",
        "tours",
        `${file}.json`
      )
    );
    vscode.workspace.fs.writeFile(uri, new Buffer(tour));

    vscode.commands.executeCommand("setContext", "codetour:recording", false);
    store.isRecording = false;

    vscode.window.showInformationMessage("Code tour saved!");
    currentThread!.dispose();
    endCurrentCodeTour();
  });
}

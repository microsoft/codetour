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
  renderCurrentStep
} from "./store/actions";
import { discoverTours } from "./store/provider";
import { CodeTourNode, CodeTourStepNode } from "./tree/nodes";

interface CodeTourQuickPickItem extends vscode.QuickPickItem {
  tour: CodeTour;
}

export function registerCommands() {
  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.startTour`,
    async (tour?: CodeTour | CodeTourNode, stepNumber?: number) => {
      if (tour) {
        const targetTour = tour instanceof CodeTourNode ? tour.tour : tour;
        return startCodeTour(targetTour, stepNumber);
      }

      let items: CodeTourQuickPickItem[] = store.tours.map(tour => ({
        label: tour.title!,
        tour: tour,
        detail: tour.description
      }));

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
      prompt: "(Optional) Specify the description of the tour"
    });

    store.isRecording = true;
    await vscode.commands.executeCommand(
      "setContext",
      "codetour:recording",
      true
    );

    startCodeTour({
      id: "",
      title,
      description,
      steps: []
    });

    if (
      await vscode.window.showInformationMessage(
        "Code tour recording started. Start creating steps by clicking the + button to the left of each line of code.",
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
      if (store.activeTour!.thread) {
        store.activeTour!.thread.dispose();
      }

      store.activeTour!.step++;
      store.activeTour!.thread = reply.thread;

      const tour = store.activeTour!.tour;
      const thread = store.activeTour!.thread;

      tour.steps.push({
        file: vscode.workspace.asRelativePath(thread!.uri),
        line: thread!.range.start.line + 1,
        description: reply.text
      });

      let label = `Step #${tour.steps.length} of ${tour.steps.length}`;

      if (tour.steps.length > 1) {
        thread!.contextValue = "hasPrevious";
      }

      thread!.comments = [new CodeTourComment(reply.text, label, thread!)];
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

      store.activeTour!.tour!.steps[
        store.activeTour!.step
      ].description = content;

      comment.parent.comments = comment.parent.comments.map(cmt => {
        if ((cmt as CodeTourComment).id === comment.id) {
          cmt.mode = vscode.CommentMode.Preview;
        }

        return cmt;
      });
    }
  );

  function saveTourIfNeccessary(tour: CodeTour) {
    if (tour.id) {
      const uri = vscode.Uri.parse(tour.id);
      delete tour.id;
      const tourContent = JSON.stringify(tour, null, 2);
      vscode.workspace.fs.writeFile(uri, new Buffer(tourContent));
    }
  }

  async function updateTourProperty(tour: CodeTour, property: string) {
    const propertyValue = await vscode.window.showInputBox({
      prompt: `Enter the ${property} for this tour`,
      // @ts-ignore
      value: tour[property]
    });

    if (!propertyValue) {
      return;
    }

    // @ts-ignore
    tour[property] = propertyValue;

    saveTourIfNeccessary(tour);
  }

  function moveStep(tour: CodeTour, stepNumber: number, movement: number) {
    const step = tour.steps[stepNumber];
    tour.steps.splice(stepNumber, 1);
    tour.steps.splice(stepNumber + movement, 0, step);

    saveTourIfNeccessary(tour);
  }

  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.moveTourStepBack`,
    (node: CodeTourStepNode) => moveStep(node.tour, node.stepNumber, -1)
  );

  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.moveTourStepForward`,
    (node: CodeTourStepNode) => moveStep(node.tour, node.stepNumber, 1)
  );

  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.changeTourDescription`,
    (node: CodeTourNode) => updateTourProperty(node.tour, "description")
  );

  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.changeTourTitle`,
    (node: CodeTourNode) => updateTourProperty(node.tour, "title")
  );

  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.deleteTour`,
    async (node: CodeTourNode) => {
      if (store.activeTour && node.tour.title === store.activeTour.tour.title) {
        await endCurrentCodeTour();
      }

      if (node.tour.id) {
        const uri = vscode.Uri.parse(node.tour.id);
        vscode.workspace.fs.delete(uri);
      }
    }
  );

  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.deleteTourStep`,
    async (comment: CodeTourComment) => {
      let thread = comment.parent;
      if (!thread) {
        return;
      }

      store.activeTour!.tour?.steps.splice(store.activeTour!.step, 1);

      thread.dispose();

      if (store.activeTour!.tour.steps.length === 0) {
        store.activeTour!.step = -1;
      } else if (store.activeTour!.step > 0) {
        store.activeTour!.step--;
      }

      renderCurrentStep();
    }
  );

  vscode.commands.registerCommand(`${EXTENSION_NAME}.saveTour`, async () => {
    const file = store
      .activeTour!.tour.title.toLocaleLowerCase()
      .replace(/\s/g, "-")
      .replace(/[^\w\d-_]/g, "");

    delete store.activeTour!.tour?.id;
    const tour = JSON.stringify(store.activeTour!.tour, null, 2);
    const workspaceRoot = vscode.workspace.workspaceFolders![0].uri.toString();
    const uri = vscode.Uri.parse(`${workspaceRoot}/.vscode/tours/${file}.json`);
    vscode.workspace.fs.writeFile(uri, new Buffer(tour));

    vscode.commands.executeCommand("setContext", "codetour:recording", false);
    store.isRecording = false;

    vscode.window.showInformationMessage(
      `The "${
        store.activeTour!.tour.title
      }" code tour was saved to to ".vscode/tours/${file}.json"`
    );
    store.activeTour!.thread!.dispose();
    endCurrentCodeTour();
  });
}

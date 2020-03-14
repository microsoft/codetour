import * as vscode from "vscode";
import { EXTENSION_NAME } from "./constants";
import { CodeTour, store } from "./store";
import {
  endCurrentCodeTour,
  moveCurrentCodeTourBackward,
  moveCurrentCodeTourForward,
  startCodeTour,
  resumeCurrentCodeTour,
  CodeTourComment
} from "./store/actions";
import { discoverTours } from "./store/provider";
import { CodeTourNode, CodeTourStepNode } from "./tree/nodes";
import { runInAction } from "mobx";
import { api, RefType } from "./git";

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

      runInAction(() => {
        store.activeTour!.thread = reply.thread;
        store.activeTour!.step++;

        const tour = store.activeTour!.tour;
        const thread = store.activeTour!.thread;
        const stepNumber = store.activeTour!.step;

        const step = {
          file: vscode.workspace.asRelativePath(thread!.uri),
          line: thread!.range.start.line + 1,
          description: reply.text
        };

        tour.steps.splice(stepNumber, 0, step);

        let label = `Step #${stepNumber + 1} of ${tour.steps.length}`;

        const contextValues = [];
        if (tour.steps.length > 1) {
          contextValues.push("hasPrevious");
        }

        if (stepNumber < tour.steps.length - 1) {
          contextValues.push("hasNext");
        }

        thread!.contextValue = contextValues.join(".");
        thread!.comments = [new CodeTourComment(reply.text, label, thread!)];
      });
    }
  );

  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.editTour`,
    async (node: CodeTourNode | vscode.CommentThread) => {
      store.isRecording = true;
      await vscode.commands.executeCommand(
        "setContext",
        "codetour:recording",
        true
      );

      if (node instanceof CodeTourNode) {
        startCodeTour(node.tour);
      } else if (store.activeTour) {
        // We need to re-start the tour so that the associated
        // comment controller is put into edit mode
        startCodeTour(store.activeTour!.tour, store.activeTour!.step);
      }
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

  function moveStep(
    movement: number,
    node: CodeTourStepNode | CodeTourComment
  ) {
    let tour, stepNumber;

    if (node instanceof CodeTourComment) {
      tour = store.activeTour!.tour;
      stepNumber = store.activeTour!.step;
    } else {
      tour = node.tour;
      stepNumber = node.stepNumber;
    }

    const step = tour.steps[stepNumber];
    tour.steps.splice(stepNumber, 1);
    tour.steps.splice(stepNumber + movement, 0, step);

    // If the user is moving the currently active step, then move
    // the tour play along with it as well.
    if (
      store.activeTour &&
      tour.id === store.activeTour.id &&
      stepNumber === store.activeTour.step
    ) {
      store.activeTour.step += movement;
    }

    saveTourIfNeccessary(tour);
  }

  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.moveTourStepBack`,
    moveStep.bind(null, -1)
  );

  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.moveTourStepForward`,
    moveStep.bind(null, 1)
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
    `${EXTENSION_NAME}.changeTourRef`,
    async (node: CodeTourNode) => {
      const uri = vscode.Uri.parse(node.tour.id!);
      const ref = await promptForTourRef(uri);
      if (ref) {
        if (ref === "HEAD") {
          delete node.tour.ref;
        } else {
          node.tour.ref = ref;
        }
      }

      saveTourIfNeccessary(node.tour);
    }
  );

  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.deleteTour`,
    async (node: CodeTourNode) => {
      if (
        await vscode.window.showInformationMessage(
          `Are you sure your want to delete the "${node.tour.title}" tour?`,
          "Delete Tour"
        )
      ) {
        if (
          store.activeTour &&
          node.tour.title === store.activeTour.tour.title
        ) {
          await endCurrentCodeTour();
        }

        if (node.tour.id) {
          const uri = vscode.Uri.parse(node.tour.id);
          vscode.workspace.fs.delete(uri);
        }
      }
    }
  );

  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.deleteTourStep`,
    async (node: CodeTourStepNode | CodeTourComment) => {
      if (
        await vscode.window.showInformationMessage(
          `Are you sure your want to delete this step?`,
          "Delete Step"
        )
      ) {
        let tour, step;

        if (node instanceof CodeTourStepNode) {
          tour = node.tour;
          step = node.stepNumber;
        } else {
          tour = store.activeTour!.tour;
          step = store.activeTour!.step;

          node.parent.dispose();
        }

        tour.steps.splice(step, 1);

        if (
          store.activeTour &&
          tour.title === store.activeTour.tour.title &&
          step === store.activeTour.step
        ) {
          if (tour.steps.length === 0) {
            store.activeTour!.step = -1;
          } else if (step > 0) {
            store.activeTour!.step--;
          }
        }

        saveTourIfNeccessary(tour);
      }
    }
  );

  interface GitRefQuickPickItem extends vscode.QuickPickItem {
    ref?: string;
  }

  async function promptForTourRef(
    uri: vscode.Uri
  ): Promise<string | undefined> {
    const repository = api.getRepository(uri);
    if (!repository) {
      return;
    }
    let items: GitRefQuickPickItem[] = [
      {
        label: "$(circle-slash) None",
        description: "Allow the tour to apply to all versions of the repo",
        ref: "HEAD",
        alwaysShow: true
      },
      {
        label: "$(git-commit) Current commit",
        description: "Keep the tour stable as the repo changes over time",
        ref: repository.state.HEAD ? repository.state.HEAD.commit! : "",
        alwaysShow: true
      }
    ];

    const tags = repository.state.refs
      .filter(ref => ref.type === RefType.Tag)
      .map(ref => ref.name!)
      .sort()
      .map(ref => ({
        label: `$(tag) ${ref}`,
        description: "Lock the tour to this tag",
        ref
      }));

    if (tags) {
      items.push(...tags);
    }

    const response = await vscode.window.showQuickPick<GitRefQuickPickItem>(
      items,
      {
        placeHolder: "Select the Git ref to associate the tour with:"
      }
    );

    if (response) {
      return response.ref;
    }
  }

  vscode.commands.registerCommand(`${EXTENSION_NAME}.saveTour`, async () => {
    const file = store
      .activeTour!.tour.title.toLocaleLowerCase()
      .replace(/\s/g, "-")
      .replace(/[^\w\d-_]/g, "");

    const tour = store.activeTour!.tour;
    delete tour.id;

    const workspaceRoot = vscode.workspace.workspaceFolders![0].uri.toString();
    const uri = vscode.Uri.parse(`${workspaceRoot}/.vscode/tours/${file}.json`);

    const ref = await promptForTourRef(uri);
    if (ref && ref !== "HEAD") {
      tour.ref = ref;
    }

    const tourContent = JSON.stringify(tour, null, 2);

    vscode.workspace.fs.writeFile(uri, new Buffer(tourContent));

    vscode.commands.executeCommand("setContext", "codetour:recording", false);
    store.isRecording = false;

    vscode.window.showInformationMessage(
      `The "${
        store.activeTour!.tour.title
      }" code tour was saved to to ".vscode/tours/${file}.json"`
    );
    store.activeTour!.thread!.dispose();
    store.activeTour = null;
    endCurrentCodeTour();
  });
}

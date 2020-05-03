import { comparer, runInAction, when } from "mobx";
import * as path from "path";
import * as vscode from "vscode";
import { workspace } from "vscode";
import { EXTENSION_NAME } from "./constants";
import { api, RefType } from "./git";
import { CodeTourComment, focusPlayer } from "./player";
import { CodeTour, store } from "./store";
import {
  endCurrentCodeTour,
  moveCurrentCodeTourBackward,
  moveCurrentCodeTourForward,
  startCodeTour,
  exportTour
} from "./store/actions";
import { discoverTours } from "./store/provider";
import { CodeTourNode, CodeTourStepNode } from "./tree/nodes";
import { getActiveWorkspacePath } from "./utils";
interface CodeTourQuickPickItem extends vscode.QuickPickItem {
  tour: CodeTour;
}

let terminal: vscode.Terminal | null;
export function registerCommands() {
  // This is a "private" command that's used exclusively
  // by the hover description for tour markers.
  vscode.commands.registerCommand(
    `${EXTENSION_NAME}._startTourById`,
    async (id: string, lineNumber: number) => {
      const tour = store.tours.find(tour => tour.id === id);
      if (tour) {
        startCodeTour(tour, lineNumber);
      }
    }
  );

  // This is a "private" command that powers the
  // ">>" shell command syntax in step comments.
  vscode.commands.registerCommand(
    `${EXTENSION_NAME}._sendTextToTerminal`,
    async (text: string) => {
      if (!terminal) {
        terminal = vscode.window.createTerminal("CodeTour");
        vscode.window.onDidCloseTerminal(term => {
          if (term.name === "CodeTour") {
            terminal = null;
          }
        });

        when(
          () => store.activeTour === null,
          () => terminal?.dispose()
        );
      }

      terminal.show();
      terminal.sendText(text, true);
    }
  );

  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.startTour`,
    async (
      tour?: CodeTour | CodeTourNode,
      stepNumber?: number,
      workspaceRoot?: vscode.Uri
    ) => {
      if (tour) {
        const targetTour = tour instanceof CodeTourNode ? tour.tour : tour;
        return startCodeTour(targetTour, stepNumber, workspaceRoot);
      }

      const items: CodeTourQuickPickItem[] = store.tours.map(tour => ({
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
    `${EXTENSION_NAME}.viewNotebook`,
    async (node: CodeTourNode) => {
      const tourUri = vscode.Uri.parse(node.tour.id);
      vscode.window.showTextDocument(tourUri);
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
        await discoverTours();
      }
    }
  );

  vscode.commands.registerCommand(`${EXTENSION_NAME}.resumeTour`, focusPlayer);

  function getTourFileUri(workspaceRoot: vscode.Uri, title: string) {
    const file = title
      .toLocaleLowerCase()
      .replace(/\s/g, "-")
      .replace(/[^\w\d-_]/g, "");

    return vscode.Uri.parse(`${workspaceRoot}/.tours/${file}.tour`);
  }

  async function checkIfTourExists(workspaceRoot: vscode.Uri, title: string) {
    const uri = getTourFileUri(workspaceRoot, title);

    try {
      const stat = await vscode.workspace.fs.stat(uri);
      return stat.type === vscode.FileType.File;
    } catch {
      return false;
    }
  }

  async function writeTourFile(
    workspaceRoot: vscode.Uri,
    title: string,
    ref?: string
  ): Promise<CodeTour> {
    const uri = getTourFileUri(workspaceRoot, title);

    const tour = { title, steps: [] };
    if (ref && ref !== "HEAD") {
      (tour as any).ref = ref;
    }

    const tourContent = JSON.stringify(tour, null, 2);
    await vscode.workspace.fs.writeFile(uri, new Buffer(tourContent));

    (tour as any).id = uri.toString();

    // @ts-ignore
    return tour as CodeTour;
  }

  interface WorkspaceQuickPickItem extends vscode.QuickPickItem {
    uri: vscode.Uri;
  }

  const REENTER_TITLE_RESPONSE = "Re-enter title";
  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.recordTour`,
    async (placeHolderTitle?: string) => {
      const title = await vscode.window.showInputBox({
        prompt: "Specify the title of the tour",
        value: placeHolderTitle
      });

      if (!title) {
        return;
      }

      let workspaceRoot = workspace.workspaceFolders![0].uri;
      if (workspace.workspaceFolders!.length > 1) {
        const items: WorkspaceQuickPickItem[] = workspace.workspaceFolders!.map(
          ({ name, uri }) => ({
            label: name,
            uri: uri
          })
        );

        const response = await vscode.window.showQuickPick(items, {
          placeHolder: "Select the workspace to save the tour to"
        });

        if (!response) {
          return;
        }

        workspaceRoot = response.uri;
      }

      const tourExists = await checkIfTourExists(workspaceRoot, title);
      if (tourExists) {
        const response = await vscode.window.showErrorMessage(
          `This workspace already includes a tour with the title "${title}."`,
          REENTER_TITLE_RESPONSE,
          "Overwrite existing tour"
        );

        if (response === REENTER_TITLE_RESPONSE) {
          return vscode.commands.executeCommand(
            `${EXTENSION_NAME}.recordTour`,
            title
          );
        } else if (!response) {
          // If the end-user closes the error
          // dialog, then cancel the recording.
          return;
        }
      }

      const ref = await promptForTourRef(workspaceRoot);
      const tour = await writeTourFile(workspaceRoot, title, ref);

      startCodeTour(tour);

      store.isRecording = true;
      await vscode.commands.executeCommand(
        "setContext",
        "codetour:recording",
        true
      );

      if (
        await vscode.window.showInformationMessage(
          "CodeTour recording started! Begin creating steps by opening a file, clicking the + button to the left of a line of code, and then adding the appropriate comments.",
          "Cancel"
        )
      ) {
        const uri = vscode.Uri.parse(tour.id);
        vscode.workspace.fs.delete(uri);

        endCurrentCodeTour();
        store.isRecording = false;
        vscode.commands.executeCommand(
          "setContext",
          "codetour:recording",
          false
        );
      }
    }
  );

  function getStepSelection() {
    const activeEditor = vscode.window.activeTextEditor;
    if (
      activeEditor &&
      activeEditor.selection &&
      !activeEditor.selection.isEmpty
    ) {
      const { start, end } = activeEditor.selection;

      // Convert the selection from 0-based
      // to 1-based to make it easier to
      // edit the JSON tour file by hand.
      const selection = {
        start: {
          line: start.line + 1,
          character: start.character + 1
        },
        end: {
          line: end.line + 1,
          character: end.character + 1
        }
      };

      const previousStep = store.activeTour!.tour.steps[
        store.activeTour!.step - 1
      ];

      // Check whether the end-user forgot to "reset"
      // the selection from the previous step, and if so,
      // ignore it from this step since it's not likely useful.
      if (
        !previousStep ||
        !previousStep.selection ||
        !comparer.structural(previousStep.selection, selection)
      ) {
        return selection;
      }
    }
  }

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

        const workspaceRoot = getActiveWorkspacePath();
        const file = path.relative(workspaceRoot, thread!.uri.toString());

        const step = {
          file,
          line: thread!.range.start.line + 1,
          description: reply.text
        };

        const selection = getStepSelection();
        if (selection) {
          (step as any).selection = selection;
        }

        tour.steps.splice(stepNumber, 0, step);

        saveTour(tour);

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
    `${EXTENSION_NAME}.editTourAtStep`,
    async (node: CodeTourStepNode) => {
      startCodeTour(node.tour, node.stepNumber, undefined, true);
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
        startCodeTour(
          store.activeTour!.tour,
          store.activeTour!.step,
          store.activeTour.workspaceRoot
        );
      }
    }
  );

  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.editTourStep`,
    async (comment: CodeTourComment) => {
      comment.parent.comments = comment.parent.comments.map(comment => {
        (comment as CodeTourComment).decodeBody();
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

      runInAction(() => {
        const tourStep = store.activeTour!.tour!.steps[store.activeTour!.step];
        tourStep.description = content;

        const selection = getStepSelection();
        if (selection) {
          tourStep.selection = selection;
        }
      });

      saveTour(store.activeTour!.tour);

      comment.parent.comments = comment.parent.comments.map(cmt => {
        if ((cmt as CodeTourComment).id === comment.id) {
          cmt.mode = vscode.CommentMode.Preview;
        }

        return cmt;
      });
    }
  );

  async function saveTour(tour: CodeTour) {
    const uri = vscode.Uri.parse(tour.id);
    const newTour = {
      ...tour
    };
    delete newTour.id;
    const tourContent = JSON.stringify(newTour, null, 2);

    return vscode.workspace.fs.writeFile(uri, new Buffer(tourContent));
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

    saveTour(tour);
  }

  function moveStep(
    movement: number,
    node: CodeTourStepNode | CodeTourComment
  ) {
    let tour: CodeTour, stepNumber: number;

    if (node instanceof CodeTourComment) {
      tour = store.activeTour!.tour;
      stepNumber = store.activeTour!.step;
    } else {
      tour = node.tour;
      stepNumber = node.stepNumber;
    }

    runInAction(async () => {
      const step = tour.steps[stepNumber];
      tour.steps.splice(stepNumber, 1);
      tour.steps.splice(stepNumber + movement, 0, step);

      // If the user is moving the currently active step, then move
      // the tour play along with it as well.
      if (
        store.activeTour &&
        tour.id === store.activeTour.tour.id &&
        stepNumber === store.activeTour.step
      ) {
        store.activeTour.step += movement;
      }

      await saveTour(tour);
    });
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
      const workspaceRoot =
        store.activeTour &&
        store.activeTour.tour.id === node.tour.id &&
        store.activeTour.workspaceRoot
          ? store.activeTour.workspaceRoot
          : workspace.getWorkspaceFolder(vscode.Uri.parse(node.tour.id))?.uri;

      if (!workspaceRoot) {
        return vscode.window.showErrorMessage(
          "You can't change the git ref of an embedded tour file."
        );
      }

      const ref = await promptForTourRef(workspaceRoot);
      if (ref) {
        if (ref === "HEAD") {
          delete node.tour.ref;
        } else {
          node.tour.ref = ref;
        }
      }

      saveTour(node.tour);
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
        if (store.activeTour && node.tour.id === store.activeTour.tour.id) {
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

        if (store.activeTour && store.activeTour.tour.id === tour.id) {
          if (
            step <= store.activeTour!.step &&
            (store.activeTour!.step > 0 || tour.steps.length === 0)
          ) {
            store.activeTour!.step--;
          }
        }

        saveTour(tour);
      }
    }
  );

  interface GitRefQuickPickItem extends vscode.QuickPickItem {
    ref?: string;
  }

  async function promptForTourRef(
    workspaceRoot: vscode.Uri
  ): Promise<string | undefined> {
    // If for some reason the Git extension isn't available,
    // then we won't be able to ask the user to select a git ref.
    if (!api || !api.getRepository) {
      return;
    }

    const repository = api.getRepository(workspaceRoot);

    // The opened project isn't a git repository, and
    // so there's no commit/tag/branch to associate the tour with.
    if (!repository) {
      return;
    }

    const currentBranch = repository.state.HEAD!.name;
    let items: GitRefQuickPickItem[] = [
      {
        label: "$(circle-slash) None",
        description:
          "Allow the tour to apply to all versions of this repository",
        ref: "HEAD",
        alwaysShow: true
      },
      {
        label: `$(git-branch) Current branch (${currentBranch})`,
        description: "Allow the tour to apply to all versions of this branch",
        ref: currentBranch,
        alwaysShow: true
      },
      {
        label: "$(git-commit) Current commit",
        description: "Keep the tour associated with a specific commit",
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
        description: "Keep the tour associated with a specific tag",
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

  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.openTourFile`,
    async () => {
      const uri = await vscode.window.showOpenDialog({
        filters: {
          Tours: ["json"]
        },
        canSelectFolders: false,
        canSelectMany: false,
        openLabel: "Open Tour"
      });

      if (!uri) {
        return;
      }

      try {
        const contents = await vscode.workspace.fs.readFile(uri[0]);
        const tour = JSON.parse(contents.toString());
        tour.id = uri[0].toString();
        startCodeTour(tour);
      } catch {
        vscode.window.showErrorMessage(
          "This file doesn't appear to be a valid tour. Please inspect its contents and try again."
        );
      }
    }
  );

  vscode.commands.registerCommand(`${EXTENSION_NAME}.openTourUrl`, async () => {
    const url = await vscode.window.showInputBox({
      prompt: "Specify the URL of the tour file to open",
      value: await vscode.env.clipboard.readText()
    });

    if (!url) {
      return;
    }

    try {
      const axios = require("axios").default;
      const response = await axios.get(url);
      const tour = response.data;
      tour.id = url;
      startCodeTour(tour);
    } catch {
      vscode.window.showErrorMessage(
        "This file doesn't appear to be a valid tour. Please inspect its contents and try again."
      );
    }
  });

  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.exportTour`,
    async (node: CodeTourNode) => {
      const uri = await vscode.window.showSaveDialog({
        filters: {
          Tours: ["json"]
        },
        saveLabel: "Export Tour"
      });

      if (!uri) {
        return;
      }

      const contents = await exportTour(node.tour);
      vscode.workspace.fs.writeFile(uri, new Buffer(contents));
    }
  );

  function setShowMarkers(showMarkers: boolean) {
    store.showMarkers = showMarkers;

    vscode.workspace
      .getConfiguration("codetour")
      .update("showMarkers", showMarkers, vscode.ConfigurationTarget.Global);

    vscode.commands.executeCommand(
      "setContext",
      "codetour:showingMarkers",
      showMarkers
    );
  }

  vscode.commands.registerCommand(`${EXTENSION_NAME}.hideMarkers`, () =>
    setShowMarkers(false)
  );

  vscode.commands.registerCommand(`${EXTENSION_NAME}.showMarkers`, () =>
    setShowMarkers(true)
  );
}

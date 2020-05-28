import { action, comparer, runInAction } from "mobx";
import * as path from "path";
import * as vscode from "vscode";
import { workspace } from "vscode";
import { EXTENSION_NAME, FS_SCHEME_CONTENT } from "../constants";
import { api, RefType } from "../git";
import { CodeTourComment } from "../player";
import { CodeTour, store } from "../store";
import { endCurrentCodeTour, startCodeTour } from "../store/actions";
import { CodeTourNode, CodeTourStepNode } from "../tree/nodes";
import { getActiveWorkspacePath } from "../utils";

export function registerRecorderCommands() {
  function getTourFileUri(workspaceRoot: vscode.Uri, title: string) {
    const file = title
      .toLocaleLowerCase()
      .replace(/\s/g, "-")
      .replace(/[^\w\d-_]/g, "");

    return workspaceRoot.with({
      path: path.join(workspaceRoot.fsPath, ".tours", `${file}.tour`)
    });
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
    const bytes = new TextEncoder().encode(tourContent);
    await vscode.workspace.fs.writeFile(uri, bytes);

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
    `${EXTENSION_NAME}.addContentStep`,
    action(async () => {
      const value = store.activeTour?.step === -1 ? "Introduction" : "";
      const title = await vscode.window.showInputBox({
        prompt: "Specify the title of the step",
        value
      });

      if (!title) {
        return;
      }

      const stepNumber = ++store.activeTour!.step;
      const tour = store.activeTour!.tour;

      tour.steps.splice(stepNumber, 0, {
        title,
        description: ""
      });

      saveTour(tour);
    })
  );

  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.addDirectoryStep`,
    action(async (uri: vscode.Uri) => {
      const stepNumber = ++store.activeTour!.step;
      const tour = store.activeTour!.tour;

      const workspaceRoot = getActiveWorkspacePath();
      const directory = path.relative(workspaceRoot, uri.fsPath);

      tour.steps.splice(stepNumber, 0, {
        directory,
        description: ""
      });

      saveTour(tour);
    })
  );

  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.addTourStep`,
    action((reply: vscode.CommentReply) => {
      if (store.activeTour!.thread) {
        store.activeTour!.thread.dispose();
      }

      store.activeTour!.thread = reply.thread;
      store.activeTour!.step++;

      const tour = store.activeTour!.tour;
      const thread = store.activeTour!.thread;
      const stepNumber = store.activeTour!.step;

      const workspaceRoot = getActiveWorkspacePath();
      const file = path.relative(workspaceRoot, thread!.uri.fsPath);

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
      thread!.comments = [
        new CodeTourComment(
          reply.text,
          label,
          thread!,
          vscode.CommentMode.Preview
        )
      ];
    })
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
    `${EXTENSION_NAME}.editTourAtStep`,
    async (node: CodeTourStepNode) => {
      startCodeTour(node.tour, node.stepNumber, undefined, true);
    }
  );

  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.previewTour`,
    async (node: CodeTourNode | vscode.CommentThread) => {
      store.isRecording = false;
      await vscode.commands.executeCommand(
        "setContext",
        "codetour:recording",
        false
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
    `${EXTENSION_NAME}.makeTourPrimary`,
    async (node: CodeTourNode) => {
      const primaryTour = node.tour;
      primaryTour.isPrimary = true;
      saveTour(primaryTour);

      store.tours
        .filter(tour => tour.id !== primaryTour.id && tour.isPrimary)
        .forEach(tour => {
          delete tour.isPrimary;
          saveTour(tour);
        });
    }
  );

  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.unmakeTourPrimary`,
    async (node: CodeTourNode) => {
      const primaryTour = node.tour;
      delete primaryTour.isPrimary;
      saveTour(primaryTour);
    }
  );

  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.saveTourStep`,
    async (comment: CodeTourComment) => {
      if (!comment.parent) {
        return;
      }

      runInAction(() => {
        const content =
          comment.body instanceof vscode.MarkdownString
            ? comment.body.value
            : comment.body;

        const tourStep = store.activeTour!.tour!.steps[store.activeTour!.step];
        tourStep.description = content;

        const selection = getStepSelection();
        if (selection) {
          tourStep.selection = selection;
        }
      });

      await saveTour(store.activeTour!.tour);
    }
  );

  async function saveTour(tour: CodeTour) {
    const uri = vscode.Uri.parse(tour.id);
    const newTour = {
      ...tour
    };
    delete newTour.id;
    const tourContent = JSON.stringify(newTour, null, 2);

    const bytes = new TextEncoder().encode(tourContent);
    return vscode.workspace.fs.writeFile(uri, bytes);
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
    `${EXTENSION_NAME}.changeTourStepTitle`,
    async (node: CodeTourStepNode) => {
      const step = node.tour.steps[node.stepNumber];
      step.title = await vscode.window.showInputBox({
        prompt: `Enter the title for this tour step`,
        value: step.title || ""
      });

      saveTour(node.tour);
    }
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
    async (node: CodeTourNode, additionalNodes: CodeTourNode[]) => {
      const messageSuffix = additionalNodes
        ? `${additionalNodes.length} selected tours`
        : `"${node.tour.title}" tour`;

      const buttonSuffix = additionalNodes
        ? `${additionalNodes.length} Tours`
        : "Tour";

      if (
        await vscode.window.showInformationMessage(
          `Are you sure your want to delete the ${messageSuffix}?`,
          `Delete ${buttonSuffix}`
        )
      ) {
        const tourIds = (additionalNodes || [node]).map(node => node.tour.id);

        if (store.activeTour && tourIds.includes(store.activeTour.tour.id)) {
          await endCurrentCodeTour();
        }

        tourIds.forEach(tourId => {
          const uri = vscode.Uri.parse(tourId);
          vscode.workspace.fs.delete(uri);
        });
      }
    }
  );

  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.deleteTourStep`,
    async (
      node: CodeTourStepNode | CodeTourComment,
      additionalNodes: CodeTourStepNode[]
    ) => {
      let tour: CodeTour, steps: number[];
      let messageSuffix = "selected step";
      let buttonSuffix = "Step";

      if (node instanceof CodeTourStepNode) {
        tour = node.tour;

        if (additionalNodes) {
          buttonSuffix = `${additionalNodes.length} Steps`;
          messageSuffix = `${additionalNodes.length} selected steps`;

          steps = additionalNodes.map(n => n.stepNumber);
        } else {
          steps = [node.stepNumber];
        }
      } else {
        tour = store.activeTour!.tour;
        steps = [store.activeTour!.step];

        node.parent.dispose();
      }

      if (
        await vscode.window.showInformationMessage(
          `Are you sure your want to delete the ${messageSuffix}?`,
          `Delete ${buttonSuffix}`
        )
      ) {
        steps.forEach(step => tour.steps.splice(step, 1));

        if (store.activeTour && store.activeTour.tour.id === tour.id) {
          const previousSteps = steps.filter(
            step => step <= store.activeTour!.step
          );
          if (
            previousSteps.length > 0 &&
            (store.activeTour!.step > 0 || tour.steps.length === 0)
          ) {
            store.activeTour!.step -= previousSteps.length;
          }

          if (steps.includes(store.activeTour.step)) {
            // The only reason that a CodeTour content editor would be
            // open is because it was associated with the current step.
            // So detect if there are any, and if so, hide them.
            vscode.window.visibleTextEditors.forEach(editor => {
              if (editor.document.uri.scheme === FS_SCHEME_CONTENT) {
                editor.hide();
              }
            });
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
}

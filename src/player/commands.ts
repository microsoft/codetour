import { when } from "mobx";
import * as vscode from "vscode";
import { EXTENSION_NAME } from "../constants";
import { focusPlayer } from "../player";
import { CodeTour, store } from "../store";
import {
  endCurrentCodeTour,
  exportTour,
  moveCurrentCodeTourBackward,
  moveCurrentCodeTourForward,
  startCodeTour
} from "../store/actions";
import { CodeTourNode } from "../tree/nodes";
interface CodeTourQuickPickItem extends vscode.QuickPickItem {
  tour: CodeTour;
}

let terminal: vscode.Terminal | null;
export function registerPlayerCommands() {
  // This is a "private" command that's used exclusively
  // by the hover description for tour markers.
  vscode.commands.registerCommand(
    `${EXTENSION_NAME}._startTourById`,
    async (id: string, stepNumber: number) => {
      const tour = store.tours.find(tour => tour.id === id);
      if (tour) {
        startCodeTour(tour, stepNumber);
      }
    }
  );

  vscode.commands.registerCommand(
    `${EXTENSION_NAME}._navigateToStep`,
    async (stepNumber: number) => {
      startCodeTour(store.activeTour!.tour, stepNumber);
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

  vscode.commands.registerCommand(`${EXTENSION_NAME}.resumeTour`, focusPlayer);

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

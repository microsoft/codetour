// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { when } from "mobx";
import * as vscode from "vscode";
import { EXTENSION_NAME } from "../constants";
import { focusPlayer } from "../player";
import { saveTour } from "../recorder/commands";
import { CodeTour, store } from "../store";
import {
  endCurrentCodeTour,
  exportTour,
  moveCurrentCodeTourBackward,
  moveCurrentCodeTourForward,
  selectTour,
  startCodeTour
} from "../store/actions";
import { progress } from "../store/storage";
import { readUriContents } from "../utils";
import { CodeTourNode } from "./tree/nodes";

const adjustOnInsertCodeSnippet = vscode.workspace
  .getConfiguration("codetour")
  .get("adjustOnInsertCodeSnippet", true);

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

  // Purpose: Command link
  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.startTourByTitle`,
    async (title: string, stepNumber?: number) => {
      const tours = store.activeTour?.tours || store.tours;
      const tour = tours.find(tour => tour.title === title);
      if (tour) {
        startCodeTour(
          tour,
          stepNumber && --stepNumber,
          store.activeTour?.workspaceRoot,
          undefined,
          undefined,
          store.activeTour?.tours
        );
      }
    }
  );

  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.finishTour`,
    async (title?: string) => {
      await progress.update();

      if (title) {
        vscode.commands.executeCommand(
          `${EXTENSION_NAME}.startTourByTitle`,
          title
        );
      } else {
        vscode.commands.executeCommand(`${EXTENSION_NAME}.endTour`);
      }
    }
  );

  // Purpose: Command link
  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.navigateToStep`,
    async (stepNumber: number) => {
      startCodeTour(
        store.activeTour!.tour,
        --stepNumber,
        store.activeTour?.workspaceRoot,
        undefined,
        undefined,
        store.activeTour?.tours
      );
    }
  );

  // Purpose: Command link and the ">>" syntax
  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.sendTextToTerminal`,
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
    `${EXTENSION_NAME}.insertCodeSnippet`,
    async (codeBlock: string) => {
      const codeSnippet = decodeURIComponent(codeBlock);

      const step = store.activeTour!.tour.steps[store.activeTour!.step];
      const docText = vscode.window.activeTextEditor?.document.getText();

      if (docText?.includes(codeSnippet)) {
        return; // early out snippet has already been inserted
      }

      if (step.selection) {
        await vscode.window.activeTextEditor?.edit(e => {
          const selection = new vscode.Selection(
            step.selection!.start.line - 1,
            step.selection!.start.character - 1,
            step.selection!.end.line - 1,
            step.selection!.end.character - 1
          );
          e.replace(selection, codeSnippet);
        });
      } else {
        const position = new vscode.Position(step.line! - 1, 0);
        await vscode.window.activeTextEditor?.edit(e =>
          e.insert(position, codeSnippet)
        );
      }

      const lineAdjustment = codeSnippet.split("\n").length - 1;
      if (adjustOnInsertCodeSnippet && lineAdjustment > 0) {
        const step = store.activeTour!.tour.steps[store.activeTour!.step];
        step.line! += lineAdjustment;
        if (step.selection) {
          step.selection.start.line += lineAdjustment;
          step.selection.end.line += lineAdjustment;
        }
        saveTour(store.activeTour!.tour);
      }

      await vscode.commands.executeCommand("editor.action.formatDocument");
    }
  );

  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.startTour`,
    async (
      tour?: CodeTour | CodeTourNode,
      stepNumber?: number,
      workspaceRoot?: vscode.Uri,
      tours?: CodeTour[]
    ) => {
      if (tour) {
        const targetTour = tour instanceof CodeTourNode ? tour.tour : tour;
        return startCodeTour(
          targetTour,
          stepNumber,
          workspaceRoot,
          undefined,
          undefined,
          tours
        );
      }

      selectTour(store.tours, workspaceRoot);
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
          Tours: ["tour"]
        },
        canSelectFolders: false,
        canSelectMany: false,
        openLabel: "Open Tour"
      });

      if (!uri) {
        return;
      }

      try {
        const contents = await readUriContents(uri[0]);

        const tour = JSON.parse(contents);
        tour.id = decodeURIComponent(uri[0].toString());

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
      const axios = await import("axios");
      const response = await axios.default.get<CodeTour>(url);
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
          Tours: ["tour"]
        },
        saveLabel: "Export Tour"
      });

      if (!uri) {
        return;
      }

      const contents = await exportTour(node.tour);
      const bytes = new TextEncoder().encode(contents);
      vscode.workspace.fs.writeFile(uri, bytes);
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

  vscode.commands.registerCommand(`${EXTENSION_NAME}.resetProgress`, () =>
    progress.reset()
  );
}

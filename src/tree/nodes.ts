import * as path from "path";
import {
  ThemeIcon,
  TreeItem,
  TreeItemCollapsibleState,
  Uri,
  workspace
} from "vscode";
import { EXTENSION_NAME } from "../constants";
import { CodeTour } from "../store";

export class CodeTourNode extends TreeItem {
  constructor(public tour: CodeTour, extensionPath: string) {
    super(tour.title!, TreeItemCollapsibleState.Collapsed);

    this.tooltip = tour.description;
    this.description = `${tour.steps.length} steps`;
    this.contextValue = "codetour.tour";

    this.iconPath = {
      dark: path.join(extensionPath, "images/dark/tour.svg"),
      light: path.join(extensionPath, "images/light/tour.svg")
    };
  }
}

function getStepLabel(tour: CodeTour, step: number) {
  return tour.steps[step].uri ? tour.steps[step].uri! : tour.steps[step].file!;
}

export class CodeTourStepNode extends TreeItem {
  constructor(tour: CodeTour, stepNumber: number) {
    super(getStepLabel(tour, stepNumber));

    const step = tour.steps[stepNumber];

    this.command = {
      command: `${EXTENSION_NAME}.startTour`,
      title: "Start Tour",
      arguments: [tour, stepNumber]
    };

    this.description = step.description;

    this.resourceUri = step.uri
      ? Uri.parse(step.uri)!
      : Uri.parse(
          path.join(workspace.workspaceFolders![0].uri.toString(), step.file!)
        );

    this.iconPath = ThemeIcon.File;
  }
}

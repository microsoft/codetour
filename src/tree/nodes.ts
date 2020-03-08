import * as path from "path";
import { TreeItem } from "vscode";
import { CodeTour } from "../store";
import { EXTENSION_NAME } from "../constants";

export class CodeTourNode extends TreeItem {
  constructor(tour: CodeTour, extensionPath: string) {
    super(tour.title!);

    this.tooltip = tour.description;

    this.command = {
      command: `${EXTENSION_NAME}.startTour`,
      title: "Start Tour",
      arguments: [tour]
    };

    this.description = `${tour.steps.length} steps`;

    this.iconPath = {
      dark: path.join(extensionPath, "images/dark/tour.svg"),
      light: path.join(extensionPath, "images/dark/tour.svg")
    };
  }
}

import * as path from "path";
import {
  ThemeIcon,
  TreeItem,
  TreeItemCollapsibleState,
  Uri,
  workspace
} from "vscode";
import { EXTENSION_NAME } from "../constants";
import { CodeTour, store } from "../store";

export class CodeTourNode extends TreeItem {
  constructor(
    public tour: CodeTour,
    extensionPath: string,
    isRecording: boolean
  ) {
    super(
      tour.title!,
      isRecording
        ? TreeItemCollapsibleState.Expanded
        : TreeItemCollapsibleState.Collapsed
    );

    this.tooltip = tour.description;
    this.description = `${tour.steps.length} steps`;

    const contextValues = ["codetour.tour"];

    if (isRecording) {
      contextValues.push("recording");
    }

    const isActive = store.activeTour && tour.id === store.activeTour?.id;
    if (isActive) {
      contextValues.push("active");
    }

    this.contextValue = contextValues.join(".");

    const icon = isRecording
      ? "tour-recording"
      : isActive
      ? "tour-active"
      : "tour";

    this.iconPath = {
      dark: path.join(extensionPath, `images/dark/${icon}.svg`),
      light: path.join(extensionPath, `images/light/${icon}.svg`)
    };
  }
}

function getStepLabel(tour: CodeTour, step: number) {
  return tour.steps[step].uri ? tour.steps[step].uri! : tour.steps[step].file!;
}

export class CodeTourStepNode extends TreeItem {
  constructor(public tour: CodeTour, public stepNumber: number) {
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

    const contextValues = ["codetour.tourStep"];
    if (stepNumber > 0) {
      contextValues.push("hasPrevious");
    }

    if (stepNumber < tour.steps.length - 1) {
      contextValues.push("hasNext");
    }

    this.contextValue = contextValues.join(".");
  }
}

export class RecordTourNode extends TreeItem {
  constructor() {
    super("Record new tour...");

    this.command = {
      command: `${EXTENSION_NAME}.recordTour`,
      title: "Record Tour"
    };
  }
}

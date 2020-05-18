import * as path from "path";
import { ThemeIcon, TreeItem, TreeItemCollapsibleState, Uri } from "vscode";
import { CONTENT_URI, EXTENSION_NAME, FS_SCHEME } from "../constants";
import { CodeTour, store } from "../store";
import { getFileUri, getWorkspacePath } from "../utils";

function isRecording(tour: CodeTour) {
  return (
    store.isRecording &&
    store.activeTour &&
    store.activeTour.tour.id === tour.id
  );
}

export class CodeTourNode extends TreeItem {
  constructor(public tour: CodeTour, extensionPath: string) {
    super(
      tour.title!,
      isRecording(tour)
        ? TreeItemCollapsibleState.Expanded
        : TreeItemCollapsibleState.Collapsed
    );

    this.tooltip = tour.description;
    this.description = `${tour.steps.length} steps`;

    const contextValues = ["codetour.tour"];

    if (tour.isPrimary) {
      contextValues.push("primary");

      this.description += " (Primary)";
    }

    if (isRecording(tour)) {
      contextValues.push("recording");
    }

    const isActive = store.activeTour && tour.id === store.activeTour?.tour.id;
    if (isActive) {
      contextValues.push("active");
    }

    this.contextValue = contextValues.join(".");

    const icon = isRecording(tour)
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

const HEADING_PATTERN = /^#+\s*(.*)/;
function getStepLabel(tour: CodeTour, stepNumber: number) {
  const step = tour.steps[stepNumber];

  const prefix = `#${stepNumber + 1} - `;
  let label;
  if (step.title) {
    label = step.title;
  } else if (HEADING_PATTERN.test(step.description.trim())) {
    label = step.description.trim().match(HEADING_PATTERN)![1];
  } else {
    label = step.uri
      ? step.uri!
      : decodeURIComponent(step.directory || step.file!);
  }

  return `${prefix}${label}`;
}

export class CodeTourStepNode extends TreeItem {
  constructor(public tour: CodeTour, public stepNumber: number) {
    super(getStepLabel(tour, stepNumber));

    const step = tour.steps[stepNumber];

    const workspaceRoot =
      store.activeTour &&
      store.activeTour.tour.id === tour.id &&
      store.activeTour.workspaceRoot
        ? store.activeTour.workspaceRoot
        : undefined;

    this.command = {
      command: `${EXTENSION_NAME}.startTour`,
      title: "Start Tour",
      arguments: [tour, stepNumber, workspaceRoot]
    };

    let resourceUri;
    if (step.uri) {
      resourceUri = Uri.parse(step.uri);
    } else if (step.contents) {
      resourceUri = Uri.parse(`${FS_SCHEME}://current/${step.file}`);
    } else if (step.file || step.directory) {
      const resourceRoot = workspaceRoot
        ? workspaceRoot.toString()
        : getWorkspacePath(tour);

      resourceUri = getFileUri(resourceRoot, step.directory || step.file!);
    } else {
      resourceUri = CONTENT_URI;
    }

    this.resourceUri = resourceUri;

    if (step.directory) {
      this.iconPath = ThemeIcon.Folder;
    } else {
      this.iconPath = ThemeIcon.File;
    }

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

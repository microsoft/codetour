// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
  ThemeColor,
  ThemeIcon,
  TreeItem,
  TreeItemCollapsibleState,
  Uri
} from "vscode";
import { CONTENT_URI, EXTENSION_NAME, FS_SCHEME } from "../../constants";
import { CodeTour, store } from "../../store";
import { progress } from "../../store/storage";
import { getFileUri, getStepLabel, getWorkspaceUri } from "../../utils";

function isRecording(tour: CodeTour) {
  return (
    store.isRecording &&
    store.activeTour &&
    store.activeTour.tour.id === tour.id
  );
}

const completeIcon = new ThemeIcon(
  "check",
  // @ts-ignore
  new ThemeColor("terminal.ansiGreen")
);

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

    this.iconPath = isRecording(tour)
      ? new ThemeIcon("record")
      : isActive
      ? new ThemeIcon("play-circle")
      : progress.isComplete(tour)
      ? completeIcon
      : new ThemeIcon("location");
  }
}

export class CodeTourStepNode extends TreeItem {
  constructor(public tour: CodeTour, public stepNumber: number) {
    super("")
  }
  async init(): Promise<CodeTourStepNode> {
    this.label = await getStepLabel(this.tour, this.stepNumber);

    const step = this.tour.steps[this.stepNumber];

    let workspaceRoot, tours;
    if (store.activeTour && store.activeTour.tour.id === this.tour.id) {
      workspaceRoot = store.activeTour.workspaceRoot;
      tours = store.activeTour.tours;
    }

    this.command = {
      command: `${EXTENSION_NAME}.startTour`,
      title: "Start Tour",
      arguments: [this.tour, this.stepNumber, workspaceRoot, tours]
    };

    let resourceUri;
    if (step.uri) {
      resourceUri = Uri.parse(step.uri);
    } else if (step.contents) {
      resourceUri = Uri.parse(`${FS_SCHEME}://current/${step.file}`);
    } else if (step.file || step.directory) {
      const resourceRoot = workspaceRoot
        ? workspaceRoot
        : getWorkspaceUri(this.tour);

      resourceUri = getFileUri(step.directory || step.file!, resourceRoot);
    } else {
      resourceUri = CONTENT_URI;
    }

    this.resourceUri = resourceUri;

    const isActive =
      store.activeTour &&
      this.tour.id === store.activeTour?.tour.id &&
      store.activeTour.step === this.stepNumber;

    if (isActive) {
      this.iconPath = new ThemeIcon("play-circle");
    } else if (progress.isComplete(this.tour, this.stepNumber)) {
      // @ts-ignore
      this.iconPath = completeIcon;
    } else if (step.directory) {
      this.iconPath = ThemeIcon.Folder;
    } else {
      this.iconPath = ThemeIcon.File;
    }

    const contextValues = ["codetour.tourStep"];
    if (this.stepNumber > 0) {
      contextValues.push("hasPrevious");
    }

    if (this.stepNumber < this.tour.steps.length - 1) {
      contextValues.push("hasNext");
    }

    this.contextValue = contextValues.join(".");
    
    return this;
  }
}

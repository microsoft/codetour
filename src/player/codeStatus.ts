import * as vscode from "vscode";
import { onDidEndTour, onDidStartTour } from "../store/actions";

export async function registerCodeStatusModule() {
  const extension = vscode.extensions.getExtension("lostintangent.codestatus");
  if (!extension) {
    return;
  }

  if (!extension.isActive) {
    await extension.activate();
  }

  let statusDisposable: vscode.Disposable;
  onDidStartTour(async ([tour, stepNumber]) => {
    const disposeable = await extension.exports.updateStatus({
      emoji: "🗺️",
      message: `CodeTour: ${tour.title} (#${stepNumber + 1} of ${
        tour.steps.length
      })`,
      limitedAvailability: true
    });

    if (!statusDisposable) {
      statusDisposable = disposeable;
    }
  });

  onDidEndTour(() => statusDisposable && statusDisposable.dispose());
}

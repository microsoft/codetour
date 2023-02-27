import * as vscode from "vscode";

export function isAccessibilitySupportOn(): boolean {
    const config = vscode.workspace.getConfiguration('editor');
    // Possible values are: auto, on, off. 
    // `auto` then queries whether the screenreader is actually on.
    // For the purposes of this demo, `auto` is treated as `on`.
    return config.get('accessibilitySupport') !== 'off';
  }
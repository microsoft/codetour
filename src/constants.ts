// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri } from "vscode";

export const EXTENSION_NAME = "codetour";

export const FS_SCHEME = EXTENSION_NAME;
export const FS_SCHEME_CONTENT = `${FS_SCHEME}-content`;
export const CONTENT_URI = Uri.parse(`${FS_SCHEME_CONTENT}://current/CodeTour`);

export const ICON_URL =
  "https://cdn.jsdelivr.net/gh/vsls-contrib/code-tour/images/icon.png";
export const SMALL_ICON_URL =
  "https://cdn.jsdelivr.net/gh/vsls-contrib/code-tour/images/icon-small.png";

export const VSCODE_DIRECTORY = ".vscode";

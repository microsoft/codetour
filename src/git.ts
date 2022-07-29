// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";

export const enum RefType {
  Head,
  RemoteHead,
  Tag
}

export interface Ref {
  readonly type: RefType;
  readonly name?: string;
  readonly commit?: string;
  readonly remote?: string;
}

export interface RepositoryState {
  readonly HEAD: Ref | undefined;
  readonly refs: Ref[];
}

export interface LogOptions {
  /** Max number of log entries to retrieve. If not specified, the default is 32. */
  readonly maxEntries?: number;
  readonly path?: string;
}

export interface Commit {
  readonly hash: string;
  readonly message: string;
  readonly parents: string[];
  readonly authorDate?: Date;
  readonly authorName?: string;
  readonly authorEmail?: string;
  readonly commitDate?: Date;
}

export interface Repository {
  readonly state: RepositoryState;
  log(options?: LogOptions): Promise<Commit[]>;
}

interface GitAPI {
  toGitUri(uri: vscode.Uri, ref: string): vscode.Uri;
  getRepository(uri: vscode.Uri): Repository | null;
}

export let api: GitAPI;
export async function initializeGitApi() {
  const extension = vscode.extensions.getExtension("vscode.git");
  if (!extension) {
    return;
  }

  if (!extension.isActive) {
    await extension.activate();
  }

  api = extension.exports.getAPI(1);
}

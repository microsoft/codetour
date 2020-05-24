import * as path from "path";
import { Uri, workspace } from "vscode";
import { CONTENT_URI, FS_SCHEME } from "./constants";
import { api } from "./git";
import { CodeTour, CodeTourStep, store } from "./store";

export function appendUriPath(uri: Uri, pathSuffix: string) {
  return uri.with({
    path: path.join(uri.path, pathSuffix)
  });
}

export async function readUriContents(uri: Uri) {
  const bytes = await workspace.fs.readFile(uri);
  return new TextDecoder().decode(bytes);
}

export function getFileUri(file: string, workspaceRoot?: Uri) {
  if (!workspaceRoot) {
    return Uri.parse(file);
  }

  const rootPath = workspaceRoot.path.endsWith("/")
    ? workspaceRoot.path
    : `${workspaceRoot.path}/`;

  // path.join/normalize will resolve relative paths (e.g. replacing
  // ".." with the actual directories), but it also messes up
  // non-file based schemes. So we parse the workspace root and
  // then replace it's path with a normalized version of _only_ the path.
  return workspaceRoot.with({
    path: path.normalize(`${rootPath}${file}`)
  });
}

export async function getStepFileUri(
  step: CodeTourStep,
  workspaceRoot?: Uri,
  ref?: string
): Promise<Uri> {
  let uri;
  if (step.contents) {
    uri = Uri.parse(`${FS_SCHEME}://current/${step.file}`);
  } else if (step.uri || step.file) {
    uri = step.uri
      ? Uri.parse(step.uri)
      : getFileUri(step.file!, workspaceRoot);

    if (api && ref && ref !== "HEAD") {
      const repo = api.getRepository(uri);

      if (
        repo &&
        repo.state.HEAD &&
        repo.state.HEAD.name !== ref && // The tour refs the user's current branch
        repo.state.HEAD.commit !== ref && // The tour refs the user's HEAD commit
        repo.state.HEAD.commit !== // The tour refs a branch/tag that points at the user's HEAD commit
          repo.state.refs.find(gitRef => gitRef.name === ref)?.commit
      ) {
        uri = await api.toGitUri(uri, ref);
      }
    }
  } else {
    uri = CONTENT_URI;
  }

  return uri;
}

export function getActiveWorkspacePath() {
  return store.activeTour!.workspaceRoot?.toString() || "";
}

export function getWorkspaceKey() {
  return (
    workspace.workspaceFile || workspace.workspaceFolders![0].uri.toString()
  );
}

export function getWorkspacePath(tour: CodeTour) {
  return getWorkspaceUri(tour)?.toString() || "";
}

export function getWorkspaceUri(tour: CodeTour) {
  const tourUri = Uri.parse(tour.id);
  return workspace.getWorkspaceFolder(tourUri)?.uri;
}

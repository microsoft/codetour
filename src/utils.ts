import { CodeTourStep } from "./store";
import { Uri } from "vscode";
import { FS_SCHEME } from "./constants";
import { api } from "./git";

export async function getStepFileUri(
  step: CodeTourStep,
  workspaceRoot: string,
  ref?: string
): Promise<Uri> {
  let uri;
  if (step.contents) {
    uri = Uri.parse(`${FS_SCHEME}://current/${step.file}`);
  } else {
    uri = step.uri
      ? Uri.parse(step.uri)
      : Uri.parse(`${workspaceRoot}/${step.file}`);

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
  }
  return uri;
}

import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { createContext } from "../../src/context";
import {
  stageCommitAnchors,
  validateTourProposal,
} from "../../src/proposal-validation";
import {
  commitFile,
  git,
  headSha,
  initGitRepo,
  rmrf,
  tempDir,
  writeFile,
} from "../helpers/test-utils";
import {
  captionedDiagram,
  INVALID_FLOWCHART_SOURCE,
} from "../helpers/mermaid-fixtures";

test("validateTourProposal requires at least one step", async () => {
  const root = tempDir();
  try {
    const result = await validateTourProposal(
      "project",
      { steps: [] },
      createContext(root)
    );
    assert.ok(!result.ok, JSON.stringify(result));
    assert.equal(result.rejection.code, "TOUR_STEPS_REQUIRED");
    assert.deepEqual(result.rejection.issues ?? [], []);
  } finally {
    rmrf(root);
  }
});

test("validateTourProposal aggregates description issues with the missing steps", async () => {
  const root = tempDir();
  try {
    const result = await validateTourProposal(
      "project",
      { description: captionedDiagram("Overview", INVALID_FLOWCHART_SOURCE) },
      createContext(root)
    );
    assert.ok(!result.ok, JSON.stringify(result));
    assert.equal(result.rejection.code, "INVALID_PROPOSAL");
    const paths = (result.rejection.issues ?? []).map((issue) => issue.path);
    assert.ok(paths.some((p) => p.startsWith("description.mermaid[")));
    assert.ok(paths.includes("steps"));
  } finally {
    rmrf(root);
  }
});

test("validateTourProposal accepts a valid Project Tour proposal", async () => {
  const root = tempDir();
  try {
    writeFile(root, "src/index.ts", "export const A = 1;\n");
    const result = await validateTourProposal(
      "project",
      {
        title: "Tour",
        steps: [{ description: "Hello", file: "src/index.ts", pattern: "A" }],
      },
      createContext(root)
    );
    assert.ok(result.ok, JSON.stringify(result));
    assert.deepEqual(result.proposal.params.title, "Tour");
    assert.equal(result.proposal.ctx.root, root);
    assert.equal(result.proposal.steps.length, 1);
  } finally {
    rmrf(root);
  }
});

test("validateTourProposal aggregates parameter and step issues", async () => {
  const root = tempDir();
  try {
    const result = await validateTourProposal(
      "project",
      { title: 5, steps: [{ description: "Hello", file: "ghost.ts" }] },
      createContext(root)
    );
    assert.ok(!result.ok, JSON.stringify(result));
    assert.equal(result.rejection.code, "INVALID_PROPOSAL");
    const paths = (result.rejection.issues ?? []).map((issue) => issue.path);
    assert.ok(paths.includes("title"));
    // Anchors are checked against the effective workspace (here the
    // configured root) in the same response as the parameter issues.
    assert.ok(paths.includes("steps[0].file"));
  } finally {
    rmrf(root);
  }
});

test("validateTourProposal checks anchors against a selected workspacePath", async () => {
  const root = tempDir();
  try {
    writeFile(root, "pkg/src/index.ts", "export const A = 1;\n");
    const result = await validateTourProposal(
      "project",
      {
        workspacePath: "pkg",
        steps: [{ description: "Hello", file: "src/ghost.ts" }],
      },
      createContext(root)
    );
    assert.ok(!result.ok, JSON.stringify(result));
    const paths = (result.rejection.issues ?? []).map((issue) => issue.path);
    assert.ok(paths.includes("steps[0].file"));
  } finally {
    rmrf(root);
  }
});

test("validateTourProposal requires the Changes Tour Git references", async () => {
  const root = tempDir();
  try {
    const result = await validateTourProposal(
      "changes",
      { steps: [{ description: "Hello" }] },
      createContext(root)
    );
    assert.ok(!result.ok, JSON.stringify(result));
    assert.equal(result.rejection.code, "INVALID_PROPOSAL");
    const paths = (result.rejection.issues ?? []).map((issue) => issue.path);
    assert.ok(paths.includes("baseRef"));
    assert.ok(paths.includes("headRef"));
  } finally {
    rmrf(root);
  }
});

test("validateTourProposal accepts a valid Changes Tour proposal structurally", async () => {
  const root = tempDir();
  try {
    const result = await validateTourProposal(
      "changes",
      {
        baseRef: "main",
        headRef: "0".repeat(40),
        steps: [{ description: "Hello", file: "anywhere.ts" }],
      },
      createContext(root)
    );
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.proposal.params.baseRef, "main");
    // Phase one is structural: the anchor is checked against the commit later.
    assert.equal(result.proposal.steps.length, 1);
  } finally {
    rmrf(root);
  }
});

// A repository whose only change renames old.ts to new.ts between the
// merge-base and HEAD: the canonical second-phase staging input.
async function setupRenameRepo(): Promise<{
  root: string;
  baseSha: string;
  head: string;
}> {
  const root = tempDir();
  await initGitRepo(root);
  await commitFile(root, "old.ts", "export const A = 1;\n", "add old file");
  const baseSha = await headSha(root);
  writeFile(root, "new.ts", "export const A = 1;\n");
  fs.rmSync(path.join(root, "old.ts"));
  await git(["add", "-A"], root);
  await git(["commit", "-m", "rename old.ts to new.ts"], root);
  return { root, baseSha, head: await headSha(root) };
}

test("stageCommitAnchors checks step files and declared baseFile values against the commit", async () => {
  const { root, baseSha, head } = await setupRenameRepo();
  try {
    const result = await validateTourProposal(
      "changes",
      {
        baseRef: baseSha,
        headRef: head,
        steps: [
          { description: "Renamed", file: "new.ts", baseFile: "wrong.ts" },
          { description: "Ghost", file: "ghost.ts" },
        ],
      },
      createContext(root)
    );
    assert.ok(result.ok, JSON.stringify(result));
    const staged = await stageCommitAnchors(result.proposal, {
      mergeBaseSha: baseSha,
      includesLocalChanges: false,
    });
    const issuesByPath = Object.fromEntries(
      staged.issues.map((issue) => [issue.path, issue.message])
    );
    assert.equal(
      issuesByPath["steps[0].baseFile"],
      "must match the old path of the detected Git rename"
    );
    assert.equal(
      issuesByPath["steps[1].file"],
      "does not exist in the analyzed commit"
    );
    assert.deepEqual([...staged.renames], [["new.ts", "old.ts"]]);
  } finally {
    rmrf(root);
  }
});

test("stageCommitAnchors accepts a correct rename and returns the staged steps", async () => {
  const { root, baseSha, head } = await setupRenameRepo();
  try {
    const result = await validateTourProposal(
      "changes",
      {
        baseRef: baseSha,
        headRef: head,
        steps: [
          {
            description: "Renamed",
            file: "new.ts",
            baseFile: "old.ts",
            pattern: "A",
          },
        ],
      },
      createContext(root)
    );
    assert.ok(result.ok, JSON.stringify(result));
    const staged = await stageCommitAnchors(result.proposal, {
      mergeBaseSha: baseSha,
      includesLocalChanges: false,
    });
    assert.deepEqual(staged.issues, []);
    assert.equal(staged.steps.length, 1);
    assert.equal(staged.steps[0].file, "new.ts");
  } finally {
    rmrf(root);
  }
});

test("stageCommitAnchors validates against the workspace when local changes are included", async () => {
  const root = tempDir();
  try {
    await initGitRepo(root);
    await commitFile(root, "committed.ts", "export const A = 1;\n", "add file");
    const baseSha = await headSha(root);
    writeFile(root, "local.ts", "export const B = 2;\n");
    const head = await headSha(root);

    const result = await validateTourProposal(
      "changes",
      {
        baseRef: baseSha,
        headRef: head,
        steps: [{ description: "Local", file: "local.ts", pattern: "B" }],
      },
      createContext(root)
    );
    assert.ok(result.ok, JSON.stringify(result));
    const staged = await stageCommitAnchors(result.proposal, {
      mergeBaseSha: baseSha,
      includesLocalChanges: true,
    });
    assert.deepEqual(staged.issues, []);
    assert.equal(staged.steps.length, 1);
    assert.deepEqual([...staged.renames], []);
  } finally {
    rmrf(root);
  }
});

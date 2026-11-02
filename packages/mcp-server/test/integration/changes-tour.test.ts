import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  callTool,
  commitFile,
  git,
  headSha,
  initGitRepo,
  issuePaths,
  readTourFile,
  rmrf,
  structuredCode,
  tempDir,
  tourFileValidAgainstSchema,
  warningCodes,
  withServer,
  writeFile,
} from "../helpers/test-utils";
import {
  ALLOWED_DIAGRAM_SOURCES,
  INVALID_FLOWCHART_SOURCE,
  captionedDiagram,
} from "../helpers/mermaid-fixtures";

async function setupRepo(): Promise<{ root: string; baseSha: string; head: string }> {
  const root = tempDir();
  await initGitRepo(root);
  await commitFile(root, "base.txt", "base content\n", "add base file");
  const baseSha = await headSha(root);
  await git(["checkout", "-b", "feature"], root);
  await commitFile(root, "feature.txt", "feature content\n", "add feature file");
  const head = await headSha(root);
  return { root, baseSha, head };
}

test("accepts all five allowed Mermaid kinds in a Changes Tour", async () => {
  const { root, baseSha, head } = await setupRepo();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: head,
        steps: Object.entries(ALLOWED_DIAGRAM_SOURCES).map(([kind, source]) => ({
          description: captionedDiagram(`${kind} change`, source),
        })),
      });
      assert.equal(response.isError, false, response.text);
      assert.equal(response.structured.stepCount, 5);
    });
    assert.ok(tourFileValidAgainstSchema(root, ".tours/changes.tour"));
  } finally {
    rmrf(root);
  }
});

test("preserves the previous Changes Tour when Mermaid syntax is invalid", async () => {
  const { root, baseSha, head } = await setupRepo();
  try {
    await withServer(root, async (client) => {
      const first = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: head,
        steps: [{ description: "Original.", file: "feature.txt" }],
      });
      assert.equal(first.isError, false);
      const before = readTourFile(root, ".tours/changes.tour");

      const second = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: head,
        steps: [
          {
            description: captionedDiagram("Broken", INVALID_FLOWCHART_SOURCE),
          },
        ],
      });
      assert.equal(second.isError, true);
      assert.equal(structuredCode(second), "INVALID_PROPOSAL");
      assert.deepEqual(readTourFile(root, ".tours/changes.tour"), before);
    });
  } finally {
    rmrf(root);
  }
});

test("creates a changes tour with the exact head SHA as ref", async () => {
  const { root, baseSha, head } = await setupRepo();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: head,
        description: "Explains the feature branch.",
        steps: [
          { description: "Intent of the change." },
          { description: "The new file.", file: "feature.txt", line: 1 },
        ],
      });
      assert.equal(response.isError, false);
      assert.equal(response.structured.status, "created");
      assert.equal(response.structured.path, ".tours/changes.tour");
      assert.equal(response.structured.stepCount, 2);
      assert.deepEqual(response.structured.warnings, []);
    });
    const tour = readTourFile(root, ".tours/changes.tour");
    assert.equal(tour.ref, head);
    assert.equal(tour.title, "Changes on feature");
    const description = tour.description as string;
    assert.ok(description.includes("Explains the feature branch."));
    assert.ok(description.includes(baseSha));
    assert.ok(description.includes(head));
    assert.ok(tourFileValidAgainstSchema(root, ".tours/changes.tour"));
  } finally {
    rmrf(root);
  }
});

test("creates a changes tour without Project Tour orientation step warnings", async () => {
  const { root, baseSha, head } = await setupRepo();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: head,
        description: "Explains the feature branch.",
        steps: [
          { description: "Intent of the change." },
          { description: "The new file.", file: "feature.txt", line: 1 },
        ],
      });
      assert.equal(response.isError, false);
      assert.equal(response.structured.status, "created");
      // The first step has no locator and no Mermaid fence: the orientation step
      // warnings are not wired into the Changes Tour flow, so this
      // must stay warning-free.
      assert.deepEqual(response.structured.warnings, []);
      assert.ok(!warningCodes(response).includes("ORIENTATION_STEP_MISSING_OVERVIEW"));
      assert.ok(!warningCodes(response).includes("ORIENTATION_STEP_DIAGRAM_TOO_LARGE"));
    });
  } finally {
    rmrf(root);
  }
});

test("uses the provided title when given", async () => {
  const { root, baseSha, head } = await setupRepo();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: head,
        title: "Custom Title",
        steps: [{ description: "d", file: "feature.txt" }],
      });
      assert.equal(response.isError, false);
    });
    assert.equal(readTourFile(root, ".tours/changes.tour").title, "Custom Title");
  } finally {
    rmrf(root);
  }
});

test("fails with STALE_HEAD when HEAD moved since the analysis", async () => {
  const { root, baseSha, head } = await setupRepo();
  try {
    await commitFile(root, "extra.txt", "extra\n", "extra commit");
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: head,
        steps: [{ description: "d" }],
      });
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "STALE_HEAD");
    });
  } finally {
    rmrf(root);
  }
});

test(
  "preserves the previous tour when HEAD moves immediately before persistence",
  {
    skip:
      process.platform === "win32" &&
      "the deterministic Git interception uses POSIX process semantics",
  },
  async () => {
  const { root, baseSha, head } = await setupRepo();
  const shimDir = tempDir("codetour-git-shim-");
  const reachedFinalCheck = path.join(shimDir, "reached-final-check");
  const continueRequest = path.join(shimDir, "continue-request");
  const gitExecutable = process.platform === "win32" ? "git.exe" : "git";
  const realGit = (process.env.PATH ?? "")
    .split(path.delimiter)
    .map((directory) => path.join(directory, gitExecutable))
    .find((candidate) => fs.existsSync(candidate));
  assert.ok(realGit, "git must be available on PATH");
  const gitShim = path.join(
    shimDir,
    process.platform === "win32" ? "git.cmd" : "git"
  );
  writeFile(
    shimDir,
    path.basename(gitShim),
    process.platform === "win32"
      ? `@echo off
if not "%*" == "rev-parse --abbrev-ref HEAD" goto run
type nul > "${reachedFinalCheck}"
:wait
if exist "${continueRequest}" goto run
ping -n 1 -w 10 127.0.0.1 > nul
goto wait
:run
"${realGit}" %*
`
      : `#!/bin/sh
if [ "$*" = "rev-parse --abbrev-ref HEAD" ]; then
  : > "${reachedFinalCheck}"
  while [ ! -e "${continueRequest}" ]; do sleep 0.01; done
fi
exec "${realGit}" "$@"
`
  );
  if (process.platform !== "win32") {
    fs.chmodSync(gitShim, 0o755);
  }

  try {
    writeFile(root, ".tours/changes.tour", JSON.stringify({ title: "Previous tour" }));
    const before = readTourFile(root, ".tours/changes.tour");

    await withServer(
      root,
      async (client) => {
        const request = callTool(client, "create_changes_tour", {
          baseRef: baseSha,
          headRef: head,
          steps: [{ description: "Should not land.", file: "feature.txt" }],
        });
        while (!fs.existsSync(reachedFinalCheck)) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        await commitFile(root, "late.txt", "late change\n", "move HEAD during request");
        writeFile(shimDir, "continue-request", "continue\n");

        const response = await request;
        assert.equal(response.isError, true);
        assert.equal(structuredCode(response), "STALE_HEAD");
      },
      { PATH: `${shimDir}:${process.env.PATH ?? ""}` }
    );
    assert.deepEqual(readTourFile(root, ".tours/changes.tour"), before);
  } finally {
    rmrf(root);
    rmrf(shimDir);
  }
  }
);

test("fails with STALE_HEAD when headRef is not the current HEAD", async () => {
  const { root, baseSha } = await setupRepo();
  try {
    const other = baseSha;
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: other,
        steps: [{ description: "d" }],
      });
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "STALE_HEAD");
    });
  } finally {
    rmrf(root);
  }
});

test("fails with GIT_REPOSITORY_REQUIRED outside a git repository", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_changes_tour", {
        baseRef: "main",
        headRef: "a".repeat(40),
        steps: [{ description: "d" }],
      });
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "GIT_REPOSITORY_REQUIRED");
      assert.ok(response.text.includes(root), "the error must identify the configured workspace");
      assert.match(response.text, /workspacePath/, "the error must explain how to select the repository");
    });
  } finally {
    rmrf(root);
  }
});

test("fails with NO_CHANGES when the range has no committed changes", async () => {
  const { root, head } = await setupRepo();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_changes_tour", {
        baseRef: head,
        headRef: head,
        steps: [{ description: "d" }],
      });
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "NO_CHANGES");
    });
  } finally {
    rmrf(root);
  }
});

test("fails with INVALID_BASE_REF when the merge-base cannot be computed", async () => {
  const { root, head } = await setupRepo();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_changes_tour", {
        baseRef: "no-such-branch",
        headRef: head,
        steps: [{ description: "d" }],
      });
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "INVALID_BASE_REF");
    });
  } finally {
    rmrf(root);
  }
});

test("keeps the previous tour when NO_CHANGES occurs", async () => {
  const { root, baseSha, head } = await setupRepo();
  try {
    await withServer(root, async (client) => {
      const first = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: head,
        steps: [{ description: "Original.", file: "feature.txt" }],
      });
      assert.equal(first.isError, false);
      const second = await callTool(client, "create_changes_tour", {
        baseRef: head,
        headRef: head,
        steps: [{ description: "Should not replace." }],
      });
      assert.equal(second.isError, true);
      assert.equal(structuredCode(second), "NO_CHANGES");
    });
    assert.equal(
      readTourFile(root, ".tours/changes.tour").ref,
      head
    );
  } finally {
    rmrf(root);
  }
});

test("warns when uncommitted changes are excluded", async () => {
  const { root, baseSha, head } = await setupRepo();
  try {
    writeFile(root, "feature.txt", "modified locally\n");
    writeFile(root, "untracked.txt", "new local file\n");
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: head,
        steps: [{ description: "d", file: "feature.txt" }],
      });
      assert.equal(response.isError, false);
      assert.ok(warningCodes(response).includes("UNCOMMITTED_CHANGES_EXCLUDED"));
    });
    assert.equal(readTourFile(root, ".tours/changes.tour").ref, head);
  } finally {
    rmrf(root);
  }
});

test("ignores the reserved tour files when detecting a dirty workspace", async () => {
  const { root, baseSha, head } = await setupRepo();
  try {
    writeFile(root, ".tours/project.tour", "{ generated earlier }");
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: head,
        steps: [{ description: "d", file: "feature.txt" }],
      });
      assert.equal(response.isError, false);
      assert.ok(!warningCodes(response).includes("UNCOMMITTED_CHANGES_EXCLUDED"));
    });
  } finally {
    rmrf(root);
  }
});

test("includes uncommitted changes explicitly and drops the ref", async () => {
  const { root, baseSha, head } = await setupRepo();
  try {
    writeFile(root, "work-in-progress.txt", "local work\n");
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: head,
        includeUncommittedChanges: true,
        steps: [
          { description: "Local work.", file: "work-in-progress.txt" },
        ],
      });
      assert.equal(response.isError, false);
      assert.ok(warningCodes(response).includes("UNCOMMITTED_CHANGES_INCLUDED"));
    });
    const tour = readTourFile(root, ".tours/changes.tour");
    assert.equal(tour.ref, undefined);
    assert.ok((tour.description as string).includes("non-reproducible"));
    assert.ok(tourFileValidAgainstSchema(root, ".tours/changes.tour"));
  } finally {
    rmrf(root);
  }
});

test("warns with NO_CHANGED_FILE_ANCHOR when no step anchors a changed file", async () => {
  const { root, baseSha, head } = await setupRepo();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: head,
        steps: [{ description: "Only context, no anchors." }],
      });
      assert.equal(response.isError, false);
      assert.ok(warningCodes(response).includes("NO_CHANGED_FILE_ANCHOR"));
    });
  } finally {
    rmrf(root);
  }
});

test("does not warn when a step anchors a changed file", async () => {
  const { root, baseSha, head } = await setupRepo();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: head,
        steps: [{ description: "The new file.", file: "feature.txt" }],
      });
      assert.equal(response.isError, false);
      assert.ok(!warningCodes(response).includes("NO_CHANGED_FILE_ANCHOR"));
    });
  } finally {
    rmrf(root);
  }
});

test("allows deletion-only branches with content-only steps", async () => {
  const root = tempDir();
  await initGitRepo(root);
  await commitFile(root, "victim.txt", "to be deleted\n", "add victim");
  const baseSha = await headSha(root);
  await git(["checkout", "-b", "cleanup"], root);
  await git(["rm", "victim.txt"], root);
  await git(["commit", "-m", "remove victim"], root);
  const head = await headSha(root);
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: head,
        steps: [{ description: "We removed victim.txt entirely." }],
      });
      assert.equal(response.isError, false);
      assert.ok(warningCodes(response).includes("NO_CHANGED_FILE_ANCHOR"));
    });
    assert.equal(readTourFile(root, ".tours/changes.tour").ref, head);
    assert.ok(tourFileValidAgainstSchema(root, ".tours/changes.tour"));
  } finally {
    rmrf(root);
  }
});

test("allows anchoring unchanged files for essential context", async () => {
  const { root, baseSha, head } = await setupRepo();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: head,
        steps: [
          { description: "Context from the base file.", file: "base.txt" },
          { description: "The new file.", file: "feature.txt" },
        ],
      });
      assert.equal(response.isError, false);
      assert.ok(!warningCodes(response).includes("NO_CHANGED_FILE_ANCHOR"));
    });
  } finally {
    rmrf(root);
  }
});

test("aggregates step validation errors for a changes tour", async () => {
  const { root, baseSha, head } = await setupRepo();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: head,
        steps: [
          { description: "d", file: "missing.txt" },
          { description: "d", file: "feature.txt", line: 99 },
        ],
      });
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "INVALID_PROPOSAL");
      const issues = (response.structured.issues ?? []) as Array<{ path: string }>;
      assert.ok(issues.some((issue) => issue.path === "steps[0].file"));
      assert.ok(issues.some((issue) => issue.path === "steps[1].line"));
    });
  } finally {
    rmrf(root);
  }
});

test("works when the workspace root is a subdirectory of the repository", async () => {
  const root = tempDir();
  await initGitRepo(root);
  await commitFile(root, "packages/app/main.ts", "export {};\n", "add app");
  await commitFile(root, "packages/app/util.ts", "export {};\n", "add util");
  const baseSha = await headSha(root);
  await git(["checkout", "-b", "sub", "-q"], root);
  await commitFile(root, "packages/app/new.ts", "export {};\n", "add new file");
  const head = await headSha(root);
  const subRoot = `${root}/packages/app`;
  try {
    await withServer(subRoot, async (client) => {
      const response = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: head,
        steps: [{ description: "The new file.", file: "new.ts" }],
      });
      assert.equal(response.isError, false);
      assert.ok(!warningCodes(response).includes("NO_CHANGED_FILE_ANCHOR"));
    });
    assert.ok(tourFileValidAgainstSchema(subRoot, ".tours/changes.tour"));
  } finally {
    rmrf(root);
  }
});

test("warns when the tour exceeds fifteen steps for a changes tour", async () => {
  const { root, baseSha, head } = await setupRepo();
  try {
    const steps = Array.from({ length: 16 }, (_, index) => ({
      description: `Step ${index + 1}.`,
    }));
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: head,
        steps,
      });
      assert.equal(response.isError, false);
      assert.equal(response.structured.stepCount, 16);
      assert.ok(warningCodes(response).includes("STEP_LIMIT_EXCEEDED"));
    });
  } finally {
    rmrf(root);
  }
});

test("warns when only staged changes are excluded", async () => {
  const { root, baseSha, head } = await setupRepo();
  try {
    writeFile(root, "staged.txt", "staged but not committed\n");
    await git(["add", "staged.txt"], root);
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: head,
        steps: [{ description: "d", file: "feature.txt" }],
      });
      assert.equal(response.isError, false);
      assert.ok(warningCodes(response).includes("UNCOMMITTED_CHANGES_EXCLUDED"));
    });
  } finally {
    rmrf(root);
  }
});

test("warns when only unstaged changes are excluded", async () => {
  const { root, baseSha, head } = await setupRepo();
  try {
    writeFile(root, "feature.txt", "committed feature\nlocal edit\n");
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: head,
        steps: [{ description: "The committed feature.", file: "feature.txt" }],
      });
      assert.equal(response.isError, false);
      assert.ok(warningCodes(response).includes("UNCOMMITTED_CHANGES_EXCLUDED"));
    });
  } finally {
    rmrf(root);
  }
});

test("warns when only untracked changes are excluded", async () => {
  const { root, baseSha, head } = await setupRepo();
  try {
    writeFile(root, "untracked.txt", "not committed\n");
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: head,
        steps: [{ description: "The committed feature.", file: "feature.txt" }],
      });
      assert.equal(response.isError, false);
      assert.ok(warningCodes(response).includes("UNCOMMITTED_CHANGES_EXCLUDED"));
    });
  } finally {
    rmrf(root);
  }
});

test("explains local work when only uncommitted changes exist", async () => {
  const { root, head } = await setupRepo();
  try {
    writeFile(root, "work-in-progress.txt", "local work\n");
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_changes_tour", {
        baseRef: head,
        headRef: head,
        includeUncommittedChanges: true,
        steps: [{ description: "Local work.", file: "work-in-progress.txt" }],
      });
      assert.equal(response.isError, false);
      assert.equal(response.structured.status, "created");
      assert.ok(warningCodes(response).includes("UNCOMMITTED_CHANGES_INCLUDED"));
      assert.ok(!warningCodes(response).includes("NO_CHANGED_FILE_ANCHOR"));
    });
    const tour = readTourFile(root, ".tours/changes.tour");
    assert.equal(tour.ref, undefined);
  } finally {
    rmrf(root);
  }
});

test("counts uncommitted files as changed for NO_CHANGED_FILE_ANCHOR", async () => {
  const { root, baseSha, head } = await setupRepo();
  try {
    writeFile(root, "local-only.txt", "local work\n");
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: head,
        includeUncommittedChanges: true,
        steps: [{ description: "Local work.", file: "local-only.txt" }],
      });
      assert.equal(response.isError, false);
      assert.ok(!warningCodes(response).includes("NO_CHANGED_FILE_ANCHOR"));
    });
  } finally {
    rmrf(root);
  }
});

test(
  "preserves the previous tour when the write fails",
  {
    skip:
      process.platform === "win32" &&
      "POSIX directory permissions are unavailable",
  },
  async () => {
    const { root, baseSha, head } = await setupRepo();
    try {
    await withServer(root, async (client) => {
      const first = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: head,
        steps: [{ description: "Original.", file: "feature.txt" }],
      });
      assert.equal(first.isError, false);
    });
    const before = readTourFile(root, ".tours/changes.tour");
    const toursDir = `${root}/.tours`;
    const fs = await import("node:fs");
    fs.chmodSync(toursDir, 0o555);
    try {
      await withServer(root, async (client) => {
        const second = await callTool(client, "create_changes_tour", {
          baseRef: baseSha,
          headRef: head,
          steps: [{ description: "Should not land.", file: "feature.txt" }],
        });
        assert.equal(second.isError, true);
      });
      assert.deepEqual(readTourFile(root, ".tours/changes.tour"), before);
      const leftovers = fs
        .readdirSync(toursDir)
        .filter((name) => name.includes(".tmp-"));
      assert.deepEqual(leftovers, []);
    } finally {
      fs.chmodSync(toursDir, 0o755);
    }
    } finally {
      rmrf(root);
    }
  }
);

test("dryRun validates the proposal and writes nothing", async () => {
  const { root, baseSha, head } = await setupRepo();
  try {
    await withServer(root, async (client) => {
      const first = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: head,
        steps: [{ description: "Original.", file: "feature.txt" }],
      });
      assert.equal(first.isError, false, first.text);

      const response = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: head,
        dryRun: true,
        title: "Rehearsal",
        steps: [{ description: "Rehearsed.", file: "feature.txt" }],
      });
      assert.equal(response.isError, false, response.text);
      assert.equal(response.structured.status, "validated");
      assert.equal(response.structured.stepCount, 1);
      assert.equal(response.structured.path, undefined);
    });
    const tour = readTourFile(root, ".tours/changes.tour");
    assert.equal(tour.title, "Changes on feature");
    assert.equal(((tour.steps as unknown[])[0] as { description: string }).description, "Original.");
  } finally {
    rmrf(root);
  }
});

test("dryRun still fails with STALE_HEAD when headRef does not match HEAD", async () => {
  const { root, baseSha } = await setupRepo();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: "0".repeat(40),
        dryRun: true,
        steps: [{ description: "Rehearsed." }],
      });
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "STALE_HEAD");
    });
    assert.equal(
      fs.existsSync(path.join(root, ".tours/changes.tour")),
      false,
      "dryRun must not create the tour file"
    );
  } finally {
    rmrf(root);
  }
});

test("writes the tour under the provided fileName with the suffix appended", async () => {
  const { root, baseSha, head } = await setupRepo();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: head,
        fileName: "pr58-2-agent-providers",
        steps: [{ description: "d", file: "feature.txt" }],
      });
      assert.equal(response.isError, false, response.text);
      assert.equal(response.structured.path, ".tours/pr58-2-agent-providers.tour");
    });
    const tour = readTourFile(root, ".tours/pr58-2-agent-providers.tour");
    assert.equal(tour.ref, head);
    assert.equal(tour.baseRef, baseSha);
    assert.ok(tourFileValidAgainstSchema(root, ".tours/pr58-2-agent-providers.tour"));
    assert.equal(fs.existsSync(path.join(root, ".tours/changes.tour")), false);
  } finally {
    rmrf(root);
  }
});

test("does not double-append the .tour suffix when fileName already has it", async () => {
  const { root, baseSha, head } = await setupRepo();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: head,
        fileName: "slice.tour",
        steps: [{ description: "d", file: "feature.txt" }],
      });
      assert.equal(response.isError, false, response.text);
      assert.equal(response.structured.path, ".tours/slice.tour");
    });
    assert.ok(tourFileValidAgainstSchema(root, ".tours/slice.tour"));
  } finally {
    rmrf(root);
  }
});

test("rejects a fileName with a path separator", async () => {
  const { root, baseSha, head } = await setupRepo();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: head,
        fileName: "../escaped.tour",
        steps: [{ description: "d", file: "feature.txt" }],
      });
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "INVALID_PROPOSAL");
      assert.ok(issuePaths(response).includes("fileName"));
    });
    assert.equal(fs.existsSync(path.join(root, ".tours/escaped.tour")), false);
  } finally {
    rmrf(root);
  }
});

test("rejects an empty fileName and reports it in dryRun too", async () => {
  const { root, baseSha, head } = await setupRepo();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: head,
        fileName: "   ",
        dryRun: true,
        steps: [{ description: "d", file: "feature.txt" }],
      });
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "INVALID_PROPOSAL");
      assert.ok(issuePaths(response).includes("fileName"));
    });
  } finally {
    rmrf(root);
  }
});

test("replaces the previous tour at a custom fileName only on success", async () => {
  const { root, baseSha, head } = await setupRepo();
  try {
    await withServer(root, async (client) => {
      const first = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: head,
        fileName: "slice",
        steps: [{ description: "Original.", file: "feature.txt" }],
      });
      assert.equal(first.isError, false);
      const before = readTourFile(root, ".tours/slice.tour");

      const failed = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: head,
        fileName: "slice",
        steps: [
          {
            description: captionedDiagram("Broken", INVALID_FLOWCHART_SOURCE),
          },
        ],
      });
      assert.equal(failed.isError, true);
      assert.deepEqual(readTourFile(root, ".tours/slice.tour"), before);

      const second = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: head,
        fileName: "slice",
        steps: [{ description: "Replacement.", file: "feature.txt" }],
      });
      assert.equal(second.isError, false);
      const after = readTourFile(root, ".tours/slice.tour");
      assert.equal(
        ((after.steps as unknown[])[0] as { description: string }).description,
        "Replacement."
      );
    });
  } finally {
    rmrf(root);
  }
});

test("ignores custom tour files when detecting a dirty workspace", async () => {
  const { root, baseSha, head } = await setupRepo();
  try {
    writeFile(root, ".tours/pr58-2-agent-providers.tour", "{ generated earlier }");
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: head,
        fileName: "entry",
        steps: [{ description: "d", file: "feature.txt" }],
      });
      assert.equal(response.isError, false);
      assert.ok(!warningCodes(response).includes("UNCOMMITTED_CHANGES_EXCLUDED"));
    });
  } finally {
    rmrf(root);
  }
});


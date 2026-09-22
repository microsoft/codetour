import { test } from "node:test";
import * as assert from "node:assert";
import {
  callTool,
  issuePaths,
  readTourFile,
  rmrf,
  structuredCode,
  structuredIssues,
  tempDir,
  tourFileValidAgainstSchema,
  warningCodes,
  withServer,
  writeFile,
} from "../helpers/test-utils";

test("creates a project tour with the default title and no git ref", async () => {
  const root = tempDir();
  try {
    writeFile(root, "src/index.ts", "export const answer = 42;\n");
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        description: "An overview of the project.",
        steps: [
          { description: "Intro step." },
          { description: "The entry point.", file: "src/index.ts", line: 1 },
        ],
      });
      assert.equal(response.isError, false);
      assert.equal(response.structured.status, "created");
      assert.equal(response.structured.path, ".tours/project.tour");
      assert.equal(response.structured.stepCount, 2);
      assert.deepEqual(response.structured.warnings, []);
    });
    const tour = readTourFile(root, ".tours/project.tour");
    assert.equal(tour.title, "Project Overview");
    assert.equal(tour.description, "An overview of the project.");
    assert.equal(tour.ref, undefined);
    assert.equal(tour.$schema, "https://aka.ms/codetour-schema");
    assert.ok(tourFileValidAgainstSchema(root, ".tours/project.tour"));
  } finally {
    rmrf(root);
  }
});

test("uses the provided title and omits the description when absent", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        title: "My Tour",
        steps: [{ description: "Sole step." }],
      });
      assert.equal(response.isError, false);
    });
    const tour = readTourFile(root, ".tours/project.tour");
    assert.equal(tour.title, "My Tour");
    assert.equal(tour.description, undefined);
    assert.ok(tourFileValidAgainstSchema(root, ".tours/project.tour"));
  } finally {
    rmrf(root);
  }
});

test("works in a workspace that is not a git repository", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        steps: [{ description: "No git here." }],
      });
      assert.equal(response.isError, false);
      assert.equal(response.structured.status, "created");
    });
  } finally {
    rmrf(root);
  }
});

test("rejects an empty steps array with TOUR_STEPS_REQUIRED", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        steps: [],
      });
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "TOUR_STEPS_REQUIRED");
    });
  } finally {
    rmrf(root);
  }
});

test("rejects a missing steps array with TOUR_STEPS_REQUIRED", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {});
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "TOUR_STEPS_REQUIRED");
    });
  } finally {
    rmrf(root);
  }
});

test("aggregates all step validation errors in one response", async () => {
  const root = tempDir();
  try {
    writeFile(root, "a.ts", "one\ntwo\n");
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        steps: [
          { description: "Missing file.", file: "nope.ts", line: 1 },
          { file: "a.ts" },
        ],
      });
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "INVALID_PROPOSAL");
      const paths = issuePaths(response);
      assert.ok(paths.includes("steps[0].file"));
      assert.ok(paths.includes("steps[0].line"));
      assert.ok(paths.includes("steps[1].description"));
    });
  } finally {
    rmrf(root);
  }
});

test("keeps the previous tour when the new proposal is invalid", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const first = await callTool(client, "create_project_tour", {
        title: "Original",
        steps: [{ description: "Original step." }],
      });
      assert.equal(first.isError, false);

      const second = await callTool(client, "create_project_tour", {
        title: "Broken",
        steps: [{ description: "Broken step.", file: "missing.ts" }],
      });
      assert.equal(second.isError, true);
      assert.equal(structuredCode(second), "INVALID_PROPOSAL");
    });
    const tour = readTourFile(root, ".tours/project.tour");
    assert.equal(tour.title, "Original");
    assert.ok(tourFileValidAgainstSchema(root, ".tours/project.tour"));
  } finally {
    rmrf(root);
  }
});

test("replaces the previous tour atomically on success", async () => {
  const root = tempDir();
  try {
    writeFile(root, "a.ts", "one\n");
    await withServer(root, async (client) => {
      await callTool(client, "create_project_tour", {
        title: "First",
        steps: [{ description: "First step." }],
      });
      const second = await callTool(client, "create_project_tour", {
        title: "Second",
        steps: [{ description: "Second step.", file: "a.ts" }],
      });
      assert.equal(second.isError, false);
    });
    const tour = readTourFile(root, ".tours/project.tour");
    assert.equal(tour.title, "Second");
    assert.equal((tour.steps as unknown[]).length, 1);
    assert.ok(tourFileValidAgainstSchema(root, ".tours/project.tour"));
  } finally {
    rmrf(root);
  }
});

test("anchors a step on a directory", async () => {
  const root = tempDir();
  try {
    writeFile(root, "lib/util.ts", "export {};\n");
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        steps: [{ description: "The lib area.", directory: "lib" }],
      });
      assert.equal(response.isError, false);
    });
    assert.ok(tourFileValidAgainstSchema(root, ".tours/project.tour"));
  } finally {
    rmrf(root);
  }
});

test("anchors a step on a unique pattern", async () => {
  const root = tempDir();
  try {
    writeFile(root, "a.ts", "const x = 1;\nconst y = 2;\n");
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        steps: [
          { description: "The y declaration.", file: "a.ts", pattern: "const y" },
        ],
      });
      assert.equal(response.isError, false);
    });
  } finally {
    rmrf(root);
  }
});

test("anchors a step on a valid selection", async () => {
  const root = tempDir();
  try {
    writeFile(root, "a.ts", "export const answer = 42;\n");
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        steps: [
          {
            description: "The answer.",
            file: "a.ts",
            selection: {
              start: { line: 1, character: 21 },
              end: { line: 1, character: 23 },
            },
          },
        ],
      });
      assert.equal(response.isError, false);
    });
  } finally {
    rmrf(root);
  }
});

test("rejects an out-of-range selection", async () => {
  const root = tempDir();
  try {
    writeFile(root, "a.ts", "short\n");
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        steps: [
          {
            description: "Too long.",
            file: "a.ts",
            selection: {
              start: { line: 1, character: 1 },
              end: { line: 1, character: 99 },
            },
          },
        ],
      });
      assert.equal(response.isError, true);
      assert.ok(
        structuredIssues(response).some((issue) =>
          issue.path.includes("selection.end.character")
        )
      );
    });
  } finally {
    rmrf(root);
  }
});

test("rejects an out-of-range line", async () => {
  const root = tempDir();
  try {
    writeFile(root, "a.ts", "one\n");
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        steps: [{ description: "Too far.", file: "a.ts", line: 10 }],
      });
      assert.equal(response.isError, true);
      assert.ok(issuePaths(response).includes("steps[0].line"));
    });
  } finally {
    rmrf(root);
  }
});

test("warns without blocking when the tour exceeds fifteen steps", async () => {
  const root = tempDir();
  try {
    const steps = Array.from({ length: 16 }, (_, index) => ({
      description: `Step ${index + 1}.`,
    }));
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", { steps });
      assert.equal(response.isError, false);
      assert.equal(response.structured.stepCount, 16);
      assert.ok(warningCodes(response).includes("STEP_LIMIT_EXCEEDED"));
    });
  } finally {
    rmrf(root);
  }
});

test("rejects CodeTour commands, when expressions and uri fields", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        when: "true",
        steps: [
          { description: "d", commands: ["workbench.action.quit"] },
          { description: "d", uri: "https://example.com" },
        ],
      });
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "INVALID_PROPOSAL");
      const paths = issuePaths(response);
      assert.ok(paths.includes("when"));
      assert.ok(paths.includes("steps[0].commands"));
      assert.ok(paths.includes("steps[1].uri"));
    });
  } finally {
    rmrf(root);
  }
});

test("rejects active markdown URI schemes in descriptions", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        steps: [
          { description: "Run this: [click](command:workbench.action.quit)" },
        ],
      });
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "INVALID_PROPOSAL");
      assert.ok(issuePaths(response).includes("steps[0].description"));
    });
  } finally {
    rmrf(root);
  }
});

test("allows ordinary https links and images in descriptions", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        steps: [
          {
            description:
              "See [the docs](https://example.com/docs) and ![diagram](https://example.com/diagram.png).",
          },
        ],
      });
      assert.equal(response.isError, false);
    });
  } finally {
    rmrf(root);
  }
});

test("rejects absolute paths as anchors", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        steps: [{ description: "d", file: "/etc/passwd" }],
      });
      assert.equal(response.isError, true);
      assert.ok(issuePaths(response).includes("steps[0].file"));
    });
  } finally {
    rmrf(root);
  }
});

test("rejects relative paths escaping the workspace root", async () => {
  const root = tempDir();
  try {
    writeFile(root, "a.ts", "one\n");
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        steps: [{ description: "d", file: "../escape.ts" }],
      });
      assert.equal(response.isError, true);
      assert.ok(issuePaths(response).includes("steps[0].file"));
    });
  } finally {
    rmrf(root);
  }
});

test("rejects symlinks that escape the workspace root", async () => {
  const root = tempDir();
  const outside = tempDir();
  try {
    writeFile(outside, "secret.ts", "top secret\n");
    writeFile(root, "a.ts", "one\n");
    const fs = await import("node:fs");
    fs.symlinkSync(outside, `${root}/link-out`);
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        steps: [{ description: "d", file: "link-out/secret.ts" }],
      });
      assert.equal(response.isError, true);
      assert.ok(issuePaths(response).includes("steps[0].file"));
    });
  } finally {
    rmrf(root);
    rmrf(outside);
  }
});

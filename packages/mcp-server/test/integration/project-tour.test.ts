import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
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
import {
  ALLOWED_DIAGRAM_SOURCES,
  INVALID_FLOWCHART_SOURCE,
  captionedDiagram,
  oversizedFlowchartSource,
} from "../helpers/mermaid-fixtures";

test("accepts all five allowed Mermaid kinds in a Project Tour", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        steps: Object.entries(ALLOWED_DIAGRAM_SOURCES).map(([kind, source]) => ({
          description: captionedDiagram(`${kind} overview`, source),
        })),
      });
      assert.equal(response.isError, false, response.text);
      assert.equal(response.structured.stepCount, 5);
    });
    const tour = readTourFile(root, ".tours/project.tour");
    assert.equal((tour.steps as unknown[]).length, 5);
    assert.ok(tourFileValidAgainstSchema(root, ".tours/project.tour"));
  } finally {
    rmrf(root);
  }
});

test("aggregates Mermaid errors with fence paths and source locations", async () => {
  const root = tempDir();
  try {
    const description = [
      ["Introductory text", "", "```mermaid", ALLOWED_DIAGRAM_SOURCES.flowchart, "```"].join("\n"),
      captionedDiagram("Unsupported", "pie title Pets\n    \"Dogs\" : 1"),
      captionedDiagram("Oversized", oversizedFlowchartSource()),
      captionedDiagram("Fourth", ALLOWED_DIAGRAM_SOURCES.flowchart),
    ].join("\n\n");
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        description,
        steps: [
          {
            description: captionedDiagram("Broken syntax", INVALID_FLOWCHART_SOURCE),
          },
          {
            description: [
              "**Diagram – malformed caption**",
              "",
              "```mermaid",
              ALLOWED_DIAGRAM_SOURCES.flowchart,
              "```",
            ].join("\n"),
          },
        ],
      });
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "INVALID_PROPOSAL");
      const issues = structuredIssues(response);
      assert.deepEqual(
        issues.map((issue) => issue.path),
        [
          "description.mermaid[0].caption",
          "description.mermaid[1].kind",
          "description.mermaid[2].source",
          "description.mermaid[3]",
          "steps[0].description.mermaid[0].source",
          "steps[1].description.mermaid[0].caption",
        ]
      );
      assert.ok(issues.every((issue) => issue.message.includes("line")));
    });
    assert.equal(fs.existsSync(path.join(root, ".tours/project.tour")), false);
  } finally {
    rmrf(root);
  }
});

test("preserves the previous Project Tour when Mermaid validation fails", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const first = await callTool(client, "create_project_tour", {
        title: "Original",
        steps: [{ description: "Original step." }],
      });
      assert.equal(first.isError, false);
      const before = readTourFile(root, ".tours/project.tour");

      const second = await callTool(client, "create_project_tour", {
        title: "Broken",
        steps: [
          {
            description: captionedDiagram("Broken", INVALID_FLOWCHART_SOURCE),
          },
        ],
      });
      assert.equal(second.isError, true);
      assert.equal(structuredCode(second), "INVALID_PROPOSAL");
      assert.deepEqual(readTourFile(root, ".tours/project.tour"), before);
    });
  } finally {
    rmrf(root);
  }
});

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
      assert.deepEqual(warningCodes(response), ["ORIENTATION_STEP_MISSING_OVERVIEW"]);
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

test("returns advisory orientation step warnings without rejecting the tour", async () => {
  const root = tempDir();
  try {
    writeFile(root, "src/index.ts", "export const answer = 42;\n");
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        steps: [
          {
            description: "The entry point is explained here.",
            file: "src/index.ts",
          },
        ],
      });

      assert.equal(response.isError, false);
      assert.equal(response.structured.status, "created");
      assert.ok(warningCodes(response).includes("ORIENTATION_STEP_MISSING_OVERVIEW"));
    });
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

test("aggregates top-level Mermaid errors even when steps are missing", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        description: captionedDiagram("Broken", INVALID_FLOWCHART_SOURCE),
        steps: [],
      });
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "INVALID_PROPOSAL");
      assert.ok(issuePaths(response).includes("description.mermaid[0].source"));
      assert.ok(issuePaths(response).includes("steps"));
    });
  } finally {
    rmrf(root);
  }
});

test("rejects an unterminated Mermaid fence", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        description: [
          "**Diagram — Unterminated**",
          "",
          "```mermaid",
          ALLOWED_DIAGRAM_SOURCES.flowchart,
        ].join("\n"),
        steps: [{ description: "A valid step." }],
      });
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "INVALID_PROPOSAL");
      assert.ok(issuePaths(response).includes("description.mermaid[0].source"));
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

test("dryRun validates a proposal without writing the tour file", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const first = await callTool(client, "create_project_tour", {
        title: "Baseline",
        steps: [{ description: "Original step." }],
      });
      assert.equal(first.isError, false, first.text);

      const response = await callTool(client, "create_project_tour", {
        title: "Rehearsal",
        dryRun: true,
        steps: [{ description: "Rehearsed step." }],
      });
      assert.equal(response.isError, false, response.text);
      assert.equal(response.structured.status, "validated");
      assert.equal(response.structured.stepCount, 1);
      assert.equal(response.structured.path, undefined);
    });
    const tour = readTourFile(root, ".tours/project.tour");
    assert.equal(tour.title, "Baseline");
    assert.equal(((tour.steps as unknown[])[0] as { description: string }).description, "Original step.");
  } finally {
    rmrf(root);
  }
});

test("dryRun still rejects an invalid proposal and preserves the previous tour", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const first = await callTool(client, "create_project_tour", {
        title: "Baseline",
        steps: [{ description: "Original step." }],
      });
      assert.equal(first.isError, false, first.text);

      const response = await callTool(client, "create_project_tour", {
        title: "Rehearsal",
        dryRun: true,
        steps: [{ description: "Rehearsed step.", file: "does-not-exist.ts" }],
      });
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "INVALID_PROPOSAL");
      assert.ok(issuePaths(response).includes("steps[0].file"));
    });
    const tour = readTourFile(root, ".tours/project.tour");
    assert.equal(tour.title, "Baseline");
  } finally {
    rmrf(root);
  }
});

test("rejects a non-boolean dryRun", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        dryRun: "yes",
        steps: [{ description: "Step." }],
      });
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "INVALID_PROPOSAL");
      assert.ok(issuePaths(response).includes("dryRun"));
    });
  } finally {
    rmrf(root);
  }
});


test("persists suggested questions and preserves the tour when there are more than four", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const questions = ["Why this entry point?", "What calls it?", "Which tests cover it?"];
      const response = await callTool(client, "create_project_tour", {
        steps: [{ description: "Entry point.", questions }],
      });
      assert.equal(response.isError, false, response.text);
      const tour = readTourFile(root, ".tours/project.tour");
      assert.deepEqual((tour.steps as { questions: string[] }[])[0].questions, questions);
      assert.ok(tourFileValidAgainstSchema(root, ".tours/project.tour"));
      const rejected = await callTool(client, "create_project_tour", {
        steps: [{ description: "Replacement.", questions: Array(5).fill("Why?") }],
      });
      assert.equal(rejected.isError, true);
      assert.deepEqual(readTourFile(root, ".tours/project.tour"), tour);
    });
  } finally {
    rmrf(root);
  }
});

test("writes the tour under the provided fileName with the suffix appended", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        fileName: "onboarding-backend",
        steps: [{ description: "Entry point." }],
      });
      assert.equal(response.isError, false, response.text);
      assert.equal(response.structured.path, ".tours/onboarding-backend.tour");
    });
    const tour = readTourFile(root, ".tours/onboarding-backend.tour");
    assert.equal(tour.title, "Project Overview");
    assert.ok(tourFileValidAgainstSchema(root, ".tours/onboarding-backend.tour"));
    assert.equal(fs.existsSync(path.join(root, ".tours/project.tour")), false);
  } finally {
    rmrf(root);
  }
});

test("rejects a fileName with a path separator", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        fileName: "/absolute/project.tour",
        steps: [{ description: "Entry point." }],
      });
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "INVALID_PROPOSAL");
      assert.ok(issuePaths(response).includes("fileName"));
    });
    assert.equal(fs.existsSync(path.join(root, ".tours/project.tour")), false);
    assert.equal(fs.existsSync(path.join(root, "absolute")), false);
  } finally {
    rmrf(root);
  }
});

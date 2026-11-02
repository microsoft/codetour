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
  structuredIssues,
  tempDir,
  tourFileValidAgainstSchema,
  withServer,
} from "../helpers/test-utils";
import {
  HTML_BYTES,
  SVG_IMAGE,
  TINY_JPEG,
  TINY_PNG,
  oversizedPng,
  writeImageFile,
} from "../helpers/image-fixtures";

test("accepts a local image under the tour's own image directory", async () => {
  const root = tempDir();
  try {
    writeImageFile(root, ".tours/images/project/architecture.png", TINY_PNG);
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        steps: [
          {
            description:
              "See ![the architecture](.tours/images/project/architecture.png).",
          },
        ],
      });
      assert.equal(response.isError, false, response.text);
      assert.equal(response.structured.status, "created");
    });
    const tour = readTourFile(root, ".tours/project.tour");
    const description = (tour.steps as { description: string }[])[0].description;
    assert.ok(description.includes("architecture.png"));
    assert.ok(tourFileValidAgainstSchema(root, ".tours/project.tour"));
  } finally {
    rmrf(root);
  }
});

test("accepts a JPEG image under the tour's own image directory", async () => {
  const root = tempDir();
  try {
    writeImageFile(root, ".tours/images/project/screen.jpg", TINY_JPEG);
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        steps: [
          {
            description:
              "See ![the screen](.tours/images/project/screen.jpg).",
          },
        ],
      });
      assert.equal(response.isError, false, response.text);
    });
  } finally {
    rmrf(root);
  }
});

test("rejects an image reference whose file does not exist", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        steps: [
          {
            description:
              "See ![the architecture](.tours/images/project/missing.png).",
          },
        ],
      });
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "INVALID_PROPOSAL");
      assert.deepEqual(issuePaths(response), [
        "steps[0].description.image[0]",
      ]);
      const issue = structuredIssues(response)[0];
      assert.ok(issue.message.includes(".tours/images/project/missing.png"));
    });
    assert.equal(fs.existsSync(path.join(root, ".tours/project.tour")), false);
  } finally {
    rmrf(root);
  }
});

test("accepts a project image that already exists in the workspace", async () => {
  const root = tempDir();
  try {
    writeImageFile(root, "docs/logo.png", TINY_PNG);
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        steps: [{ description: "See ![the logo](docs/logo.png)." }],
      });
      assert.equal(response.isError, false, response.text);
      assert.equal(response.structured.status, "created");
    });
  } finally {
    rmrf(root);
  }
});

test("rejects an absolute image path", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        steps: [{ description: "See ![the logo](/etc/logo.png)." }],
      });
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "INVALID_PROPOSAL");
      assert.deepEqual(issuePaths(response), [
        "steps[0].description.image[0]",
      ]);
      assert.ok(structuredIssues(response)[0].message.includes("/etc/logo.png"));
    });
  } finally {
    rmrf(root);
  }
});

test("rejects an image path escaping the workspace root", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        steps: [{ description: "See ![the logo](../outside/logo.png)." }],
      });
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "INVALID_PROPOSAL");
      assert.deepEqual(issuePaths(response), [
        "steps[0].description.image[0]",
      ]);
      assert.ok(
        structuredIssues(response)[0].message.includes("../outside/logo.png")
      );
    });
  } finally {
    rmrf(root);
  }
});

test("rejects a reference into another tour's image directory", async () => {
  const root = tempDir();
  try {
    writeImageFile(root, ".tours/images/onboarding-backend/logo.png", TINY_PNG);
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        steps: [
          {
            description:
              "See ![the logo](.tours/images/onboarding-backend/logo.png).",
          },
        ],
      });
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "INVALID_PROPOSAL");
      assert.deepEqual(issuePaths(response), [
        "steps[0].description.image[0]",
      ]);
      assert.ok(
        structuredIssues(response)[0].message.includes(
          ".tours/images/onboarding-backend/logo.png"
        )
      );
    });
    assert.equal(fs.existsSync(path.join(root, ".tours/project.tour")), false);
  } finally {
    rmrf(root);
  }
});

test("rejects an image whose content is not PNG or JPEG despite its extension", async () => {
  const root = tempDir();
  try {
    writeImageFile(root, ".tours/images/project/fake.png", HTML_BYTES);
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        steps: [
          {
            description: "See ![the fake](.tours/images/project/fake.png).",
          },
        ],
      });
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "INVALID_PROPOSAL");
      assert.deepEqual(issuePaths(response), [
        "steps[0].description.image[0]",
      ]);
      const message = structuredIssues(response)[0].message;
      assert.ok(message.includes(".tours/images/project/fake.png"));
      assert.ok(message.includes("PNG or JPEG"));
    });
  } finally {
    rmrf(root);
  }
});

test("rejects an SVG image", async () => {
  const root = tempDir();
  try {
    writeImageFile(root, ".tours/images/project/icon.svg", SVG_IMAGE);
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        steps: [
          {
            description: "See ![the icon](.tours/images/project/icon.svg).",
          },
        ],
      });
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "INVALID_PROPOSAL");
      const message = structuredIssues(response)[0].message;
      assert.ok(message.includes(".tours/images/project/icon.svg"));
      assert.ok(message.includes("SVG"));
    });
  } finally {
    rmrf(root);
  }
});

test("rejects an image larger than 2 MB", async () => {
  const root = tempDir();
  try {
    writeImageFile(root, ".tours/images/project/huge.png", oversizedPng());
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        steps: [
          {
            description: "See ![the huge one](.tours/images/project/huge.png).",
          },
        ],
      });
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "INVALID_PROPOSAL");
      const message = structuredIssues(response)[0].message;
      assert.ok(message.includes(".tours/images/project/huge.png"));
      assert.ok(message.includes("2 MB"));
    });
  } finally {
    rmrf(root);
  }
});

test("derives the tour image directory from the provided fileName", async () => {
  const root = tempDir();
  try {
    writeImageFile(root, ".tours/images/onboarding-backend/logo.png", TINY_PNG);
    writeImageFile(root, ".tours/images/project/logo.png", TINY_PNG);
    await withServer(root, async (client) => {
      const accepted = await callTool(client, "create_project_tour", {
        fileName: "onboarding-backend",
        steps: [
          {
            description:
              "See ![the logo](.tours/images/onboarding-backend/logo.png).",
          },
        ],
      });
      assert.equal(accepted.isError, false, accepted.text);
      assert.equal(accepted.structured.path, ".tours/onboarding-backend.tour");

      const rejected = await callTool(client, "create_project_tour", {
        fileName: "onboarding-backend",
        steps: [
          {
            description: "See ![the logo](.tours/images/project/logo.png).",
          },
        ],
      });
      assert.equal(rejected.isError, true);
      assert.equal(structuredCode(rejected), "INVALID_PROPOSAL");
      assert.ok(
        structuredIssues(rejected)[0].message.includes(".tours/images/project/logo.png")
      );
    });
  } finally {
    rmrf(root);
  }
});

test("accepts images in subfolders of the tour's image directory", async () => {
  const root = tempDir();
  try {
    writeImageFile(root, ".tours/images/project/flows/arch.png", TINY_PNG);
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        steps: [
          {
            description:
              "See ![the flows](.tours/images/project/flows/arch.png).",
          },
        ],
      });
      assert.equal(response.isError, false, response.text);
    });
  } finally {
    rmrf(root);
  }
});

test("aggregates image issues from the tour-level description and several steps", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        description: "See ![the logo](.tours/images/project/missing.png).",
        steps: [
          {
            description: "See ![the logo](.tours/images/project/also-missing.png).",
          },
          { description: "A fine step." },
        ],
      });
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "INVALID_PROPOSAL");
      assert.deepEqual(issuePaths(response), [
        "description.image[0]",
        "steps[0].description.image[0]",
      ]);
    });
  } finally {
    rmrf(root);
  }
});

test("ignores image references inside code fences", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        steps: [
          {
            description: [
              "Markdown image syntax looks like this:",
              "",
              "```markdown",
              "![alt](.tours/images/project/missing.png)",
              "```",
              "",
              "But the step itself has no local image.",
            ].join("\n"),
          },
        ],
      });
      assert.equal(response.isError, false, response.text);
    });
  } finally {
    rmrf(root);
  }
});

test("keeps https and data images outside the local file checks", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        steps: [
          {
            description:
              "Remote ![diagram](https://example.com/diagram.png) and inline ![pixel](data:image/png;base64,iVBORw0KGgo=).",
          },
        ],
      });
      assert.equal(response.isError, false, response.text);
    });
  } finally {
    rmrf(root);
  }
});

test("preserves the previous tour when image validation fails", async () => {
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
            description: "See ![the logo](.tours/images/project/missing.png).",
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

test("accepts and rejects local images in a changes tour", async () => {
  const root = tempDir();
  await initGitRepo(root);
  await commitFile(root, "base.txt", "base content\n", "add base file");
  const baseSha = await headSha(root);
  await git(["checkout", "-b", "feature"], root);
  await commitFile(root, "feature.txt", "feature content\n", "add feature file");
  const head = await headSha(root);
  try {
    writeImageFile(root, ".tours/images/changes/review.png", TINY_PNG);
    writeImageFile(root, ".tours/images/project/logo.png", TINY_PNG);
    await withServer(root, async (client) => {
      const accepted = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: head,
        steps: [
          {
            description:
              "See ![the review](.tours/images/changes/review.png).",
            file: "feature.txt",
          },
        ],
      });
      assert.equal(accepted.isError, false, accepted.text);
      assert.equal(accepted.structured.status, "created");

      const rejected = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: head,
        steps: [
          {
            description: "See ![the logo](.tours/images/project/logo.png).",
            file: "feature.txt",
          },
        ],
      });
      assert.equal(rejected.isError, true);
      assert.equal(structuredCode(rejected), "INVALID_PROPOSAL");
      assert.deepEqual(issuePaths(rejected), [
        "steps[0].description.image[0]",
      ]);
    });
  } finally {
    rmrf(root);
  }
});

test("dryRun validates image references without writing the tour file", async () => {
  const root = tempDir();
  try {
    writeImageFile(root, ".tours/images/project/architecture.png", TINY_PNG);
    await withServer(root, async (client) => {
      const first = await callTool(client, "create_project_tour", {
        title: "Baseline",
        steps: [{ description: "Original step." }],
      });
      assert.equal(first.isError, false, first.text);

      const valid = await callTool(client, "create_project_tour", {
        title: "Rehearsal",
        dryRun: true,
        steps: [
          {
            description:
              "See ![the architecture](.tours/images/project/architecture.png).",
          },
        ],
      });
      assert.equal(valid.isError, false, valid.text);
      assert.equal(valid.structured.status, "validated");

      const invalid = await callTool(client, "create_project_tour", {
        title: "Rehearsal",
        dryRun: true,
        steps: [
          {
            description:
              "See ![the architecture](.tours/images/project/missing.png).",
          },
        ],
      });
      assert.equal(invalid.isError, true);
      assert.equal(structuredCode(invalid), "INVALID_PROPOSAL");
      assert.deepEqual(issuePaths(invalid), [
        "steps[0].description.image[0]",
      ]);
    });
    const tour = readTourFile(root, ".tours/project.tour");
    assert.equal(tour.title, "Baseline");
  } finally {
    rmrf(root);
  }
});

test("rejects a local image reference whose path contains spaces when the file is missing", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        steps: [
          {
            description:
              "See ![the arch](.tours/images/project/my arch.png).",
          },
        ],
      });
      assert.equal(response.isError, true, response.text);
      assert.equal(structuredCode(response), "INVALID_PROPOSAL");
      assert.deepEqual(issuePaths(response), [
        "steps[0].description.image[0]",
      ]);
      assert.ok(
        structuredIssues(response)[0].message.includes(
          ".tours/images/project/my arch.png"
        )
      );
    });
  } finally {
    rmrf(root);
  }
});

test("accepts an existing local image whose path contains spaces", async () => {
  const root = tempDir();
  try {
    writeImageFile(root, ".tours/images/project/my arch.png", TINY_PNG);
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        steps: [
          {
            description:
              "See ![the arch](.tours/images/project/my arch.png).",
          },
        ],
      });
      assert.equal(response.isError, false, response.text);
      assert.equal(response.structured.status, "created");
    });
  } finally {
    rmrf(root);
  }
});

test("validates image references against the workspace root, not the selected workspacePath", async () => {
  const root = tempDir();
  try {
    writeImageFile(root, "docs/logo.png", TINY_PNG);
    fs.mkdirSync(path.join(root, "subdir"));
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        workspacePath: "subdir",
        steps: [{ description: "See ![the logo](docs/logo.png)." }],
      });
      assert.equal(response.isError, false, response.text);
      assert.equal(response.structured.status, "created");
    });
  } finally {
    rmrf(root);
  }
});

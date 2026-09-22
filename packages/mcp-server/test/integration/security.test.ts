import { test } from "node:test";
import * as assert from "node:assert";
import {
  callTool,
  rmrf,
  structuredCode,
  tempDir,
  withServer,
} from "../helpers/test-utils";

test("rejects a file: scheme in a step description", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        steps: [{ description: "Open [the file](file:///etc/passwd)." }],
      });
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "INVALID_PROPOSAL");
    });
  } finally {
    rmrf(root);
  }
});

test("rejects vscode: and javascript: schemes in a step description", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        steps: [
          { description: "Click [here](vscode://file/x)." },
          { description: "Execute [this](javascript:alert(1))." },
        ],
      });
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "INVALID_PROPOSAL");
    });
  } finally {
    rmrf(root);
  }
});

test("rejects a command scheme in a changes tour description", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        steps: [{ description: "Run [this](command:workbench.action.quit)." }],
      });
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "INVALID_PROPOSAL");
    });
  } finally {
    rmrf(root);
  }
});

test("rejects an active scheme in the tour-level description", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        description: "See [the launch command](command:workbench.action.quit).",
        steps: [{ description: "Fine step." }],
      });
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "INVALID_PROPOSAL");
      const issues = (response.structured.issues ?? []) as Array<{ path: string }>;
      assert.ok(issues.some((issue) => issue.path === "description"));
    });
  } finally {
    rmrf(root);
  }
});

test("exposes exactly two tools", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name).sort();
      assert.deepEqual(names, ["create_changes_tour", "create_project_tour"]);
      const project = tools.tools.find((tool) => tool.name === "create_project_tour");
      assert.ok(project);
      assert.ok(project!.description!.includes("Project Tour"));
      const changes = tools.tools.find((tool) => tool.name === "create_changes_tour");
      assert.ok(changes);
      assert.ok(changes!.description!.includes("Changes Tour"));
    });
  } finally {
    rmrf(root);
  }
});

test("returns a human-readable message and a structured result", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        steps: [{ description: "Hello." }],
      });
      assert.equal(response.isError, false);
      assert.ok(response.text.includes(".tours/project.tour"));
      assert.equal(response.structured.status, "created");
      assert.equal(response.structured.path, ".tours/project.tour");
      assert.equal(response.structured.stepCount, 1);
      assert.ok(Array.isArray(response.structured.warnings));
    });
  } finally {
    rmrf(root);
  }
});

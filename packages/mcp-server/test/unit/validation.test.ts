import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { createContext } from "../../src/context";
import {
  MAX_PATTERN_LENGTH,
  MAX_RECOMMENDED_DIAGRAM_NODES,
  MAX_RECOMMENDED_STEPS,
  orientationStepWarnings,
  validateChangesParams,
  validateProjectParams,
  validateSteps,
} from "../../src/validation";
import { rmrf, tempDir, writeFile } from "../helpers/test-utils";

test("orientationStepWarnings accepts a locator-free Mermaid overview", () => {
  const warnings = orientationStepWarnings([
    {
      description: [
        "**Diagram — Vue contexte**",
        "",
        "```mermaid",
        "flowchart LR",
        "  Reader --> Tour",
        "```",
      ].join("\n"),
    },
  ]);

  assert.deepEqual(warnings, []);
});

test("orientationStepWarnings warns when the first step has a file locator", () => {
  const warnings = orientationStepWarnings([
    {
      description: "**Diagram — Overview**\n\n```mermaid\nflowchart LR\n  A --> B\n```",
      file: "src/index.ts",
    },
  ]);

  assert.deepEqual(warnings.map((warning) => warning.code), [
    "ORIENTATION_STEP_MISSING_OVERVIEW",
  ]);
});

test("orientationStepWarnings warns when the first step has no Mermaid fence", () => {
  const warnings = orientationStepWarnings([
    { description: "A text-only introduction." },
  ]);

  assert.deepEqual(warnings.map((warning) => warning.code), [
    "ORIENTATION_STEP_MISSING_OVERVIEW",
  ]);
});

test("orientationStepWarnings accepts a diagram at the recommended node limit", () => {
  const edges = Array.from(
    { length: MAX_RECOMMENDED_DIAGRAM_NODES - 1 },
    (_, index) => `  Node${index + 1} --> Node${index + 2}`
  );
  const warnings = orientationStepWarnings([
    {
      description: [
        "**Diagram — Overview**",
        "",
        "```mermaid",
        "flowchart LR",
        ...edges,
        "```",
      ].join("\n"),
    },
  ]);

  assert.deepEqual(warnings, []);
});

test("orientationStepWarnings warns when the first diagram exceeds the recommended node limit", () => {
  const edges = Array.from(
    { length: MAX_RECOMMENDED_DIAGRAM_NODES },
    (_, index) => `  Node${index + 1} --> Node${index + 2}`
  );
  const warnings = orientationStepWarnings([
    {
      description: [
        "**Diagram — Overview**",
        "",
        "```mermaid",
        "flowchart LR",
        ...edges,
        "```",
      ].join("\n"),
    },
  ]);

  assert.deepEqual(warnings.map((warning) => warning.code), [
    "ORIENTATION_STEP_DIAGRAM_TOO_LARGE",
  ]);
});

test("orientationStepWarnings does not count edge labels as diagram nodes", () => {
  const warnings = orientationStepWarnings([
    {
      description: [
        "**Diagram — Vue contexte**",
        "",
        "```mermaid",
        "flowchart LR",
        "  Client[\"Client\"] --> API: passe les commandes (HTTPS)",
        "  API -->|enregistre les tours| Store[(\"Fichiers .tours\")]",
        "```",
      ].join("\n"),
    },
  ]);

  assert.deepEqual(warnings, []);
});

test("validateProjectParams rejects non-object arguments", () => {
  const { issues } = validateProjectParams("not-an-object");
  assert.ok(issues.some((issue) => issue.path === "$"));
});

test("validateProjectParams rejects unknown root fields", () => {
  const { issues } = validateProjectParams({ when: "true", steps: [] });
  assert.ok(issues.some((issue) => issue.path === "when"));
});

test("validateProjectParams requires a string title and description", () => {
  const { issues } = validateProjectParams({
    title: 5,
    description: false,
    steps: [],
  });
  const paths = issues.map((issue) => issue.path);
  assert.ok(paths.includes("title"));
  assert.ok(paths.includes("description"));
});

test("validateChangesParams requires baseRef and a full headRef SHA", () => {
  const { issues } = validateChangesParams({ steps: [] });
  const paths = issues.map((issue) => issue.path);
  assert.ok(paths.includes("baseRef"));
  assert.ok(paths.includes("headRef"));
});

test("validateChangesParams accepts the public Changes Tour contract", () => {
  const headRef = "a".repeat(40);
  const { params, issues } = validateChangesParams({
    baseRef: "main",
    headRef,
    includeUncommittedChanges: true,
    steps: [{ description: "Explain the change." }],
  });

  assert.deepEqual(issues, []);
  assert.equal(params?.baseRef, "main");
  assert.equal(params?.headRef, headRef);
  assert.equal(params?.includeUncommittedChanges, true);
});

test("validateChangesParams rejects a short head SHA", () => {
  const { issues } = validateChangesParams({
    baseRef: "main",
    headRef: "deadbeef",
    steps: [],
  });
  assert.ok(issues.some((issue) => issue.path === "headRef"));
});

test("validateChangesParams accepts both review modes", () => {
  const headRef = "a".repeat(40);
  for (const reviewMode of ["neutral", "critical"] as const) {
    const { params, issues } = validateChangesParams({
      baseRef: "main",
      headRef,
      reviewMode,
      steps: [{ description: "Explain the change." }],
    });
    assert.deepEqual(issues, []);
    assert.equal(params?.reviewMode, reviewMode);
  }
});

test("validateChangesParams leaves reviewMode unset for existing neutral calls", () => {
  const { params, issues } = validateChangesParams({
    baseRef: "main",
    headRef: "a".repeat(40),
    steps: [{ description: "Explain the change." }],
  });
  assert.deepEqual(issues, []);
  assert.equal(params?.reviewMode, undefined);
});

test("validateChangesParams rejects a reviewMode that is not neutral or critical", () => {
  const headRef = "a".repeat(40);
  for (const reviewMode of ["angry", "CRITICAL", 1, null, {}, []]) {
    const { issues } = validateChangesParams({
      baseRef: "main",
      headRef,
      reviewMode,
      steps: [],
    });
    assert.ok(
      issues.some(
        (issue) =>
          issue.path === "reviewMode" &&
          issue.message.includes('must be "neutral" or "critical"')
      ),
      `reviewMode ${JSON.stringify(reviewMode)} must be rejected`
    );
  }
});

test("validateChangesParams aggregates a reviewMode error with other field errors", () => {
  const { issues } = validateChangesParams({
    baseRef: "main",
    headRef: "deadbeef",
    reviewMode: "angry",
    steps: [],
  });
  const paths = issues.map((issue) => issue.path);
  assert.ok(paths.includes("reviewMode"));
  assert.ok(paths.includes("headRef"));
});

test("validateProjectParams rejects reviewMode as an unknown field", () => {
  const { issues } = validateProjectParams({
    reviewMode: "critical",
    steps: [{ description: "Explain." }],
  });
  assert.ok(issues.some((issue) => issue.path === "reviewMode"));
});

test("validateChangesParams rejects a non-boolean includeUncommittedChanges", () => {
  const { issues } = validateChangesParams({
    baseRef: "main",
    headRef: "a".repeat(40),
    includeUncommittedChanges: "yes",
    steps: [],
  });
  assert.ok(issues.some((issue) => issue.path === "includeUncommittedChanges"));
});

test("validateChangesParams rejects a baseRef that could be parsed as a Git option", () => {
  const { issues } = validateChangesParams({
    baseRef: "--output=/tmp/pwned",
    headRef: "a".repeat(40),
    steps: [],
  });
  assert.ok(
    issues.some(
      (issue) => issue.path === "baseRef" && issue.message.includes("must not start with '-'")
    )
  );
});

function workspaceWithFiles(files: Record<string, string>): string {
  const dir = tempDir();
  for (const [name, content] of Object.entries(files)) {
    writeFile(dir, name, content);
  }
  return dir;
}

function validate(rawSteps: unknown[], root: string) {
  return validateSteps(rawSteps, createContext(root));
}

test("a step rejects a file and a directory together", () => {
  const root = workspaceWithFiles({ "a.ts": "x" });
  fs.mkdirSync(path.join(root, "sub"));
  const { issues } = validate(
    [{ description: "d", file: "a.ts", directory: "sub" }],
    root
  );
  assert.ok(issues.some((issue) => issue.path === "steps[0]"));
  rmrf(root);
});

test("line and pattern are mutually exclusive", () => {
  const root = workspaceWithFiles({ "a.ts": "one\ntwo\n" });
  const { issues } = validate(
    [{ description: "d", file: "a.ts", line: 1, pattern: "two" }],
    root
  );
  assert.ok(issues.some((issue) => issue.message.includes("mutually exclusive")));
  rmrf(root);
});

test("line, pattern and selection require a file", () => {
  const root = workspaceWithFiles({ "a.ts": "one\ntwo\n" });
  const { issues } = validate(
    [
      { description: "d", line: 1 },
      { description: "d", pattern: "one" },
      {
        description: "d",
        selection: { start: { line: 1, character: 1 }, end: { line: 1, character: 2 } },
      },
    ],
    root
  );
  assert.equal(issues.length, 3);
  rmrf(root);
});

test("line must be a positive integer", () => {
  const root = workspaceWithFiles({ "a.ts": "one\n" });
  const { issues } = validate(
    [
      { description: "d", file: "a.ts", line: 0 },
      { description: "d", file: "a.ts", line: 1.5 },
    ],
    root
  );
  assert.equal(issues.filter((issue) => issue.path.endsWith(".line")).length, 2);
  rmrf(root);
});

test("a pattern must match exactly one occurrence", () => {
  const root = workspaceWithFiles({ "a.ts": "one\ntwo\none\n" });
  const { issues } = validate(
    [
      { description: "d", file: "a.ts", pattern: "one" },
      { description: "d", file: "a.ts", pattern: "three" },
    ],
    root
  );
  assert.equal(issues.length, 2);
  rmrf(root);
});

test("an invalid regular expression is rejected", () => {
  const root = workspaceWithFiles({ "a.ts": "one\n" });
  const { issues } = validate(
    [{ description: "d", file: "a.ts", pattern: "(unclosed" }],
    root
  );
  assert.equal(issues.length, 1);
  rmrf(root);
});

test("a potentially catastrophic regular expression is rejected", () => {
  const root = workspaceWithFiles({ "a.ts": "a".repeat(100) });
  const { issues } = validate(
    [{ description: "d", file: "a.ts", pattern: "(a+)+$" }],
    root
  );
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /excessive backtracking/);
  rmrf(root);
});

test("an overly long pattern is rejected", () => {
  const root = workspaceWithFiles({ "a.ts": "one\n" });
  const { issues } = validate(
    [{ description: "d", file: "a.ts", pattern: "a".repeat(MAX_PATTERN_LENGTH + 1) }],
    root
  );
  assert.equal(issues.length, 1);
  assert.ok(issues[0].path.endsWith(".pattern"));
  rmrf(root);
});

test("steps may anchor files and directories without line targeting", () => {
  const root = workspaceWithFiles({ "a.ts": "one\ntwo\n" });
  fs.mkdirSync(path.join(root, "sub"));
  const { steps, issues } = validate(
    [
      { description: "d", file: "a.ts" },
      { description: "d", directory: "sub" },
    ],
    root
  );
  assert.equal(issues.length, 0);
  assert.ok(steps);
  assert.equal(steps!.length, 2);
  rmrf(root);
});

test("content-only steps without any anchor are allowed", () => {
  const root = workspaceWithFiles({ "a.ts": "one\n" });
  const { steps, issues } = validate(
    [{ description: "intro" }, { description: "deleted file context" }],
    root
  );
  assert.equal(issues.length, 0);
  assert.ok(steps);
  assert.equal(steps!.length, 2);
  rmrf(root);
});

test("the recommended step maximum is fifteen", () => {
  assert.equal(MAX_RECOMMENDED_STEPS, 15);
});


test("step questions are optional and preserve up to four contextual prompts", () => {
  const root = tempDir();
  try {
    const questions = [" Why? ", "Which caller?", "Which tests?", "Which limit?"];
    const result = validate([{ description: "Step", questions }, { description: "Legacy step" }], root);
    assert.deepEqual(result.issues, []);
    assert.ok(result.steps);
    assert.deepEqual(result.steps[0].questions, questions.map(question => question.trim()));
    assert.equal(result.steps[1].questions, undefined);
  } finally {
    rmrf(root);
  }
});

test("step questions reject excessive, empty and non-string suggestions", () => {
  const root = tempDir();
  try {
    for (const questions of ["Why?", Array(5).fill("Why?"), [""], ["   "], [42], [null]]) {
      const result = validate([{ description: "Step", questions }], root);
      assert.ok(result.issues.some(issue => issue.path.startsWith("steps[0].questions")));
    }
  } finally {
    rmrf(root);
  }
});

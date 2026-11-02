import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
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
  withServer,
  writeFile,
} from "../helpers/test-utils";
import {
  CODETOUR_CRITICAL_REVIEW_ADAPTATION,
  CRITICAL_REVIEW_RESOURCE_URI,
  UPSTREAM_CODE_REVIEW_LICENSE,
  UPSTREAM_CODE_REVIEW_SKILL,
  UPSTREAM_CODE_REVIEW_SOURCE_REVISION,
  criticalReviewSkillPack,
} from "../../src/review-skill";

// The integration seam plays a fake orchestrator: the tests act as the
// generating agent that reads the skill-pack resource before writing any
// step, then calls create_changes_tour with an explicit review mode.

interface RepoSetup {
  root: string;
  baseSha: string;
  head: string;
}

// A repository whose feature branch adds feature.js. The optional extras
// add the sources the fake orchestrator may find: a documented standards
// rule and a spec referenced by the feature commit.
async function setupCriticalRepo(options: {
  withSpec?: boolean;
  withStandards?: boolean;
} = {}): Promise<RepoSetup> {
  const root = tempDir();
  await initGitRepo(root);
  if (options.withStandards !== false) {
    await commitFile(
      root,
      "AGENTS.md",
      "# Standards\n\n- All runtime source files use TypeScript.\n",
      "document standards"
    );
  } else {
    await commitFile(root, "base.txt", "base content\n", "add base file");
  }
  if (options.withSpec) {
    await commitFile(
      root,
      "docs/feature-spec.md",
      [
        "# Feature spec",
        "",
        "## Requirements",
        "",
        "- The tour destination is printed with its .tour suffix.",
        "- Errors are reported to the caller.",
        "",
      ].join("\n"),
      "add feature spec"
    );
  }
  const baseSha = await headSha(root);
  await git(["checkout", "-b", "feature"], root);
  const commitMessage = options.withSpec
    ? "add feature output (implements docs/feature-spec.md)"
    : "add feature output";
  await commitFile(
    root,
    "feature.js",
    ['export function writeTour() {', '  return ".tours/changes.tour";', "}", ""].join("\n"),
    commitMessage
  );
  const head = await headSha(root);
  return { root, baseSha, head };
}

test("serves the critical review skill pack resource", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await client.readResource({
        uri: CRITICAL_REVIEW_RESOURCE_URI,
      });
      const content = response.contents[0];
      assert.equal(content.uri, CRITICAL_REVIEW_RESOURCE_URI);
      const text = (content as { text?: string }).text ?? "";
      // The resource serves the exact assembled pack: upstream verbatim,
      // CodeTour adaptation, source revision, attribution, and MIT license.
      assert.equal(text, criticalReviewSkillPack());
      assert.ok(text.includes(UPSTREAM_CODE_REVIEW_SKILL));
      assert.ok(text.includes(CODETOUR_CRITICAL_REVIEW_ADAPTATION));
      assert.ok(text.includes(UPSTREAM_CODE_REVIEW_LICENSE));
      assert.ok(text.includes(UPSTREAM_CODE_REVIEW_SOURCE_REVISION));
      assert.ok(text.includes("Matt Pocock"));
      assert.ok(text.includes("MIT"));
    });
  } finally {
    rmrf(root);
  }
});

test("create_changes_tour guidance refers to the skill pack resource", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const { tools } = await client.listTools();
      const changes = tools.find((tool) => tool.name === "create_changes_tour");
      const project = tools.find((tool) => tool.name === "create_project_tour");
      assert.ok(changes, "create_changes_tour must stay exposed");
      assert.ok(project, "create_project_tour must stay exposed");
      assert.equal(tools.length, 2, "no third tool may be added");
      assert.ok(
        (changes.description ?? "").includes(CRITICAL_REVIEW_RESOURCE_URI),
        "the changes tour guidance must reference the skill pack resource"
      );
      assert.ok(
        (changes.description ?? "").includes("critical"),
        "the changes tour guidance must describe the critical mode"
      );
      assert.ok(
        !(project.description ?? "").includes(CRITICAL_REVIEW_RESOURCE_URI),
        "project tours have no review mode"
      );
    });
  } finally {
    rmrf(root);
  }
});

// Fake-orchestrator scenario (b): a spec source is found (referenced by the
// feature commit), so the critical tour explains the changes, labels the
// Standards and Spec findings separately, and anchors each finding at the
// changed lines. The test acts as the generating agent following the skill
// pack: read the resource, find the spec source in the commit reference,
// then author the steps.
test("critical changes tour with a found spec separates labeled Standards and Spec findings", async () => {
  const { root, baseSha, head } = await setupCriticalRepo({ withSpec: true });
  try {
    await withServer(root, async (client) => {
      // The orchestrator reads the skill pack before writing any step.
      const resource = await client.readResource({ uri: CRITICAL_REVIEW_RESOURCE_URI });
      assert.ok(((resource.contents[0] as { text?: string }).text ?? "").length > 0);

      // The agent follows the commit reference to the spec source.
      const specPath = "docs/feature-spec.md";
      assert.ok(
        (await git(["log", "--format=%B", `${baseSha}..${head}`], root)).stdout.includes(specPath),
        "the feature commit must reference the spec source"
      );

      const response = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: head,
        reviewMode: "critical",
        description: [
          "The branch adds feature.js exporting writeTour, which returns the tour destination path.",
          "Review axes: Standards and Spec. Spec source: docs/feature-spec.md, referenced by the feature commit.",
        ].join("\n\n"),
        steps: [
          {
            title: "The new feature module",
            description: [
              "The change adds a single module that computes the destination the tour generator writes to.",
              "**Standards:** demonstrated violation — AGENTS.md requires that all runtime source files use TypeScript, and feature.js is JavaScript.",
            ].join("\n\n"),
            file: "feature.js",
            pattern: "export function writeTour",
          },
          {
            title: "Destination and unimplemented error reporting",
            description: [
              "writeTour returns the .tour destination, which satisfies the spec requirement \"The tour destination is printed with its .tour suffix.\" (docs/feature-spec.md).",
              "**Spec:** requirement not implemented — \"Errors are reported to the caller.\" (docs/feature-spec.md) has no counterpart in the diff: writeTour returns only the destination and reports nothing.",
            ].join("\n\n"),
            file: "feature.js",
            line: 2,
          },
        ],
      });
      assert.equal(response.isError, false, response.text);
      assert.equal(response.structured.status, "created");
      assert.equal(response.structured.stepCount, 2);
    });
    const tour = readTourFile(root, ".tours/changes.tour");
    assert.ok(tourFileValidAgainstSchema(root, ".tours/changes.tour"));
    assert.equal(tour.ref, head);
    assert.equal(tour.baseRef, baseSha);
    const steps = tour.steps as Array<{ description: string; file?: string; display?: string }>;
    assert.equal(steps.length, 2);
    // Both file steps are anchored at the changed file and shown as diffs.
    assert.equal(steps[0].file, "feature.js");
    assert.equal(steps[0].display, "diff");
    assert.equal(steps[1].file, "feature.js");
    // The factual explanation stays in every step.
    assert.ok(steps[0].description.includes("computes the destination"));
    // Standards and Spec findings are present, labeled, and separated.
    assert.ok(steps[0].description.includes("**Standards:**"));
    assert.ok(steps[0].description.includes("AGENTS.md"));
    assert.ok(steps[1].description.includes("**Spec:**"));
    assert.ok(steps[1].description.includes("Errors are reported to the caller."));
    // The spec reference is kept verifiable in the tour.
    assert.ok((tour.description as string).includes("docs/feature-spec.md"));
  } finally {
    rmrf(root);
  }
});

// Fake-orchestrator scenario (c): no spec source exists. The tour is still
// produced: the Standards axis works, the Spec axis is declared as not
// evaluated, and nothing blocks.
test("critical changes tour without a spec declares the Spec axis not evaluated", async () => {
  const { root, baseSha, head } = await setupCriticalRepo();
  try {
    await withServer(root, async (client) => {
      const resource = await client.readResource({ uri: CRITICAL_REVIEW_RESOURCE_URI });
      assert.ok(((resource.contents[0] as { text?: string }).text ?? "").length > 0);

      // No docs/, specs/, or .scratch/ source and no ticket reference in the
      // commits: the agent continues without asking for a spec.
      const response = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: head,
        reviewMode: "critical",
        description: [
          "The branch adds feature.js exporting writeTour, which returns the tour destination path.",
          "Spec axis not evaluated: no spec source was found.",
        ].join("\n\n"),
        steps: [
          {
            title: "The new feature module",
            description: [
              "The change adds a single module that computes the destination the tour generator writes to.",
              "**Standards:** demonstrated violation — AGENTS.md requires that all runtime source files use TypeScript, and feature.js is JavaScript.",
            ].join("\n\n"),
            file: "feature.js",
            pattern: "export function writeTour",
          },
        ],
      });
      assert.equal(response.isError, false, response.text);
      assert.equal(response.structured.status, "created");
      assert.equal(response.structured.stepCount, 1);
    });
    const tour = readTourFile(root, ".tours/changes.tour");
    assert.ok(tourFileValidAgainstSchema(root, ".tours/changes.tour"));
    assert.ok((tour.description as string).includes("Spec axis not evaluated: no spec source was found."));
    const steps = tour.steps as Array<{ description: string }>;
    assert.ok(steps[0].description.includes("**Standards:**"));
    assert.ok(!steps[0].description.includes("**Spec:**"));
  } finally {
    rmrf(root);
  }
});

// Fake-orchestrator scenario (d): no defect is established. The tour stays
// a factual explanation with no invented findings, and it is still created.
test("critical changes tour without established defects stays factual", async () => {
  const { root, baseSha, head } = await setupCriticalRepo({
    withSpec: false,
    withStandards: false,
  });
  try {
    await withServer(root, async (client) => {
      const resource = await client.readResource({ uri: CRITICAL_REVIEW_RESOURCE_URI });
      assert.ok(((resource.contents[0] as { text?: string }).text ?? "").length > 0);

      const response = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: head,
        reviewMode: "critical",
        description: [
          "The branch adds feature.js exporting writeTour, which returns the tour destination path.",
          "Spec axis not evaluated: no spec source was found.",
          "No defect was established on the Standards axis.",
        ].join("\n\n"),
        steps: [
          {
            title: "The new feature module",
            description:
              "The change adds a single module that computes the destination the tour generator writes to. The function has no callers yet; its tests are inferred from the change, not executed.",
            file: "feature.js",
            pattern: "export function writeTour",
          },
        ],
      });
      assert.equal(response.isError, false, response.text);
      assert.equal(response.structured.status, "created");
    });
    const tour = readTourFile(root, ".tours/changes.tour");
    assert.ok(tourFileValidAgainstSchema(root, ".tours/changes.tour"));
    const steps = tour.steps as Array<{ description: string }>;
    assert.ok(!steps[0].description.includes("**Standards:**"));
    assert.ok(!steps[0].description.includes("**Spec:**"));
    // Inferred tests are never presented as executed.
    assert.ok(steps[0].description.includes("not executed"));
  } finally {
    rmrf(root);
  }
});

// Fake-orchestrator scenario (e): existing direct calls stay neutral and
// unchanged, the mode is never persisted, and invalid values are rejected
// with the previous tour preserved.
test("existing calls without reviewMode stay neutral and never persist the mode", async () => {
  const { root, baseSha, head } = await setupCriticalRepo();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: head,
        steps: [{ description: "The new module.", file: "feature.js" }],
      });
      assert.equal(response.isError, false, response.text);
      assert.equal(response.structured.status, "created");
    });
    const tour = readTourFile(root, ".tours/changes.tour");
    assert.ok(!("reviewMode" in tour), "the mode must not be persisted in the .tour file");
    assert.ok(tourFileValidAgainstSchema(root, ".tours/changes.tour"));
  } finally {
    rmrf(root);
  }
});

test("rejects an invalid reviewMode over stdio and preserves the previous tour", async () => {
  const { root, baseSha, head } = await setupCriticalRepo();
  try {
    await withServer(root, async (client) => {
      const first = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: head,
        steps: [{ description: "Original.", file: "feature.js" }],
      });
      assert.equal(first.isError, false, first.text);
      const before = readTourFile(root, ".tours/changes.tour");

      const response = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: head,
        reviewMode: "angry",
        steps: [{ description: "Should not land.", file: "feature.js" }],
      });
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "INVALID_PROPOSAL");
      assert.ok(issuePaths(response).includes("reviewMode"));
      assert.deepEqual(readTourFile(root, ".tours/changes.tour"), before);
    });
  } finally {
    rmrf(root);
  }
});

test("dryRun with reviewMode critical validates without writing", async () => {
  const { root, baseSha, head } = await setupCriticalRepo();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_changes_tour", {
        baseRef: baseSha,
        headRef: head,
        reviewMode: "critical",
        dryRun: true,
        steps: [{ description: "Rehearsed.", file: "feature.js" }],
      });
      assert.equal(response.isError, false, response.text);
      assert.equal(response.structured.status, "validated");
      assert.equal(response.structured.path, undefined);
    });
    assert.equal(
      fs.existsSync(`${root}/.tours/changes.tour`),
      false,
      "dryRun must not create the tour file"
    );
  } finally {
    rmrf(root);
  }
});

test("create_project_tour rejects reviewMode as an unknown field", async () => {
  const root = tempDir();
  try {
    writeFile(root, "hello.txt", "hello\n");
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_project_tour", {
        reviewMode: "critical",
        steps: [{ description: "Overview.", file: "hello.txt" }],
      });
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "INVALID_PROPOSAL");
      assert.ok(issuePaths(response).includes("reviewMode"));
    });
  } finally {
    rmrf(root);
  }
});

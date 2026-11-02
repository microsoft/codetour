import { test } from "node:test";
import * as assert from "node:assert/strict";
import {
  CodeTourStepSchema,
  loadTour,
  parseTourFile,
  TourFileSchema
} from "./tourSchema";

const validTour = JSON.stringify({
  title: "Getting around",
  steps: [
    { description: "Open the entry point", file: "src/main.ts", line: 1 },
    {
      description: "Compare the changes",
      file: "src/main.ts",
      baseFile: "src/old.ts",
      display: "diff"
    }
  ]
});

test("a tour file that matches the format parses", () => {
  const tour = parseTourFile(validTour);
  assert.equal(tour.title, "Getting around");
  assert.equal(tour.steps.length, 2);
  assert.equal(tour.steps[0].file, "src/main.ts");
  assert.equal(tour.steps[1].display, "diff");
});

test("loadTour assigns the host identity on top of the parsed file", () => {
  const tour = loadTour(validTour, "file:///main.tour");
  assert.equal(tour.id, "file:///main.tour");
  assert.equal(tour.steps[0].file, "src/main.ts");
});

test("a step without a description becomes empty rather than invalid", () => {
  const tour = parseTourFile('{"title":"T","steps":[{"file":"a.ts"}]}');
  assert.equal(tour.steps[0].description, "");
});

test("invalid tour files are rejected", () => {
  assert.equal(TourFileSchema.safeParse({ steps: [] }).success, false);
  assert.equal(TourFileSchema.safeParse({ title: "T" }).success, false);
  assert.equal(
    TourFileSchema.safeParse({ title: "T", steps: "no" }).success,
    false
  );
  // baseRef is a persisted merge-base SHA, not an arbitrary ref name.
  assert.equal(
    TourFileSchema.safeParse({ title: "T", baseRef: "main", steps: [] }).success,
    false
  );
  // A non-diff display value is a schema violation, not a rendering concern.
  assert.equal(
    CodeTourStepSchema.safeParse({ description: "d", display: "patch" }).success,
    false
  );
  assert.throws(() => parseTourFile("{not json"));
});

test("the rejection points at the offending field", () => {
  const result = TourFileSchema.safeParse({ title: "T" });
  assert.ok(!result.success);
  assert.ok(result.error.issues.some(issue => issue.path.includes("steps")));
});

test("questions must be at most four non-blank strings", () => {
  assert.equal(
    CodeTourStepSchema.safeParse({ description: "d", questions: ["a?", "b?"] }).success,
    true
  );
  assert.equal(
    CodeTourStepSchema.safeParse({ description: "d", questions: [] }).success,
    true
  );
  assert.equal(
    CodeTourStepSchema.safeParse({ description: "d", questions: ["a", "b", "c", "d", "e"] }).success,
    false
  );
  assert.equal(
    CodeTourStepSchema.safeParse({ description: "d", questions: ["  "] }).success,
    false
  );
});

test("a selection needs both endpoints fully positioned", () => {
  assert.equal(
    CodeTourStepSchema.safeParse({
      description: "d",
      selection: {
        start: { line: 1, character: 2 },
        end: { line: 3, character: 4 }
      }
    }).success,
    true
  );
  assert.equal(
    CodeTourStepSchema.safeParse({
      description: "d",
      selection: { start: { line: 1 } }
    }).success,
    false
  );
});

test("unknown fields survive parsing so a later save cannot lose them", () => {
  const tour = parseTourFile(
    '{"title":"T","version":2,"steps":[{"description":"d","$custom":"kept"}]}'
  );
  assert.equal(tour.version, 2);
  assert.equal(tour.steps[0].$custom, "kept");
});

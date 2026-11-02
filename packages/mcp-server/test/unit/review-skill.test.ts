import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import {
  CODETOUR_CRITICAL_REVIEW_ADAPTATION,
  CRITICAL_REVIEW_RESOURCE_URI,
  UPSTREAM_CODE_REVIEW_LICENSE,
  UPSTREAM_CODE_REVIEW_SKILL,
  UPSTREAM_CODE_REVIEW_SOURCE_REVISION,
  UPSTREAM_CODE_REVIEW_SOURCE_URL,
  criticalReviewSkillPack,
} from "../../src/review-skill";

// The Markdown sources under review-skill/ are the readable source of
// truth; the generated module must embed them verbatim so the skill pack is
// guaranteed present offline in every distribution.
const packageRoot = path.join(__dirname, "..", "..", "..");
const skillRoot = path.join(packageRoot, "review-skill");

function readSkillFile(name: string): string {
  return fs.readFileSync(path.join(skillRoot, name), "utf8");
}

test("the generated module embeds the Markdown skill sources verbatim", () => {
  assert.equal(
    UPSTREAM_CODE_REVIEW_SKILL,
    readSkillFile("upstream-code-review.md")
  );
  assert.equal(
    UPSTREAM_CODE_REVIEW_LICENSE,
    readSkillFile("upstream-LICENSE.txt")
  );
  assert.equal(
    CODETOUR_CRITICAL_REVIEW_ADAPTATION,
    readSkillFile("codetour-adaptation.md")
  );
});

test("the upstream skill text is preserved verbatim with its frontmatter", () => {
  assert.ok(
    UPSTREAM_CODE_REVIEW_SKILL.startsWith('---\nname: code-review\n'),
    "the upstream frontmatter must be intact"
  );
  // Distinctive lines from the upstream file, quoted to detect any
  // accidental edit of the vendored copy.
  for (const line of [
    "Both axes run as **parallel sub-agents** so they don't pollute each other's context, then this skill aggregates their findings. Start every sub-agent with a fresh context window.",
    "- **Mysterious Name**: a function, variable, or type whose name doesn't reveal what it does or holds. → rename it; if no honest name comes, the design's murky.",
    "Reporting them separately stops one axis from masking the other.",
  ]) {
    assert.ok(
      UPSTREAM_CODE_REVIEW_SKILL.includes(line),
      `the upstream text must contain: ${line.slice(0, 60)}...`
    );
  }
});

test("the upstream MIT license and attribution are recorded", () => {
  assert.ok(UPSTREAM_CODE_REVIEW_LICENSE.includes("MIT License"));
  assert.ok(UPSTREAM_CODE_REVIEW_LICENSE.includes("Copyright (c) 2026 Matt Pocock"));
  assert.match(UPSTREAM_CODE_REVIEW_SOURCE_REVISION, /^[0-9a-f]{40}$/);
  assert.equal(
    UPSTREAM_CODE_REVIEW_SOURCE_URL,
    "https://github.com/mattpocock/skills/blob/main/skills/engineering/code-review/SKILL.md"
  );
});

test("the CodeTour adaptation encodes the critical review contract", () => {
  const adaptation = CODETOUR_CRITICAL_REVIEW_ADAPTATION;
  // Labeling contract: Standards and Spec findings are labeled separately.
  assert.ok(adaptation.includes("`**Standards:**`"));
  assert.ok(adaptation.includes("`**Spec:**`"));
  // Without a spec: continue and declare, never ask or block.
  assert.ok(
    adaptation.includes("Spec axis not evaluated: no spec source was found.")
  );
  // Documented repo rules override the heuristic smell baseline.
  assert.ok(adaptation.includes("overrides the upstream smell baseline"));
  // Demonstrated violations and heuristic risks stay distinguished.
  assert.ok(adaptation.includes("demonstrated violation"));
  assert.ok(adaptation.includes("risk / code smell"));
  // Nothing already guaranteed by a tool is recycled as a finding.
  assert.ok(adaptation.includes("anything a tool already guarantees"));
  // Never invent anything; inferred tests are never executed tests.
  assert.ok(adaptation.includes("Never invent defects, requirements, specs, or test results."));
  assert.ok(adaptation.includes("never as executed"));
  // Sequential degradation is explicit and rule-preserving.
  assert.ok(adaptation.includes("sequentially"));
  assert.ok(adaptation.includes("never the rules of the review"));
  // The MCP server stays authoritative for Git and validation.
  assert.ok(adaptation.includes("the server wins"));
});

test("the assembled skill pack carries every required component", () => {
  const pack = criticalReviewSkillPack();
  assert.equal(CRITICAL_REVIEW_RESOURCE_URI, "codetour://review/critical-instructions");
  assert.ok(pack.includes(UPSTREAM_CODE_REVIEW_SKILL), "upstream verbatim");
  assert.ok(pack.includes(CODETOUR_CRITICAL_REVIEW_ADAPTATION), "CodeTour adaptation");
  assert.ok(pack.includes(UPSTREAM_CODE_REVIEW_LICENSE), "MIT license text");
  assert.ok(pack.includes(UPSTREAM_CODE_REVIEW_SOURCE_REVISION), "source revision");
  assert.ok(pack.includes(UPSTREAM_CODE_REVIEW_SOURCE_URL), "source URL");
  assert.ok(pack.includes("Matt Pocock"), "attribution");
});

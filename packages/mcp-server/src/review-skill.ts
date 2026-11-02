import {
  CODETOUR_CRITICAL_REVIEW_ADAPTATION,
  UPSTREAM_CODE_REVIEW_LICENSE,
  UPSTREAM_CODE_REVIEW_SKILL,
} from "./review-skill.generated";

// Critical review skill pack for Changes Tours.
//
// The skill texts live as generated strings (see review-skill.generated.ts,
// sourced from review-skill/*.md) so importing this module from server.ts
// guarantees the pack is present offline in every distribution: npm package,
// VSIX, and the standalone bundle. This module is the single code authority
// for the provenance constants and for assembling the resource content.

export { CODETOUR_CRITICAL_REVIEW_ADAPTATION, UPSTREAM_CODE_REVIEW_LICENSE, UPSTREAM_CODE_REVIEW_SKILL };

// URI of the MCP resource that serves the assembled skill pack.
export const CRITICAL_REVIEW_RESOURCE_URI =
  "codetour://review/critical-instructions";

// Provenance of the vendored upstream skill, recorded so the exact upstream
// revision stays verifiable without network access.
export const UPSTREAM_CODE_REVIEW_SOURCE_URL =
  "https://github.com/mattpocock/skills/blob/main/skills/engineering/code-review/SKILL.md";

// Commit SHA of the upstream file at the time it was vendored.
export const UPSTREAM_CODE_REVIEW_SOURCE_REVISION =
  "7739eaed7f8f3915437a8def198a6d0d7206dbc7";

// Assemble the full skill pack served by the MCP resource: attribution and
// provenance first, then the CodeTour adaptation (the instructions the
// generating agent must follow), then the upstream skill and its MIT
// license, both verbatim.
export function criticalReviewSkillPack(): string {
  return [
    "# CodeTour critical Changes Tour review instructions",
    "",
    "## Attribution and provenance",
    "",
    `- Upstream skill: \`code-review\` by Matt Pocock — ${UPSTREAM_CODE_REVIEW_SOURCE_URL}`,
    `- Source revision (commit SHA of the vendored upstream file): \`${UPSTREAM_CODE_REVIEW_SOURCE_REVISION}\``,
    "- Upstream license: MIT, Copyright (c) 2026 Matt Pocock — full text at the end of this resource.",
    "- The CodeTour adaptation below is distinct from the upstream text and governs how review findings are integrated into Changes Tours.",
    "",
    "## CodeTour adaptation — read before writing the tour steps",
    "",
    CODETOUR_CRITICAL_REVIEW_ADAPTATION,
    "",
    "## Upstream skill (verbatim)",
    "",
    UPSTREAM_CODE_REVIEW_SKILL,
    "",
    "## Upstream license (verbatim)",
    "",
    UPSTREAM_CODE_REVIEW_LICENSE,
    "",
  ].join("\n");
}

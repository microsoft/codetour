# CodeTour adaptation: critical Changes Tours

This document adapts the upstream `code-review` skill by Matt Pocock
(reproduced verbatim in the skill pack, MIT licensed) to CodeTour Changes
Tours. It is the authoritative instruction set for every
`create_changes_tour` call with `reviewMode: "critical"`. In neutral mode
(the default) this adaptation does not apply: produce the current factual
Changes Tour with no quality judgments.

## 1. Receive the mode before analyzing

The review mode is generation data decided before any analysis. Confirm the
mode (neutral or critical) before you inspect the diff; a mode already
stated unambiguously in the request is never asked again, and a cancelled
choice stops the tour instead of generating one silently. Read the whole
skill pack resource before writing any step: receiving the mode only in the
final tool call would be too late.

## 2. Analyze the same comparison the tour describes

Run both review axes on the exact comparison the Changes Tour will
describe: the diff from the merge-base of the base reference to the
analyzed head commit, plus explicitly included uncommitted changes when
requested. Never substitute another range. The MCP server's Git checks,
validation, snapshots, and anchor verification remain the sole authority:
when your analysis and the server disagree, the server wins.

## 3. Standards axis — always

- First search the repository for documented rules: `AGENTS.md`,
  `CONTRIBUTING.md`, `CONTEXT.md`, documents under `docs/`, and any other
  documented conventions (naming, structure, error handling...). A
  documented repo rule always overrides the upstream smell baseline: where
  a documented rule endorses what the baseline would flag, suppress the
  smell.
- Report each finding with the label `**Standards:**` and classify it as
  either:
  - a **demonstrated violation** — cite the documented rule (its file and
    the rule itself) and quote the code that breaks it; or
  - a **risk / code smell** — a heuristic judgement from the upstream smell
    baseline, always presented as such, never as a violation.
- Do not report as a new finding anything a tool already guarantees
  (compiler and type errors, formatter and linter output, the MCP server's
  own validation). Recycling guaranteed results adds noise, not review
  value.

## 4. Spec axis — only when a source is found

- Look for a source associated with the changes, in this order:
  1. an explicit user indication (a message, a path, or a ticket
     reference);
  2. issue or ticket references in the commit messages (`#123`,
     `Closes #45`, ...);
  3. a spec file under `docs/`, `specs/`, or `.scratch/` matching the
     branch or feature.
- Keep a verifiable reference to the source you used (path or ticket URL)
  and cite the exact requirement text for each finding.
- Report each finding with the label `**Spec:**`: requirements that are
  missing or partial; behavior that was not asked for (scope creep);
  requirements that look implemented but wrong.
- Never invent requirements: every Spec finding must quote its source. If
  the source is ambiguous, say so instead of guessing.
- If no source is found: do not ask the user for a spec and do not block.
  Continue with the Standards axis alone and state in the tour description
  exactly: `Spec axis not evaluated: no spec source was found.`

## 5. Integrating findings into the tour

- Every step keeps a factual explanation of the change — what it does, how
  it is implemented, and its observable effect. Review findings complement
  the explanation; they never replace it.
- Attach each finding inside the description of the step whose Tour Anchor
  locates the motivating code (for a Spec finding: the implementation of
  the requirement), with its `**Standards:**` or `**Spec:**` label and the
  quoted rule or requirement. Do not create an extra step for every
  suspicion: only established findings earn anchored coverage, and the
  tour remains one coherent review path.
- Keep the two axes separate and labeled; never merge or rerank findings
  across axes (see the upstream "Why two axes").
- Findings must anchor at lines that exist in the analyzed head commit so
  the server's anchor validation can verify them.

## 6. Honesty guarantees

- Never invent defects, requirements, specs, or test results.
- Tests you inferred from reading the change must be described as
  inferred, never as executed; report a test as passing or failing only if
  you observed the run.
- Distinguish observed behavior from intended behavior.
- If no defect is established at all, the tour remains a useful factual
  explanation: say so plainly instead of manufacturing criticism.

## 7. Sub-agents and sequential degradation

Prefer the upstream structure — the two axes as parallel sub-agents, each
with a fresh context — when the client supports sub-agents. When it does
not, run the same two analyses sequentially in your own context, keeping
the axes separate and labeled exactly as above. The degradation changes
only how the work is executed, never the rules of the review.

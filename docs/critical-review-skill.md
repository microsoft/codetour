# Critical review skill for Changes Tours

`create_changes_tour` accepts an optional `reviewMode` argument with exactly two values: `"neutral"` (the default, including when the argument is omitted) and `"critical"`. Neutral mode is the historical factual Changes Tour: explain the changes, judge nothing. Critical mode additionally integrates code-review findings into the tour, following a skill pack packaged with the MCP server core.

## Provenance and license

The critical mode is based on Matt Pocock's [`code-review` skill](https://github.com/mattpocock/skills/blob/main/skills/engineering/code-review/SKILL.md), vendored verbatim in this repository:

- Upstream file: `packages/mcp-server/review-skill/upstream-code-review.md` (blob SHA `83183e0ad36fd0eef25d37c7e483284b7e34c1f0`, byte-identical to upstream).
- Source revision (commit SHA of the upstream file when vendored): `7739eaed7f8f3915437a8def198a6d0d7206dbc7`.
- Upstream license: MIT, Copyright (c) 2026 Matt Pocock — verbatim copy in `packages/mcp-server/review-skill/upstream-LICENSE.txt`.
- The CodeTour adaptation is a distinct document (`packages/mcp-server/review-skill/codetour-adaptation.md`); it is not part of the upstream skill.

No network access or upstream plugin installation is needed for the critical mode. The Markdown files under `packages/mcp-server/review-skill/` are the readable source of truth; `scripts/embed-review-skill.js` regenerates `src/review-skill.generated.ts`, which embeds the texts as strings imported by `src/server.ts`. Because the strings travel with the compiled server code, the skill pack is guaranteed present offline in all three distributions: the `codetour-mcp` npm package (the `review-skill/` directory is also shipped for readability), the VS Code extension, and the standalone bundle. A unit test (`test/unit/review-skill.test.ts`) fails if the generated module ever diverges from the Markdown sources.

## How the skill pack reaches the agent

The server exposes the assembled pack — attribution, provenance, the CodeTour adaptation, the upstream skill verbatim, and the MIT license — as an MCP resource at `codetour://review/critical-instructions`, and the `create_changes_tour` tool guidance refers to it. An agent must read the resource **before writing any step**: receiving the mode only in the final tool call would be too late. The tool call carries `reviewMode: "critical"` as generation data; the mode is never persisted in the `.tour` file, and `create_project_tour` plus the `.tour` format are unchanged.

## What the adaptation requires

The adaptation keeps the upstream skill's two separate axes and adapts them to Changes Tours:

- **Standards (always):** documented repository rules are searched first and override the upstream heuristic smell baseline. Each finding is labeled `**Standards:**` and classified as a demonstrated violation (citing the documented rule and the code that breaks it) or as a risk / code smell (explicitly heuristic). Anything a tool already guarantees (compiler, formatter, linter, the MCP server's own validation) is not recycled as a finding.
- **Spec (only when a source is found):** the agent looks for an associated source — a user indication, issue references in commit messages, or a spec file under `docs/`, `specs/`, or `.scratch/` — keeps a verifiable reference, and quotes the exact requirement for each `**Spec:**` finding. If no source exists, the agent does not ask for a spec and does not block: the tour states `Spec axis not evaluated: no spec source was found.`
- **Integration:** every step keeps its factual explanation of the change; findings complement it at the step whose Tour Anchor locates the motivating code. No extra step is created for a suspicion; the two axes are never merged or reranked.
- **Honesty:** defects, requirements, specs, and test results are never invented; tests inferred from reading the change are never presented as executed; with no established defect the tour remains a useful factual explanation.
- **Git authority:** the review runs on the same merge-base comparison the tour describes; the MCP server's Git checks, validation, snapshots, and anchor verification always win.
- **Sub-agents:** the two axes preferably run as parallel sub-agents; a client without sub-agent support degrades to running them sequentially in one context — the execution changes, never the rules.

## Limits

- **Direct MCP clients without an adapter never see a mode question.** The server never asks a conversational question; it only validates `reviewMode`. A client that drives an interactive user (such as the Copilot CLI adapter) collects the neutral/critical choice before the analysis starts and passes the mode explicitly. A third-party client calling the tool directly gets the neutral default — a documented, deliberate behavior, not a failure.
- **The server cannot verify that the agent followed the skill pack.** It validates and persists whatever steps are proposed; the review quality is the generating agent's responsibility, enforced by the instructions the resource carries.
- **Sequential degradation is the agent's choice.** The pack describes when to prefer parallel sub-agents and how to degrade; the server does not orchestrate sub-agents itself.

# Copilot generation probe — 30 October 2026

Environment: macOS arm64, GitHub Copilot CLI **1.0.105** (build `845c2287`), its bundled extension SDK and Node v24.22.1. The fixture was `/private/tmp/codetour-copilot-probe`, with an actual Git repository, a one-line `app.js`, and this adapter copied into `.github/extensions/codetour/`. The CLI used its existing signed-in account; no credentials were changed.

The recorded interactive session is `0df242c6-cd9b-4312-9d95-9aa9b60feb5a`. The local source evidence is its `events.jsonl` in Copilot's session-state directory plus the CLI process log `process-1793352481016-60901.log`. The timeline below is a concise, sanitized transcription of those events; timestamps use UTC.

| Time | Observed event |
| --- | --- |
| 09:28:05.873 | Copilot installed one native extension; its UI reported the shared `codetour` MCP connected. |
| Before 09:28:17 | `/codetour` displayed Read/Generate, then Project Tour/Changes Tour; Generate → Project Tour was selected. No review-mode question appeared. |
| 09:28:17.481 | The host received the Project Tour generation prompt via `session.send`. |
| 09:28:22.160 | First analysis tool (`glob`), after the generation choices. |
| 09:29:42.075 | Shared `create_project_tour` validated the real agent's six-step proposal with `dryRun: true`. |
| 09:29:58.481 | The same tool created `.tours/project.tour`, six steps, no validation warnings. |
| Before 09:30:29 | `/codetour generate changes` displayed Neutral/Critical; Neutral was selected. |
| 09:30:29.864 | The agent began Git analysis after receiving `reviewMode: "neutral"`. |
| 09:30:59.776 | Shared `create_changes_tour` validated a factual two-step proposal. |
| 09:31:21.539 | Shared MCP created `.tours/changes.tour`, two steps, `master...HEAD`, no warnings. |
| 09:32:19.640 | `/codetour generate changes critical` skipped the already explicit mode choice. The host received a prompt containing the complete offline skill resource: upstream text, CodeTour adaptation, source revision and MIT license. |
| 09:32:33.923 | First critical analysis tool, after the complete instruction-bearing prompt. |
| 09:32:46.360 | Shared `create_changes_tour` received `reviewMode: "critical"`, factual explanation, an explicit unavailable Spec axis and a Standards conclusion without invented defects. |
| 09:33:08.074 | The shared MCP validated that critical proposal with two steps and no warnings. |
| 09:33:53.987 | The shared MCP created `.tours/changes.tour` with that critical content, two steps, no warnings. |

The changes fixture compared base `96d8ad56912cf2f4b77463414bbfc4719c402c3b` against head `cbab2ed57c3f3cb3e58ca3b5b72fe67932ac44d8`: `greet(name)` began trimming its argument before interpolation. No spec or standards documents existed in this fixture. The real critical generator continued without asking for a spec, retained the explanation, and stated that the Spec axis was not evaluated.

Copilot's own MCP approval dialogs were approved once per validation/write call in this temporary fixture. Those dialogs are host permissions, separate from the adapter's mode choices. No permissions were saved for future sessions.

An initial installed-host probe exposed that `process.execPath` can be the native Copilot executable, not Node. The adapter now uses Node from PATH for development `.js` entries and keeps the bundled runtime for standalone Windows launchers. A regression assertion covers that command contract. A separate prompt-mode probe established that `--trust-folder` alone does not load project extensions in this CLI version: prompt mode additionally requires `GITHUB_COPILOT_PROMPT_MODE_EXTENSIONS=true`, and initial `-p` text does not establish interactive slash-command dispatch. The successful evidence above uses interactive mode.

Automated validation: `npm run build` passed; `node --test test/copilot-adapter.test.mjs` passed **12/12**. These tests cover choices, cancellation at each choice, explicit mode, Project Tour exclusion of review mode, unavailable UI and unavailable shared skill, CLI playback and actual stdio retrieval of the full review resource before handoff. Critical generation with a discovered spec is covered by the common MCP and cross-surface tests; it has not been repeated with this real Copilot model. Windows requires a real-host run. This single successful macOS probe establishes compatibility with this installed version, not all experimental Copilot versions or deterministic model output.

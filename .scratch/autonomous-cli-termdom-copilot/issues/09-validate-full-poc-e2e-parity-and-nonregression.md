# 09: Validate complete POC parity and non-regression end to end

**What to build:** A maintainer can verify the complete CodeTour CLI and Copilot experience through public boundaries, including both Playback Surfaces, rich content, diffs, window lifecycle and supported packaged platforms, while existing CodeTour behavior remains intact.

**Blocked by:** 02 — Inspect Tour Anchors and reproducible Changes Tour diffs in HTML; 04 — Render rich Tour explanations and Mermaid in TermDOM; 05 — Review reproducible Changes Tour diffs in TermDOM; 07 — Launch independent CodeTour from Copilot CLI; 08 — Distribute CodeTour readers without admin rights or preinstalled Node.js.

**Status:** ready-for-agent

- [ ] One representative existing Project Tour and one reproducible Changes Tour run in HTML and TermDOM with equivalent Tour Steps, anchors, source context and Git snapshots (not pixel-for-pixel identical styling).
- [ ] Tests cover HTML/Mermaid, diff review, real terminal interaction, Copilot launch and closure, and offline reading. Standalone ACP questions and security refusals are deferred to a later phase; existing VS Code ACP security remains covered by regression tests.
- [ ] A reached unsupported TermDOM step immediately stops the entire Tour, reports an actionable diagnosis and yields a test-visible failure without skipping/fallback.
- [ ] The full automated CLI and existing VS Code/MCP regression suites pass without paid agent calls; a real Copilot smoke test covers the adapter.
- [ ] Actual Windows and macOS packaged artifacts pass the no-admin/no-preinstalled-runtime smoke tests.
- [ ] Tour generation, Tour files, Git comparison and existing VS Code playback have no behavioral regressions; opening, navigating or closing the new readers never modifies persisted Tour progress.
- [ ] Any unresolved rendering, Copilot API, or packaging limitation is recorded as a failed acceptance criterion rather than misreported as a successful POC.

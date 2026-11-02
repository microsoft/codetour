# 05: Review reproducible Changes Tour diffs in TermDOM

**What to build:** A reviewer reading a Changes Tour in the TermDOM Playback Surface can inspect actual code changes without opening an IDE. The presentation follows the existing CodeTour Git snapshot and diff source used by the HTML reader.

**Blocked by:** 02 — Inspect Tour Anchors and reproducible Changes Tour diffs in HTML; 03 — Play a Tour in an independent TermDOM terminal window.

**Status:** ready-for-agent

- [ ] The terminal reader presents file names, line context and distinguishable added, removed and unchanged lines from the existing authoritative Git comparison.
- [ ] Added and renamed files, and anchored/unanchored Tour Steps, retain the existing Git semantics and Tour Anchor resolution.
- [ ] Diff2Html is reused only where useful as a formatting stage; TermDOM is the selected terminal renderer and no new Git diff engine is introduced.
- [ ] The reviewer can scroll and navigate a representative multi-hunk Changes Tour diff without losing Tour Step context.
- [ ] A diff that cannot be rendered correctly triggers the documented whole-Tour stop and diagnostic; no silent fallback is allowed.
- [ ] An end-to-end test confirms the same base/head snapshots and diff substance in both Playback Surfaces, including when the worktree changes.

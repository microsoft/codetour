# 02: Inspect Tour Anchors and reproducible Changes Tour diffs in HTML

**What to build:** A user reading the standalone HTML Playback Surface can see the code associated with each Tour Anchor and review the exact changed lines of a Changes Tour. CodeTour keeps its existing Git selection, persisted snapshots and diff semantics; this adds presentation only, not an IDE.

**Blocked by:** 01 — Open an existing Project Tour from the standalone CLI.

**Status:** ready-for-agent

- [ ] File, line/range, pattern, directory, embedded-content and unanchored Tour Steps resolve according to existing CodeTour rules, without inventing a code target.
- [ ] The HTML reader shows relevant read-only code context and identifies the file and anchor; no edit, symbol index, or click-to-definition feature is added.
- [ ] Changes Tour diffs use the exact persisted base/head Git snapshots, including an added file and a rename; unrelated current working-tree edits cannot silently replace a snapshot.
- [ ] Diff2Html may format the authoritative Git diff, but never computes the comparison or changes existing Git behavior.
- [ ] Existing failure behavior for unavailable Git revisions/targets is preserved rather than manufacturing additions or hiding the step.
- [ ] End-to-end tests demonstrate a Project Tour anchor, a Changes Tour diff, a rename, and snapshot stability after a working-tree edit.

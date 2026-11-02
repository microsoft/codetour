# 06: Reuse ACP Tour Step Conversations in standalone readers

**What to build:** The standalone CodeTour reader offers the existing per-Tour-Step ACP conversation in HTML and TermDOM, with suggested questions, useful displayed-code context, and read-only safeguards. Tour reading remains available when no agent is installed.

**Blocked by:** 01 — Open an existing Project Tour from the standalone CLI; 03 — Play a Tour in an independent TermDOM terminal window.

**Status:** deferred to a later phase; not a blocker for the current delivery. The standalone functionality is not implemented. Existing VS Code ACP behavior remains unchanged.

- [ ] Both Playback Surfaces expose the existing Tour Step Conversation and suggested questions using the current ACP provider negotiation and Ask/read-only policy.
- [ ] The agent sees only the step's correctly resolved description and displayed code/diff context, including persisted Git snapshots where applicable.
- [ ] Existing refusal of forbidden write/delete/move/execute tools, session cancellation, per-step history separation and in-memory lifetime are preserved.
- [ ] With no available ACP provider, the Tour remains fully readable and navigable; only agent-backed features are unavailable with a clear explanation.
- [ ] The reader owns its ACP session independently of the launcher; no new server, socket, or HTTP control protocol is added.
- [ ] Deterministic end-to-end tests use a fake ACP child process to prove read-only behavior, cancellation, step grounding, and no-agent mode without paid AI calls.

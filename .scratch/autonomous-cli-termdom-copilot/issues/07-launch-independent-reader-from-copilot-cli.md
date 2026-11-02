# 07: Launch independent CodeTour from Copilot CLI

**What to build:** A Copilot CLI user invokes `/codetour` to select an existing Tour or specify a Tour and renderer flag. A thin Copilot adapter launches the autonomous CodeTour reader, which keeps working when Copilot CLI closes.

**Blocked by:** 01 — Open an existing Project Tour from the standalone CLI; 03 — Play a Tour in an independent TermDOM terminal window.

**Status:** ready-for-agent

- [ ] The supported Copilot CLI extension/command mechanism is verified against a real installed CLI before depending on argument forwarding.
- [ ] `/codetour` supports Tour selection and explicit `--renderer html|terminal`, delegating Tour discovery and playback to the standalone CLI.
- [ ] A terminal launch opens a second window without requiring the user to launch Zellij, tmux or an intermediate command; no Copilot-native sidebar or dynamic split is implemented.
- [ ] Closing Copilot CLI does not terminate the CodeTour window or its current Tour Step. Standalone ACP sessions are deferred to a later phase.
- [ ] The Copilot adapter contains no Tour creation, Git comparison, rendering or ACP business logic, allowing future thin adapters for other agents.
- [ ] A real Copilot CLI integration smoke test exercises invocation, flag forwarding and launcher shutdown. If the command API cannot satisfy the contract, record a concrete POC blocker rather than inventing a new protocol.

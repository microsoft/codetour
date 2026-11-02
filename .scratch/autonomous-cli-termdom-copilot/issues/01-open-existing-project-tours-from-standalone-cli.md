# 01: Open an existing Project Tour from the standalone CLI

**What to build:** From any directory inside a Git worktree, the user launches `codetour` and reads an existing Project Tour in an independent HTML Playback Surface, without VS Code or a connected agent. The CLI shares CodeTour's existing Tour discovery and reading behavior; any extraction from the VS Code host must preserve existing behavior.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] The CLI locates the enclosing Git worktree root from the current directory, including when launched from a nested directory, and uses existing Tour discovery rules.
- [ ] With multiple existing Tours, the reader can select one; passing a Tour name opens that Tour; unknown Tours produce a useful error.
- [ ] The default `--renderer html` Playback Surface shows Tour and Tour Step titles, descriptions, progress, and previous/next/end navigation, without opening VS Code.
- [ ] A non-Git directory, unknown renderer, or malformed invocation fails with a clear diagnostic and a nonzero exit code.
- [ ] Navigating and exiting never changes Tour creation, editing, discovery or persistence semantics, and never writes the active Tour Step into a Tour file.
- [ ] Automated end-to-end tests exercise the public CLI from a temporary Git worktree and compare preserved VS Code playback behavior.

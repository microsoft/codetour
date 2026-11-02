# 03: Play a Tour in an independent TermDOM terminal window

**What to build:** A user launches `codetour --renderer terminal` and reads an existing Tour interactively in a second terminal window that is independent of the launching process. The Terminal Playback Surface uses TermDOM alone; it consumes the same Tour and shared playback engine as HTML.

**Blocked by:** 01 — Open an existing Project Tour from the standalone CLI.

**Status:** ready-for-agent

- [ ] The terminal renderer uses TermDOM as its only terminal UI framework and opens an independent terminal window automatically; the user does not launch a multiplexer or a second command.
- [ ] The TUI displays a real Tour's selected Tour Step, progress and previous/next/finish controls with keyboard-driven navigation and scrolling.
- [ ] The same discovery, Tour selection and step state are used in both renderers; the terminal does not persist current progress into the Tour file.
- [ ] A missing or unsupported terminal host is diagnosed explicitly; no hidden reliance on Copilot CLI or VS Code is introduced.
- [ ] HTML remains the default, and the terminal renderer is selected only through the explicit flag.
- [ ] An automated pseudo-terminal test drives the real reader; platform-specific window-launch behavior is smoke-tested on Windows and macOS.

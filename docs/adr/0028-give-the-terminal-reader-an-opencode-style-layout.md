# Give the terminal reader an OpenCode-style layout

The terminal reader painted a filled header and footer around a single prose
column and a right-hand chat panel. It worked, but the reader could not see
where they were in the Tour: the Step count was a number in a bar, the other
Steps and their titles were invisible, and the conversation read as one more
transcript block with no identity for the questioner or the agent. The OpenCode
TUI solves the same problems for a long agent conversation, and its dark palette
was already shared with the HTML reader (ADR 0027).

The terminal reader now uses that layout:

- A wordmark bar (`▌ codetour │ <Tour title> … step n/N`) replaces the filled
  header.
- A Steps rail lists every Step with its number, marks the active Step with `▌`
  and a raised row, and disappears below 100 columns so the Step and its
  conversation keep readable widths (36 columns minimum for the panel). A Tour
  longer than the rail keeps the active Step visible and marks the Steps hidden
  above and below with `⋮`, so the marker is never off-screen.
- The Step body keeps its own scroller and opens with the anchor and a
  `▌ codetour` role line. Source and diff live in a titled panel whose head
  carries the target and its kind (`diff`, `code`, `n/a`).
- The conversation is a thread: `▌ you` in the info colour, `▌ <agent>` in the
  primary colour, tool calls as `⚙ …` muted rows, and a bordered composer that
  says when no agent is available and shows the keys that apply.
- The footer becomes a status line: a `READ` / `ASK` / `WAIT` chip, the keys
  that work in that state, and the selected provider with the Step's exchange
  count. `a ask` disappears when no agent is installed or an answer is in
  flight; the long key hints only appear once the line has room for them.

`ADR 0026` chose a right-hand panel at "about 45% of the columns". The panel
keeps that role but settles at 36–48 columns (37% of the width): the rail takes
26 columns on a wide screen, and a 50-column panel next to it would leave the
Step too narrow for both prose and code. Every width — rail threshold, panel,
Step text, code, title, rail label and composer — is computed in
`src/cli/terminalLayout.ts`, so the budgets can be tested without a
pseudo-terminal; a resize re-renders only when the column or row count changes.

Two consequences follow. The rail is a reading aid, not a navigator: `←/→`
still walk the Tour and no new jump key is invented, so a reader cannot land on
a Step they skipped. And the long key hints are gated on its own width rather
than the rail's, because a 100-column screen has room for the rail but not for
the spelled-out hints plus the provider segment.

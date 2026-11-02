# Adopt the OpenCode dark palette in the standalone readers

The standalone readers used a GitHub-flavoured dark theme: a navy canvas
(`#161b22`), a darker blue chat panel (`#111820`), and filled blue-grey bars
for the header and footer. On a terminal those filled surfaces do not read as
chrome, they read as a washed-out blue veil that fights the text, and because
the source context shared the same blue, the green and red of a Changes Tour
diff stopped standing out. The palette was chosen for a web page, not for a
cell buffer.

Both readers now share the OpenCode TUI dark palette (`src/cli/palette.ts`):

| role | colour |
| --- | --- |
| canvas | `#0a0a0a` |
| panel (chat, source) | `#141414` |
| element (prompt, code block) | `#1e1e1e` |
| border | `#2a2a2a`, strong `#3c3c3c` |
| text / muted / faint | `#eeeeee` / `#808080` / `#b5b5b5` |
| primary (step title, links) | `#fab283` |
| info (panel rule, source label) | `#5c9cf5` |
| accent (section headings) | `#9d7cd8` |
| warning (quotes) | `#e5c07b` |
| error | `#e06c75` |

A code diff is the one place where colour carries meaning, so it is not left
to a foreground-only difference: added and removed rows get the OpenCode diff
backgrounds (`#20303b` and `#37222c`) with `#b8db87` and `#e26a75` text, hunk
headers `#82aaff` on the element background, and context rows stay muted. In
the HTML reader each row is a block, so the tint covers the whole line instead
of only the glyphs. A terminal that downsamples 24-bit colour still shows the
two directions as different bands, and the rest of the page is neutral enough
that they are the only saturated colours on screen.

The HTML reader is styled from the same constants, so a Tour is recognisably
the same document in the terminal and in a browser: black canvas, peach title,
blue source label, monospaced muted anchors. The chat panel keeps a raised
`#141414` surface and a `#2a2a2a` rule rather than a coloured background: it
is a sidebar, not a highlight.

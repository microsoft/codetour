# Render the terminal reader on the alternate screen

TermDOM paints cells at absolute terminal coordinates and diffs each frame
against its own framebuffer. Started with `attach()` alone, it renders inline on
the primary screen and assumes the viewport starts at row 1. Anything the
process printed before the reader takes over — a Node.js deprecation warning
from a bundled dependency is enough — shifts the real screen by those rows while
the framebuffer still counts from row 1. Every later frame then paints only the
cells that changed in the framebuffer, so the shift never heals: stale rows from
the previous Tour Step survive, the header disappears, and characters are
dropped mid-word. Two or three warning lines are enough to corrupt the screen
from the first Tour Step onward.

The reader therefore calls `document.documentElement.requestFullscreen()` right
after `attach()`, which is TermDOM's alt-screen surface. The reader owns a known
viewport, prior output cannot offset it, the diff painting stays consistent
across Step navigation, and `dispose()` restores the reader's previous screen
and scrollback when the Tour ends. The call is best-effort: a transport without
fullscreen support falls back to inline rendering rather than failing the Tour.

Two consequences follow from owning the terminal until `dispose()`:

- A failure diagnostic must be written after the restore. `fatal()` awaits
  `dispose()` before printing to stderr; written earlier, the message would be
  erased together with the alternate screen and the reader would see an empty
  terminal and a nonzero exit.
- Each Step renders from the top by resetting the Step scroller, not by asking
  the document to scroll. With the fullscreen root pinned to the viewport, the
  document scroller still reports a `scrollY`, but the painted surface never
  moves: `j`/`k`/`PgDn` appeared to do nothing and everything past the first
  screenful of a long Step was unreachable. The reader therefore keeps the
  header and footer fixed and scrolls the Step in an absolutely positioned
  `.content` box with `overflow-y: auto`, whose `clientHeight` is exactly one
  screenful in the same units as its `scrollTop`. The chat panel owns its own
  scroller the same way.

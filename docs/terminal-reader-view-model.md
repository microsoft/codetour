# The terminal Tour reader view model

The terminal Tour reader is a reading module behind one interface: every
interaction — navigating to a Tour Step, asking a Tour Step Conversation
question, toggling the Step Narration voice, pressing one key, resizing the
terminal — yields a **view model**, a structured snapshot of the logical
reading state. The view model carries no DOM, no terminal cells and no
processes. A rendering adapter paints it: TermDOM today
(`src/cli/terminal.ts`), any other terminal surface tomorrow. This document is
the contract between the two sides, so a future host-adapter author can paint
the reader on another Playback Surface without re-deriving the reading
semantics (spec #93, story 15).

The module lives in `src/cli/reader/`:

- `reader.ts` — the reading state machine (`createReader`, the `TourReader`
  interface).
- `viewModel.ts` — the view-model types this document describes.
- `readerInput.ts` — the pure key translation the adapter reuses.
- `statusLine.ts` — the status line as pure data.
- `narrationPolicy.ts` — the Step Narration policy (ADR 0029).
- `conversation.ts` — the Tour Step Conversation orchestration (ADR 0026).
- `collaborators.ts` — the injected collaborators.

The visual contract is frozen by ADR 0025 (alternate screen, Step-box
scrolling), ADR 0026 (right-hand conversation panel), ADR 0027 (palette) and
ADR 0028 (layout); the narration policy by ADR 0029. The view model exposes
their behavior, not their pixels.

## The reading interface

`createReader(options)` returns a `TourReader`. The adapter calls it; the
reader never calls the adapter. An `onViewChange` callback is the reader's only
outbound signal — fired after every view-model change the adapter must paint.

- `open(): Promise<void>` — the initial render, or the empty-Tour
  presentation when the Tour has no Step.
- `navigateTo(step): ReaderViewModel` — move the navigation target. The
  target changes synchronously; the display commits when the (versioned)
  render lands.
- `pressKey(event): ReaderViewModel` — handle one key input, ask-mode capture
  included.
- `resize(columns, rows): ReaderViewModel` — a geometry change: re-render and
  restore the clamped scroll offset.
- `toggleVoice(): ReaderViewModel` — the unmodified-`v` voice toggle.
- `ask(question): Promise<void>` — ask the active Step's question; one answer
  is in flight at a time.
- `onExtentsMeasured(extents)` — the adapter's report of its measured
  scroller geometry, after each paint (see "Scroll and resize semantics").
- `close(): Promise<void>` — the session is over: ignore every further input
  and release the collaborators. `getState()` still works afterwards.
- `getState(): ReaderViewModel` — the current view model, cheap and pure.

Every method returns (or leaves current) the same logical view model; the
adapter repaints from `getState()` whenever `onViewChange` fires.

## Collaborators

The reader owns reading behavior only; everything environmental is injected
from the composition root (`runTerminalTour` in `src/cli/terminal.ts`):

- **Speech engine** (`SpeechEngine`): the Step Narration engine seam — the
  platform's system speech in production. The reader keeps only the policy.
- **Conversation responder** (`ConversationResponder`): the agent answering
  Tour Step Conversation questions, adapted from the Step Chat support
  seams. Absent by design: the reader stays fully usable without an agent.
- **Description renderer** (`DescriptionRenderer`): renders one Step's
  description to sanitized terminal HTML at a given text width. Async — the
  await that makes renders versioned.
- **Step context resolver** and **commit file reader**: the code, diff and
  grounding context of a Step.

## View-model fields

`ReaderViewModel` (in `viewModel.ts`, the authoritative type) groups into:

**Reading state**

- `currentStep` — the navigation target, synchronous, changes at the
  keypress. `displayedStep` — the Step a committed render actually displays;
  `-1` until the first render lands. `rendering` — a render is still in
  flight for the target. `finished` — `close()` ran; every further input is
  ignored.

**Painted Step content** (the content of the last committed render; a failed
or superseded render changes nothing here)

- `tourTitle` — untruncated; the adapter fits it to `layout.titleWidth`.
- `stepCount` — `"step n/N"`, or `"step 0/0"` for a Tour without steps.
- `emptyMessage` — set only on the empty paths; painted instead of a Step.
- `anchorText` — the full untruncated anchor: the Step's target plus its
  `" · diff"` suffix. The adapter tails a long path.
- `stepTitle` — the Step's title or its `"Step n"` fallback.
- `descriptionHtml` — the sanitized, terminal-rendered description HTML.

**Rail** (`rail`, `railVisible`) — the window of Steps around the displayed
Step, each item with its index, untruncated title and active flag, plus
`before`/`after` markers for the rows hidden outside the window (one `⋮` row
each in the adapter). `railVisible` is false below the 100-column threshold;
the rail is a position indicator, never a navigator (ADR 0028).

**Source section** (`source`, undefined for `"none"`/`"directory"` contexts)
— `kind` (`"code"` | `"diff"` | `"unavailable"`), the head `label` with its
base/head parenthetical already stripped, the `tag` (`"n/a"` when
unavailable), and the raw unwrapped `lines`. Wrapping and diff row coloring
are painting.

**Tour Step Conversation** (`conversation`) — the panel title, its `meta`
(`"no agent"`, `"ready"` or `"n exchanges"`), `hasResponder`, the agent's
`providerName` (the adapter lowercases it for the role line), the active
Step's `suggestions` in order (keys 1-9 ask them), the Step's `exchanges`
(`ChatExchange`: question, streamed answer, pending/error flags, tool lines),
and `responding` while an answer streams.

**Composer** (`composer`) — `mode` (`"idle"`, `"asking"`, `"responding"`,
`"unavailable"` without an agent), the full `draft`, the exact `hint` line,
and the `prompt` content before fitting (the draft plus its `▌` caret, or the
idle notices). The adapter tails the draft so the caret stays visible.

**Status line** (`status`) — see the next section.

**Step Narration** (`narration`) — `enabled`, `speaking`, `warning`, the
index of the Step the voice last spoke (`lastNarratedStep`, `-1` when none),
and `pendingNarration`: a navigation wants narration and it defers until its
Step is the displayed one. The voice is off by default; a single unmodified
`v` toggles it; the previous speech is cut at the navigation keypress;
narration commits only for the Step a render actually displays — a re-render
or a failed render never speaks; an engine failure surfaces as the
nonblocking `warning` and clears on the next handed utterance (ADR 0029).

**Scroll** (`scroll`) — see "Scroll and resize semantics".

**Layout and rows** — `layout`, the pure cell budget from
`src/cli/terminalLayout.ts` (columns, rail/chat/text/code/title widths,
`compactHints`), and `rows`, the terminal height. One geometry input for the
adapter's truncation decisions; the view model never carries terminal cells.

**Fatal** (`fatal`) — the render error that ended the session, when one
occurred. The adapter restores the screen, repaints the previous view model,
then prints the diagnostic after the restore (ADR 0025).

## Status line segments and precedence

`status.mode` is `"ASK"` while the ask prompt owns the keyboard, `"WAIT"`
while an answer streams, `"READ"` otherwise; ask mode wins the chip.
`status.hints` is the exact key-hint string — ask mode replaces it with
`" enter send · esc cancel"` — with the compact variant below 120 columns.

`status.rightSegments` is ordered by fixed precedence; index 0 always
survives truncation:

1. `VOICE ON` / `VOICE OFF` — always present.
2. The narration `warning` (`"Narration failed: …"`), while one is current.
3. The agent's provider name, lowercased, when an agent is installed.
4. The exchange count (`"n exchanges"`), when nonzero.

The adapter joins the segments with `" · "` and fits them into the budget
`max(30, columns - (compactHints ? 48 : 72))`, cutting from the right. The
reader emits the segments; only the join and cut are painting.

## Key inputs

The adapter maps its key events to `ReaderKeyEvent` (`key`, `ctrl`, `meta`,
`alt`) and calls `pressKey`. The same pure `translateKey` function tells the
adapter whether a key was consumed at all: an `"unhandled"` action must be
passed through to the host untouched.

In ask mode the prompt owns the keyboard: every printable key appends to the
draft, `Enter` submits the trimmed question, `Escape` cancels, `Backspace`
deletes. In reading mode:

- `←`/`p` previous Step, `→`/`n` next Step (clamped at the boundaries);
- `v` or `V` toggles the voice — only unmodified: Ctrl+V, Cmd+V and Alt+V
  are not the narration shortcut;
- `j`/`↓` scroll one row down, `k`/`↑` one row up, `PgDn`/Space one screenful
  down, `PgUp` one screenful up;
- `a` enters ask mode when an agent is installed and no answer streams;
- digits `1`-`9` ask the matching suggested question of the active Step,
  ignored while an answer streams;
- `q` (or `Escape`) quits.

## Scroll and resize semantics

The reader owns the scroll state; the adapter applies the offsets and
measures the geometry. `scroll` carries the Step-box position
(`stepScrollTop`), its viewport and content heights
(`stepViewportRows`/`stepContentRows`), the conversation panel's position
and extents (`chatScrollTop`/`chatViewportRows`/`chatContentRows`), and
`chatPinned` — true for the whole session: the panel pins to its bottom after
every chat paint and streaming delta.

The protocol, per paint:

1. The adapter paints the view model.
2. It reports the measured geometry through `onExtentsMeasured` — the
   Step-box `stepViewportRows`/`stepContentRows` are required; the panel's
   `chatViewportRows`/`chatContentRows` are optional and, when absent,
   leave the panel's scroll state untouched.
3. The reader clamps its offsets against the fresh extents (a pinned panel
   sits at its bottom; a shrunk Step box clamps its offset inside it) and
   the adapter applies the offsets from the returned view model.

Scroll keys move `stepScrollTop` by one row or one screenful, clamped to
`[0, stepContentRows - stepViewportRows]`. Every committed Step render
paints from the top again — except a resize render, which restores the
offset the resize saved, clamped against the new extents. A resize to the
same geometry repaints nothing. The adapter debounces its resize events
(100 ms in TermDOM) and calls `resize` with the new geometry.

An adapter that cannot measure rows in the reader's units should report its
own units consistently; the offsets are unit-agnostic, only the clamp and
the page arithmetic consume them.

## What stays a painting decision

Truncation (`fit`/`tail`), line wrapping, diff row coloring, the `▌` caret,
the rail `⋮` markers, the `… answering` pending placeholder, all CSS and
DOM construction, and the alternate-screen takeover and restore. The view
model deliberately excludes: terminal cell grids, DOM nodes, process
handles, internal version counters, and truncated strings — the adapter
truncates using the budgets in `layout`.

## Testing against the contract

The reader's tests (`src/cli/reader/reader.test.ts`,
`src/cli/reader/readerNarration.test.ts`) drive this interface in-process —
fakes at the collaborator seams, assertions on the view model — with no
PTY, no VT decoder and no terminal. An adapter stays thin and paint-only;
its correctness is a manual read on a real terminal. A regression in the
reader reports a view-model diff, readable from the failure message alone.

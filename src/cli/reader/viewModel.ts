import type { StepConversationExchange } from "../../agent/stepConversations";
import type { TerminalLayout } from "../terminalLayout";

/**
 * The logical reading state of the terminal Tour reader at one instant
 * (spec #93): structured data a rendering adapter paints, with no DOM, no
 * terminal cells and no processes. Truncation (`fit`/`tail`) and line
 * wrapping stay out of the view model: they are painting decisions the
 * adapter applies through the pure layout module.
 */

/** One Step of the rail window; the active Step carries the `▌` bar. */
export interface ReaderRailItem {
  index: number;
  /** The Step title, or its "Step n" fallback — untruncated; the adapter fits it. */
  title: string;
  active: boolean;
}

/**
 * The Tour Step Conversation state the reader's decisions share: whether the
 * ask prompt owns the keyboard, an answer is streaming, and an agent is
 * installed to answer at all. Key dispatch, the status line and the composer
 * all consume the same triple, so it travels as one unit (spec #93).
 */
export interface ConversationState {
  /** The ask prompt owns the keyboard. */
  asking: boolean;
  /** True while the displayed Step's answer is streaming (ADR 0031). */
  responding: boolean;
  /** True when an agent is installed to answer questions. */
  hasResponder: boolean;
}

/**
 * The Step's anchor, carried structured: the target the adapter paints and
 * the diff flag whose " · diff" suffix the adapter derives when painting
 * (ADR 0025). The view model never carries painted anchor text.
 */
export interface ReaderAnchor {
  /** The untruncated target: the Step's file, URI, directory or view, its line included. */
  target: string;
  /** True for a diff Step: the adapter paints the " · diff" suffix. */
  diff: boolean;
}

/**
 * The reading position of the wordmark bar's Step counter: the numbers the
 * adapter formats into "step n/N" — or "step 0/0" for a Tour without
 * steps. The view model carries no preformatted display string (spec #93).
 */
export interface ReaderStepCount {
  /** The displayed Step's index, 0-based; 0 for a Tour without steps. */
  index: number;
  /** The Tour's total number of Steps. */
  count: number;
}

/** The slice of the rail that keeps the active Step visible (ADR 0028). */
export interface ReaderRailWindow {
  items: ReaderRailItem[];
  /** Rows hidden above the window; the adapter paints one `⋮` marker for them. */
  before: boolean;
  /** Rows hidden below the window. */
  after: boolean;
}

/** The source or diff panel below the description. */
export interface ReaderSourceSection {
  kind: "code" | "diff" | "unavailable";
  /** Head label with the base/head parenthetical already stripped; untruncated. */
  label: string;
  /** "n/a" when the target is unavailable, else the context kind. */
  tag: string;
  /** Raw logical content lines, unwrapped; the adapter wraps and classes diff rows. */
  lines: string[];
}

/** The composer under the Tour Step Conversation panel. */
export interface ReaderComposer {
  mode: "idle" | "asking" | "responding" | "unavailable";
  /** The full question draft; the adapter tails it and paints the caret. */
  draft: string;
  /** The exact hint line under the prompt. */
  hint: string;
  /**
   * The prompt notices before the adapter's fit: the idle, responding and
   * unavailable texts. Empty while asking — the adapter paints the draft
   * with its `▌` caret, a truncation the view model never carries.
   */
  prompt: string;
}

/** The right-hand Tour Step Conversation panel (ADR 0026). */
export interface ReaderConversation {
  title: string;
  /**
   * A display fragment, deliberately: one of "no agent" | "ready" |
   * "n exchanges", formatted exactly as the panel head paints it.
   * Unlike `stepCount` the label is a one-word status the paint layer
   * sets verbatim, so restructuring it would churn the paint
   * disproportionately — a conscious trade documented here (spec #93).
   */
  meta: string;
  hasResponder: boolean;
  /** The agent's provider name, for the role line; the adapter lowercases it. */
  providerName: string | undefined;
  /** Suggested questions of the active Step, in order; keys 1-9 ask them. */
  suggestions: string[];
  /** The raw, unpainted exchanges of the displayed Step, from the shared
   * store (ADR 0031); the adapter paints tool uses, activity and states. */
  exchanges: readonly StepConversationExchange[];
  /** True while the displayed Step's answer is streaming: new asks on it are
   * blocked and `q`/Escape interrupt it (ADR 0031). */
  responding: boolean;
}

/** The status line: mode and key hints on the left, fixed-precedence segments right. */
export interface ReaderStatusLine {
  mode: "READ" | "ASK" | "WAIT";
  /** The exact hint string; asking mode owns the keyboard and the hints row. */
  hints: string;
  /** Ordered; index 0 survives truncation. Empty never happens: the voice state is always first. */
  rightSegments: string[];
}

/** The Step Narration state (ADR 0029). */
export interface ReaderNarrationState {
  enabled: boolean;
  /** A narration was handed to the engine and has not been interrupted or warned since. */
  speaking: boolean;
  /** The latest nonblocking narration failure; shown until speech recovers. */
  warning: string | undefined;
  /** Index of the Step the voice last spoke; -1 when none. */
  lastNarratedStep: number;
  /** A navigation wants narration; it defers until its Step is the displayed one. */
  pendingNarration: boolean;
}

/** The scroll state of the reader's scrollers (ADR 0025). */
export interface ReaderScrollState {
  /** Step-box scroll position, in the units the adapter measures and reports. */
  stepScrollTop: number;
  /** One screenful in the same units. */
  stepViewportRows: number;
  /** Total scrollable height of the Step box, reported by the adapter after each paint. */
  stepContentRows: number;
  /** The conversation panel's scroll offset, owned by the module (spec #93). */
  conversationScrollTop: number;
  /** The conversation panel's visible rows, as the adapter measured them. */
  conversationViewportRows: number;
  /** The conversation panel's total height, reported by the adapter after each paint. */
  conversationContentRows: number;
}

/** The scroller extents the adapter measures after painting a view model. */
export interface ReaderExtents {
  stepViewportRows: number;
  stepContentRows: number;
  /**
   * The conversation panel's measured extents. Optional: a report about the
   * Step box alone leaves the panel's scroll state untouched.
   */
  conversationViewportRows?: number;
  conversationContentRows?: number;
}

/**
 * A render error that ended the session; the adapter prints it after
 * restoring the screen (ADR 0025). The boundary is DOM-free, so the error
 * object itself cannot cross it: the view model carries the typed error's
 * identity as its class `name` next to the verbatim `message`, a conscious
 * contract (spec #93) — an adapter branches or logs on the kind without
 * ever holding the error.
 */
export interface ReaderFatal {
  message: string;
  /** The thrown error's class name; "Error" for a non-Error thrown value. */
  name: string;
}

/** Everything a rendering adapter needs to paint one instant of a reading session. */
export interface ReaderViewModel {
  /** The navigation target — synchronous, it changes at the keypress. */
  currentStep: number;
  /** The Step actually displayed by a committed render; -1 until the first render lands. */
  displayedStep: number;
  /** True while a render is still in flight for the navigation target. */
  rendering: boolean;
  /** The session is over: close ran, every further input is ignored. */
  finished: boolean;

  /** The Tour title, untruncated; the adapter fits it to the wordmark bar. */
  tourTitle: string;
  /** The displayed Step's index and the Tour's Step count; the adapter formats the counter. */
  stepCount: ReaderStepCount;
  /** The article text of the empty paths, painted instead of a Step. */
  emptyMessage: string | undefined;
  /** The Step's anchor, structured; the adapter derives its painted suffix. */
  anchor: ReaderAnchor;
  /** The Step title or its "Step n" fallback. */
  stepTitle: string;
  /** The sanitized description HTML the pure content module produced. */
  descriptionHtml: string;

  /** The rail window around the displayed Step; empty until one is displayed. */
  rail: ReaderRailWindow;
  /** False below the width where the rail would eat more than it explains. */
  railVisible: boolean;

  /** The source/diff section; undefined for "none" and "directory" contexts. */
  source: ReaderSourceSection | undefined;

  conversation: ReaderConversation;
  composer: ReaderComposer;
  status: ReaderStatusLine;
  narration: ReaderNarrationState;
  scroll: ReaderScrollState;

  /** The layout snapshot the adapter paints with; pure data, no cells. */
  layout: TerminalLayout;
  rows: number;

  /** The render error that aborted the session, when one occurred. */
  fatal: ReaderFatal | undefined;
}

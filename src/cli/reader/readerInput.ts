import type { ConversationState } from "./viewModel";

/**
 * The keyboard of the reader, translated once into logical actions the
 * state machine applies (spec #93). Pure: the reader assembles the facts a
 * key depends on and runs {@link translateKey} through its single dispatch
 * — the same call that answers the adapter's `wouldConsume` query
 * (`"unhandled"` means: pass it through to the terminal untouched, no
 * preventDefault). The reader applies the returned action to its own state.
 */

/** One key input, the logical shape of the adapter's keyboard event. */
export interface ReaderKeyEvent {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  alt?: boolean;
}

/** The reading facts a key dispatch depends on. */
export interface ReaderKeyState {
  /** The conversation state the dispatch depends on (spec #93). */
  conversation: ConversationState;
  /** Suggested questions of the active Step, in order; keys 1-9 ask them. */
  suggestions: string[];
  currentStep: number;
  stepCount: number;
  /** One screenful of the Step box, for the paging keys. */
  pageRows: number;
}

export type ReaderKeyAction =
  | { type: "unhandled" }
  | { type: "quit" }
  | { type: "stop-answer" }
  | { type: "enter-ask-mode" }
  | { type: "ask-suggestion"; question: string }
  | { type: "navigate"; step: number }
  | { type: "toggle-voice" }
  | { type: "scroll"; delta: number }
  | { type: "draft-append"; text: string }
  | { type: "draft-backspace" }
  | { type: "submit-draft" }
  | { type: "cancel-draft" };

/**
 * Dispatch one key exactly as the reader always has: the ask-mode prompt
 * owns the keyboard first, then the reading-mode keys in their fixed order.
 */
export function translateKey(state: ReaderKeyState, event: ReaderKeyEvent): ReaderKeyAction {
  const { asking, responding, hasResponder } = state.conversation;
  if (asking) {
    if (event.key === "Enter") return { type: "submit-draft" };
    if (event.key === "Escape") return { type: "cancel-draft" };
    if (event.key === "Backspace") return { type: "draft-backspace" };
    if (event.key.length === 1) return { type: "draft-append", text: event.key };
    return { type: "unhandled" };
  }
  // While an answer streams, the reading must survive: `q` and Escape
  // interrupt the Step's answer in flight instead of quitting the reader,
  // and a second press quits once nothing is in flight (ADR 0031).
  if (event.key === "q" || event.key === "Escape") {
    return responding ? { type: "stop-answer" } : { type: "quit" };
  }
  if (event.key === "a" && hasResponder && !responding) {
    return { type: "enter-ask-mode" };
  }
  if (/^[1-9]$/.test(event.key)) {
    const question = state.suggestions[Number(event.key) - 1];
    // A digit without its suggestion, or while an answer streams, falls
    // through unhandled — the terminal sees the key.
    if (question !== undefined && !responding) {
      return { type: "ask-suggestion", question };
    }
    return { type: "unhandled" };
  }
  if ((event.key === "ArrowRight" || event.key === "n") &&
    state.currentStep < state.stepCount - 1) {
    return { type: "navigate", step: state.currentStep + 1 };
  }
  if ((event.key === "ArrowLeft" || event.key === "p") && state.currentStep > 0) {
    return { type: "navigate", step: state.currentStep - 1 };
  }
  if (event.key === "v" || event.key === "V") {
    // A single unmodified V toggles the voice: Ctrl+V, Cmd+V and Alt+V are
    // not the narration shortcut (spec #79). A "v" typed in the ask prompt
    // never reaches this branch — it stayed draft text.
    if (event.ctrl || event.meta || event.alt) return { type: "unhandled" };
    return { type: "toggle-voice" };
  }
  if (event.key === "j" || event.key === "ArrowDown") return { type: "scroll", delta: 1 };
  if (event.key === "k" || event.key === "ArrowUp") return { type: "scroll", delta: -1 };
  if (event.key === "PageDown" || event.key === " ") {
    return { type: "scroll", delta: state.pageRows };
  }
  if (event.key === "PageUp") return { type: "scroll", delta: -state.pageRows };
  return { type: "unhandled" };
}

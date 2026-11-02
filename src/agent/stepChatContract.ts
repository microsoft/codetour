/**
 * The Tour Step Conversation contract shared by every reading surface.
 *
 * The extension chat and the standalone terminal reader both ask the same
 * responder for an answer to a question about the displayed Step. Keeping the
 * types and the failure class here — free of `vscode` — lets the CLI reuse the
 * ACP responder without bundling the extension API.
 */

/** One side of a displayed diff comparison, identified as such. */
export interface StepChatDiffSide {
  // The tour's declared path for this side's file.
  path: string;
  // The Git commit whose snapshot this side displays.
  ref: string;
  // The side's displayed content.
  code: string;
}

/** The step context captured for a question, faithful to the display. */
export type StepChatContext =
  | {
      available: true;
      // The tour's declared path for the step target, when it has one.
      path?: string;
      // The code the reader actually sees for the step target.
      code: string;
      description: string;
    }
  | {
      available: true;
      // The tour's declared path label of the compared files.
      path: string;
      // A diff step displays two sides: both are transmitted, each
      // identified with its own path and Git commit.
      diff: { original: StepChatDiffSide; modified: StepChatDiffSide };
      description: string;
    }
  | {
      // The step target is not currently displayed: it is reported as
      // such and never silently replaced by another file.
      available: false;
      path?: string;
      description: string;
    };

/** One question of a step conversation, with the raw answer of the responder. */
export interface StepChatHistoryEntry {
  question: string;
  answer: string;
}

/** A tool the agent executed while answering, as the chat displays it. */
export interface StepChatToolUse {
  toolCallId: string;
  // The tool kind, as the agent declared it (read, edit, execute, ...).
  kind?: string;
  // The call's latest status (pending, in_progress, completed, failed).
  status?: string;
  // The agent's own title for the call, in the agent's language.
  title?: string;
  // True when the kind is forbidden in a Tour Step Conversation: the
  // chat reports the call to the reader instead of hiding it.
  forbidden: boolean;
}

/**
 * The conversation's agent could not be launched or its connection broke;
 * the reader may retry with a new question, which relaunches the agent.
 */
export class StepChatAgentUnavailableError extends Error {}

/** Streaming callbacks for one step question's answer. */
export interface StepChatAnswerEvents {
  /**
   * Called for each answer chunk as it arrives from the responder; the
   * chat displays it immediately, before the answer is complete.
   */
  onAnswerDelta?(delta: string): void;
  onThoughtDelta?(delta: string): void;
  onActivity?(message: string): void;
  /**
   * Called each time the agent starts or updates a tool call: the chat
   * reports the forbidden ones to the reader as they happen, and keeps
   * them visible after the answer completes or is stopped.
   */
  onToolUse?(tool: StepChatToolUse): void;
}

/** What the responder receives for a question. */
export interface StepChatRequest {
  question: string;
  context: StepChatContext;
  history: StepChatHistoryEntry[];
  /** The workspace root the tour lives in; the agent session's cwd. */
  workspaceRoot: string;
}

/**
 * The responder answering step questions: the ACP session layer over the
 * installed agent entry in production, injected by the deterministic tests
 * at the same seam.
 */
export interface StepChatResponder {
  answer(
    request: StepChatRequest,
    events?: StepChatAnswerEvents
  ): Promise<string> | string;
  /**
   * Interrupts the in-flight answer, if any. The late completion of a
   * cancelled answer is ignored by the chat.
   */
  cancel?(): void;
  /**
   * Releases the responder's agent resources; called when the reading
   * webview closes or the responder is replaced.
   */
  dispose?(): Promise<void> | void;
}

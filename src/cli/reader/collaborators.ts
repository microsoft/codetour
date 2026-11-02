import type { StepChatAnswerEvents, StepChatRequest } from "../../agent/stepChatContract";
import type { CodeTour, CodeTourStep } from "../../store";
import type { ReadonlyStepContext } from "../stepContext";

/**
 * The collaborators the reading module depends on, injected from the
 * composition root (spec #93). The reader only ever sees these interfaces —
 * never a process, a DOM or a terminal — so its tests replace each one with
 * a fake at the module boundary and stay in-process.
 */

/**
 * The agent answering Tour Step Conversation questions (ADR 0026, ADR 0031):
 * the ACP failover session layer in production — `openTerminalChat`'s
 * responder over every installed candidate (ADR 0014) — adapted from the
 * Step chat support module by the composition root. The reader only sees
 * this port; the conversation lifecycle lives in the shared
 * `StepConversations` store above the seam. No agent process is started
 * until the first question.
 */
export interface ConversationResponder {
  /** Lowercase provider name for the status line and the agent role line. */
  readonly providerName: string | undefined;
  answer(request: StepChatRequest, events?: StepChatAnswerEvents): Promise<string> | string;
  /**
   * Interrupts the in-flight answer, if any; the store's stop calls it and
   * the cancelled answer's late completion is ignored (ADR 0031).
   */
  cancel?(): void;
  /** Release the responder's agent resources; the session is over. */
  dispose?(): Promise<void> | void;
}

/**
 * Renders one Step's description to sanitized HTML. Async by nature
 * (diagram rasterization, image reading) — the await that makes the render
 * pipeline versioned. Injected so tests control latency and failures.
 */
export type DescriptionRenderer = (
  tour: CodeTour,
  index: number,
  /** The text width the description may occupy, diagram art included. */
  width: number
) => Promise<string>;

/**
 * Resolves the readonly context of one Step: the code, the diff or the
 * diagnostic the reader displays. Injected so tests never run Git.
 */
export type StepContextResolver = (
  root: string,
  tour: CodeTour,
  step: CodeTourStep
) => ReadonlyStepContext;

/** Reads one file as it exists at a commit, for grounding diff questions. */
export type CommitFileReader = (ref: string, file: string) => string | undefined;

import type { CodeTour } from "../../store";
import {
  StepConversations,
  type StepConversationExchange,
  type StepConversationView
} from "../../agent/stepConversations";
import { buildStepChatContext } from "../stepChatSupport";
import type { CommitFileReader, ConversationResponder, StepContextResolver } from "./collaborators";

export interface TourStepConversationOptions {
  tour: CodeTour;
  root: string;
  responder: ConversationResponder | undefined;
  resolveStepContext: StepContextResolver;
  readCommitFile: CommitFileReader;
  /** Notified after every exchange update, so the adapter repaints the panel. */
  onChange?: () => void;
}

/**
 * The Tour Step Conversation of the reader (ADR 0026, ADR 0031): a thin
 * reading-module face over the shared StepConversations store, keyed by Step.
 * The lifecycle — one answer in flight per Step, streaming, interruption that
 * ignores a late completion, history rules, failures that never disturb the
 * reading — lives in the store above the responder seam, exactly as in the
 * extension's chat; this class only supplies the reader's grounding (the
 * displayed Step's context, built once at question time) and notifies the
 * adapter on every update.
 */
export class TourStepConversation {
  private readonly exchanges: StepConversations;

  constructor(private readonly options: TourStepConversationOptions) {
    this.exchanges = new StepConversations(options.responder);
  }

  get hasResponder(): boolean {
    return this.options.responder !== undefined;
  }

  /** The agent's lowercase provider name, for the status line and the role line. */
  get providerName(): string | undefined {
    return this.options.responder?.providerName;
  }

  /** The Step's conversation, straight from the shared store. */
  private view(step: number): StepConversationView {
    return this.exchanges.view(String(step));
  }

  /** True while the Step's latest question is still being answered. */
  isResponding(step: number): boolean {
    return this.view(step).responding;
  }

  exchangesFor(step: number): readonly StepConversationExchange[] {
    return this.view(step).exchanges;
  }

  /**
   * Ask one Step's question. The store owns the lifecycle: the question is
   * blocked while the Step's previous answer is still in progress, the answer
   * streams into the pending exchange, and an interruption or a failure
   * settles it without disturbing the reading. Nothing happens for a missing
   * Step.
   */
  async ask(step: number, question: string): Promise<void> {
    const { tour, root, resolveStepContext, readCommitFile } = this.options;
    const notify = this.options.onChange;
    const stepData = tour.steps[step];
    if (!stepData) return;
    await this.exchanges.ask(
      String(step),
      question,
      {
        // The grounding context is built once, at question time, from the
        // Step the reader sees; the store awaits it, so a stop during the
        // capture is honored.
        context: () => buildStepChatContext(
          tour,
          stepData,
          resolveStepContext(root, tour, stepData),
          readCommitFile
        ),
        workspaceRoot: root
      },
      notify
    );
  }

  /**
   * Interrupts the Step's answer in flight: the stopped exchange keeps
   * whatever already streamed, marked as interrupted, and the late
   * completion of the cancelled answer is ignored. Stopping with no answer
   * in flight changes nothing.
   */
  stop(step: number): void {
    this.exchanges.stop(String(step));
  }

  /** Release the responder's agent resources; the session is over. */
  async dispose(): Promise<void> {
    await this.options.responder?.dispose?.();
  }
}

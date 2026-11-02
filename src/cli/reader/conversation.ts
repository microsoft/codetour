import type { CodeTour } from "../../store";
import { StepConversations, type StepConversationExchange } from "../../agent/stepConversations";
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
 * The reader's Tour Step Conversation (ADR 0026): per-Step exchanges kept in
 * memory until the Tour ends. The lifecycle itself — the store, the blocking
 * of a question while its conversation's previous answer is in progress, the
 * follow-up history of completed exchanges, the interruption of an answer in
 * flight with its late completion ignored, the failure messages and the
 * release of the responder's agent resources — lives in the shared
 * `StepConversations` store above the responder seam, exactly as in the
 * extension's conversation view (ADR 0031). This module keeps only what grounds a
 * question in the Step the reader displays.
 */
export class TourStepConversation {
  private readonly store = new StepConversations();

  constructor(private readonly options: TourStepConversationOptions) {
    if (options.responder) {
      this.store.setResponder(options.responder);
    }
  }

  get hasResponder(): boolean {
    return this.options.responder !== undefined;
  }

  /** The agent's lowercase provider name, for the status line and the role line. */
  get providerName(): string | undefined {
    return this.options.responder?.providerName;
  }

  /** The Step's exchanges, raw and unpainted, straight from the shared store. */
  exchangesFor(step: number): readonly StepConversationExchange[] {
    return this.store.view(String(step)).exchanges;
  }

  /** True while the Step's previous answer is still streaming. */
  isResponding(step: number): boolean {
    return this.store.view(String(step)).responding;
  }

  /**
   * Ask one Step's question. The store owns the lifecycle: the question
   * appears immediately as a pending exchange, a question asked while the
   * Step's previous answer is still in progress never reaches the responder,
   * and the answer streams into the exchange through `onChange`. Nothing
   * happens for a missing Step.
   */
  ask(step: number, question: string): Promise<void> {
    const { tour, root, resolveStepContext, readCommitFile, onChange } = this.options;
    const stepData = tour.steps[step];
    if (!stepData) return Promise.resolve();
    // The grounding context is built once, at question time, from the Step
    // the reader sees — captured faithfully to the display (ADR 0021).
    return this.store.ask(
      String(step),
      question,
      {
        context: () => buildStepChatContext(tour, stepData,
          resolveStepContext(root, tour, stepData), readCommitFile),
        workspaceRoot: root
      },
      onChange
    ).then(() => undefined);
  }

  /**
   * Interrupt the Step's answer in flight: the stopped exchange keeps
   * whatever already streamed, marked interrupted, and its late completion
   * is ignored. A new question is accepted immediately. Stopping with no
   * answer in flight changes nothing (ADR 0031).
   */
  stop(step: number): void {
    this.store.stop(String(step));
    this.options.onChange?.();
  }

  /**
   * Release the responder's agent resources through the store; the session
   * is over.
   */
  dispose(): Promise<void> {
    this.store.setResponder(undefined);
    return Promise.resolve();
  }
}

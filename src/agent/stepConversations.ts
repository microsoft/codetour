import {
  StepChatAgentUnavailableError,
  type StepChatContext,
  type StepChatHistoryEntry,
  type StepChatResponder,
  type StepChatToolUse
} from "./stepChatContract";

/**
 * The Tour Step Conversation store shared by every playback surface, above
 * the StepChatResponder seam.
 *
 * One lifecycle for both painters: a question is blocked while its
 * conversation's previous answer is in progress, the answer streams into the
 * pending exchange, only completed exchanges feed a follow-up question's
 * history, a stop interrupts the in-flight answer and ignores its late
 * completion, and a failure lands in the conversation without disturbing the
 * reading. Each surface keeps only the way it paints the exchanges.
 */

/** One exchange of a conversation, as stored above the seam: raw, unpainted. */
export interface StepConversationExchange {
  question: string;
  // The raw answer: the streamed chunks while pending, the complete answer
  // once settled, the failure message once failed.
  answer: string;
  // The latest raw activity of the responder, whatever its kind: an agent
  // activity message, the accumulated reasoning while thoughts stream, or
  // the line of an allowed tool call. The latest event wins.
  activity?: string;
  // The tool calls the agent reported while answering, forbidden ones
  // included, keyed by call and updated in place.
  toolUses: StepChatToolUse[];
  // True while the responder is still answering this question.
  pending: boolean;
  // True when the reader stopped this answer: its late completion must
  // never overwrite the interrupted state.
  interrupted: boolean;
  failed: boolean;
}

/** A conversation with its response-in-progress state, unpainted. */
export interface StepConversationView {
  exchanges: StepConversationExchange[];
  // True while the conversation's latest question is still being answered:
  // new questions are blocked until it turns false.
  responding: boolean;
}

interface StoredExchange {
  question: string;
  answer: string;
  activity?: string;
  // The accumulated reasoning, kept so a later activity message never
  // truncates the thoughts a subsequent delta restores.
  thought: string;
  tools: Map<string, StepChatToolUse>;
  pending: boolean;
  interrupted: boolean;
  failed: boolean;
}

/** What a question is grounded in: the displayed target and the workspace. */
export interface StepConversationGrounding {
  // Captures the step context faithful to the reader's display; the store
  // awaits it, so a stop during the capture is honored.
  context: () => StepChatContext | Promise<StepChatContext>;
  workspaceRoot: string;
}

export class StepConversations {
  private responder?: StepChatResponder;
  private readonly conversations = new Map<string, StoredExchange[]>();

  constructor(responder?: StepChatResponder) {
    this.responder = responder;
  }

  /** Injects (or removes) the responder answering the questions. */
  setResponder(next?: StepChatResponder): void {
    this.release(this.responder);
    this.responder = next;
  }

  /** The conversation, with its response-in-progress state. */
  view(conversation: string): StepConversationView {
    const stored = this.conversations.get(conversation) ?? [];
    return {
      exchanges: stored.map(exchange => ({
        question: exchange.question,
        answer: exchange.answer,
        activity: exchange.activity,
        toolUses: [...exchange.tools.values()],
        pending: exchange.pending,
        interrupted: exchange.interrupted,
        failed: exchange.failed
      })),
      responding: stored.some(exchange => exchange.pending)
    };
  }

  /**
   * Asks the responder for the conversation, records the exchange and
   * returns the conversation once the answer settles.
   *
   * The answer streams: every received chunk and reported event is reported
   * through `onUpdate` while the exchange stays pending. A question asked
   * while the conversation's previous answer is still in progress is
   * blocked: it never reaches the responder and never enters the
   * conversation.
   */
  async ask(
    conversation: string,
    question: string,
    grounding: StepConversationGrounding,
    onUpdate?: () => void
  ): Promise<StepConversationView> {
    const stored = this.conversations.get(conversation) ?? [];
    const text = question.trim();
    // A new question cannot be sent while the previous answer is in
    // progress: it never reaches the responder.
    if (stored.some(exchange => exchange.pending) || !text) {
      return this.view(conversation);
    }

    // Only the exchanges that completed feed the follow-up question: a
    // failed or interrupted one never did.
    const history: StepChatHistoryEntry[] = stored
      .filter(exchange => !exchange.failed && !exchange.pending && !exchange.interrupted)
      .map(exchange => ({ question: exchange.question, answer: exchange.answer }));

    // The question appears immediately with the response-in-progress
    // state, before any answer text arrives.
    const exchange: StoredExchange = {
      question: text,
      answer: "",
      thought: "",
      activity: undefined,
      tools: new Map(),
      pending: true,
      interrupted: false,
      failed: false
    };
    stored.push(exchange);
    this.conversations.set(conversation, stored);
    onUpdate?.();

    // The late completion of a stopped exchange is ignored: it never
    // overwrites the interrupted state the reader already sees.
    const settle = (answer: string, failed: boolean): void => {
      if (exchange.interrupted) {
        return;
      }
      exchange.answer = answer;
      exchange.failed = failed;
      exchange.pending = false;
    };

    if (!this.responder) {
      settle("This step's responder is not available. Tour reading stays usable.", true);
      return this.view(conversation);
    }

    try {
      const context = await grounding.context();
      // A stop can arrive while the displayed context is still captured.
      if (exchange.interrupted) {
        return this.view(conversation);
      }
      const answer = await this.responder.answer(
        {
          question: text,
          context,
          history,
          workspaceRoot: grounding.workspaceRoot
        },
        {
          onAnswerDelta: delta => {
            if (exchange.interrupted) return;
            exchange.answer += delta;
            onUpdate?.();
          },
          onThoughtDelta: delta => {
            if (exchange.interrupted) return;
            exchange.thought += delta;
            exchange.activity = exchange.thought;
            onUpdate?.();
          },
          onActivity: message => {
            if (exchange.interrupted) return;
            exchange.activity = message;
            onUpdate?.();
          },
          onToolUse: tool => {
            if (exchange.interrupted) return;
            exchange.tools.set(tool.toolCallId, tool);
            // An allowed tool call is a plain line of model activity,
            // reported live; a forbidden one is reported by the painters.
            if (!tool.forbidden) {
              exchange.activity = `${tool.title ?? tool.kind ?? "Tool"} (${tool.status ?? "in progress"})`;
            }
            onUpdate?.();
          }
        }
      );
      settle(answer, false);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (error instanceof StepChatAgentUnavailableError) {
        settle(
          `${reason} A new question will restart the agent; tour reading stays usable.`,
          true
        );
      } else {
        settle(
          `The answer to this question failed (${reason}). Tour reading stays usable.`,
          true
        );
      }
    }

    return this.view(conversation);
  }

  /**
   * Interrupts the conversation's answer in flight: the stopped exchange
   * keeps whatever already streamed, marked as interrupted, and the late
   * completion of the cancelled answer is ignored. A new question is
   * accepted immediately. Stopping with no answer in flight changes nothing.
   */
  stop(conversation: string): StepConversationView {
    const stored = this.conversations.get(conversation) ?? [];
    const exchange = [...stored].reverse().find(candidate => candidate.pending);
    if (!exchange) {
      return this.view(conversation);
    }

    // The stopped answer keeps its streamed part, marked as interrupted.
    exchange.pending = false;
    exchange.interrupted = true;

    // The responder cancels its in-flight exchange; a responder without
    // cancellation still leaves the interrupted state in the conversation.
    this.cancelInFlight();

    return this.view(conversation);
  }

  /** Forgets every conversation and releases the responder's agent resources. */
  clear(): void {
    this.conversations.clear();
    // The agent resources are released with the conversations; the responder
    // stays registered and lazily relaunches for a future reading session.
    this.release(this.responder);
  }

  private cancelInFlight(): void {
    try {
      this.responder?.cancel?.();
    } catch {
      // Stopping must never disturb the reader.
    }
  }

  private release(current: StepChatResponder | undefined): void {
    if (!current) {
      return;
    }
    try {
      const released = current.dispose?.();
      if (released) {
        Promise.resolve(released).catch(() => undefined);
      }
    } catch {
      // Releasing a responder must never disturb the reader.
    }
  }
}

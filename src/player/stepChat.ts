import { Uri, window, workspace } from "vscode";
import { ActiveTour } from "../store";
import { FS_SCHEME } from "../constants";
import { getStepFileUri } from "../utils";
import { getStepDiff, getStepDiffPath } from "./diff";
import { renderMarkdownToHtml } from "./markdown";

/**
 * The Tour Step Conversation base (webview chat).
 *
 * Message protocol between the webview and the extension:
 *
 * - webview → extension: `{ type: "askQuestion", question, token,
 *   targetTourId, step }` submits the reader's question for the rendered
 *   step, with the same identity as every other webview message.
 * - webview → extension: `{ type: "stopQuestion", token, targetTourId,
 *   step }` interrupts the step's answer in flight: the responder's
 *   exchange is cancelled, the interrupted state is displayed in the
 *   chat and a new question is accepted immediately.
 * - extension → webview: `{ type: "stepChat", exchanges, responding }`
 *   replaces the rendered conversation of the step. Each exchange is a
 *   question with the answer HTML produced by the shared renderer and
 *   sanitizer; a failed exchange carries the error message instead of a
 *   responder answer. The answer streams chunk by chunk: one update per
 *   received chunk, `responding` true and the latest exchange `pending`
 *   while the answer is in progress, `responding` false once it is
 *   complete. A question is blocked while the step's previous answer is
 *   still in progress.
 *
 * Conversations are kept in memory per tour and step identity, until the
 * reading webview closes; nothing is persisted to disk.
 */

import type {
  StepChatAnswerEvents,
  StepChatContext,
  StepChatDiffSide,
  StepChatHistoryEntry,
  StepChatRequest,
  StepChatResponder,
  StepChatToolUse
} from "../agent/stepChatContract";
import { StepChatAgentUnavailableError } from "../agent/stepChatContract";

export type {
  StepChatAnswerEvents,
  StepChatContext,
  StepChatDiffSide,
  StepChatHistoryEntry,
  StepChatRequest,
  StepChatResponder,
  StepChatToolUse
};
export { StepChatAgentUnavailableError };

let responder: StepChatResponder | undefined;

/** Injects (or removes) the responder answering step chat questions. */
export function setStepChatResponder(next?: StepChatResponder): void {
  releaseResponder(responder);
  responder = next;
}

function releaseResponder(current: StepChatResponder | undefined): void {
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

interface StoredExchange {
  question: string;
  // The raw answer feeds follow-up questions; the HTML feeds the chat.
  answerMarkdown: string;
  answerHtml: string;
  activityHtml?: string;
  // The forbidden tool calls executed during this answer, keyed by call
  // and kept up to date while the answer streams.
  forbiddenTools?: Map<string, StepChatToolUse>;
  failed: boolean;
  // True while the responder is still answering this question: the
  // response-in-progress state of the chat.
  pending?: boolean;
  // True when the reader stopped this exchange's answer: its late
  // completion must never overwrite the interrupted state.
  interrupted?: boolean;
}

const conversations = new Map<string, StoredExchange[]>();

function conversationKey(tourId: string, step: number): string {
  return `${tourId}::${step}`;
}

function getConversation(tourId: string, step: number): StoredExchange[] {
  return conversations.get(conversationKey(tourId, step)) ?? [];
}

/** One question with its answer, as the webview renders it. */
export interface StepChatExchangeView {
  question: string;
  answerHtml: string;
  activityHtml?: string;
  // The forbidden tools the agent executed during this answer: reported
  // live while the answer streams and kept after it completes or stops.
  forbiddenTools?: StepChatToolUse[];
  failed?: boolean;
  // True while this question's answer is still streaming.
  pending?: boolean;
  // True when the reader stopped this answer: the partial answer stays
  // readable, marked as interrupted.
  interrupted?: boolean;
}

/** The conversation of a step, with its response-in-progress state. */
export interface StepChatConversationView {
  exchanges: StepChatExchangeView[];
  // True while the step's latest question is still being answered: new
  // questions are blocked until it turns false.
  responding: boolean;
}

/** The conversation of a step, as the webview renders it. */
export function getStepChatExchanges(
  tourId: string,
  step: number
): StepChatExchangeView[] {
  return getStepChatConversationView(tourId, step).exchanges;
}

/** The conversation of a step with its response-in-progress state. */
export function getStepChatConversationView(
  tourId: string,
  step: number
): StepChatConversationView {
  const conversation = getConversation(tourId, step);
  return {
    exchanges: conversation.map(exchange => ({
      question: exchange.question,
      answerHtml: exchange.answerHtml,
      activityHtml: exchange.activityHtml,
      forbiddenTools:
        exchange.forbiddenTools && exchange.forbiddenTools.size > 0
          ? [...exchange.forbiddenTools.values()]
          : undefined,
      failed: exchange.failed || undefined,
      pending: exchange.pending || undefined,
      interrupted: exchange.interrupted || undefined
    })),
    responding: conversation.some(exchange => exchange.pending === true)
  };
}

/** Forgets every step conversation; called when the reading webview closes. */
export function clearStepChatConversations(): void {
  conversations.clear();
  // The ACP agent resources are released with the conversations; the
  // responder stays registered and lazily relaunches for a future reading
  // session.
  releaseResponder(responder);
}

/**
 * Captures the step context faithful to what the reader is shown, reusing
 * the reader's own target resolution across every step target kind.
 *
 * - A diff step captures the persisted comparison's two sides as such, each
 *   identified with its own path and Git commit.
 * - Any other code step captures the buffer of the exact target the render
 *   resolved — the Git snapshot of a Changes Tour step, never the current
 *   workspace file, the virtual document of an embedded-content step, or
 *   the open buffer of a file or URI step, unsaved edits included.
 * - A step without code (a directory, a view or a plain explanation)
 *   passes the declared target, if any, without any substitute code.
 * - A target that is not currently displayed is reported unavailable,
 *   never silently replaced by another file.
 */
export async function resolveStepContext(
  active: ActiveTour
): Promise<StepChatContext> {
  const tour = active.tour;
  const step = tour.steps[active.step];
  const description = step?.description ?? "";
  if (!step) {
    return { available: false, description };
  }

  if (step.display === "diff" && step.file) {
    const diff = await getStepDiff(step, tour, active.workspaceRoot);
    if (diff) {
      try {
        // The same snapshot documents the render displays, already opened
        // by the reader's resolution.
        const [original, modified] = await Promise.all([
          readDisplayedSide(diff.original),
          readDisplayedSide(diff.modified)
        ]);
        return {
          available: true,
          path: getStepDiffPath(step),
          diff: {
            original: {
              path: step.baseFile || step.file,
              ref: tour.baseRef!,
              code: original
            },
            modified: { path: step.file, ref: tour.ref!, code: modified }
          },
          description
        };
      } catch {
        // A side that cannot be read falls back to the single-target
        // resolution below, exactly like the render's own fallback.
      }
    }
  }

  // The virtual document of an embedded-content step, as the reader's own
  // resolution opens it.
  if (step.contents !== undefined) {
    const target = Uri.parse(`${FS_SCHEME}://current/${step.file}`);
    const editor = window.visibleTextEditors.find(
      editor => editor.document.uri.toString() === target.toString()
    );
    if (!editor) {
      return { available: false, path: step.file, description };
    }
    return {
      available: true,
      path: step.file,
      code: editor.document.getText(),
      description
    };
  }

  const file = step.file || step.uri;
  if (file) {
    // The same resolution the render performs: the Git snapshot of a Changes
    // Tour step, the current buffer of an ordinary step.
    const uri = await getStepFileUri(
      step,
      active.workspaceRoot,
      step.display === "diff" ? undefined : tour.ref
    );
    const editor = window.visibleTextEditors.find(
      editor => editor.document.uri.toString() === uri.toString()
    );
    if (!editor) {
      return { available: false, path: file, description };
    }

    return {
      available: true,
      path: file,
      code: editor.document.getText(),
      description
    };
  }

  // A directory-anchored step presents no code: the declared directory is
  // the target the agent receives, never a substitute buffer.
  if (step.directory) {
    return { available: false, path: step.directory, description };
  }

  // No code target at all: a view or plain explanation step.
  return { available: false, description };
}

async function readDisplayedSide(uri: Uri): Promise<string> {
  return (await workspace.openTextDocument(uri)).getText();
}

/**
 * Asks the injected responder for the rendered step, records the exchange
 * in the step's conversation and returns the updated webview conversation.
 *
 * The answer streams: each received chunk is reported through `onProgress`
 * with the response-in-progress state visible, until the complete answer
 * turns it off. A new question is blocked while the step's previous answer
 * is still in progress: it never reaches the responder.
 */
export async function askTourStepQuestion(
  active: ActiveTour,
  question: string,
  onProgress?: (view: StepChatConversationView) => void
): Promise<StepChatConversationView> {
  const key = conversationKey(active.tour.id, active.step);
  const view = (): StepChatConversationView =>
    getStepChatConversationView(active.tour.id, active.step);

  // A new question cannot be sent while the previous answer is in progress.
  if (view().responding) {
    return view();
  }

  const history: StepChatHistoryEntry[] = getConversation(
    active.tour.id,
    active.step
  )
    // A failed or interrupted exchange never completed: neither feeds a
    // follow-up question's history.
    .filter(exchange => !exchange.failed && !exchange.pending && !exchange.interrupted)
    .map(exchange => ({
      question: exchange.question,
      answer: exchange.answerMarkdown
    }));

  // The question appears immediately with the response-in-progress state,
  // before any answer text arrives.
  const exchange: StoredExchange = {
    question,
    answerMarkdown: "",
    answerHtml: "",
    failed: false,
    pending: true
  };
  const conversation = getConversation(active.tour.id, active.step);
  conversation.push(exchange);
  conversations.set(key, conversation);
  onProgress?.(view());

  // The stored exchange is updated in place: the conversation keeps its
  // order and a refresh never mixes the streamed answer into another step.
  // The late completion of a stopped exchange is ignored: it never
  // overwrites the interrupted state the reader already sees.
  const complete = (final: StoredExchange) => {
    if (exchange.interrupted) {
      return;
    }
    exchange.answerMarkdown = final.answerMarkdown;
    exchange.answerHtml = final.answerHtml;
    exchange.failed = final.failed;
    exchange.pending = undefined;
  };

  if (!responder) {
    complete(
      failedExchange(
        question,
        "This step's responder is not available. Tour reading stays usable."
      )
    );
  } else {
    let streamed = "";
    let thought = "";
    try {
      const context = await resolveStepContext(active);
      // Stop can arrive while the displayed context is still being read.
      if (exchange.interrupted) return view();
      const answerMarkdown = await responder.answer(
        {
          question,
          context,
          history,
          workspaceRoot: active.workspaceRoot?.fsPath ?? ""
        },
        {
          // Every chunk is rendered through the shared sanitizer and
          // displayed on its own: the answer is readable as it streams.
          onThoughtDelta: delta => {
            if (exchange.interrupted) return;
            thought += delta;
            exchange.activityHtml = renderMarkdownToHtml(thought);
            onProgress?.(view());
          },
          onActivity: message => {
            if (exchange.interrupted) return;
            exchange.activityHtml = renderMarkdownToHtml(message);
            onProgress?.(view());
          },
          // A forbidden tool call is reported to the reader the moment it
          // runs; an allowed one stays a plain line of model activity.
          onToolUse: tool => {
            if (exchange.interrupted) return;
            if (tool.forbidden) {
              const tools =
                exchange.forbiddenTools ?? new Map<string, StepChatToolUse>();
              tools.set(tool.toolCallId, tool);
              exchange.forbiddenTools = tools;
            } else {
              exchange.activityHtml = renderMarkdownToHtml(
                `${tool.title ?? tool.kind ?? "Tool"} (${tool.status ?? "in progress"})`
              );
            }
            onProgress?.(view());
          },
          onAnswerDelta: (delta: string) => {
            if (exchange.interrupted) {
              return;
            }
            streamed += delta;
            exchange.answerHtml = renderMarkdownToHtml(streamed);
            onProgress?.(view());
          }
        }
      );
      complete({
        question,
        answerMarkdown,
        answerHtml: renderMarkdownToHtml(answerMarkdown),
        failed: false
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (error instanceof StepChatAgentUnavailableError) {
        complete(
          failedExchange(
            question,
            `${reason} A new question will restart the agent; tour reading stays usable.`
          )
        );
      } else {
        complete(
          failedExchange(
            question,
            `The answer to this question failed (${reason}). Tour reading stays usable.`
          )
        );
      }
    }
  }

  const final = view();
  onProgress?.(final);
  return final;
}

/**
 * Interrupts the step's answer in flight and returns the updated webview
 * conversation.
 *
 * The responder's exchange is cancelled and the stopped exchange keeps
 * whatever already streamed, marked as interrupted; the late completion
 * of the cancelled answer is ignored. A new question is accepted
 * immediately, without reloading the webview. Stopping with no answer in
 * flight changes nothing.
 */
export function stopTourStepQuestion(
  active: ActiveTour,
  onProgress?: (view: StepChatConversationView) => void
): StepChatConversationView {
  const conversation = getConversation(active.tour.id, active.step);
  const exchange = [...conversation]
    .reverse()
    .find(candidate => candidate.pending === true);
  if (!exchange) {
    return getStepChatConversationView(active.tour.id, active.step);
  }

  // The stopped answer keeps its streamed part, marked as interrupted.
  exchange.pending = undefined;
  exchange.interrupted = true;
  exchange.answerHtml = interruptedAnswerHtml(exchange.answerHtml);

  // The responder cancels its in-flight ACP exchange; a responder without
  // cancellation still leaves the interrupted state in the chat.
  try {
    responder?.cancel?.();
  } catch {
    // Stopping must never disturb the reader.
  }

  const final = getStepChatConversationView(active.tour.id, active.step);
  onProgress?.(final);
  return final;
}

/** The displayed answer of a stopped exchange, with its interruption. */
function interruptedAnswerHtml(streamedAnswer: string): string {
  return `${streamedAnswer}<p class="step-chat-interrupted" role="status">Answer interrupted.</p>`;
}

function failedExchange(question: string, message: string): StoredExchange {
  return {
    question,
    answerMarkdown: "",
    answerHtml: renderMarkdownToHtml(message),
    failed: true
  };
}

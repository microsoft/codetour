import type { AcpAgentEntry, AcpAgentProcess } from "./acpAgentProcess";
import { spawnAcpAgent } from "./acpAgentProcess";
import type { AskSession, TourStepContext } from "./acpSession";
import { openAskSession } from "./acpSession";
import {
  StepChatAgentUnavailableError,
  type StepChatContext,
  type StepChatRequest,
  type StepChatResponder
} from "./stepChatContract";

/**
 * The Tour Step Conversation agent: the webview chat's responder built on
 * the ACP session layer. The agent is launched lazily by its installed ACP
 * entry on the first question — a configured ACP provider or the deterministic fake
 * agent at the same process boundary in tests — kept for the whole reading
 * session, and its Ask mode is selected and verified by the session layer
 * before the first prompt.
 */

export interface AcpStepChatResponderHooks {
  /**
   * Observes every spawned ACP agent process. The deterministic tests use it
   * to watch the transport; production passes no hooks.
   */
  onProcess?(agent: AcpAgentProcess): void;
  startupTimeoutMs?: number;
}

export interface AcpStepChatResponder extends StepChatResponder {
  /** Cancels any in-flight turn and releases the ACP agent resources. */
  dispose(): Promise<void>;
}

export function createAcpStepChatResponder(
  entryFor: (request: StepChatRequest) => AcpAgentEntry,
  hooks: AcpStepChatResponderHooks = {}
): AcpStepChatResponder {
  let session: AskSession | undefined;
  let agent: AcpAgentProcess | undefined;
  let opening: Promise<AskSession> | undefined;
  // The answer currently in flight, if any.
  let answering: Promise<unknown> | undefined;
  // Bumped by dispose so a launch racing the close of the reading webview
  // can never install a leaked session on a fresh conversation.
  let epoch = 0;
  // Bumped when the reader stops an answer whose agent session is still
  // starting: the stopped question is never prompted once it opens.
  let stopEpoch = 0;

  // An agent that honors the ACP cancellation ends its turn promptly; one
  // that ignores it must not block the reader's next question forever.
  const STOP_SETTLE_TIMEOUT_MS = 10_000;

  async function openSession(request: StepChatRequest): Promise<AskSession> {
    if (session) {
      return session;
    }
    if (!opening) {
      const myEpoch = epoch;
      const entry = entryFor(request);
      const spawned = spawnAcpAgent(entry);
      agent = spawned;
      hooks.onProcess?.(spawned);
      opening = openAskSession({ transport: spawned, cwd: entry.cwd, modeId: entry.modeId, useDefaultMode: entry.useDefaultMode, startupTimeoutMs: hooks.startupTimeoutMs }).then(
        opened => {
          if (myEpoch !== epoch) {
            opened.close().catch(() => undefined);
            throw new Error(
              "The tour step conversation closed while the agent was starting."
            );
          }
          session = opened;
          return opened;
        },
        error => {
          if (myEpoch === epoch) {
            opening = undefined;
            spawned.dispose().catch(() => undefined);
          }
          throw new StepChatAgentUnavailableError(
            `Impossible de lancer l'agent de conversation : ${messageOf(error)}`
          );
        }
      );
      // Teardown can reject the launch before the caller attaches its own
      // handler; keep that window free of unhandled rejections.
      opening.catch(() => undefined);
    }
    return opening;
  }

  /** True when the agent process behind the session is already gone. */
  async function transportGone(): Promise<boolean> {
    const currentAgent = agent;
    if (!currentAgent) {
      return false;
    }
    return Promise.race([
      currentAgent.exited.then(
        () => true,
        () => true
      ),
      new Promise<boolean>(resolve => setImmediate(() => resolve(false)))
    ]);
  }

  /** Drops a dead session so the next question relaunches the agent. */
  function releaseBrokenSession(): void {
    const currentSession = session;
    const currentAgent = agent;
    session = undefined;
    agent = undefined;
    opening = undefined;
    if (currentAgent) {
      currentAgent.dispose().catch(() => undefined);
    } else if (currentSession) {
      currentSession.close().catch(() => undefined);
    }
  }

  return {
    async answer(request, events) {
      const settling = answering;
      const turn = (async () => {
        // An answer the reader stopped may still be settling on the ACP
        // session: its cancelled turn ends before the next question is
        // prompted, so a new question after a stop is never rejected as
        // already in flight.
        if (settling) {
          await Promise.race([
            settling.then(
              () => undefined,
              () => undefined
            ),
            new Promise(resolve =>
              setTimeout(resolve, STOP_SETTLE_TIMEOUT_MS)
            )
          ]);
        }
        const myStopEpoch = stopEpoch;
        events?.onActivity?.("Connecting to the agent…");
        const current = await openSession(request);
        events?.onActivity?.("Question sent, waiting for the model…");
        // A stop that arrived while the agent was still starting targets
        // this very question: it is never prompted to the agent.
        if (myStopEpoch !== stopEpoch) {
          throw new Error(
            "The tour step conversation was stopped before the question was sent."
          );
        }
        let outcome;
        try {
          // A crashed agent must never leave the reader waiting on a
          // prompt that can no longer be answered.
          const crashed = agent!.exited.then(
            () => {
              throw new Error("The ACP agent exited during the answer.");
            },
            () => {
              throw new Error(
                "The ACP agent connection broke during the answer."
              );
            }
          );
          outcome = await Promise.race([
            current.prompt(
              request.question,
              toTourStepContext(request.context),
              // Every streamed chunk of the agent's answer is handed to the
              // chat as it arrives, so the reader never waits for the whole
              // generation to finish.
              {
                onAssistantText: delta => events?.onAnswerDelta?.(delta),
                onThoughtText: delta => events?.onThoughtDelta?.(delta),
                // Each executed tool call is forwarded as it arrives: the
                // chat owns the display policy for allowed and forbidden
                // calls alike.
                onToolUse: tool => events?.onToolUse?.(tool)
              },
              request.history
            ),
            crashed
          ]);
        } catch (error) {
          // The SDK sees EOF before the OS necessarily emits process exit
          // (notably on Windows). A closed ACP stream is already unusable.
          if (messageOf(error) === "ACP connection closed" || await transportGone()) {
            releaseBrokenSession();
            throw new StepChatAgentUnavailableError(
              `The conversation agent connection was lost: ${messageOf(error)}`
            );
          }
          throw error;
        }
        return outcome.message;
      })();
      answering = turn;
      try {
        return await turn;
      } finally {
        if (answering === turn) {
          answering = undefined;
        }
      }
    },
    cancel() {
      if (!session) {
        // The agent is still starting: the stopped question must never be
        // prompted once its session opens.
        stopEpoch++;
        return;
      }
      session.cancel();
    },
    async dispose() {
      epoch++;
      const currentSession = session;
      const currentAgent = agent;
      session = undefined;
      agent = undefined;
      opening = undefined;
      if (currentSession) {
        await currentSession.close().catch(() => undefined);
      } else if (currentAgent) {
        await currentAgent.dispose().catch(() => undefined);
      }
    }
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Maps the resolver-captured step context onto the prompt context. An
 * unavailable target is reported as such; no other file's code is ever
 * substituted for the missing display.
 */
function toTourStepContext(context: StepChatContext): TourStepContext {
  if (context.available) {
    // A diff step shows two snapshots: both sides are transmitted, each
    // identified with its own path and Git commit, so the agent discusses
    // the comparison the reader actually sees.
    if ("diff" in context) {
      const { original, modified } = context.diff;
      return {
        filePath: context.path,
        description: context.description,
        code: [
          `Original (${original.ref}) ${original.path}:`,
          "```",
          original.code,
          "```",
          `Modified (${modified.ref}) ${modified.path}:`,
          "```",
          modified.code,
          "```"
        ].join("\n")
      };
    }
    return {
      filePath: context.path ?? "",
      description: context.description,
      code: context.code
    };
  }
  return {
    filePath: context.path ?? "",
    description: context.description,
    code: "",
    codeUnavailable: true
  };
}

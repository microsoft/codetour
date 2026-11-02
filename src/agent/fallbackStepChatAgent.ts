import type { AcpProvider } from "./acpProviders";
import { acpProviders } from "./acpProviders";
import { createAcpStepChatResponder, type AcpStepChatResponderHooks } from "./stepChatAgent";
import { StepChatAgentUnavailableError, type StepChatResponder } from "./stepChatContract";

/** Keeps the first working provider for the reading session, with ordered failover. */
export function createFallbackStepChatResponder(
  providersFor: (cwd: string) => AcpProvider[] = acpProviders,
  hooks: AcpStepChatResponderHooks = {}
): StepChatResponder {
  let active: StepChatResponder | undefined;
  let selected = 0;
  let workspace: string | undefined;
  let generation = 0;
  // Selection, startup and fallback form one operation on the shared session.
  // Queue the whole operation, not just prompts inside an individual provider.
  let pending: Promise<void> = Promise.resolve();

  return {
    async answer(request, events) {
      const attempt = generation;
      const answer = pending.then(async () => {
        if (attempt !== generation) throw new Error("Answer interrupted.");
        if (workspace !== request.workspaceRoot) {
          const previous = active;
          active = undefined;
          selected = 0;
          workspace = request.workspaceRoot;
          await previous?.dispose?.();
        }
        const providers = providersFor(request.workspaceRoot);
        const failed: string[] = [];
        for (; selected < providers.length; selected++) {
          if (attempt !== generation) throw new Error("Answer interrupted.");
          const provider = providers[selected];
          const current = active ?? createAcpStepChatResponder(() => provider.entry, hooks);
          active = current;
          let streamed = false;
          events?.onActivity?.(`Connecting to ${provider.name}…`);
          try {
            return await current.answer(request, {
              onAnswerDelta: delta => {
                if (attempt !== generation) return;
                streamed ||= delta.length > 0;
                events?.onAnswerDelta?.(delta);
              },
              onThoughtDelta: delta => {
                if (attempt === generation) events?.onThoughtDelta?.(delta);
              },
              onActivity: message => {
                if (attempt === generation) events?.onActivity?.(`${provider.name} — ${message}`);
              }
            });
          } catch (error) {
            if (attempt !== generation) throw error;
            // A visible answer belongs to one agent; never splice another into it.
            if (streamed) throw error;
            failed.push(`${provider.name} : ${error instanceof Error ? error.message : String(error)}`);
            active = undefined;
            await current.dispose?.();
            if (attempt !== generation) throw error;
            events?.onActivity?.(`${provider.name} indisponible, essai de l’agent suivant…`);
          }
        }
        selected = 0; // A future question retries the ordered list after configuration changes.
        throw new StepChatAgentUnavailableError(
          `Aucun agent ACP disponible (Vibe → Copilot → Codex → Claude Code). ${failed.join("\n")}`
        );
      });
      // Rejection must free the queue for the next request as well.
      pending = answer.then(() => undefined, () => undefined);
      return answer;
    },
    cancel() {
      generation++;
      active?.cancel?.();
      const previous = active;
      active = undefined;
      // A live agent may ignore cancel. Retire its transport before admitting
      // fresh requests; stale queued requests retain the old generation.
      pending = Promise.resolve(previous?.dispose?.()).then(() => undefined, () => undefined);
    },
    async dispose() {
      generation++;
      const previous = active;
      active = undefined;
      selected = 0;
      workspace = undefined;
      pending = Promise.resolve(previous?.dispose?.()).then(() => undefined, () => undefined);
      await pending;
    }
  };
}

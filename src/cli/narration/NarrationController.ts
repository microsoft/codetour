import { prepareNarrationText } from "./prepareText";
import type { NarrationEngine } from "./SystemSpeech";

export interface NarrationControllerOptions {
  /** The local OS speech adapter; a fake makes narration deterministically testable. */
  engine: NarrationEngine;
  /**
   * One nonblocking report per failed narration attempt (spec #79): the
   * reader shows it and stays usable, the Tour is never aborted.
   */
  onWarning?: (message: string) => void;
  /** A narration was handed to the engine; earlier warnings are obsolete. */
  onSpeaking?: () => void;
}

/**
 * The speech state of the terminal reader's optional narration (spec #79):
 * enabled state, cancellation, replacement of speech and race protection.
 * The controller owns the engine — TermDOM never touches the synthesizer —
 * and nothing here knows Step indices: the reader narrates on real Step
 * changes only, and supplies the currently displayed description itself.
 *
 * Race protection is a generation counter: every attempt is stamped, and any
 * outcome of an older attempt — completion or failure — is ignored, so rapid
 * navigation with a slow engine can never overlap or resume stale speech.
 */
export class NarrationController {
  private enabled = false;
  private generation = 0;
  private disposed = false;

  constructor(private readonly options: NarrationControllerOptions) {}

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Toggle narration. Turning it off cuts the current speech immediately; the
   * reader reads the currently displayed description when turning it on.
   */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) this.interrupt();
  }

  /**
   * Stop the current speech without starting a new one. The reader interrupts
   * at the navigation keypress, so the previous Step's voice is cut while the
   * next Step is still rendering.
   */
  interrupt(): void {
    this.generation++;
    this.options.engine.cancel();
  }

  /**
   * Narrate one Step's description, replacing any current speech. An empty
   * description produces no audio, and finishing an utterance never moves the
   * reader anywhere: completion is not an event.
   */
  onStepChanged(description: string): void {
    if (!this.enabled || this.disposed) return;
    this.generation++;
    const generation = this.generation;
    this.options.engine.cancel();
    const text = prepareNarrationText(description);
    if (!text) return;
    this.options.onSpeaking?.();
    void this.options.engine.speak(text).catch(error => {
      // Only the current generation's failures are the reader's problem.
      if (this.disposed || !this.enabled || generation !== this.generation) return;
      this.options.onWarning?.("Narration failed: " +
        (error instanceof Error ? error.message : String(error)));
    });
  }

  /** Stop speech and release the engine's subprocess. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.interrupt();
    this.options.engine.dispose();
  }
}

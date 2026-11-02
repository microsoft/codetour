import { prepareNarrationText } from "../narration/prepareText";
import type { SpeechEngine } from "./collaborators";
import type { ReaderNarrationState } from "./viewModel";

/**
 * The home of the Step Narration policy (ADR 0029): the five crossing
 * closure variables of the old reader — last narrated Step, displayed Step,
 * pending narration, speech warning and the version/commit bookkeeping they
 * interact with — become one cohesive unit the reading state machine reports
 * to. The Step facts stay the reader's; the policy owns what the voice does
 * with them. The engine is the injected speech seam the foundation ticket
 * defined: nothing here starts a process or touches a terminal.
 */
export class NarrationPolicy {
  private enabled = false;
  private speakingValue = false;
  private warningValue: string | undefined;
  private lastNarratedStepValue = -1;
  private pendingNarrationValue = false;
  /**
   * Race protection over the engine: every handed utterance is stamped, and
   * any outcome of an older attempt — completion or failure — is ignored, so
   * rapid navigation with a slow engine can never overlap or resume stale
   * speech.
   */
  private generation = 0;
  private disposed = false;

  constructor(
    private readonly engine: SpeechEngine,
    /** Notified when state changes asynchronously — an engine failure surfacing as a warning. */
    private readonly onChange?: () => void
  ) {}

  get state(): ReaderNarrationState {
    return {
      enabled: this.enabled,
      speaking: this.speakingValue,
      warning: this.warningValue,
      lastNarratedStep: this.lastNarratedStepValue,
      pendingNarration: this.pendingNarrationValue
    };
  }

  /**
   * A navigation keypress: the previous speech is cut now, and the Step
   * this navigation actually displays asks for narration — a superseded or
   * failed render narrates nothing, the want survives until a committed
   * render displays that Step (ADR 0029).
   */
  onNavigate(): void {
    this.pendingNarrationValue = true;
    this.interrupt();
  }

  /**
   * The commit point of a versioned render: narration commits only for the
   * Step the render actually displays. A superseded render never reaches
   * here and a failed render never commits, so neither narrates anything;
   * the pending want survives until a later render displays the Step.
   */
  onRenderCommitted(
    displayedStep: number,
    currentStep: number,
    description: string
  ): void {
    if (this.disposed || !this.pendingNarrationValue || displayedStep !== currentStep) {
      return;
    }
    this.pendingNarrationValue = false;
    this.narrateDisplayedStep(displayedStep, description, false);
  }

  /**
   * The unmodified-`v` toggle (the modifier guard lives in the key
   * translation). Turning the voice off cuts the current speech inside the
   * engine immediately; turning it on re-reads the displayed Step — unless
   * a navigation is still rendering, in which case the pending deferral
   * speaks it only if that render commits.
   */
  toggleVoice(displayedStep: number, currentStep: number, description: string): void {
    this.setEnabled(!this.enabled);
    if (this.enabled && displayedStep === currentStep) {
      this.narrateDisplayedStep(displayedStep, description, true);
    }
  }

  /** Turning the voice off cuts the current speech immediately. */
  private setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) this.interrupt();
  }

  /**
   * Stop the current speech without starting a new one. The reader
   * interrupts at the navigation keypress, so the previous Step's voice is
   * cut while the next Step is still rendering. An earlier warning survives:
   * only a handed utterance makes it obsolete.
   */
  private interrupt(): void {
    this.generation++;
    this.speakingValue = false;
    this.engine.cancel();
  }

  /**
   * Speak the displayed Step's description — only ever that: never sources,
   * diffs, anchors, questions or ACP exchanges. A redisplayed Step never
   * speaks twice unless the toggle explicitly re-reads it.
   */
  private narrateDisplayedStep(
    displayedStep: number,
    description: string,
    reread: boolean
  ): void {
    if (!this.enabled || this.disposed || displayedStep < 0) return;
    if (!reread && displayedStep === this.lastNarratedStepValue) return;
    this.lastNarratedStepValue = displayedStep;
    this.speak(description);
  }

  /** Hand one prepared description to the engine (ADR 0029). */
  private speak(description: string): void {
    this.generation++;
    const generation = this.generation;
    this.engine.cancel();
    // An empty description produces no audio: the voice never invents a
    // summary.
    const text = prepareNarrationText(description);
    if (!text) return;
    // A narration was handed to the engine: an earlier warning is obsolete.
    this.speakingValue = true;
    this.warningValue = undefined;
    void this.engine.speak(text).catch(error => {
      // Only the current generation's failures are the reader's problem.
      if (this.disposed || !this.enabled || generation !== this.generation) return;
      this.speakingValue = false;
      this.warningValue = "Narration failed: " +
        (error instanceof Error ? error.message : String(error));
      this.onChange?.();
    });
  }

  /** Stop speech and release the engine's subprocess; the session is over. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.interrupt();
    this.engine.dispose();
  }
}

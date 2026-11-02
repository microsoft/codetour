import type { NarrationController } from "../narration/NarrationController";
import type { ReaderNarrationState } from "./viewModel";

/**
 * The Step facts the Step Narration policy decides on (ADR 0029): the Step a
 * committed render actually displays, the navigation target at the keypress,
 * and the displayed Step's description. They travel as one unit so the
 * reader's call sites and the policy's entry points share one shape.
 */
export interface NarrationStep {
  /** The Step a committed render actually displays. */
  displayedStep: number;
  /** The navigation target; a render may still be in flight for it. */
  currentStep: number;
  /** The displayed Step's description, the only text the voice ever speaks. */
  description: string;
}

/**
 * The home of the Step Narration policy (ADR 0029): the reading decisions
 * around the voice — the last narrated Step, the pending narration want of a
 * navigation, and the speech warning display — become one cohesive unit the
 * reading state machine reports to. The engine seam is the NarrationController
 * the entry point composes over the system speech: the enabled state, the
 * cut and replace of utterances and the generation race protection live in
 * the controller, once. The policy never re-implements them; nothing here
 * starts a process or touches a terminal.
 */
export class NarrationPolicy {
  private speakingValue = false;
  private warningValue: string | undefined;
  private lastNarratedStepValue = -1;
  private pendingNarrationValue = false;

  constructor(
    private readonly controller: NarrationController,
    /** Notified when state changes asynchronously — an engine failure surfacing as a warning. */
    private readonly onChange?: () => void
  ) {
    // The display half of the policy: the controller hands an utterance to
    // the engine or fails one, and what the reader shows of it is decided
    // here (ADR 0029).
    controller.attach({
      onSpeaking: () => {
        this.speakingValue = true;
        // A narration was handed to the engine: an earlier warning is obsolete.
        this.warningValue = undefined;
      },
      onWarning: message => {
        this.speakingValue = false;
        this.warningValue = message;
        this.onChange?.();
      }
    });
  }

  get state(): ReaderNarrationState {
    return {
      enabled: this.controller.isEnabled(),
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
    // The display shows no speech from the moment the cut happens; the
    // controller owns the cut itself. An earlier warning survives it.
    this.speakingValue = false;
    this.controller.interrupt();
  }

  /**
   * The commit point of a versioned render: narration commits only for the
   * Step the render actually displays. A superseded render never reaches
   * here and a failed render never commits, so neither narrates anything;
   * the pending want survives until a later render displays the Step.
   */
  onRenderCommitted(step: NarrationStep): void {
    if (!this.pendingNarrationValue || step.displayedStep !== step.currentStep) {
      return;
    }
    this.pendingNarrationValue = false;
    this.narrate(step.displayedStep, step.description, false);
  }

  /**
   * The unmodified-`v` toggle (the modifier guard lives in the key
   * translation). Turning the voice off cuts the current speech inside the
   * engine immediately; turning it on re-reads the displayed Step — unless
   * a navigation is still rendering, in which case the pending deferral
   * speaks it only if that render commits.
   */
  toggleVoice(step: NarrationStep): void {
    const enabled = !this.controller.isEnabled();
    this.controller.setEnabled(enabled);
    if (!enabled) {
      // The engine cut the speech; the display stops showing it.
      this.speakingValue = false;
      return;
    }
    if (step.displayedStep === step.currentStep) {
      this.narrate(step.displayedStep, step.description, true);
    }
  }

  /**
   * Speak the displayed Step's description — only ever that: never sources,
   * diffs, anchors, questions or ACP exchanges. A redisplayed Step never
   * speaks twice unless the toggle explicitly re-reads it.
   */
  private narrate(displayedStep: number, description: string, reread: boolean): void {
    if (!this.controller.isEnabled() || displayedStep < 0) return;
    if (!reread && displayedStep === this.lastNarratedStepValue) return;
    this.lastNarratedStepValue = displayedStep;
    this.controller.onStepChanged(description);
  }

  /** Stop speech and release the engine's subprocess; the session is over. */
  dispose(): void {
    void this.controller.dispose();
  }
}

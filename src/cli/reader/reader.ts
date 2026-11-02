import { resolveReadonlyStepContext, type ReadonlyStepContext } from "../stepContext";
import { renderTerminalDescription, TerminalStepRenderError } from "../terminalContent";
import { railWindow, terminalLayout, type TerminalLayout } from "../terminalLayout";
import type { CodeTour, CodeTourStep } from "../../store";
import type { NarrationController } from "../narration/NarrationController";
import type {
  CommitFileReader,
  ConversationResponder,
  DescriptionRenderer,
  StepContextResolver
} from "./collaborators";
import { TourStepConversation } from "./conversation";
import { NarrationPolicy, type NarrationStep } from "./narrationPolicy";
import { translateKey, type ReaderKeyEvent } from "./readerInput";
import { exchangesLabel, statusLine } from "./statusLine";
import type {
  ConversationState,
  ReaderComposer,
  ReaderExtents,
  ReaderFatal,
  ReaderRailItem,
  ReaderRailWindow,
  ReaderSourceSection,
  ReaderViewModel
} from "./viewModel";

/**
 * The reading interface of the terminal Tour reader (spec #93). Every call
 * yields the updated view model: logical, structured reading state with no
 * DOM and no terminal cells. The rendering adapter paints the view model,
 * translates its key events into {@link ReaderKeyEvent}s and reports the
 * measured Step-box extents back through {@link TourReader.onExtentsMeasured}.
 */
export interface TourReader {
  getState(): ReaderViewModel;
  /** The initial render, or the empty-Tour presentation when there is no Step. */
  open(): Promise<void>;
  /** Move to a Step; the render is versioned and commits asynchronously. */
  navigateTo(step: number): ReaderViewModel;
  /** Handle one key input: ask-mode capture included. */
  pressKey(event: ReaderKeyEvent): ReaderViewModel;
  /**
   * Whether the reader consumes `event`: the adapter asks before its
   * preventDefault and forwards only consumed keys to {@link pressKey}.
   * Both run the same reader-side translation, once (spec #93).
   */
  wouldConsume(event: ReaderKeyEvent): boolean;
  /** A geometry change: re-render and restore the clamped scroll offset. */
  resize(columns: number, rows: number): ReaderViewModel;
  /** The unmodified-`v` voice toggle (ADR 0029). */
  toggleVoice(): ReaderViewModel;
  /** Ask the active Step's question; one answer in flight at a time. */
  ask(question: string): Promise<void>;
  /** The adapter's measured Step-box extents, after each paint. */
  onExtentsMeasured(extents: ReaderExtents): void;
  /** The session is over: ignore every further input and release the collaborators. */
  close(): Promise<void>;
}

export interface ReaderOptions {
  tour: CodeTour;
  root: string;
  /** Initial terminal width in columns; the adapter reports the real geometry. */
  columns?: number;
  /** Initial terminal height in rows. */
  rows?: number;
  /**
   * The narration controller — the speech engine seam (ADR 0029), composed
   * over the system speech by the entry point and handed to the reader. The
   * reader keeps only the policy; the controller owns the engine's enabled
   * state, its race protection and its disposal.
   */
  speech: NarrationController;
  /** The agent answering Tour Step Conversation questions; none by default. */
  responder?: ConversationResponder;
  /** The description renderer; the pure terminal content module by default. */
  descriptionRenderer?: DescriptionRenderer;
  /** The Step context resolver; the pure step context module by default. */
  resolveStepContext?: StepContextResolver;
  /** The commit file reader grounding diff questions; none by default. */
  readCommitFile?: CommitFileReader;
  /**
   * Notified after every view-model change the adapter must paint — render
   * commits, key inputs, streaming exchange updates, narration warnings.
   * A navigation keypress notifies nothing until its render commits, exactly
   * as the reader's screen always behaved.
   */
  onViewChange?: () => void;
}

/** Rows the reader's own chrome takes before the rail can paint an item. */
const RAIL_CHROME_ROWS = 6;

export function createReader(options: ReaderOptions): TourReader {
  return new TerminalReader(options);
}

/**
 * The reading state machine: navigation targets are synchronous, displays
 * are versioned commits, and the view model is assembled from live state on
 * every call. Nothing here touches the DOM, the terminal or a process.
 */
class TerminalReader implements TourReader {
  private readonly tour: CodeTour;
  private readonly root: string;
  private readonly descriptionRenderer: DescriptionRenderer;
  private readonly resolveStepContext: StepContextResolver;
  private readonly narration: NarrationPolicy;
  private readonly conversation: TourStepConversation;

  private layout: TerminalLayout;
  private terminalRows: number;

  private current = 0;
  private displayedStep = -1;
  private version = 0;
  private inFlight = 0;
  private finished = false;
  private fatalValue: ReaderFatal | undefined;

  /** The content of the last committed render; a failed or superseded render changes nothing. */
  private painted = {
    tourTitle: "",
    stepCount: { index: 0, count: 0 },
    emptyMessage: undefined as string | undefined,
    anchor: { target: "", diff: false },
    stepTitle: "",
    descriptionHtml: "",
    source: undefined as ReaderSourceSection | undefined
  };

  private asking = false;
  private draft = "";

  private stepScrollTop = 0;
  private stepViewportRows = 0;
  private stepContentRows = 0;
  /** The offset a resize render must restore, stamped with its render request. */
  private pendingScrollRestore: { request: number; scrollTop: number } | undefined;

  private conversationScrollTop = 0;
  private conversationViewportRows = 0;
  private conversationContentRows = 0;
  /** The single disposal promise, returned to every caller of close(). */
  private closing: Promise<void> | undefined;
  private readonly onViewChange: (() => void) | undefined;

  constructor(options: ReaderOptions) {
    this.tour = options.tour;
    this.root = options.root;
    this.layout = terminalLayout(options.columns ?? 80);
    this.terminalRows = options.rows ?? 24;
    this.descriptionRenderer = options.descriptionRenderer ??
      ((tour, index, width) => renderTerminalDescription(tour, index, this.root, { width }));
    const resolveStepContext = options.resolveStepContext ?? resolveReadonlyStepContext;
    this.resolveStepContext = resolveStepContext;
    this.onViewChange = options.onViewChange;
    this.narration = new NarrationPolicy(
      options.speech,
      () => this.notify()
    );
    this.conversation = new TourStepConversation({
      tour: options.tour,
      root: options.root,
      responder: options.responder,
      resolveStepContext,
      readCommitFile: options.readCommitFile ?? (() => undefined),
      onChange: () => this.notify()
    });
  }

  /** The adapter's paint trigger: called after every mutation it must paint. */
  private notify(): void {
    this.onViewChange?.();
  }

  getState(): ReaderViewModel {
    const suggestions = this.tour.steps[this.current]?.questions ?? [];
    const exchanges = this.conversation.exchangesFor(this.current);
    const responding = this.conversation.isResponding(this.current);
    const hasResponder = this.conversation.hasResponder;
    // The conversation state every status and composer decision shares.
    const conversation: ConversationState = {
      asking: this.asking,
      responding,
      hasResponder
    };
    const narrationState = this.narration.state;
    return {
      currentStep: this.current,
      displayedStep: this.displayedStep,
      rendering: this.inFlight > 0,
      finished: this.finished,
      tourTitle: this.painted.tourTitle,
      stepCount: this.painted.stepCount,
      emptyMessage: this.painted.emptyMessage,
      anchor: this.painted.anchor,
      stepTitle: this.painted.stepTitle,
      descriptionHtml: this.painted.descriptionHtml,
      rail: this.railWindow(),
      railVisible: this.layout.railWidth > 0,
      source: this.painted.source,
      conversation: {
        title: "conversation",
        meta: !hasResponder
          ? "no agent"
          : exchanges.length
            ? exchangesLabel(exchanges.length)
            : "ready",
        hasResponder,
        providerName: this.conversation.providerName,
        suggestions,
        exchanges,
        responding
      },
      composer: this.composer(conversation, suggestions),
      status: statusLine({
        conversation,
        compactHints: this.layout.compactHints,
        narrationEnabled: narrationState.enabled,
        speechWarning: narrationState.warning,
        providerName: this.conversation.providerName,
        exchangeCount: exchanges.length
      }),
      narration: narrationState,
      scroll: {
        stepScrollTop: this.stepScrollTop,
        stepViewportRows: this.stepViewportRows,
        stepContentRows: this.stepContentRows,
        conversationScrollTop: this.conversationScrollTop,
        conversationViewportRows: this.conversationViewportRows,
        conversationContentRows: this.conversationContentRows
      },
      layout: this.layout,
      rows: this.terminalRows,
      fatal: this.fatalValue
    };
  }

  async open(): Promise<void> {
    if (!this.tour.steps.length) {
      // The empty Tour stays fully interactive: the reader shows its title,
      // its "step 0/0" counter and the no-steps message, and every remaining
      // key keeps working.
      this.painted.tourTitle = this.tour.title;
      this.painted.stepCount = { index: 0, count: 0 };
      this.painted.emptyMessage = "Tour has no steps. Press q to quit.";
      this.notify();
      return;
    }
    await this.render();
  }

  navigateTo(step: number): ReaderViewModel {
    if (this.finished) return this.getState();
    if (step < 0 || step >= this.tour.steps.length) return this.getState();
    this.current = step;
    // ADR 0029: the previous speech is cut at the keypress and the new
    // narration is committed only for the Step this navigation actually
    // displays — the render commit settles the pending want.
    this.narration.onNavigate();
    void this.render();
    return this.getState();
  }

  pressKey(event: ReaderKeyEvent): ReaderViewModel {
    const action = this.dispatch(event);
    this.applyAction(action);
    // A navigation paints nothing at the keypress: the screen keeps the
    // previous Step until the navigation's render commits (ADR 0025).
    if (action.type !== "navigate") this.notify();
    return this.getState();
  }

  wouldConsume(event: ReaderKeyEvent): boolean {
    return this.dispatch(event).type !== "unhandled";
  }

  /**
   * The session's single key translation (spec #93): pressKey and the
   * adapter's consume query both run through it, so the clump of facts a
   * key depends on is assembled exactly once, reader-side — the adapter
   * never rebuilds it from the view model.
   */
  private dispatch(event: ReaderKeyEvent): ReturnType<typeof translateKey> {
    return translateKey({
      conversation: {
        asking: this.asking,
        responding: this.conversation.isResponding(this.current),
        hasResponder: this.conversation.hasResponder
      },
      suggestions: this.tour.steps[this.current]?.questions ?? [],
      currentStep: this.current,
      stepCount: this.tour.steps.length,
      pageRows: Math.max(1, this.stepViewportRows)
    }, event);
  }

  resize(columns: number, rows: number): ReaderViewModel {
    if (this.finished) return this.getState();
    const nextLayout = terminalLayout(Math.floor(columns));
    const nextRows = Math.floor(rows);
    // The adapter debounces resize events; an unchanged geometry would only
    // churn repaints and lose the scroll offset.
    if (nextLayout.columns === this.layout.columns && nextRows === this.terminalRows) {
      return this.getState();
    }
    const scrollTop = this.stepScrollTop;
    this.layout = nextLayout;
    this.terminalRows = nextRows;
    // The re-render stamps the next version; its commit restores the saved
    // offset, clamped against the extents the adapter reports after painting
    // the new geometry.
    this.pendingScrollRestore = { request: this.version + 1, scrollTop };
    void this.render();
    this.notify();
    return this.getState();
  }

  toggleVoice(): ReaderViewModel {
    // The policy owns the voice decision; the reader supplies the Step facts
    // it keeps: the displayed Step, the navigation target and the
    // displayed Step's description (ADR 0029).
    this.narration.toggleVoice(this.narrationStep());
    return this.getState();
  }

  async ask(question: string): Promise<void> {
    if (this.finished) return;
    const text = question.trim();
    if (!text) return;
    await this.conversation.ask(this.current, text);
    // The store reports every streaming update through its own callback;
    // the settled exchange (completed, failed or interrupted) is painted
    // here, exactly as the pre-#104 reader's settle path did.
    this.notify();
  }

  onExtentsMeasured(extents: ReaderExtents): void {
    this.stepViewportRows = extents.stepViewportRows;
    this.stepContentRows = extents.stepContentRows;
    this.clampScroll();
    if (extents.conversationViewportRows !== undefined) {
      this.conversationViewportRows = extents.conversationViewportRows;
    }
    if (extents.conversationContentRows !== undefined) {
      this.conversationContentRows = extents.conversationContentRows;
    }
    // The pinning policy (spec #93) is unconditional, exactly as the reader
    // always has: the freshly painted panel settles at its bottom against
    // its new extents, after every conversation paint and streaming delta.
    this.conversationScrollTop = Math.max(0, this.conversationContentRows - this.conversationViewportRows);
  }

  close(): Promise<void> {
    // One disposal promise for every caller: the adapter may await the close
    // a quit keypress already started.
    if (this.closing) return this.closing;
    this.finished = true;
    // Any in-flight render drops itself against the bumped version.
    ++this.version;
    this.narration.dispose();
    this.closing = this.conversation.dispose();
    return this.closing;
  }

  private applyAction(action: ReturnType<typeof translateKey>): void {
    if (this.finished) return;
    switch (action.type) {
      case "quit":
        void this.close();
        break;
      case "stop-answer":
        // `q`/Escape during a streaming answer interrupt it; only a second
        // press quits the reader (ADR 0031).
        this.conversation.stop(this.current);
        break;
      case "navigate":
        this.navigateTo(action.step);
        break;
      case "scroll":
        this.scrollBy(action.delta);
        break;
      case "toggle-voice":
        this.toggleVoice();
        break;
      case "enter-ask-mode":
        this.asking = true;
        this.draft = "";
        break;
      case "draft-append":
        this.draft += action.text;
        break;
      case "draft-backspace":
        this.draft = this.draft.slice(0, -1);
        break;
      case "cancel-draft":
        this.asking = false;
        this.draft = "";
        break;
      case "submit-draft": {
        const question = this.draft.trim();
        this.asking = false;
        this.draft = "";
        if (question) void this.ask(question);
        break;
      }
      case "ask-suggestion":
        void this.ask(action.question);
        break;
      default:
        break;
    }
  }

  /** The Step-box scroller moves by rows, one page being one screenful (ADR 0025). */
  private scrollBy(delta: number): void {
    this.stepScrollTop += delta;
    this.clampScroll();
  }

  private clampScroll(): void {
    const max = Math.max(0, this.stepContentRows - this.stepViewportRows);
    this.stepScrollTop = Math.min(Math.max(0, this.stepScrollTop), max);
  }

  /**
   * The versioned render (spec #93): navigation targets are synchronous,
   * displays are commits. A render superseded by a newer navigation paints
   * nothing and narrates nothing; a failed render keeps the previous
   * screen state in the view model so the adapter can repaint it and print
   * the diagnostic after the restore (ADR 0025).
   */
  private render(): Promise<void> {
    if (this.finished) return Promise.resolve();
    const step = this.tour.steps[this.current];
    if (!step) {
      // The defensive empty path: a Tour without a Step for the current
      // index shows the frozen no-steps message — the exact text of the
      // open path, the reader's visual contract (ADR 0025) — and changes
      // nothing else. It is fully synchronous — nothing is ever in flight.
      const request = ++this.version;
      this.painted.emptyMessage = "Tour has no steps. Press q to quit.";
      // A resize render still restores its scroll offset on this path.
      this.settleScroll(request, false);
      return Promise.resolve();
    }
    const request = ++this.version;
    this.inFlight++;
    return this.renderBody(request, step).finally(() => {
      this.inFlight--;
    });
  }

  private async renderBody(request: number, step: CodeTourStep): Promise<void> {
    try {
      const descriptionHtml = await this.descriptionRenderer(
        this.tour, this.current, this.layout.textWidth
      );
      if (this.finished || request !== this.version) return;
      const context = this.resolveStepContext(this.root, this.tour, step);
      // A diff Step must show its diff: fail fast on the reached Step,
      // never prevalidate future Steps.
      if (step.display === "diff" && context.kind !== "diff") {
        throw new TerminalStepRenderError(this.tour, this.current, "Git diff",
          "persisted base/head snapshot or file comparison unavailable");
      }
      const anchor = step.file || step.uri || step.directory || step.view || "";
      const target = anchor ? anchor + (step.line ? ":" + step.line : "") : "";
      this.painted = {
        tourTitle: this.tour.title,
        stepCount: { index: this.current, count: this.tour.steps.length },
        emptyMessage: undefined,
        // The anchor travels structured: the target the adapter paints and
        // the diff flag whose " · diff" suffix the adapter derives when
        // painting — the view model never carries painted text (spec #93).
        anchor: { target, diff: context.kind === "diff" },
        stepTitle: step.title || "Step " + (this.current + 1),
        descriptionHtml,
        source: this.sourceSection(context)
      };
      // The scroller is the Step box: every Step paints from the top, unless
      // this is the resize render that owns a scroll restoration (ADR 0025).
      this.settleScroll(request, true);
      // Only now is the Step displayed — the commit point the narration
      // policy and every displayed-Step query key off (ADR 0029). The render
      // path itself never starts the voice: only a pending navigation want
      // settles here, so a re-render never restarts narration.
      this.displayedStep = this.current;
      this.narration.onRenderCommitted(this.narrationStep());
    } catch (error) {
      await this.fatal(error);
    }
    this.notify();
  }

  /**
   * The scroll policy of one committed render: a resize render restores the
   * offset its request saved, any other render paints from the top, and a
   * superseded render leaves the offset alone (it never settles here).
   */
  private settleScroll(request: number, resetToTop: boolean): void {
    const restore = this.pendingScrollRestore;
    this.pendingScrollRestore = undefined;
    if (restore && restore.request === request) {
      this.stepScrollTop = restore.scrollTop;
    } else if (resetToTop) {
      this.stepScrollTop = 0;
    }
    this.clampScroll();
  }

  /**
   * A failed render ends the session: the view model keeps the previous
   * screen state — nothing the failed render computed is painted — and the
   * adapter restores the screen, repaints it, then prints the diagnostic.
   */
  private async fatal(error: unknown): Promise<void> {
    this.fatalValue = {
      message: error instanceof Error ? error.message : String(error),
      // The typed error's identity crosses the DOM-free boundary as its
      // name; the message stays verbatim for display (spec #93).
      name: error instanceof Error ? error.name : "Error"
    };
    await this.close();
  }

  private sourceSection(context: ReadonlyStepContext): ReaderSourceSection | undefined {
    if (context.kind !== "code" && context.kind !== "diff" && context.kind !== "unavailable") {
      return undefined;
    }
    const content = context.kind === "unavailable"
      ? context.diagnostic || "Target unavailable"
      : context.text || "";
    return {
      kind: context.kind,
      // A diff label carries the base/head parenthetical; the head names
      // the file and the refs are already the diff's first rows.
      label: (context.label || "Source context").replace(/ \([^)]*\)$/, ""),
      tag: context.kind === "unavailable" ? "n/a" : context.kind,
      lines: content.split("\n")
    };
  }

  /**
   * The Step facts the narration policy decides on (ADR 0029): the displayed
   * Step, the navigation target and the displayed Step's description.
   */
  private narrationStep(): NarrationStep {
    return {
      displayedStep: this.displayedStep,
      currentStep: this.current,
      description: this.tour.steps[this.displayedStep]?.description ?? ""
    };
  }

  private composer(conversation: ConversationState, suggestions: string[]): ReaderComposer {
    // The prompt and hint orders mirror the composer the reader paints today.
    const { asking, responding, hasResponder } = conversation;
    const mode = asking
      ? "asking"
      : !hasResponder
        ? "unavailable"
        : responding
          ? "responding"
          : "idle";
    // The asking mode paints the draft with its caret; the caret and its
    // truncation are the adapter's, so the view model carries the notices
    // of every other mode and no painted prompt text (spec #93).
    const prompt = asking
      ? ""
      : !hasResponder
        ? "no ACP agent"
        : responding
          ? "answering…"
          : "ask about this step…";
    const hint = asking
      ? "question for this step"
      : responding
        ? "answer streaming · q stop"
        : !hasResponder
          ? "no agent on PATH"
          : suggestions.length
            ? "a ask · 1-" + Math.min(4, suggestions.length) + " suggestion"
            : "a ask";
    return { mode, draft: this.draft, hint, prompt };
  }

  /** The rail window around the displayed Step; empty until one is displayed. */
  private railWindow(): ReaderRailWindow {
    if (this.displayedStep < 0 || !this.tour.steps.length) {
      return { items: [], before: false, after: false };
    }
    const capacity = Math.max(1, this.terminalRows - RAIL_CHROME_ROWS);
    const window = railWindow(this.tour.steps.length, this.displayedStep, capacity);
    const items: ReaderRailItem[] = [];
    for (let index = window.start; index < window.end; index++) {
      items.push({
        index,
        title: this.tour.steps[index].title || "Step " + (index + 1),
        active: index === this.displayedStep
      });
    }
    return { items, before: window.before, after: window.after };
  }
}

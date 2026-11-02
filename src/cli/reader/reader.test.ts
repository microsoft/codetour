import * as assert from "node:assert/strict";
import { test } from "node:test";
import type { CodeTour, CodeTourStep } from "../../store";
import type { StepChatAnswerEvents, StepChatRequest } from "../../agent/stepChatContract";
import type { ConversationResponder, CommitFileReader, DescriptionRenderer, SpeechEngine, StepContextResolver } from "./collaborators";
import { createReader, type TourReader } from "./reader";
import type { ReaderViewModel } from "./viewModel";

/**
 * The reading interface of the terminal Tour reader (spec #93). Every test
 * drives the interface in-process and asserts on the view model only: no
 * PTY, no VT bytes, no DOM — the collaborators (speech engine, conversation
 * responder, description renderer, Step context resolver) are fakes at the
 * module boundary, the same determinism the NarrationController tests
 * achieve with a fake engine.
 */

const flush = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

function tourWith(steps: CodeTourStep[], tour: Partial<CodeTour> = {}): CodeTour {
  return { id: "reader-test", title: "Reader", steps, ...tour };
}

/**
 * A scripted speech engine: the test decides when each utterance settles.
 * Nothing in these tests relies on audible output or a speech subprocess.
 */
class FakeSpeechEngine implements SpeechEngine {
  readonly spoken: string[] = [];
  cancellations = 0;
  disposed = false;

  speak(text: string): Promise<void> {
    this.spoken.push(text);
    return Promise.resolve();
  }

  cancel(): void {
    this.cancellations++;
  }

  dispose(): void {
    this.disposed = true;
  }
}

/**
 * A description renderer the test controls: each Step's render stays pending
 * until the test resolves or fails it, so render supersession under rapid
 * navigation is deterministic without timing tricks.
 */
class FakeDescriptionRenderer {
  /** One pending render per started request, in start order. */
  private readonly pending: Array<{
    index: number;
    resolve: (html: string) => void;
    reject: (error: unknown) => void;
  }> = [];
  readonly requested: Array<{ index: number; width: number }> = [];

  readonly render: DescriptionRenderer = (_tour, index, width) => {
    this.requested.push({ index, width });
    return new Promise<string>((resolve, reject) => {
      this.pending.push({ index, resolve, reject });
    });
  };

  private oldest(index: number) {
    return this.pending.find(entry => entry.index === index);
  }

  /** Commit the oldest pending render of one Step. */
  commit(index: number, html: string): void {
    const entry = this.oldest(index);
    assert.ok(entry, "no pending render for step " + index);
    this.pending.splice(this.pending.indexOf(entry), 1);
    entry.resolve(html);
  }

  /** Fail the oldest pending render of one Step. */
  fail(index: number, error: unknown): void {
    const entry = this.oldest(index);
    assert.ok(entry, "no pending render for step " + index);
    this.pending.splice(this.pending.indexOf(entry), 1);
    entry.reject(error);
  }
}

/** A conversation responder the test scripts; no ACP agent process is started. */
class FakeResponder implements ConversationResponder {
  readonly providerName = "Fake";
  readonly requests: StepChatRequest[] = [];
  disposed = false;
  /** The answer the next question resolves with; the test can override it. */
  nextAnswer: (request: StepChatRequest, events?: StepChatAnswerEvents) => Promise<string> =
    async () => "Fake answer";

  answer(request: StepChatRequest, events?: StepChatAnswerEvents): Promise<string> {
    this.requests.push(request);
    return this.nextAnswer(request, events);
  }

  cancellations = 0;
  cancel(): void {
    this.cancellations++;
  }

  dispose(): void {
    this.disposed = true;
  }
}

interface Harness {
  reader: TourReader;
  speech: FakeSpeechEngine;
  descriptions: FakeDescriptionRenderer;
  responder: FakeResponder | undefined;
}

/**
 * A reader wired entirely to fakes: the Step context resolver returns a
 * plain "none" context unless a test overrides it, so no Git command and no
 * file read ever runs in this suite.
 */
function harness(
  steps: CodeTourStep[],
  options: {
    responder?: FakeResponder;
    context?: StepContextResolver;
    columns?: number;
    rows?: number;
    readCommitFile?: CommitFileReader;
    tour?: Partial<CodeTour>;
  } = {}
): Harness {
  const speech = new FakeSpeechEngine();
  const descriptions = new FakeDescriptionRenderer();
  const reader = createReader({
    tour: tourWith(steps, options.tour),
    root: "/workspace",
    speechEngine: speech,
    descriptionRenderer: descriptions.render,
    resolveStepContext: options.context ?? (() => ({ kind: "none" })),
    responder: options.responder,
    readCommitFile: options.readCommitFile,
    columns: options.columns,
    rows: options.rows
  });
  return { reader, speech, descriptions, responder: options.responder };
}

test("an empty Tour opens on the no-steps message and stays interactive", async () => {
  const { reader } = harness([]);
  await reader.open();
  const state = reader.getState();
  assert.equal(state.currentStep, 0);
  assert.equal(state.displayedStep, -1);
  assert.equal(state.rendering, false);
  assert.equal(state.finished, false);
  assert.equal(state.tourTitle, "Reader");
  assert.equal(state.stepCount, "step 0/0");
  assert.equal(state.emptyMessage, "Tour has no steps. Press q to quit.");
  assert.equal(state.stepTitle, "");
  assert.equal(state.descriptionHtml, "");
  assert.deepEqual(state.rail.items, []);
});

test("the empty Tour conversation panel reports the no-agent state for step 0", async () => {
  const { reader } = harness([]);
  await reader.open();
  const state = reader.getState();
  assert.equal(state.conversation.title, "conversation");
  assert.equal(state.conversation.meta, "no agent");
  assert.equal(state.conversation.hasResponder, false);
  assert.deepEqual(state.conversation.suggestions, []);
  assert.deepEqual(state.conversation.exchanges, []);
  assert.equal(state.conversation.responding, false);
  assert.equal(state.composer.mode, "unavailable");
  assert.equal(state.composer.prompt, "no ACP agent");
  assert.equal(state.composer.hint, "no agent on PATH");
});

test("opening a Tour renders the first Step and commits the painted reading state", async () => {
  const { reader, descriptions } = harness([
    { title: "First", description: "Hello", file: "src/a.ts", line: 12 },
    { title: "Second", description: "World" }
  ]);
  const opening = reader.open();
  // The description render is in flight: the target is set, nothing is displayed yet.
  assert.equal(reader.getState().currentStep, 0);
  assert.equal(reader.getState().displayedStep, -1);
  assert.equal(reader.getState().rendering, true);
  // The description renders at the layout's text width (80 columns → 38 cells).
  assert.deepEqual(descriptions.requested, [{ index: 0, width: 38 }]);
  descriptions.commit(0, "<p>rendered first</p>");
  await opening;
  const state = reader.getState();
  assert.equal(state.displayedStep, 0);
  assert.equal(state.rendering, false);
  assert.equal(state.tourTitle, "Reader");
  assert.equal(state.stepCount, "step 1/2");
  assert.equal(state.stepTitle, "First");
  assert.equal(state.descriptionHtml, "<p>rendered first</p>");
  assert.equal(state.anchorText, "src/a.ts:12");
  assert.equal(state.emptyMessage, undefined);
});

test("a Step without a title falls back to its number and its anchor keeps the diff suffix", async () => {
  const { reader, descriptions } = harness(
    [{ description: "Hello", uri: "https://example.test/doc" }],
    { context: () => ({ kind: "diff", label: "src/a.ts (base ↔ head)", text: "+added" }) }
  );
  const opening = reader.open();
  descriptions.commit(0, "<p>rendered</p>");
  await opening;
  const state = reader.getState();
  assert.equal(state.stepTitle, "Step 1");
  // The anchor keeps its path whole; the diff suffix is the reader's to add.
  assert.equal(state.anchorText, "https://example.test/doc · diff");
});

test("a code Step context becomes the source section with its label stripped", async () => {
  const { reader, descriptions } = harness([{ description: "Hello", file: "src/a.ts" }], {
    context: () => ({ kind: "code", label: "src/a.ts (irrelevant)", text: "one\ntwo" })
  });
  const opening = reader.open();
  descriptions.commit(0, "<p>rendered</p>");
  await opening;
  const source = reader.getState().source;
  assert.ok(source);
  assert.equal(source.kind, "code");
  assert.equal(source.label, "src/a.ts");
  assert.equal(source.tag, "code");
  assert.deepEqual(source.lines, ["one", "two"]);
});

test("an unreadable Step target becomes an n/a source section with its diagnostic", async () => {
  const { reader, descriptions } = harness([{ description: "Hello", file: "gone.ts" }], {
    context: () => ({ kind: "unavailable", label: "gone.ts", diagnostic: "File unavailable: gone" })
  });
  const opening = reader.open();
  descriptions.commit(0, "<p>rendered</p>");
  await opening;
  const source = reader.getState().source;
  assert.ok(source);
  assert.equal(source.kind, "unavailable");
  assert.equal(source.label, "gone.ts");
  assert.equal(source.tag, "n/a");
  assert.deepEqual(source.lines, ["File unavailable: gone"]);
});

test("a Step without a target context paints no source section", async () => {
  const { reader, descriptions } = harness([{ description: "Hello" }]);
  const opening = reader.open();
  descriptions.commit(0, "<p>rendered</p>");
  await opening;
  assert.equal(reader.getState().source, undefined);
});

test("navigation moves the target at the keypress and displays it when the render commits", async () => {
  const { reader, descriptions } = harness([
    { title: "First", description: "Hello" },
    { title: "Second", description: "World" }
  ]);
  const opening = reader.open();
  descriptions.commit(0, "<p>first</p>");
  await opening;

  const state = reader.navigateTo(1);
  // The target moves immediately; the display still shows the previous Step.
  assert.equal(state.currentStep, 1);
  assert.equal(state.displayedStep, 0);
  assert.equal(state.rendering, true);
  descriptions.commit(1, "<p>second</p>");
  await flush();
  const committed = reader.getState();
  assert.equal(committed.displayedStep, 1);
  assert.equal(committed.currentStep, 1);
  assert.equal(committed.stepCount, "step 2/2");
  assert.equal(committed.stepTitle, "Second");
  assert.equal(committed.rendering, false);

  reader.pressKey({ key: "ArrowLeft" });
  descriptions.commit(0, "<p>first again</p>");
  await flush();
  assert.equal(reader.getState().displayedStep, 0);
  assert.equal(reader.getState().stepTitle, "First");
});

test("navigation keys honor the first and last Step boundaries", async () => {
  const { reader, descriptions } = harness([
    { title: "First", description: "Hello" },
    { title: "Second", description: "World" }
  ]);
  const opening = reader.open();
  descriptions.commit(0, "<p>first</p>");
  await opening;

  // Before the first Step, left does nothing.
  reader.pressKey({ key: "ArrowLeft" });
  reader.pressKey({ key: "p" });
  assert.equal(reader.getState().currentStep, 0);

  reader.pressKey({ key: "n" });
  descriptions.commit(1, "<p>second</p>");
  await flush();
  assert.equal(reader.getState().currentStep, 1);

  // At the last Step, right does nothing.
  reader.pressKey({ key: "ArrowRight" });
  reader.pressKey({ key: "n" });
  assert.equal(reader.getState().currentStep, 1);
  assert.equal(reader.getState().rendering, false);

  // An unrelated key changes nothing.
  reader.pressKey({ key: "x" });
  assert.equal(reader.getState().currentStep, 1);
  assert.equal(reader.getState().displayedStep, 1);
});

test("navigateTo ignores steps outside the Tour", async () => {
  const { reader, descriptions } = harness([{ title: "Only", description: "Hello" }]);
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;
  reader.navigateTo(5);
  reader.navigateTo(-1);
  const state = reader.getState();
  assert.equal(state.currentStep, 0);
  assert.equal(state.rendering, false);
});

test("the rail window keeps the displayed Step visible with its markers", async () => {
  const steps = Array.from({ length: 10 }, (_, index) => ({ title: "Step " + index, description: "d" }));
  const { reader, descriptions } = harness(steps, { columns: 120, rows: 10 });
  const opening = reader.open();
  // A resize-free harness: navigate to the middle Step and commit it.
  descriptions.commit(0, "<p>0</p>");
  await opening;
  reader.navigateTo(5);
  descriptions.commit(5, "<p>5</p>");
  await flush();
  const state = reader.getState();
  assert.equal(state.railVisible, true);
  // 10 rows minus 6 chrome rows = a 4-row rail: 2 items plus the two markers.
  assert.deepEqual(state.rail.items.map(item => item.index), [4, 5]);
  assert.equal(state.rail.items[1].active, true);
  assert.equal(state.rail.items[1].title, "Step 5");
  assert.equal(state.rail.before, true);
  assert.equal(state.rail.after, true);
});

test("the rail stays hidden below the width where it stops paying for itself", async () => {
  const { reader, descriptions } = harness([{ title: "Only", description: "Hello" }], { columns: 80 });
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;
  assert.equal(reader.getState().railVisible, false);
});

test("a superseded render changes nothing while a newer navigation is in flight", async () => {
  const { reader, descriptions } = harness([
    { title: "First", description: "Hello" },
    { title: "Second", description: "World" },
    { title: "Third", description: "!" }
  ]);
  const opening = reader.open();
  descriptions.commit(0, "<p>first</p>");
  await opening;

  // Two rapid navigations while the description renders are still pending.
  reader.navigateTo(1);
  reader.navigateTo(2);
  assert.equal(reader.getState().currentStep, 2);

  // The first render settles: superseded, it paints nothing.
  descriptions.commit(1, "<p>second</p>");
  await flush();
  const superseded = reader.getState();
  assert.equal(superseded.displayedStep, 0);
  assert.equal(superseded.stepTitle, "First");
  assert.equal(superseded.descriptionHtml, "<p>first</p>");
  assert.equal(superseded.rendering, true);

  descriptions.commit(2, "<p>third</p>");
  await flush();
  const committed = reader.getState();
  assert.equal(committed.displayedStep, 2);
  assert.equal(committed.stepTitle, "Third");
  assert.equal(committed.rendering, false);
});

test("rapid key navigation superscedes in-flight renders the same way", async () => {
  const { reader, descriptions } = harness([
    { title: "First", description: "Hello" },
    { title: "Second", description: "World" },
    { title: "Third", description: "!" }
  ]);
  const opening = reader.open();
  descriptions.commit(0, "<p>first</p>");
  await opening;
  reader.pressKey({ key: "ArrowRight" });
  reader.pressKey({ key: "n" });
  assert.equal(reader.getState().currentStep, 2);
  descriptions.commit(1, "<p>second</p>");
  descriptions.commit(2, "<p>third</p>");
  await flush();
  const state = reader.getState();
  assert.equal(state.displayedStep, 2);
  assert.equal(state.stepTitle, "Third");
});

test("a failed Step render keeps the previous screen state and reports the diagnostic", async () => {
  const { reader, descriptions, speech } = harness([
    { title: "First", description: "Hello" },
    { title: "Second", description: "World" }
  ]);
  const opening = reader.open();
  descriptions.commit(0, "<p>first</p>");
  await opening;

  reader.navigateTo(1);
  descriptions.fail(1, new Error("render exploded"));
  await flush();
  const state = reader.getState();
  // The previous screen state is restored in the view model: the adapter
  // repaints it after the alternate-screen restore, then prints the
  // diagnostic (ADR 0025).
  assert.equal(state.displayedStep, 0);
  assert.equal(state.stepTitle, "First");
  assert.equal(state.descriptionHtml, "<p>first</p>");
  assert.equal(state.stepCount, "step 1/2");
  assert.equal(state.fatal?.message, "render exploded");
  assert.equal(state.finished, true);
  assert.equal(state.rendering, false);
  assert.equal(speech.disposed, true);

  // The session is over: every further input is ignored.
  reader.pressKey({ key: "ArrowRight" });
  reader.navigateTo(0);
  assert.equal(reader.getState().currentStep, 1);
});

test("a failed initial render reports the diagnostic with nothing displayed", async () => {
  const { reader, descriptions } = harness([{ title: "Only", description: "Hello" }]);
  const opening = reader.open();
  descriptions.fail(0, new Error("no renderer"));
  await opening;
  const state = reader.getState();
  assert.equal(state.displayedStep, -1);
  assert.equal(state.stepTitle, "");
  assert.equal(state.fatal?.message, "no renderer");
  assert.equal(state.finished, true);
});

test("a diff Step without a resolved diff fails the render with the terminal error", async () => {
  const { reader, descriptions } = harness(
    [
      { title: "First", description: "Hello" },
      { description: "Comparison", display: "diff", file: "src/a.ts" }
    ],
    { context: () => ({ kind: "none" }) }
  );
  const opening = reader.open();
  descriptions.commit(0, "<p>first</p>");
  await opening;
  reader.navigateTo(1);
  descriptions.commit(1, "<p>comparison</p>");
  await flush();
  assert.equal(
    reader.getState().fatal?.message,
    "CodeTour terminal stopped: Tour 'Reader', step 2 ('Untitled'), Git diff: " +
      "persisted base/head snapshot or file comparison unavailable"
  );
});

test("pressing q closes the session and releases the collaborators", async () => {
  const { reader, descriptions, speech, responder } = harness(
    [{ title: "Only", description: "Hello" }],
    { responder: new FakeResponder() }
  );
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;
  reader.pressKey({ key: "q" });
  await flush();
  const state = reader.getState();
  assert.equal(state.finished, true);
  assert.equal(speech.disposed, true);
  assert.ok(responder?.disposed);
});

test("scroll keys move the Step-box offset and clamp against the reported extents", async () => {
  const { reader, descriptions } = harness([{ title: "Only", description: "Hello" }]);
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;
  // The adapter reports its measured extents: 3 viewport rows of 10 content rows.
  reader.onExtentsMeasured({ stepViewportRows: 3, stepContentRows: 10 });

  reader.pressKey({ key: "j" });
  reader.pressKey({ key: "ArrowDown" });
  assert.equal(reader.getState().scroll.stepScrollTop, 2);
  reader.pressKey({ key: "k" });
  assert.equal(reader.getState().scroll.stepScrollTop, 1);

  // A page is one screenful of the Step box (ADR 0025).
  reader.pressKey({ key: "PageDown" });
  assert.equal(reader.getState().scroll.stepScrollTop, 4);
  reader.pressKey({ key: "PageUp" });
  assert.equal(reader.getState().scroll.stepScrollTop, 1);
  reader.pressKey({ key: " " });
  assert.equal(reader.getState().scroll.stepScrollTop, 4);

  // Scrolling past either end clamps: the bottom is content - viewport rows.
  for (let i = 0; i < 10; i++) reader.pressKey({ key: "PageDown" });
  assert.equal(reader.getState().scroll.stepScrollTop, 7);
  for (let i = 0; i < 10; i++) reader.pressKey({ key: "PageUp" });
  assert.equal(reader.getState().scroll.stepScrollTop, 0);
});

test("a Step change paints the Step box from the top again", async () => {
  const { reader, descriptions } = harness([
    { title: "First", description: "Hello" },
    { title: "Second", description: "World" }
  ]);
  const opening = reader.open();
  descriptions.commit(0, "<p>first</p>");
  await opening;
  reader.onExtentsMeasured({ stepViewportRows: 3, stepContentRows: 30 });
  reader.pressKey({ key: "PageDown" });
  assert.equal(reader.getState().scroll.stepScrollTop, 3);
  reader.navigateTo(1);
  descriptions.commit(1, "<p>second</p>");
  await flush();
  assert.equal(reader.getState().scroll.stepScrollTop, 0);
});

test("newly reported extents clamp the current offset", async () => {
  const { reader, descriptions } = harness([{ title: "Only", description: "Hello" }]);
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;
  reader.onExtentsMeasured({ stepViewportRows: 3, stepContentRows: 30 });
  reader.pressKey({ key: "PageDown" });
  reader.pressKey({ key: "PageDown" });
  assert.equal(reader.getState().scroll.stepScrollTop, 6);
  // The adapter paints a shorter Step and reports smaller extents.
  reader.onExtentsMeasured({ stepViewportRows: 3, stepContentRows: 5 });
  assert.equal(reader.getState().scroll.stepScrollTop, 2);
});

test("a resize re-renders at the new geometry and restores the clamped scroll offset", async () => {
  const { reader, descriptions } = harness([{ title: "Only", description: "Hello" }]);
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;
  reader.onExtentsMeasured({ stepViewportRows: 3, stepContentRows: 30 });
  reader.pressKey({ key: "PageDown" });
  reader.pressKey({ key: "PageDown" });
  assert.equal(reader.getState().scroll.stepScrollTop, 6);

  reader.resize(120, 24);
  // The re-render is in flight at the new layout's text width (120 columns → 44 cells).
  assert.equal(reader.getState().rendering, true);
  assert.equal(reader.getState().layout.columns, 120);
  assert.equal(descriptions.requested[descriptions.requested.length - 1].width, 44);
  descriptions.commit(0, "<p>only, wider</p>");
  await flush();
  // The adapter paints the new geometry and reports its extents; the saved
  // offset comes back, clamped to the new content height.
  reader.onExtentsMeasured({ stepViewportRows: 4, stepContentRows: 12 });
  const state = reader.getState();
  assert.equal(state.displayedStep, 0);
  assert.equal(state.descriptionHtml, "<p>only, wider</p>");
  assert.equal(state.scroll.stepScrollTop, 6);
  reader.onExtentsMeasured({ stepViewportRows: 10, stepContentRows: 12 });
  assert.equal(reader.getState().scroll.stepScrollTop, 2);
});

test("a resize to the same geometry repaints nothing", async () => {
  const { reader, descriptions } = harness([{ title: "Only", description: "Hello" }]);
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;
  const requests = descriptions.requested.length;
  reader.onExtentsMeasured({ stepViewportRows: 3, stepContentRows: 30 });
  reader.pressKey({ key: "PageDown" });
  reader.resize(80, 24);
  const state = reader.getState();
  assert.equal(state.rendering, false);
  assert.equal(descriptions.requested.length, requests);
  assert.equal(state.scroll.stepScrollTop, 3);
});

test("a navigation superseding a resize render wins the scroll policy", async () => {
  const { reader, descriptions } = harness([
    { title: "First", description: "Hello" },
    { title: "Second", description: "World" }
  ]);
  const opening = reader.open();
  descriptions.commit(0, "<p>first</p>");
  await opening;
  reader.onExtentsMeasured({ stepViewportRows: 3, stepContentRows: 30 });
  reader.pressKey({ key: "PageDown" });
  reader.resize(120, 24);
  // Before the resize render commits, the reader navigates: its render is
  // the newer one and paints from the top.
  reader.pressKey({ key: "ArrowRight" });
  descriptions.commit(0, "<p>first, wider</p>");
  descriptions.commit(1, "<p>second</p>");
  await flush();
  reader.onExtentsMeasured({ stepViewportRows: 10, stepContentRows: 30 });
  const state = reader.getState();
  assert.equal(state.displayedStep, 1);
  assert.equal(state.scroll.stepScrollTop, 0);
});

test("the status line reports the reading mode and its key hints", async () => {
  const { reader, descriptions } = harness([{ title: "Only", description: "Hello" }]);
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;
  // 80 columns: the compact hints.
  assert.equal(reader.getState().status.mode, "READ");
  assert.equal(reader.getState().status.hints, " ←/→ step · j/k scroll · q quit");
});

test("a wide terminal spells the hints out and an agent adds the ask hint", async () => {
  const { reader, descriptions } = harness([{ title: "Only", description: "Hello" }], {
    columns: 130,
    responder: new FakeResponder()
  });
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;
  const status = reader.getState().status;
  assert.equal(status.mode, "READ");
  assert.equal(status.hints, " ←/→ previous/next · j/k scroll · PgUp/PgDn page · a ask · q quit");
  // The right segments: the voice state first, then the provider.
  assert.deepEqual(status.rightSegments, ["VOICE OFF", "fake"]);
});

test("the voice state leads the right segments and no agent paints only it", async () => {
  const { reader, descriptions } = harness([{ title: "Only", description: "Hello" }]);
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;
  assert.deepEqual(reader.getState().status.rightSegments, ["VOICE OFF"]);
});

test("a single unmodified v toggles the voice; modified combos pass through", async () => {
  const { reader, descriptions, speech } = harness([{ title: "Only", description: "Hello" }]);
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;

  reader.pressKey({ key: "v" });
  let state = reader.getState();
  assert.equal(state.narration.enabled, true);
  assert.deepEqual(state.status.rightSegments, ["VOICE ON"]);

  // Ctrl+V, Cmd+V and Alt+V are not the narration shortcut (spec #79).
  reader.pressKey({ key: "v", ctrl: true });
  reader.pressKey({ key: "V", meta: true });
  reader.pressKey({ key: "v", alt: true });
  assert.equal(reader.getState().narration.enabled, true);

  reader.pressKey({ key: "V" });
  state = reader.getState();
  assert.equal(state.narration.enabled, false);
  // Two cuts: the handed utterance cancels first, then turning the voice
  // off cuts the speech (ADR 0029) — the engine cancels before every speak.
  assert.equal(speech.cancellations, 2);
  assert.deepEqual(state.status.rightSegments, ["VOICE OFF"]);
});

test("'a' enters ask mode only with an agent installed and no answer streaming", async () => {
  const bare = harness([{ title: "Only", description: "Hello" }]);
  const bareOpening = bare.reader.open();
  bare.descriptions.commit(0, "<p>only</p>");
  await bareOpening;
  // Without an agent the ask key falls through unhandled.
  bare.reader.pressKey({ key: "a" });
  assert.equal(bare.reader.getState().composer.mode, "unavailable");

  const withAgent = harness([{ title: "Only", description: "Hello" }], {
    responder: new FakeResponder()
  });
  const opening = withAgent.reader.open();
  withAgent.descriptions.commit(0, "<p>only</p>");
  await opening;
  withAgent.reader.pressKey({ key: "a" });
  const state = withAgent.reader.getState();
  assert.equal(state.composer.mode, "asking");
  assert.equal(state.composer.draft, "");
  assert.equal(state.composer.prompt, "▌");
  assert.equal(state.composer.hint, "question for this step");
  assert.equal(state.status.mode, "ASK");
  assert.equal(state.status.hints, " enter send · esc cancel");
});

test("the ask prompt owns the keyboard: every printable key stays draft text", async () => {
  const { reader, descriptions } = harness([{ title: "Only", description: "Hello" }], {
    responder: new FakeResponder()
  });
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;

  reader.pressKey({ key: "a" });
  // A "v" typed in the prompt is text, not the voice toggle; "q" does not
  // quit; a digit is not a suggestion key while asking (spec #79).
  reader.pressKey({ key: "v" });
  reader.pressKey({ key: "q" });
  reader.pressKey({ key: "2" });
  reader.pressKey({ key: "ArrowRight" });
  let state = reader.getState();
  assert.equal(state.composer.draft, "vq2");
  assert.equal(state.composer.prompt, "vq2▌");
  assert.equal(state.narration.enabled, false);
  assert.equal(state.currentStep, 0);
  assert.equal(state.finished, false);

  reader.pressKey({ key: "Backspace" });
  state = reader.getState();
  assert.equal(state.composer.draft, "vq");
  assert.equal(state.status.mode, "ASK");

  // Escape cancels the draft and returns the keyboard to the reader.
  reader.pressKey({ key: "Escape" });
  state = reader.getState();
  assert.equal(state.composer.mode, "idle");
  assert.equal(state.composer.draft, "");
  assert.equal(state.status.mode, "READ");
  assert.equal(state.conversation.exchanges.length, 0);
});

test("Enter submits the trimmed question, exits ask mode and dispatches it", async () => {
  const responder = new FakeResponder();
  const { reader, descriptions } = harness(
    [{ title: "Only", description: "Hello", file: "src/a.ts" }],
    { responder, context: () => ({ kind: "code", label: "src/a.ts", text: "line" }) }
  );
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;

  reader.pressKey({ key: "a" });
  reader.pressKey({ key: " " });
  reader.pressKey({ key: "w" });
  reader.pressKey({ key: "h" });
  reader.pressKey({ key: "y" });
  reader.pressKey({ key: " " });
  reader.pressKey({ key: "Enter" });

  const state = reader.getState();
  // Ask mode is exited and the answer is already in flight (WAIT mode).
  assert.equal(state.composer.mode, "responding");
  assert.equal(state.composer.draft, "");
  await flush();
  // The question reaches the agent once the grounding context resolves.
  assert.equal(responder.requests.length, 1);
  assert.equal(responder.requests[0].question, "why");
  // The question is grounded in the Step the reader sees (spec #93).
  assert.deepEqual(responder.requests[0].context, {
    available: true,
    path: "src/a.ts",
    code: "line",
    description: "Hello"
  });
  assert.equal(responder.requests[0].workspaceRoot, "/workspace");
  await flush();
  const done = reader.getState();
  assert.equal(done.composer.mode, "idle");
  assert.equal(done.conversation.exchanges.length, 1);
  assert.equal(done.conversation.exchanges[0].answer, "Fake answer");
});

test("suggestion keys ask the matching suggestion when it exists", async () => {
  const responder = new FakeResponder();
  const { reader, descriptions } = harness(
    [{ title: "Only", description: "Hello", questions: ["First question", "Second question"] }],
    { responder }
  );
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;

  // The composer hint announces the suggestion keys.
  assert.equal(reader.getState().composer.hint, "a ask · 1-2 suggestion");
  reader.pressKey({ key: "2" });
  await flush();
  assert.equal(responder.requests.length, 1);
  assert.equal(responder.requests[0].question, "Second question");

  // A digit without its suggestion falls through unhandled.
  reader.pressKey({ key: "3" });
  assert.equal(responder.requests.length, 1);
  assert.equal(reader.getState().currentStep, 0);
  await flush();
});

test("a question without an agent fails the exchange with the guidance", async () => {
  const { reader, descriptions } = harness([{ title: "Only", description: "Hello" }]);
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;
  await reader.ask("why?");
  const state = reader.getState();
  assert.equal(state.conversation.exchanges.length, 1);
  assert.deepEqual(state.conversation.exchanges[0], {
    question: "why?",
    answer: "This step's responder is not available. Tour reading stays usable.",
    activity: undefined,
    toolUses: [],
    pending: false,
    interrupted: false,
    failed: true
  });
  // The chat head still reports the no-agent state.
  assert.equal(state.conversation.meta, "no agent");
});

test("an answer streams into the exchange, reports activity and completes", async () => {
  const responder = new FakeResponder();
  responder.nextAnswer = async (_request, events) => {
    events?.onActivity?.("thinking");
    events?.onAnswerDelta?.("Hel");
    events?.onAnswerDelta?.("lo");
    return "Hello";
  };
  const { reader, descriptions } = harness([{ title: "Only", description: "Hello" }], {
    responder
  });
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;
  await reader.ask("why?");
  const state = reader.getState();
  assert.equal(state.conversation.responding, false);
  assert.equal(state.conversation.exchanges.length, 1);
  assert.equal(state.conversation.exchanges[0].pending, false);
  assert.equal(state.conversation.exchanges[0].answer, "Hello");
  assert.equal(state.conversation.exchanges[0].activity, "thinking");
  assert.deepEqual(state.conversation.exchanges[0].toolUses, []);
  assert.equal(state.conversation.meta, "1 exchange");
  // The status line gains the exchange count after the voice state and the provider.
  assert.deepEqual(state.status.rightSegments, ["VOICE OFF", "fake", "1 exchange"]);
});

test("a streaming answer paints WAIT mode and hides the ask hint", async () => {
  let release: (() => void) | undefined;
  const responder = new FakeResponder();
  responder.nextAnswer = () => new Promise<string>(resolve => {
    release = () => resolve("done");
  });
  const { reader, descriptions } = harness([{ title: "Only", description: "Hello" }], {
    responder
  });
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;
  const asking = reader.ask("why?");
  await flush();
  const state = reader.getState();
  assert.equal(state.status.mode, "WAIT");
  assert.equal(state.composer.mode, "responding");
  assert.equal(state.composer.prompt, "answering…");
  assert.equal(state.composer.hint, "answer streaming · q stop");
  assert.match(state.status.hints, /q stop/);
  assert.doesNotMatch(state.status.hints, /a ask/);
  assert.equal(state.conversation.responding, true);
  assert.ok(release);
  release!();
  await asking;
  const done = reader.getState();
  assert.equal(done.status.mode, "READ");
  assert.equal(done.composer.mode, "idle");
  assert.equal(done.conversation.responding, false);
});

test("one answer is in flight at a time", async () => {
  let release: (() => void) | undefined;
  const responder = new FakeResponder();
  responder.nextAnswer = () => new Promise<string>(resolve => {
    release = () => resolve("done");
  });
  const { reader, descriptions } = harness([{ title: "Only", description: "Hello" }], {
    responder
  });
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;
  const asking = reader.ask("first?");
  await flush();
  await reader.ask("second?");
  assert.equal(responder.requests.length, 1);
  // The ask key is blocked while an answer streams.
  reader.pressKey({ key: "a" });
  assert.equal(reader.getState().composer.mode, "responding");
  release!();
  await asking;
  assert.equal(reader.getState().conversation.responding, false);
});

test("q first interrupts a streaming answer, then quits once nothing is in flight", async () => {
  let release: (() => void) | undefined;
  const responder = new FakeResponder();
  responder.nextAnswer = () => new Promise<string>(resolve => {
    release = () => resolve("late completion");
  });
  const { reader, descriptions } = harness([{ title: "Only", description: "Hello" }], {
    responder
  });
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;
  const asking = reader.ask("why?");
  await flush();
  // While the answer streams, quitting would lose it: the same key first
  // interrupts the Step's answer in flight.
  reader.pressKey({ key: "q" });
  let state = reader.getState();
  assert.equal(state.finished, false);
  assert.equal(state.conversation.responding, false);
  assert.equal(responder.cancellations, 1);
  const stopped = state.conversation.exchanges[0];
  assert.equal(stopped.pending, false);
  assert.equal(stopped.interrupted, true);
  // The late completion of the cancelled answer is ignored.
  release!();
  await asking;
  state = reader.getState();
  assert.equal(state.conversation.exchanges[0].interrupted, true);
  assert.equal(state.conversation.exchanges[0].answer, "");
  // A second q, with nothing in flight, quits.
  reader.pressKey({ key: "q" });
  await flush();
  assert.equal(reader.getState().finished, true);
});

test("a failed answer fails the exchange and unlocks asking again", async () => {  const responder = new FakeResponder();
  responder.nextAnswer = async () => {
    throw new Error("agent went away");
  };
  const { reader, descriptions } = harness([{ title: "Only", description: "Hello" }], {
    responder
  });
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;
  await reader.ask("why?");
  const state = reader.getState();
  assert.equal(state.conversation.exchanges[0].failed, true);
  assert.equal(
    state.conversation.exchanges[0].answer,
    "The answer to this question failed (agent went away). Tour reading stays usable."
  );
  assert.equal(state.conversation.exchanges[0].pending, false);
  assert.equal(state.conversation.responding, false);
  // A retry is possible: the failed exchange is not history.
  responder.nextAnswer = async () => "Recovered";
  await reader.ask("again?");
  const after = reader.getState();
  assert.equal(after.conversation.exchanges.length, 2);
  assert.equal(after.conversation.exchanges[1].answer, "Recovered");
  assert.equal(responder.requests[1].history.length, 0);
});

test("the empty Tour reports the bare no-steps message when a resize re-renders it", async () => {
  const { reader, descriptions } = harness([]);
  await reader.open();
  assert.equal(reader.getState().emptyMessage, "Tour has no steps. Press q to quit.");
  reader.resize(100, 30);
  // The render's defensive empty path: the article shows the bare message
  // and the topbar keeps its startup "step 0/0" counter.
  const state = reader.getState();
  assert.equal(state.emptyMessage, "This Tour has no steps.");
  assert.equal(state.stepCount, "step 0/0");
  assert.equal(state.displayedStep, -1);
  assert.equal(state.rendering, false);
  assert.equal(descriptions.requested.length, 0);
});

test("the empty Tour ignores Step keys and quits on q", async () => {
  const { reader } = harness([]);
  await reader.open();
  reader.pressKey({ key: "ArrowRight" });
  reader.pressKey({ key: "n" });
  reader.pressKey({ key: "2" });
  reader.pressKey({ key: "a" });
  reader.pressKey({ key: "j" });
  const state = reader.getState();
  assert.equal(state.currentStep, 0);
  assert.equal(state.finished, false);
  assert.equal(state.scroll.stepScrollTop, 0);
  reader.pressKey({ key: "q" });
  await flush();
  assert.equal(reader.getState().finished, true);
});

test("a finished session ignores resize and further questions", async () => {
  const responder = new FakeResponder();
  const { reader, descriptions } = harness([{ title: "Only", description: "Hello" }], {
    responder
  });
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;
  reader.pressKey({ key: "q" });
  await flush();
  reader.resize(200, 40);
  await reader.ask("anyone there?");
  const state = reader.getState();
  assert.equal(state.finished, true);
  assert.equal(state.layout.columns, 80);
  assert.equal(responder.requests.length, 0);
});

test("an exchange is recorded under its own Step across navigation", async () => {
  const responder = new FakeResponder();
  let release: (() => void) | undefined;
  responder.nextAnswer = () => new Promise<string>(resolve => {
    release = () => resolve("answer");
  });
  const { reader, descriptions } = harness([
    { title: "First", description: "Hello" },
    { title: "Second", description: "World" }
  ], { responder });
  const opening = reader.open();
  descriptions.commit(0, "<p>first</p>");
  await opening;
  const asking = reader.ask("about the first?");
  await flush();
  // The reader navigates away while the answer streams.
  reader.navigateTo(1);
  descriptions.commit(1, "<p>second</p>");
  await flush();
  release!();
  await asking;
  // The new Step shows its own, empty conversation.
  let state = reader.getState();
  assert.equal(state.currentStep, 1);
  assert.equal(state.conversation.exchanges.length, 0);
  // The exchange stayed with the Step it was asked about.
  reader.navigateTo(0);
  descriptions.commit(0, "<p>first again</p>");
  await flush();
  state = reader.getState();
  assert.equal(state.conversation.exchanges.length, 1);
  assert.equal(state.conversation.exchanges[0].question, "about the first?");
  assert.equal(state.conversation.exchanges[0].answer, "answer");
});

test("the conversation panel pins to the bottom of the extents the adapter reports", async () => {
  const responder = new FakeResponder();
  const { reader, descriptions } = harness([{ title: "Only", description: "Hello" }], {
    responder
  });
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;
  // The adapter measures the panel after painting: 5 visible rows of 12.
  reader.onExtentsMeasured({
    stepViewportRows: 3, stepContentRows: 10,
    chatViewportRows: 5, chatContentRows: 12
  });
  const scroll = reader.getState().scroll;
  // The pinning policy is module state: the panel sits at its bottom, the
  // offset clamped against the reported extents (spec #93).
  assert.equal(scroll.chatPinned, true);
  assert.equal(scroll.chatScrollTop, 7);
  assert.equal(scroll.chatViewportRows, 5);
  assert.equal(scroll.chatContentRows, 12);

  // A panel shorter than its viewport clamps at the top: nothing to scroll.
  reader.onExtentsMeasured({
    stepViewportRows: 3, stepContentRows: 10,
    chatViewportRows: 8, chatContentRows: 3
  });
  assert.equal(reader.getState().scroll.chatScrollTop, 0);
});

test("the conversation panel keeps its scroll position while the reader walks the Step", async () => {
  const { reader, descriptions } = harness([
    { title: "First", description: "Hello" },
    { title: "Second", description: "World" }
  ]);
  const opening = reader.open();
  descriptions.commit(0, "<p>first</p>");
  await opening;
  reader.onExtentsMeasured({
    stepViewportRows: 3, stepContentRows: 10,
    chatViewportRows: 5, chatContentRows: 12
  });
  assert.equal(reader.getState().scroll.chatScrollTop, 7);

  // Walking the Step repaints the panel with the new Step's exchanges; the
  // offset is module state, not something the repaint resets to the top.
  reader.navigateTo(1);
  descriptions.commit(1, "<p>second</p>");
  await flush();
  assert.equal(reader.getState().scroll.chatScrollTop, 7);
  // The adapter measures the new Step's shorter panel; the pin settles
  // against the reported extents.
  reader.onExtentsMeasured({
    stepViewportRows: 3, stepContentRows: 10,
    chatViewportRows: 5, chatContentRows: 8
  });
  assert.equal(reader.getState().scroll.chatScrollTop, 3);
});

test("a question begins a pending exchange before the agent is contacted", async () => {
  let release: (() => void) | undefined;
  const responder = new FakeResponder();
  responder.nextAnswer = () => new Promise<string>(resolve => {
    release = () => resolve("done");
  });
  const { reader, descriptions } = harness([{ title: "Only", description: "Hello" }], {
    responder
  });
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;
  const asking = reader.ask("why?");
  await flush();
  // The pending exchange paints before the agent is contacted: the reader
  // sees its own question and an answer on the way.
  const exchange = reader.getState().conversation.exchanges[0];
  assert.deepEqual(exchange, {
    question: "why?",
    answer: "",
    activity: undefined,
    toolUses: [],
    pending: true,
    interrupted: false,
    failed: false
  });
  release!();
  await asking;
});

test("streaming deltas accumulate into the pending exchange and the panel follows", async () => {
  let release: (() => void) | undefined;
  const responder = new FakeResponder();
  responder.nextAnswer = (_request, events) => new Promise<string>(resolve => {
    events?.onAnswerDelta?.("Hel");
    events?.onAnswerDelta?.("lo");
    release = () => resolve("Hello");
  });
  const { reader, descriptions } = harness([{ title: "Only", description: "Hello" }], {
    responder
  });
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;
  reader.onExtentsMeasured({
    stepViewportRows: 3, stepContentRows: 10,
    chatViewportRows: 5, chatContentRows: 8
  });
  assert.equal(reader.getState().scroll.chatScrollTop, 3);
  const asking = reader.ask("why?");
  await flush();
  // The deltas streamed so far are the live answer of the pending exchange.
  const streaming = reader.getState();
  assert.equal(streaming.conversation.exchanges[0].pending, true);
  assert.equal(streaming.conversation.exchanges[0].answer, "Hello");
  // The adapter paints the grown answer and reports the panel's new
  // extents; the pin follows the new bottom.
  reader.onExtentsMeasured({
    stepViewportRows: 3, stepContentRows: 10,
    chatViewportRows: 5, chatContentRows: 15
  });
  assert.equal(reader.getState().scroll.chatScrollTop, 10);
  release!();
  await asking;
  const done = reader.getState();
  assert.equal(done.conversation.exchanges[0].pending, false);
  assert.equal(done.conversation.exchanges[0].answer, "Hello");
});

test("tool uses are keyed by call and the latest activity wins", async () => {
  const responder = new FakeResponder();
  responder.nextAnswer = async (_request, events) => {
    events?.onActivity?.("scanning files");
    events?.onToolUse?.({ toolCallId: "1", kind: "edit", title: "src/a.ts", forbidden: false });
    // The same call reported again with a new status is one use, updated
    // in place, not two.
    events?.onToolUse?.({ toolCallId: "1", kind: "edit", title: "src/a.ts", status: "completed", forbidden: false });
    events?.onToolUse?.({ toolCallId: "2", kind: "run", forbidden: true });
    return "done";
  };
  const { reader, descriptions } = harness([{ title: "Only", description: "Hello" }], {
    responder
  });
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;
  await reader.ask("why?");
  const exchange = reader.getState().conversation.exchanges[0];
  // Tool uses are keyed by call: a forbidden one keeps its kind alone, the
  // painters prefix it from the structured use, not a prebuilt label.
  assert.deepEqual(exchange.toolUses, [
    { toolCallId: "1", kind: "edit", title: "src/a.ts", status: "completed", forbidden: false },
    { toolCallId: "2", kind: "run", forbidden: true }
  ]);
  // The latest activity wins: the allowed tool call became the live line,
  // over the earlier plain activity message.
  assert.equal(exchange.activity, "src/a.ts (completed)");
});

test("a completed exchange becomes the history of the Step's next question", async () => {
  const responder = new FakeResponder();
  responder.nextAnswer = async () => "first answer";
  const { reader, descriptions } = harness([{ title: "Only", description: "Hello" }], {
    responder
  });
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;
  await reader.ask("first?");
  responder.nextAnswer = async () => "second answer";
  await reader.ask("second?");
  // Only completed, error-free, non-empty answers enter the history the
  // responder sees — the pending and failed exchanges never do.
  assert.deepEqual(responder.requests[0].history, []);
  assert.deepEqual(responder.requests[1].history, [
    { question: "first?", answer: "first answer" }
  ]);
  // The history is per Step: it follows the Step the question was asked about.
  assert.equal(responder.requests[1].history.length, 1);
});

test("suggestion digits are ignored while an answer streams", async () => {
  let release: (() => void) | undefined;
  const responder = new FakeResponder();
  responder.nextAnswer = () => new Promise<string>(resolve => {
    release = () => resolve("done");
  });
  const { reader, descriptions } = harness(
    [{ title: "Only", description: "Hello", questions: ["First question", "Second question"] }],
    { responder }
  );
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;
  const asking = reader.ask("First question");
  await flush();
  // While responding, a suggestion digit is ignored exactly like the ask
  // key: the streaming answer keeps the keyboard to itself.
  reader.pressKey({ key: "2" });
  assert.equal(responder.requests.length, 1);
  assert.equal(reader.getState().conversation.responding, true);
  release!();
  await asking;
  // Once the answer landed, the digit asks again.
  responder.nextAnswer = async () => "second done";
  reader.pressKey({ key: "2" });
  await flush();
  assert.equal(responder.requests.length, 2);
  assert.equal(responder.requests[1].question, "Second question");
});

test("without an agent the panel keeps its guidance and the Step's suggestions", async () => {
  const { reader, descriptions } = harness(
    [{ title: "Only", description: "Hello", questions: ["What is this?", "Why now?"] }]
  );
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;
  const state = reader.getState();
  // The reader without an agent stays a reading surface (ADR 0026): the
  // panel explains itself and the suggestions stay visible.
  assert.equal(state.conversation.hasResponder, false);
  assert.equal(state.conversation.meta, "no agent");
  assert.deepEqual(state.conversation.suggestions, ["What is this?", "Why now?"]);
  assert.equal(state.composer.mode, "unavailable");
  assert.equal(state.composer.prompt, "no ACP agent");
  assert.equal(state.composer.hint, "no agent on PATH");
  // The suggestion digits still submit without an agent: the exchange
  // then fails with the guidance, the reader's defense in depth (ADR 0026).
  reader.pressKey({ key: "1" });
  const after = reader.getState().conversation.exchanges;
  assert.equal(after.length, 1);
  assert.equal(after[0].question, "What is this?");
  assert.equal(after[0].failed, true);
  assert.equal(after[0].answer, "This step's responder is not available. Tour reading stays usable.");
});

test("a diff Step question is grounded in both commit snapshots", async () => {
  const baseRef = "b".repeat(40);
  const headRef = "a".repeat(40);
  // A fake commit file reader standing in for `git show`: the grounding
  // never runs Git in this suite.
  const snapshots = new Map([
    [baseRef + ":src/old.ts", "the original content"],
    [headRef + ":src/a.ts", "the modified content"]
  ]);
  const responder = new FakeResponder();
  const { reader, descriptions } = harness(
    [{ title: "Compare", description: "Hello", display: "diff", file: "src/a.ts", baseFile: "src/old.ts" }],
    {
      responder,
      context: () => ({ kind: "diff", label: "src/a.ts (base ↔ head)", text: "+the diff" }),
      readCommitFile: (ref, file) => snapshots.get(ref + ":" + file),
      tour: { baseRef, ref: headRef }
    }
  );
  const opening = reader.open();
  descriptions.commit(0, "<p>compare</p>");
  await opening;
  await reader.ask("what changed?");
  // The question carries both sides of the displayed diff, each identified
  // with its own path and commit — never another file (ADR 0021).
  assert.deepEqual(responder.requests[0].context, {
    available: true,
    path: "src/a.ts",
    diff: {
      original: { path: "src/old.ts", ref: baseRef, code: "the original content" },
      modified: { path: "src/a.ts", ref: headRef, code: "the modified content" }
    },
    description: "Hello"
  });
  assert.equal(responder.requests[0].workspaceRoot, "/workspace");
});

// --- The paint seam of the rendering adapter (spec #93, ticket #98) ---
//
// The adapter owns no reading behavior: it paints the view model, and it
// paints only when the reader tells it something changed. These tests pin
// the notification timing the adapter depends on, exactly as the reader's
// screen always behaved: a navigation keypress paints nothing until its
// render commits, every other state change paints when it happens.

/** A reader wired to fakes that records the view model at every paint. */
function paintHarness(
  steps: CodeTourStep[],
  options: { responder?: FakeResponder } = {}
): { reader: TourReader; descriptions: FakeDescriptionRenderer; paints: ReaderViewModel[] } {
  const speech = new FakeSpeechEngine();
  const descriptions = new FakeDescriptionRenderer();
  const paints: ReaderViewModel[] = [];
  const reader = createReader({
    tour: tourWith(steps),
    root: "/workspace",
    speechEngine: speech,
    descriptionRenderer: descriptions.render,
    resolveStepContext: () => ({ kind: "none" }),
    responder: options.responder,
    onViewChange: () => paints.push(reader.getState())
  });
  return { reader, descriptions, paints };
}

/** Open the reader to its first committed paint, like the adapter does. */
async function openPainted(
  harness: ReturnType<typeof paintHarness>
): Promise<void> {
  const opening = harness.reader.open();
  harness.descriptions.commit(0, "<p>rendered</p>");
  await opening;
}

test("the reader notifies its observer when the initial render commits", async () => {
  const painted = paintHarness([{ title: "First", description: "Hello" }]);
  const opening = painted.reader.open();
  // Nothing is paintable while the description render is still in flight.
  assert.equal(painted.paints.length, 0);
  painted.descriptions.commit(0, "<p>rendered</p>");
  await opening;
  assert.equal(painted.paints.length, 1);
  assert.equal(painted.paints[0].displayedStep, 0);
});

test("the empty Tour paints once it opens", async () => {
  const painted = paintHarness([]);
  await painted.reader.open();
  assert.equal(painted.paints.length, 1);
  assert.equal(painted.paints[0].emptyMessage, "Tour has no steps. Press q to quit.");
});

test("a navigation keypress paints nothing until its render commits", async () => {
  const painted = paintHarness([
    { title: "First", description: "Hello" },
    { title: "Second", description: "World" }
  ]);
  await openPainted(painted);
  painted.paints.length = 0;
  painted.reader.pressKey({ key: "ArrowRight" });
  // The keypress moves the target synchronously but paints nothing, exactly
  // as the reader always has: the screen keeps the previous Step until the
  // navigation's render commits.
  assert.equal(painted.paints.length, 0);
  assert.equal(painted.reader.getState().currentStep, 1);
  painted.descriptions.commit(1, "<p>rendered second</p>");
  await flush();
  assert.equal(painted.paints.length, 1);
  assert.equal(painted.paints[0].displayedStep, 1);
  assert.equal(painted.paints[0].stepTitle, "Second");
});

test("a key that changes reading state paints immediately", async () => {
  const painted = paintHarness([{ title: "First", description: "Hello" }]);
  await openPainted(painted);
  painted.paints.length = 0;
  const state = painted.reader.pressKey({ key: "v" });
  assert.equal(state.narration.enabled, true);
  assert.equal(painted.paints.length, 1);
  assert.equal(painted.paints[0].status.rightSegments[0], "VOICE ON");
});

test("a resize paints the new geometry and again when its render commits", async () => {
  const painted = paintHarness([{ title: "First", description: "Hello" }]);
  await openPainted(painted);
  painted.paints.length = 0;
  const state = painted.reader.resize(120, 40);
  // The geometry change paints at once — the rail width moves with it.
  assert.equal(state.layout.railWidth, 26);
  assert.equal(painted.paints.length, 1);
  assert.equal(painted.paints[0].layout.railWidth, 26);
  painted.descriptions.commit(0, "<p>rendered</p>");
  await flush();
  assert.equal(painted.paints.length, 2);
  assert.equal(painted.paints[1].displayedStep, 0);
});

test("every conversation exchange update notifies the adapter", async () => {
  const responder = new FakeResponder();
  responder.nextAnswer = async (_request, events) => {
    events?.onAnswerDelta?.("Hel");
    events?.onAnswerDelta?.("lo");
    return "Hello";
  };
  // The view model hands the adapter live exchange objects, so the answer is
  // snapshotted at notify time: what the panel held at each paint.
  const answers: Array<string | undefined> = [];
  let paints = 0;
  const descriptions = new FakeDescriptionRenderer();
  const reader = createReader({
    tour: tourWith([{ title: "First", description: "Hello" }]),
    root: "/workspace",
    speechEngine: new FakeSpeechEngine(),
    descriptionRenderer: descriptions.render,
    resolveStepContext: () => ({ kind: "none" }),
    responder,
    onViewChange: () => {
      paints++;
      answers.push(reader.getState().conversation.exchanges[0]?.answer);
    }
  });
  const opening = reader.open();
  descriptions.commit(0, "<p>rendered</p>");
  await opening;
  paints = 0;
  answers.length = 0;
  await reader.ask("what?");
  // One paint at the begin (the pending exchange and WAIT mode), one per
  // streaming delta, one at the settle — the panel answers live (ADR 0026).
  assert.equal(paints, 4);
  assert.deepEqual(answers, ["", "Hel", "Hello", "Hello"]);
});

test("an async narration warning notifies the adapter", async () => {
  const speech = new FakeSpeechEngine();
  speech.speak = () => Promise.reject(new Error("boom"));
  const descriptions = new FakeDescriptionRenderer();
  const paints: ReaderViewModel[] = [];
  const reader = createReader({
    tour: tourWith([{ title: "First", description: "Hello" }]),
    root: "/workspace",
    speechEngine: speech,
    descriptionRenderer: descriptions.render,
    resolveStepContext: () => ({ kind: "none" }),
    onViewChange: () => paints.push(reader.getState())
  });
  const opening = reader.open();
  descriptions.commit(0, "<p>rendered</p>");
  await opening;
  reader.toggleVoice();
  await flush();
  const last = paints[paints.length - 1];
  assert.equal(last.narration.warning, "Narration failed: boom");
});

test("a second close awaits the first one's disposal", async () => {
  const responder = new FakeResponder();
  responder.dispose = () => new Promise<void>(() => {});
  const reader = createReader({
    tour: tourWith([{ title: "First", description: "Hello" }]),
    root: "/workspace",
    speechEngine: new FakeSpeechEngine(),
    descriptionRenderer: new FakeDescriptionRenderer().render,
    resolveStepContext: () => ({ kind: "none" }),
    responder
  });
  const first = reader.close();
  const second = reader.close();
  assert.equal(second, first);
});

test("the conversation panel carries the provider name for the agent role line", async () => {
  const responder = new FakeResponder();
  const painted = paintHarness(
    [{ title: "First", description: "Hello" }],
    { responder }
  );
  await openPainted(painted);
  assert.equal(painted.reader.getState().conversation.providerName, "Fake");
  const bare = paintHarness([{ title: "First", description: "Hello" }]);
  await openPainted(bare);
  assert.equal(bare.reader.getState().conversation.providerName, undefined);
});

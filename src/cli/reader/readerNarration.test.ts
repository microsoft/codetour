import * as assert from "node:assert/strict";
import { test } from "node:test";
import type { CodeTour, CodeTourStep } from "../../store";
import type { StepChatRequest } from "../../agent/stepChatContract";
import type {
  ConversationResponder,
  DescriptionRenderer,
  SpeechEngine
} from "./collaborators";
import { createReader, type TourReader } from "./reader";

/**
 * The Step Narration policy of the reading module (spec #93, ticket #96),
 * driven through the reading interface and asserted on the view model and
 * the fake engine only: no CODETOUR_SPEECH_COMMAND subprocess, no PTY, no
 * audio. The engine is scripted — the test decides when each utterance
 * settles — so interrupt-at-keypress, the versioned render-commit policy and
 * the warning lifecycle are all observable without timing tricks, the same
 * determinism the NarrationController tests achieve with a fake engine.
 */

const flush = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

function tourWith(steps: CodeTourStep[]): CodeTour {
  return { id: "narration-test", title: "Narration", steps };
}

/**
 * A scripted speech engine: the test settles each utterance itself, so a
 * failure can land while its generation is still current — or after the
 * policy has moved on, which must never surface as a warning.
 */
class ScriptedSpeechEngine implements SpeechEngine {
  readonly spoken: string[] = [];
  cancellations = 0;
  disposed = false;
  /** One settle function per utterance, in speak order. */
  private readonly settling: Array<(error?: Error) => void> = [];

  speak(text: string): Promise<void> {
    this.spoken.push(text);
    return new Promise<void>((resolve, reject) => {
      this.settling.push((error?: Error) => {
        error ? reject(error) : resolve();
      });
    });
  }

  cancel(): void {
    this.cancellations++;
  }

  dispose(): void {
    this.disposed = true;
  }

  /** Settle one utterance; an error fails it exactly as the engine would. */
  settle(index: number, error?: Error): void {
    assert.ok(this.settling[index], "no utterance " + index + " to settle");
    this.settling[index](error);
  }
}

/**
 * A description renderer the test controls: each Step's render stays pending
 * until the test resolves it, so render supersession under rapid navigation
 * is deterministic.
 */
class FakeDescriptionRenderer {
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

  /** Commit the oldest pending render of one Step. */
  commit(index: number, html: string): void {
    const entry = this.pending.find(candidate => candidate.index === index);
    assert.ok(entry, "no pending render for step " + index);
    this.pending.splice(this.pending.indexOf(entry), 1);
    entry.resolve(html);
  }

  /** Fail the oldest pending render of one Step, exactly as a real one rejects. */
  fail(index: number, error: unknown): void {
    const entry = this.pending.find(candidate => candidate.index === index);
    assert.ok(entry, "no pending render for step " + index);
    this.pending.splice(this.pending.indexOf(entry), 1);
    entry.reject(error);
  }
}

/** A conversation responder stub: no agent process is ever started. */
class StubResponder implements ConversationResponder {
  readonly providerName = "Stub";
  answer(_request: StepChatRequest): Promise<string> {
    return Promise.resolve("Stub answer");
  }
}

interface Harness {
  reader: TourReader;
  speech: ScriptedSpeechEngine;
  descriptions: FakeDescriptionRenderer;
}

function harness(steps: CodeTourStep[], responder?: ConversationResponder): Harness {
  const speech = new ScriptedSpeechEngine();
  const descriptions = new FakeDescriptionRenderer();
  const reader = createReader({
    tour: tourWith(steps),
    root: "/workspace",
    speechEngine: speech,
    descriptionRenderer: descriptions.render,
    responder,
    // No Git command and no file read ever runs in this suite.
    resolveStepContext: () => ({ kind: "none" })
  });
  return { reader, speech, descriptions };
}

test("turning the voice on reads the displayed Step's prepared description aloud", async () => {
  const { reader, descriptions, speech } = harness([
    { title: "First", description: "# Hello\n\n```mermaid\nA --> B\n```\n" }
  ]);
  const opening = reader.open();
  descriptions.commit(0, "<p>hello</p>");
  await opening;

  reader.pressKey({ key: "v" });
  const state = reader.getState();
  assert.equal(state.narration.enabled, true);
  // The voice speaks the prepared description, never the raw Markdown and
  // never a source, diff or anchor (ADR 0029).
  assert.deepEqual(speech.spoken, ["Hello\nVoir diagramme"]);
  assert.equal(state.narration.speaking, true);
  assert.equal(state.narration.lastNarratedStep, 0);
  assert.equal(state.narration.warning, undefined);
});

test("navigation cuts the speech at the keypress and defers the new narration to the render commit", async () => {
  const { reader, descriptions, speech } = harness([
    { title: "First", description: "First spoken" },
    { title: "Second", description: "Second spoken" }
  ]);
  const opening = reader.open();
  descriptions.commit(0, "<p>first</p>");
  await opening;

  reader.pressKey({ key: "v" });
  assert.deepEqual(speech.spoken, ["First spoken"]);
  const cancellationsBeforeNavigation = speech.cancellations;

  const state = reader.pressKey({ key: "ArrowRight" });
  // The previous speech is cut at the keypress, before any render lands, and
  // nothing new is spoken while the Step is still rendering (ADR 0029).
  assert.equal(speech.cancellations, cancellationsBeforeNavigation + 1);
  assert.deepEqual(speech.spoken, ["First spoken"]);
  assert.equal(state.narration.speaking, false);
  // The navigation wants narration; it defers until its Step is the
  // displayed one.
  assert.equal(state.narration.pendingNarration, true);
  assert.equal(state.displayedStep, 0);

  descriptions.commit(1, "<p>second</p>");
  await flush();
  // The committed render speaks the Step this navigation actually displays.
  assert.deepEqual(speech.spoken, ["First spoken", "Second spoken"]);
  const committed = reader.getState();
  assert.equal(committed.narration.pendingNarration, false);
  assert.equal(committed.narration.lastNarratedStep, 1);
});

test("rapid navigation narrates only the Step the last render displays; a superseded render narrates nothing", async () => {
  const { reader, descriptions, speech } = harness([
    { title: "First", description: "First spoken" },
    { title: "Second", description: "Second spoken" },
    { title: "Third", description: "Third spoken" }
  ]);
  const opening = reader.open();
  descriptions.commit(0, "<p>first</p>");
  await opening;
  reader.pressKey({ key: "v" });
  assert.deepEqual(speech.spoken, ["First spoken"]);

  // Two rapid navigations while both renders are still pending.
  reader.pressKey({ key: "ArrowRight" });
  reader.pressKey({ key: "n" });
  assert.equal(reader.getState().currentStep, 2);

  // The render of the superseded Step 1 settles: it painted nothing and
  // narrates nothing — render supersession is observable at the interface
  // with no timing tricks, only the fake renderer's commit order.
  descriptions.commit(1, "<p>second</p>");
  await flush();
  assert.deepEqual(speech.spoken, ["First spoken"]);

  descriptions.commit(2, "<p>third</p>");
  await flush();
  assert.deepEqual(speech.spoken, ["First spoken", "Third spoken"]);
  assert.equal(reader.getState().narration.lastNarratedStep, 2);
});

test("a re-render never restarts narration: a resize of a redisplayed Step stays silent", async () => {
  const { reader, descriptions, speech } = harness([
    { title: "Only", description: "Only spoken" }
  ]);
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;
  reader.pressKey({ key: "v" });
  assert.deepEqual(speech.spoken, ["Only spoken"]);

  reader.resize(120, 24);
  assert.equal(reader.getState().rendering, true);
  descriptions.commit(0, "<p>only, wider</p>");
  await flush();
  // The resize re-rendered the same Step: the render path never starts the
  // voice (ADR 0029).
  assert.deepEqual(speech.spoken, ["Only spoken"]);
  assert.equal(reader.getState().narration.lastNarratedStep, 0);
});

test("a resize render commits a pending navigation narration", async () => {
  const { reader, descriptions, speech } = harness([
    { title: "First", description: "First spoken" },
    { title: "Second", description: "Second spoken" }
  ]);
  const opening = reader.open();
  descriptions.commit(0, "<p>first</p>");
  await opening;
  reader.pressKey({ key: "v" });

  // The navigation's render is still pending when the terminal resizes:
  // the resize render is the newer one and owns the commit.
  reader.pressKey({ key: "ArrowRight" });
  reader.resize(120, 24);
  descriptions.commit(1, "<p>second</p>");
  await flush();
  // The navigation's render settled first and was superseded: nothing yet.
  assert.deepEqual(speech.spoken, ["First spoken"]);
  descriptions.commit(1, "<p>second, wider</p>");
  await flush();
  assert.deepEqual(speech.spoken, ["First spoken", "Second spoken"]);
  const state = reader.getState();
  assert.equal(state.displayedStep, 1);
  assert.equal(state.narration.pendingNarration, false);
});

test("the render path never starts the voice: navigation with the voice off stays silent", async () => {
  const { reader, descriptions, speech } = harness([
    { title: "First", description: "First spoken" },
    { title: "Second", description: "Second spoken" }
  ]);
  const opening = reader.open();
  descriptions.commit(0, "<p>first</p>");
  await opening;

  reader.pressKey({ key: "ArrowRight" });
  descriptions.commit(1, "<p>second</p>");
  await flush();
  // Voice off by default: renders commit, the engine never speaks.
  assert.deepEqual(speech.spoken, []);
  assert.equal(reader.getState().narration.enabled, false);
  assert.equal(reader.getState().narration.pendingNarration, false);
});

test("an engine failure surfaces as the speech warning and recovers on the next utterance", async () => {
  const { reader, descriptions, speech } = harness([
    { title: "First", description: "First spoken" },
    { title: "Second", description: "Second spoken" }
  ]);
  const opening = reader.open();
  descriptions.commit(0, "<p>first</p>");
  await opening;
  reader.pressKey({ key: "v" });

  speech.settle(0, new Error("say exited with code 1"));
  await flush();
  // The warning is nonblocking: the reader stays usable and carries it in
  // the status segments, right after the voice state (spec #79).
  const warned = reader.getState();
  assert.equal(warned.narration.warning, "Narration failed: say exited with code 1");
  assert.equal(warned.narration.speaking, false);
  assert.deepEqual(warned.status.rightSegments,
    ["VOICE ON", "Narration failed: say exited with code 1"]);

  // The interrupt of a navigation does not clear the warning; only a handed
  // utterance makes it obsolete.
  reader.pressKey({ key: "ArrowRight" });
  assert.equal(reader.getState().narration.warning,
    "Narration failed: say exited with code 1");
  descriptions.commit(1, "<p>second</p>");
  await flush();
  const recovered = reader.getState();
  assert.deepEqual(speech.spoken, ["First spoken", "Second spoken"]);
  assert.equal(recovered.narration.warning, undefined);
  assert.equal(recovered.narration.speaking, true);
  assert.deepEqual(recovered.status.rightSegments, ["VOICE ON"]);
});

test("a stale failure never warns: the generation moves with each handover", async () => {
  const { reader, descriptions, speech } = harness([
    { title: "First", description: "First spoken" },
    { title: "Second", description: "Second spoken" }
  ]);
  const opening = reader.open();
  descriptions.commit(0, "<p>first</p>");
  await opening;
  reader.pressKey({ key: "v" });

  // The reader navigates before the engine failure lands: the failure
  // belongs to a superseded generation and must not surface.
  reader.pressKey({ key: "ArrowRight" });
  speech.settle(0, new Error("say exited with code 1"));
  await flush();
  assert.equal(reader.getState().narration.warning, undefined);
  descriptions.commit(1, "<p>second</p>");
  await flush();
  assert.deepEqual(speech.spoken, ["First spoken", "Second spoken"]);
  assert.equal(reader.getState().narration.warning, undefined);
});

test("an empty description stays silent, and a redisplayed Step never speaks twice", async () => {
  const { reader, descriptions, speech } = harness([
    { title: "Silent", description: "" },
    { title: "Second", description: "Second spoken" }
  ]);
  const opening = reader.open();
  descriptions.commit(0, "<p>silent</p>");
  await opening;
  reader.pressKey({ key: "v" });
  // An empty description produces no audio: the voice never invents a summary.
  assert.deepEqual(speech.spoken, []);
  assert.equal(reader.getState().narration.speaking, false);

  // Navigating away and back does not re-narrate the already-narrated Step.
  reader.pressKey({ key: "ArrowRight" });
  descriptions.commit(1, "<p>second</p>");
  await flush();
  reader.pressKey({ key: "ArrowLeft" });
  descriptions.commit(0, "<p>silent again</p>");
  await flush();
  assert.deepEqual(speech.spoken, ["Second spoken"]);
  assert.equal(reader.getState().narration.lastNarratedStep, 0);
});

test("toggling the voice off and on again re-reads the displayed Step", async () => {
  const { reader, descriptions, speech } = harness([
    { title: "Only", description: "Only spoken" }
  ]);
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;

  reader.pressKey({ key: "v" });
  assert.deepEqual(speech.spoken, ["Only spoken"]);
  reader.pressKey({ key: "v" });
  // Turning the voice off cut the speech; nothing new is spoken.
  assert.deepEqual(speech.spoken, ["Only spoken"]);
  reader.pressKey({ key: "v" });
  // Turning it on again re-reads the displayed Step, even though it was
  // already narrated (ADR 0029).
  assert.deepEqual(speech.spoken, ["Only spoken", "Only spoken"]);
});

test("toggling the voice on while a navigation is still rendering defers to the commit", async () => {
  const { reader, descriptions, speech } = harness([
    { title: "First", description: "First spoken" },
    { title: "Second", description: "Second spoken" }
  ]);
  const opening = reader.open();
  descriptions.commit(0, "<p>first</p>");
  await opening;

  reader.pressKey({ key: "ArrowRight" });
  reader.pressKey({ key: "v" });
  // The voice is on, but the navigation is still rendering: the displayed
  // Step is not the target, so nothing is spoken yet.
  const state = reader.getState();
  assert.equal(state.narration.enabled, true);
  assert.deepEqual(speech.spoken, []);
  descriptions.commit(1, "<p>second</p>");
  await flush();
  // The pending want from the navigation settles on the committed render.
  assert.deepEqual(speech.spoken, ["Second spoken"]);
  assert.equal(reader.getState().narration.lastNarratedStep, 1);
});

test("enabling the voice during a navigation never speaks a Step whose render fails", async () => {
  const { reader, descriptions, speech } = harness([
    { title: "First", description: "First spoken" },
    { title: "Broken", description: "Never spoken" }
  ]);
  const opening = reader.open();
  descriptions.commit(0, "<p>first</p>");
  await opening;

  // Navigate and enable the voice while the target Step is still rendering,
  // then let that render fail: the engine must never speak the failed Step.
  reader.pressKey({ key: "ArrowRight" });
  reader.pressKey({ key: "v" });
  assert.equal(reader.getState().narration.enabled, true);
  descriptions.fail(1, new Error("unsupported content"));
  await flush();

  const state = reader.getState();
  assert.deepEqual(speech.spoken, [], "a failed render narrates nothing");
  assert.equal(state.narration.lastNarratedStep, -1);
  // The failed render ends the session: the diagnostic is the only report,
  // and the narration dies with it.
  assert.equal(state.fatal?.message, "unsupported content");
  assert.equal(state.finished, true);
  assert.equal(speech.disposed, true);
});

test("scrolling and opening the chat never restart the narration", async () => {
  const { reader, descriptions, speech } = harness(
    [{ title: "Only", description: "Only spoken" }],
    new StubResponder()
  );
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;
  reader.pressKey({ key: "v" });
  assert.deepEqual(speech.spoken, ["Only spoken"]);

  // Scrolling repaints the Step box and the chat repaints its panel; neither
  // may hand a new utterance to the engine or disturb the voice state.
  reader.onExtentsMeasured({ stepViewportRows: 3, stepContentRows: 30 });
  reader.pressKey({ key: "j" });
  reader.pressKey({ key: "a" });
  reader.pressKey({ key: "Escape" });

  const state = reader.getState();
  assert.deepEqual(speech.spoken, ["Only spoken"]);
  assert.equal(state.narration.enabled, true);
  assert.equal(state.narration.lastNarratedStep, 0);
  assert.equal(state.narration.pendingNarration, false);
});

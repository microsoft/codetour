import { test } from "node:test";
import * as assert from "node:assert/strict";
import { NarrationController } from "./NarrationController";
import type { NarrationEngine } from "./SystemSpeech";

/**
 * A scripted engine standing in for the OS speech facility: the test decides
 * when each utterance settles, so races and slow startups are deterministic.
 */
class FakeEngine implements NarrationEngine {
  readonly utterances: string[] = [];
  cancellations = 0;
  disposed = false;
  /** Utterances that were still active when a new one started: must stay 0. */
  overlaps = 0;
  private active = false;
  /** One settle function per utterance, in speak order. */
  readonly settle: ((error?: Error) => void)[] = [];

  isSpeaking(): boolean {
    return this.active;
  }

  speak(text: string): Promise<void> {
    if (this.active) this.overlaps++;
    this.utterances.push(text);
    this.active = true;
    return new Promise<void>((resolve, reject) => {
      this.settle.push((error?: Error) => {
        this.active = false;
        error ? reject(error) : resolve();
      });
    });
  }

  cancel(): void {
    this.cancellations++;
    // The real engine settles a cancelled utterance as completed.
    if (this.active) this.settle[this.settle.length - 1]();
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
  }
}

/** Lets rejected utterances reach the controller's failure handling. */
const flush = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

function controller(): {
  control: NarrationController;
  engine: FakeEngine;
  warnings: string[];
  speaking: { started: number };
} {
  const engine = new FakeEngine();
  const warnings: string[] = [];
  const speaking = { started: 0 };
  const control = new NarrationController({
    engine,
    onWarning: message => warnings.push(message),
    onSpeaking: () => speaking.started++
  });
  return { control, engine, warnings, speaking };
}

test("narration is disabled by default: step changes stay silent", () => {
  const { control, engine } = controller();
  control.onStepChanged("# Hello");
  assert.deepEqual(engine.utterances, []);
});

test("an enabled controller speaks the prepared description of the current step", () => {
  const { control, engine, speaking } = controller();
  control.setEnabled(true);
  control.onStepChanged("# Hello\n\n```mermaid\nA --> B\n```");
  assert.deepEqual(engine.utterances, ["Hello\nVoir diagramme"]);
  assert.equal(speaking.started, 1);
});

test("an empty description produces no audio", () => {
  const { control, engine } = controller();
  control.setEnabled(true);
  control.onStepChanged("   ");
  assert.deepEqual(engine.utterances, []);
});

test("disabling narration stops the current speech immediately", () => {
  const { control, engine } = controller();
  control.setEnabled(true);
  control.onStepChanged("a long step");
  assert.ok(engine.isSpeaking());
  control.setEnabled(false);
  assert.ok(!engine.isSpeaking());
  assert.equal(engine.utterances.length, 1);
});

test("navigation interrupts speech without starting a new utterance", () => {
  const { control, engine } = controller();
  control.setEnabled(true);
  control.onStepChanged("step one");
  control.interrupt();
  assert.ok(!engine.isSpeaking());
  assert.deepEqual(engine.utterances, ["step one"]);
});

test("a step change replaces speech; a stale failure never warns or resumes", async () => {
  const { control, engine, warnings } = controller();
  control.setEnabled(true);
  control.onStepChanged("step one");
  // The engine failure is queued while the utterance is still current, then
  // the reader navigates before the rejection lands: the failure is stale.
  engine.settle[0](new Error("say exited with code 1"));
  control.onStepChanged("step two");
  await flush();
  assert.deepEqual(engine.utterances, ["step one", "step two"]);
  assert.deepEqual(warnings, []);
  assert.equal(engine.overlaps, 0);
});

test("rapid step changes with slow startup never overlap speech", () => {
  const { control, engine } = controller();
  control.setEnabled(true);
  control.onStepChanged("step one");
  control.onStepChanged("step two");
  control.onStepChanged("step three");
  assert.deepEqual(engine.utterances, ["step one", "step two", "step three"]);
  assert.equal(engine.overlaps, 0);
  assert.ok(engine.cancellations >= engine.utterances.length - 1,
    "each replacement must cancel the previous utterance first");
});

test("an engine failure warns without blocking later narration", async () => {
  const { control, engine, warnings, speaking } = controller();
  control.setEnabled(true);
  control.onStepChanged("step one");
  engine.settle[0](new Error("Local speech synthesis is not available on linux."));
  await flush();
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /narration failed/i);
  // The reader stays usable: the next step is still handed to the engine.
  control.onStepChanged("step two");
  assert.equal(engine.utterances.length, 2);
  assert.equal(speaking.started, 2);
});

test("finishing an utterance changes nothing", async () => {
  const { control, engine, warnings } = controller();
  control.setEnabled(true);
  control.onStepChanged("step one");
  engine.settle[0]();
  await flush();
  assert.deepEqual(warnings, []);
  assert.equal(engine.cancellations, 1);
  assert.deepEqual(engine.utterances, ["step one"]);
});

test("dispose cancels speech, releases the engine and stays silent afterwards", async () => {
  const { control, engine, warnings } = controller();
  control.setEnabled(true);
  control.onStepChanged("step one");
  await control.dispose();
  assert.ok(engine.disposed);
  assert.ok(!engine.isSpeaking());
  control.onStepChanged("step two");
  assert.equal(engine.utterances.length, 1);
  // A failure that settles after the shutdown is not the reader's problem.
  engine.settle[0](new Error("too late"));
  await flush();
  assert.deepEqual(warnings, []);
});

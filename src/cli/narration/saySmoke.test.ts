import { test } from "node:test";
import * as assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createSystemSpeech, NarrationEngine } from "./SystemSpeech";
import { prepareNarrationText } from "./prepareText";
import { SPELL_WORDS } from "./spellWords";

/**
 * The real-engine smoke test of spec #79, ticket 04: it speaks out loud
 * through the machine's `say`, so it never runs in the default suite. Opt in
 * on macOS with CODETOUR_SPEECH_SMOKE=1.
 */
const skip = process.platform !== "darwin" ||
  process.env.CODETOUR_SPEECH_SMOKE !== "1" ||
  // An explicit speech command would smoke the override, not the real voice.
  !!process.env.CODETOUR_SPEECH_COMMAND;

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** Speak one utterance on a fresh engine, failing if `say` misses the deadline. */
async function speakWithinTimeout(speech: NarrationEngine, text: string, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) =>
    timer = setTimeout(() => reject(new Error("say did not finish in time")), ms));
  try {
    await Promise.race([speech.speak(text), deadline]);
  } finally {
    clearTimeout(timer);
    speech.dispose();
  }
}

test("the real macOS voice speaks an utterance to completion", { skip }, async () => {
  await speakWithinTimeout(createSystemSpeech(), "CodeTour narration smoke test.", 30000);
});

test("the real macOS voice speaks the spell dictionary and representative identifiers", { skip }, async () => {
  // Every dictionary entry, then identifiers exercising the #90 splitting and
  // the dictionary miss: a human listens to this utterance and records any
  // phonetic adjustment in SPELL_WORDS before ticket #91 closes.
  const identifiers = [
    ...Object.keys(SPELL_WORDS),
    "UTF8",
    "sha256",
    "selectContext",
    "STALE_HEAD",
    "parseSTDERRFile"
  ];
  const description = identifiers.map(identifier => "The `" + identifier + "` token.").join(" ");
  await speakWithinTimeout(createSystemSpeech(), prepareNarrationText(description), 60000);
});

test("closing the reader's engine cuts the real voice and nothing resumes", { skip }, async () => {
  // A marker inside the utterance makes the say process findable by its
  // command line: argv data, exactly where the reader puts it.
  const marker = "codetour-smoke-utterance-" + Date.now();
  const longText = (marker + " this sentence repeats to keep the voice busy. ").repeat(40);
  const speech = createSystemSpeech();
  const speaking = speech.speak(longText);
  await sleep(1000);
  speech.dispose();
  await speaking;
  // A killed voice stays dead: no process of the utterance is left or resumed.
  await sleep(2000);
  const probe = spawnSync("pgrep", ["-fl", marker], { encoding: "utf8" });
  assert.ifError(probe.error);
  // Only exit 1 proves no matches; an unavailable or forbidden probe fails.
  assert.equal(probe.status, 1, probe.stdout + probe.stderr);
});

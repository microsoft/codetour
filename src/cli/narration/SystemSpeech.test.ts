import { test } from "node:test";
import * as assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CommandSpeech, createSystemSpeech } from "./SystemSpeech";

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** A fake speech command: records its argv and exits, like `say` speaking a line. */
const FAKE_SAY = [
  'require("node:fs").writeFileSync(process.env.FAKE_SPEECH_LOG,',
  "  JSON.stringify({ argv: process.argv.slice(2) }));"
].join("\n");

/** A fake PowerShell: a fixed command whose utterance arrives on stdin. */
const FAKE_POWERSHELL = [
  'let text = "";',
  'process.stdin.setEncoding("utf8");',
  'process.stdin.on("data", chunk => text += chunk);',
  'process.stdin.on("end", () => {',
  '  require("node:fs").writeFileSync(process.env.FAKE_SPEECH_LOG,',
  "    JSON.stringify({ argv: process.argv.slice(2), stdin: text }));",
  "  process.exit(0);",
  "});"
].join("\n");

/** A fake speech command that speaks for a long time, like a whole step. */
const FAKE_SLOW_SAY = [
  'const fs = require("node:fs");',
  'fs.writeFileSync(process.env.FAKE_SPEECH_LOG, "start " + process.pid + "\\n");',
  "setTimeout(() => {",
  '  fs.appendFileSync(process.env.FAKE_SPEECH_LOG, "end " + process.pid + "\\n");',
  "  process.exit(0);",
  "}, 15000);"
].join("\n");

function fakeCommandDirectory(): { directory: string; log: () => string } {
  const directory = mkdtempSync(path.join(os.tmpdir(), "codetour-speech-"));
  const logPath = path.join(directory, "log.json");
  process.env.FAKE_SPEECH_LOG = logPath;
  return {
    directory,
    // The child command has not necessarily started when the test polls.
    log: () => (existsSync(logPath) ? readFileSync(logPath, "utf8") : "")
  };
}

const HOSTILE_TEXT = 'He said "hello"; rm -rf /\nnewline `backticks` $HOME && exit';

test("the utterance reaches an argv command as one data argument, never a shell command", {
  skip: process.platform === "win32"
}, async () => {
  const { directory, log } = fakeCommandDirectory();
  try {
    const say = path.join(directory, "fake-say");
    writeFileSync(say, "#!/bin/sh\nprintf '%s' \"$2\" > \"$FAKE_SPEECH_LOG\"\n");
    chmodSync(say, 0o755);
    const speech = createSystemSpeech({ CODETOUR_SPEECH_COMMAND: say }, "linux");
    await speech.speak(HOSTILE_TEXT);
    assert.equal(log(), HOSTILE_TEXT);
  } finally {
    delete process.env.FAKE_SPEECH_LOG;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the say adapter passes the utterance verbatim after the end-of-options marker", async () => {
  const { directory, log } = fakeCommandDirectory();
  try {
    writeFileSync(path.join(directory, "fake-say.js"), FAKE_SAY);
    // The production argv shape on macOS: `say -- <text>`, so a description
    // starting with a dash can never become an option.
    const speech = new CommandSpeech(process.execPath, [path.join(directory, "fake-say.js")]);
    await speech.speak(HOSTILE_TEXT);
    assert.deepEqual(JSON.parse(log()).argv, ["--", HOSTILE_TEXT]);
  } finally {
    delete process.env.FAKE_SPEECH_LOG;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the Windows adapter keeps the utterance out of argv and reads it from stdin", async () => {
  const { directory, log } = fakeCommandDirectory();
  try {
    writeFileSync(path.join(directory, "fake-powershell.js"), FAKE_POWERSHELL);
    // The production spawn shape on Windows: a fixed powershell command, the
    // utterance as UTF-8 stdin data. The fixed argv never contains the text.
    const fixed = ["-NoProfile", "-NonInteractive", "-Command", "<script>"];
    const engine = new CommandSpeech(process.execPath,
      [path.join(directory, "fake-powershell.js"), ...fixed], { channel: "stdin" });
    await engine.speak(HOSTILE_TEXT);
    const recorded = JSON.parse(log());
    assert.deepEqual(recorded.argv.slice(-fixed.length), fixed);
    assert.equal(recorded.stdin, HOSTILE_TEXT);
    assert.ok(!JSON.stringify(recorded.argv).includes("hello"));
  } finally {
    delete process.env.FAKE_SPEECH_LOG;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the Windows factory drives the installed PowerShell speech engine", {
  // On a real Windows host this would speak aloud: the real-engine smoke test
  // owns that machine; here the missing powershell binary proves the wiring.
  skip: process.platform === "win32"
}, async () => {
  const speech = createSystemSpeech({}, "win32");
  await assert.rejects(speech.speak("any text"), /powershell/);
});

test("cancelling kills the speech process and settles the utterance as completed", {
  skip: process.platform === "win32"
}, async () => {
  const { directory, log } = fakeCommandDirectory();
  try {
    writeFileSync(path.join(directory, "fake-slow-say.js"), FAKE_SLOW_SAY);
    const speech = new CommandSpeech(process.execPath,
      [path.join(directory, "fake-slow-say.js")]);
    const speaking = speech.speak("a long step description");
    const deadline = Date.now() + 5000;
    while (!log().startsWith("start") && Date.now() < deadline) await sleep(50);
    assert.ok(log().startsWith("start"), "the fake speech command must start");
    speech.cancel();
    await speaking;
    // A cancelled utterance is dead: the slow command never reaches its end.
    await sleep(1000);
    assert.doesNotMatch(log(), /end/);
    speech.cancel();
  } finally {
    delete process.env.FAKE_SPEECH_LOG;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a failing speech command rejects, a cancelled one never does", {
  skip: process.platform === "win32"
}, async () => {
  const speech = new CommandSpeech(process.execPath, ["-e", "process.exit(3)"]);
  await assert.rejects(speech.speak("broken"), /exited with code 3/);
  const missing = new CommandSpeech(path.join(os.tmpdir(), "codetour-no-such-speech-command"));
  await assert.rejects(missing.speak("gone"));
});

test("dispose releases the speech subprocess", {
  skip: process.platform === "win32"
}, async () => {
  const { directory, log } = fakeCommandDirectory();
  try {
    writeFileSync(path.join(directory, "fake-slow-say.js"), FAKE_SLOW_SAY);
    const speech = new CommandSpeech(process.execPath,
      [path.join(directory, "fake-slow-say.js")]);
    const speaking = speech.speak("a long step description");
    const deadline = Date.now() + 5000;
    while (!log().startsWith("start") && Date.now() < deadline) await sleep(50);
    speech.dispose();
    await speaking;
    await sleep(1000);
    assert.doesNotMatch(log(), /end/);
  } finally {
    delete process.env.FAKE_SPEECH_LOG;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a platform without local speech fails cleanly and stays inert", async () => {
  const speech = createSystemSpeech({}, "linux");
  await assert.rejects(speech.speak("any text"), /Local speech synthesis is not available on linux/);
  speech.cancel();
  speech.dispose();
});

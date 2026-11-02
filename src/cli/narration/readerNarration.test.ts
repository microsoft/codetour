import { after, before, test } from "node:test";
import * as assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

const cli = path.resolve(__dirname, "../../../cli.js");

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

function initGitWorktree(dir: string): void {
  execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "ignore" });
}

const TOUR = {
  title: "Narration",
  steps: [
    { title: "Introduction", description: "First spoken description" },
    { title: "Middle", description: "Second spoken description" },
    { title: "End", description: "Third spoken description" }
  ]
};

/**
 * A fake local speech command for the real reader: it records its pid and the
 * utterance, then keeps "speaking" so interruption and cleanup are observable.
 * The utterance is argv data after `--`, exactly like `say` receives it.
 */
const FAKE_SPEECH_SCRIPT = [
  "#!/bin/sh",
  'printf \'%s %s\\n\' "$$" "$2" >> "$CODETOUR_SPEECH_LOG"',
  "exec sleep 30",
  ""
].join("\n");

interface ReaderSession {
  status: number | null;
  stdout: string;
  stderr: string;
}

type ReaderAction =
  | { output: string; key: string; ready?: () => boolean }
  | { frame: true; key: string; ready?: () => boolean };

/** Send each key after its matching frame and optional async condition are ready. */
function readTourUntil(actions: ReaderAction[], env: NodeJS.ProcessEnv): Promise<ReaderSession> {
  const reader = [process.execPath, cli, "--internal-tour", tourPath];
  const args = process.platform === "darwin"
    ? ["-q", "/dev/null", ...reader]
    : ["-q", "-e", "-c", reader.map(arg => "'" + arg.replace(/'/g, "'\\''") + "'").join(" "), "/dev/null"];
  return new Promise((resolve, reject) => {
    // BSD script requires a pipe or terminal on stdin; Node's socketpair is
    // unsuitable. cat supplies that pipe while preserving interactive input.
    const command = "cat | script " + args.map(arg => "'" + arg.replace(/'/g, "'\\''") + "'").join(" ");
    const child = spawn("bash", ["-c", command], {
      env: { ...process.env, TERM: "xterm-256color", CI: "true", ...env }
    });
    let stdout = "";
    let stderr = "";
    let cursor = 0;
    let next = 0;
    const frameEnd = "\x1b[?2026l";
    const advance = (): void => {
      while (next < actions.length) {
        const action = actions[next];
        let end = -1;
        if ("frame" in action) {
          end = stdout.indexOf(frameEnd, cursor);
        } else {
          const found = stdout.indexOf(action.output, cursor);
          if (found < 0) return;
          end = stdout.indexOf(frameEnd, found + action.output.length);
        }
        if (end < 0) return;
        if (action.ready && !action.ready()) return;
        cursor = end + frameEnd.length;
        next++;
        child.stdin.write(action.key);
        if (next === actions.length) {
          child.stdin.end();
          return;
        }
      }
    };
    const conditionPoll = actions.some(action => action.ready)
      ? setInterval(advance, 10)
      : undefined;
    const deadline = setTimeout(() => {
      child.stdin.end("q");
      child.kill("SIGKILL");
      if (conditionPoll) clearInterval(conditionPoll);
      const action = actions[next];
      const waitingFor = action
        ? "Reader did not display " + ("output" in action ? action.output : "the next screen frame")
        : "Reader did not close";
      reject(new Error(waitingFor + "\n" + stdout.slice(-2000)));
    }, 15000);
    child.stdout.on("data", data => {
      stdout += data.toString();
      advance();
    });
    child.stderr.on("data", data => { stderr += data.toString(); });
    child.once("error", error => {
      clearTimeout(deadline);
      if (conditionPoll) clearInterval(conditionPoll);
      reject(error);
    });
    child.once("close", status => {
      clearTimeout(deadline);
      if (conditionPoll) clearInterval(conditionPoll);
      child.stdin.destroy();
      resolve({ status, stdout, stderr });
    });
  });
}

async function assertProcessesExited(lines: string[]): Promise<void> {
  const pids = lines.map(line => Number(line.split(" ")[0])).filter(pid => pid > 0);
  const deadline = Date.now() + 5000;
  for (const pid of pids) {
    for (;;) {
      try {
        process.kill(pid, 0);
      } catch {
        break;
      }
      if (Date.now() > deadline) {
        assert.fail("speech process " + pid + " is still alive after the reader closed");
      }
      await sleep(100);
    }
  }
}

const directory = mkdtempSync(path.join(os.tmpdir(), "codetour-narration-reader-"));
const tourPath = path.join(directory, "tour.tour");
const fakeSpeech = path.join(directory, "fake-speech");
const failingSpeech = path.join(directory, "fake-speech-fails");

before(() => {
  initGitWorktree(directory);
  writeFileSync(tourPath, JSON.stringify(TOUR));
  writeFileSync(fakeSpeech, FAKE_SPEECH_SCRIPT);
  chmodSync(fakeSpeech, 0o755);
  writeFileSync(failingSpeech, "#!/bin/sh\nexit 1\n");
  chmodSync(failingSpeech, 0o755);
});

after(() => {
  rmSync(directory, { recursive: true, force: true });
});

/** A fresh speech log per test, so sessions cannot observe each other. */
function speechSession(): { env: NodeJS.ProcessEnv; log: () => string[] } {
  const logPath = path.join(directory, "speech-" + randomUUID() + ".log");
  return {
    env: { CODETOUR_SPEECH_COMMAND: fakeSpeech, CODETOUR_SPEECH_LOG: logPath },
    log: () => {
      try {
        return readFileSync(logPath, "utf8").split("\n").filter(Boolean);
      } catch {
        return [];
      }
    }
  };
}

test("a session starts silent; V speaks the current step and V stops it", {
  skip: process.platform === "win32"
}, async () => {
  const { env, log } = speechSession();
  const session = await readTourUntil([
    { output: "VOICE OFF", key: "v" },
    { output: "VOICE ON", key: "v", ready: () => log().length === 1 },
    { output: "VOICE OFF", key: "q" }
  ], env);
  assert.equal(session.status, 0, session.stderr + "\n" + session.stdout.slice(-1500));
  assert.match(session.stdout, /VOICE OFF/);
  assert.match(session.stdout, /VOICE ON/);
  assert.deepEqual(log().map(line => line.slice(line.indexOf(" ") + 1)),
    ["First spoken description"]);
  await assertProcessesExited(log());
});

test("navigation interrupts the previous speech and narrates the displayed step", {
  skip: process.platform === "win32"
}, async () => {
  const { env, log } = speechSession();
  const session = await readTourUntil([
    { output: "VOICE OFF", key: "v" },
    { output: "VOICE ON", key: "\u001b[C", ready: () => log().length === 1 },
    { output: "Middle", key: "q", ready: () => log().length === 2 }
  ], env);
  assert.equal(session.status, 0, session.stderr + "\n" + session.stdout.slice(-1500));
  assert.deepEqual(log().map(line => line.slice(line.indexOf(" ") + 1)),
    ["First spoken description", "Second spoken description"]);
  await assertProcessesExited(log());
});

test("enabling voice during navigation never speaks a step that fails validation", {
  skip: process.platform === "win32"
}, async () => {
  const { env, log } = speechSession();
  writeFileSync(tourPath, JSON.stringify({ ...TOUR, steps: [TOUR.steps[0], {
    title: "Middle", description: "Next description\n\n**Diagram — Navigation**\n\n```mermaid\nflowchart TD\nA --> B\n```\n\n![missing](missing.png)"
  }] }));
  try {
    const session = await readTourUntil([
      { output: "VOICE OFF", key: "\u001b[Cv" }
    ], env);
    assert.equal(session.status, 1, session.stderr + session.stdout.slice(-1500));
    assert.match(session.stdout + session.stderr, /missing\.png/);
    assert.deepEqual(log(), []);
    await assertProcessesExited(log());
  } finally {
    writeFileSync(tourPath, JSON.stringify(TOUR));
  }
});

test("rapid navigation narrates only the steps actually displayed", {
  skip: process.platform === "win32"
}, async () => {
  // Both right-arrows arrive before any render completes, so the middle Step
  // is never displayed: the voice must skip it, not queue or double anyone.
  // The initial toggle waits for the rendered OFF state instead of guessing
  // that TermDOM attached within a fixed delay.
  const { env, log } = speechSession();
  const finalDescription = "THIRDSPOKEN";
  writeFileSync(tourPath, JSON.stringify({ ...TOUR, steps: [
    ...TOUR.steps.slice(0, 2), { ...TOUR.steps[2], description: finalDescription }
  ] }));
  let session: ReaderSession;
  try {
    session = await readTourUntil([
      { output: "VOICE OFF", key: "v" },
      { output: "VOICE ON", key: "\u001b[C\u001b[C" },
      { output: finalDescription, key: "q" }
    ], env);
  } finally {
    writeFileSync(tourPath, JSON.stringify(TOUR));
  }
  assert.equal(session.status, 0, session.stderr + "\n" + session.stdout.slice(-1500));
  assert.deepEqual(log().map(line => line.slice(line.indexOf(" ") + 1)),
    ["First spoken description", finalDescription]);
  await assertProcessesExited(log());
});

test("a v typed in the chat prompt stays text and Ctrl+V is not the shortcut", {
  skip: process.platform === "win32"
}, async () => {
  // /bin/echo exists on PATH: the chat opens without launching any agent,
  // because no question is ever submitted. 0x16 is the Ctrl+V byte.
  const { env, log } = speechSession();
  const session = await readTourUntil([
    { output: "VOICE OFF", key: "\u0016a" },
    { output: "ASK", key: "v" },
    { output: "v▌", key: "\u001b" },
    { output: "READ", key: "q" }
  ], { ...env, CODETOUR_ACP_COMMAND: "/bin/echo" });
  assert.equal(session.status, 0, session.stderr + "\n" + session.stdout.slice(-1500));
  assert.match(session.stdout, /v▌/);
  assert.doesNotMatch(session.stdout, /VOICE ON/);
  assert.deepEqual(log(), []);
});

test("scrolling and opening the chat never restart the narration", {
  skip: process.platform === "win32"
}, async () => {
  const { env, log } = speechSession();
  const description = "First spoken description " +
    Array.from({ length: 80 }, (_, index) => "scrollable line " + index).join(" ");
  writeFileSync(tourPath, JSON.stringify({ ...TOUR, steps: [
    { ...TOUR.steps[0], description }, ...TOUR.steps.slice(1)
  ] }));
  let session: ReaderSession;
  try {
    session = await readTourUntil([
      { output: "VOICE OFF", key: "v" },
      { output: "VOICE ON", key: "j" },
      { frame: true, key: "a" },
      { output: "ASK", key: "\u001b" },
      { output: "READ", key: "q" }
    ], { ...env, CODETOUR_ACP_COMMAND: "/bin/echo" });
  } finally {
    writeFileSync(tourPath, JSON.stringify(TOUR));
  }
  assert.equal(session.status, 0, session.stderr + "\n" + session.stdout.slice(-1500));
  assert.match(session.stdout, /VOICE ON/);
  assert.equal(log().length, 1, "scrolling and chat redraw must not start another utterance");
  assert.ok(log()[0].includes("First spoken description"));
  await assertProcessesExited(log());
});

test("a failing speech engine warns without blocking the reader", {
  skip: process.platform === "win32"
}, async () => {
  const session = await readTourUntil([
    { output: "VOICE OFF", key: "v" },
    { output: "Narration failed", key: "\u001b[C" },
    { output: "Middle", key: "q" }
  ], { CODETOUR_SPEECH_COMMAND: failingSpeech });
  assert.equal(session.status, 0, session.stderr + "\n" + session.stdout.slice(-1500));
  assert.match(session.stdout, /VOICE ON/);
  assert.match(session.stdout, /Narration failed/);
  assert.match(session.stdout, /Middle/);
});

test("a platform without local speech warns without blocking the reader", {
  skip: process.platform !== "linux"
}, async () => {
  const session = await readTourUntil([
    { output: "VOICE OFF", key: "v" },
    { output: "Narration failed", key: "\u001b[C" },
    { output: "Middle", key: "q" }
  ], {});
  assert.equal(session.status, 0, session.stderr + "\n" + session.stdout.slice(-1500));
  assert.match(session.stdout, /Narration failed/);
  assert.match(session.stdout, /Middle/);
});

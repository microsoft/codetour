import { test } from "node:test";
import * as assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { StringDecoder } from "node:string_decoder";

const cli = path.resolve(__dirname, "../../cli.js");

function initGitWorktree(dir: string): void {
  execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "ignore" });
}

function quote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  for (let index = haystack.indexOf(needle); index >= 0;
    index = haystack.indexOf(needle, index + needle.length)) {
    count++;
  }
  return count;
}

/**
 * A minimal VT decoder for the reader's PTY output. It is deliberately not a
 * complete terminal emulator: it implements exactly the control sequences
 * TermDOM emits — alternate screen, DECSC/DECRC, CUP/CHA/CUU/CUD/CUF/CUB,
 * ED/EL — and skips the SGR/DA/DSR/OSC/DCS queries, which paint no cells.
 * With it a test asserts the *rendered screen* (what a reader actually sees)
 * instead of the raw byte stream, whose diff encoding TermDOM chooses is an
 * implementation detail. Every printable glyph counts as one cell wide,
 * which matches the reader's description rows.
 */
class TerminalScreen {
  private readonly rowsTotal: number;
  private readonly columns: number;
  private cells: string[][];
  private alternate: string[][] | null = null;
  private savedCursor: { row: number; column: number } | null = null;
  private row = 0;
  private column = 0;
  private pending = "";

  constructor(columns: number, rows: number) {
    this.columns = columns;
    this.rowsTotal = rows;
    this.cells = this.blank();
  }

  /** Feeds raw PTY bytes; escape sequences may split across writes. */
  write(chunk: string): void {
    const text = this.pending + chunk;
    this.pending = "";
    let index = 0;
    while (index < text.length) {
      const char = text[index];
      if (char === "\x1b") {
        const end = this.escapeEnd(text, index);
        if (end < 0) {
          this.pending = text.slice(index);
          return;
        }
        this.applyEscape(text.slice(index, end));
        index = end;
      } else if (char === "\r") {
        this.column = 0;
        index++;
      } else if (char === "\n") {
        this.lineFeed();
        index++;
      } else if (char === "\b") {
        this.column = Math.max(0, this.column - 1);
        index++;
      } else if (char >= " ") {
        this.print(char);
        index++;
      } else {
        // BEL and the other control bytes carry no cells.
        index++;
      }
    }
  }

  /** The rendered screen, one row per line, spaces included. */
  text(): string {
    return this.cells.map(row => row.join("")).join("\n");
  }

  private blank(): string[][] {
    return Array.from({ length: this.rowsTotal },
      () => Array.from({ length: this.columns }, () => " "));
  }

  /** Returns the index just past the escape sequence, or -1 if incomplete. */
  private escapeEnd(text: string, start: number): number {
    const next = start + 1;
    if (next >= text.length) return -1;
    const kind = text[next];
    if (kind === "[") {
      for (let index = next + 1; index < text.length; index++) {
        const code = text.charCodeAt(index);
        // Parameter and intermediate bytes keep the sequence going; a final
        // byte in @..~ closes it.
        if (code >= 0x40 && code <= 0x7e) return index + 1;
        if (code < 0x20 || code > 0x3f) return index + 1;
      }
      return -1;
    }
    if (kind === "]" || kind === "P" || kind === "X" || kind === "^" || kind === "_") {
      // OSC/DCS/SOS/PM/APC: swallow everything up to the string terminator.
      for (let index = next + 1; index < text.length; index++) {
        if (text[index] === "\x07") return index + 1;
        if (text[index] === "\x1b" && index + 1 >= text.length) return -1;
        if (text[index] === "\x1b" && text[index + 1] === "\\") return index + 2;
      }
      return -1;
    }
    // Two-character escape: DECSC, DECRC, ST, IND, keypad modes...
    return next + 1;
  }

  private applyEscape(sequence: string): void {
    if (sequence.length === 2) {
      switch (sequence[1]) {
        case "7":
          this.savedCursor = { row: this.row, column: this.column };
          return;
        case "8":
          if (this.savedCursor) {
            this.row = this.savedCursor.row;
            this.column = this.savedCursor.column;
          }
          return;
        case "D":
          this.lineFeed();
          return;
        case "M":
          this.row = Math.max(0, this.row - 1);
          return;
        default:
          return;
      }
    }
    if (!sequence.startsWith("\x1b[")) return;
    const final = sequence[sequence.length - 1];
    const parameters = sequence.slice(2, -1);
    const numbers = parameters.replace(/[^0-9;]/g, "")
      .split(";").map(part => (part ? Number(part) : 0));
    const count = numbers[0] || 1;
    switch (final) {
      case "H":
      case "f":
        this.row = Math.min(this.rowsTotal - 1, Math.max(0, (numbers[0] || 1) - 1));
        this.column = Math.min(this.columns - 1, Math.max(0, (numbers[1] || 1) - 1));
        return;
      case "A":
        this.row = Math.max(0, this.row - count);
        return;
      case "B":
        this.row = Math.min(this.rowsTotal - 1, this.row + count);
        return;
      case "C":
        this.column = Math.min(this.columns - 1, this.column + count);
        return;
      case "D":
        this.column = Math.max(0, this.column - count);
        return;
      case "G":
        this.column = Math.min(this.columns - 1, Math.max(0, count - 1));
        return;
      case "d":
        this.row = Math.min(this.rowsTotal - 1, Math.max(0, count - 1));
        return;
      case "J":
        this.eraseDisplay(numbers[0] || 0);
        return;
      case "K":
        this.eraseLine(numbers[0] || 0);
        return;
      case "h":
      case "l":
        if (parameters === "?1049") this.setAlternate(final === "h");
        return;
      default:
        // SGR, device queries and the remaining private modes paint no cells.
        return;
    }
  }

  private setAlternate(enter: boolean): void {
    if (enter && !this.alternate) {
      this.alternate = this.cells;
      this.cells = this.blank();
      this.row = 0;
      this.column = 0;
    } else if (!enter && this.alternate) {
      this.cells = this.alternate;
      this.alternate = null;
    }
  }

  private eraseDisplay(mode: number): void {
    if (mode === 2 || mode === 3) {
      this.cells = this.blank();
      return;
    }
    if (mode === 0) {
      this.eraseLine(0);
      for (let row = this.row + 1; row < this.rowsTotal; row++) this.cells[row].fill(" ");
    } else {
      this.eraseLine(1);
      for (let row = 0; row < this.row; row++) this.cells[row].fill(" ");
    }
  }

  private eraseLine(mode: number): void {
    const row = this.cells[this.row];
    const from = mode === 1 ? 0 : this.column;
    const to = mode === 0 ? this.columns - 1 : this.column;
    for (let column = from; column <= to; column++) row[column] = " ";
  }

  private lineFeed(): void {
    if (this.row === this.rowsTotal - 1) {
      this.cells.shift();
      this.cells.push(Array.from({ length: this.columns }, () => " "));
    } else {
      this.row++;
    }
  }

  private print(char: string): void {
    this.cells[this.row][this.column] = char;
    // TermDOM pre-wraps its rows, so pin the column instead of wrapping.
    if (this.column < this.columns - 1) this.column++;
  }
}

// The escape forms below are the ones TermDOM emitted on the ubuntu-latest
// CI leg (PR #82 run 41058655916, issue #86): the renderer keeps a dirty-cell
// framebuffer, so after the initial frame a repaint re-emits only the cells
// that differ from the row's previous occupant. All the fixture paragraphs
// share the prefix "Paragraph line ", so a page scroll repaints digits only,
// and the final paragraph — whose row previously showed another
// "Paragraph line 19x." line — reaches the terminal as a single "9" cell.
const ciSessionInit = "\x1b[?2004h\x1b[22;0t\x1b[?1002h\x1b[?1006h\x1b]11;?\x1b\\" +
  "\x1b[38;2;111;122;133m\x1bP$qm\x1b\\\x1b[39;22m\x1bP+q524742\x1b\\" +
  "\x1bP+q5463\x1b\\\x1b[>c\x1b[c\x1b[6n\x1b[8l\x1b[8$p\x1b[?2027h\x1b[?2027$p" +
  "\x1b[53m\x1bP$qm\x1b\\\x1b[55m\r\x1b[K\x1b[16t\x1b[c\x1b[?25l\x1b[?1049h\x1b[2J\x1b[H";

const ciBlankFrame = "\x1b[?2026h\x1b[1;1H\x1b7\x1b[J" +
  Array.from({ length: 22 }, () => "\r\x1b[K" + " ".repeat(80) + "\r\r\n").join("") +
  "\x1b[24;1H\x1b[?2026l";

/** Chrome plus the first screenful: previously blank rows paint in full. */
const ciFirstScreenful = "\x1b[?2026h\x1b[1;1H\x1b7" +
  "\x1b[38;5;217;1m▌\x1b[6n codetour\x1b[1C\x1b[38;5;237;22m│\x1b[0m\r\r\n" +
  "\x1b[2C\x1b[38;5;217;1mLong\x1b[40C\x1b[38;5;243mstep 1/1\x1b[0m\r\r\n" +
  "\x1b[2C\x1b[38;5;253mParagraph line 000.\x1b[25C" +
  "\x1b[38;5;237;48;5;234m┌───────────────────────────────┐\x1b[0m\r\r\n" +
  Array.from({ length: 10 }, (_, index) =>
    "\x1b[2C\x1b[38;5;253mParagraph line " + String(index + 1).padStart(3, "0") +
    ".\x1b[0m\r\r\n").join("") +
  "\x1b[2C\x1b[38;5;253mParagraph line 011.\x1b[27C" +
  "\x1b[38;5;243;48;5;234mno agent on PATH\x1b[0m\r\r\n" +
  "\x1b[2C\x1b[38;5;232;48;5;217;1mREAD\x1b[39;22m \x1b[1C" +
  "\x1b[38;5;243m←/→ step · j/k scroll · q quit\x1b[32CVOICE OFF\x1b[0m" +
  "\x1b[24;1H\x1b[?2026l";

/** Fifteen pages later (intermediate frames elided): digits-only repaints. */
const ciPagedFrame = "\x1b[?2026h\x1b[1;1H\x1b7\r\r\n\r\r\n" +
  Array.from({ length: 12 }, (_, index) =>
    "\x1b[17C\x1b[38;5;253m" + (index < 10 ? "18" : "19") + "\x1b[0m\r\r\n").join("") +
  "\x1b[24;1H\x1b[?2026l";

/** The clamped bottom screenful: rows 188..199 over rows 180..191. */
const ciFinalPage = "\x1b[?2026h\x1b[1;1H\x1b7\r\r\n\r\r\n" +
  "\x1b[19C\x1b[38;5;253m8\x1b[0m\r\r\n" +
  "\x1b[19C\x1b[38;5;253m9\x1b[0m\r\r\n" +
  Array.from({ length: 8 }, (_, index) =>
    "\x1b[18C\x1b[38;5;253m9" + index + "\x1b[0m\r\r\n").join("") +
  "\x1b[19C\x1b[38;5;253m8\x1b[0m\r\r\n" +
  "\x1b[19C\x1b[38;5;253m9\x1b[0m\r\r\n" +
  "\x1b[24;1H\x1b[?2026l";

test("the screen decoder reconstructs the rendered rows from TermDOM's diff repaints", () => {
  const screen = new TerminalScreen(80, 24);
  screen.write(ciSessionInit);
  screen.write(ciBlankFrame);
  screen.write(ciFirstScreenful);
  assert.ok(screen.text().includes("Paragraph line 000."), "the first frame paints in full");
  assert.ok(screen.text().includes("codetour"), "SGR and query noise must not eat cells");
  assert.ok(screen.text().includes("VOICE OFF"), "the status line renders");
  screen.write(ciPagedFrame);
  // Arbitrary chunk splits must not lose a split escape sequence.
  for (let index = 0; index < ciFinalPage.length; index += 7) {
    screen.write(ciFinalPage.slice(index, index + 7));
  }
  const raw = ciSessionInit + ciBlankFrame + ciFirstScreenful + ciPagedFrame + ciFinalPage;
  // The ubuntu CI failure (issue #86): the last paragraph never appears
  // contiguously in the raw stream, because its row previously showed
  // "Paragraph line 191." and only the final "9" cell is repainted.
  assert.doesNotMatch(raw, /Paragraph line 199\./);
  assert.ok(screen.text().includes("Paragraph line 188."), "the bottom screenful starts");
  assert.ok(screen.text().includes("Paragraph line 199."), "the last paragraph is rendered");
});

interface ReaderScrollSession {
  status: number | null;
  stdout: string;
  stderr: string;
  screen: string;
}

/**
 * Pages through a long Step in a genuine pseudo-terminal pinned to 80x24 and
 * resolves once `expected` is visible on the rendered screen. Keys travel
 * only after observable output: TermDOM wraps every repaint in the
 * synchronized-update pair `\x1b[?2026h` … `\x1b[?2026l`, so each PageDown
 * waits for the frame that answers it, never a blind timer. The screen is
 * decoded from the raw stream, so the caller asserts what the reader
 * displays rather than TermDOM's diff encoding.
 */
function scrollTourUntilVisible(tourPath: string, expected: string): Promise<ReaderScrollSession> {
  // The geometry is pinned, so the page math is the same on every host:
  // only repeated paging can bring the last paragraph on screen.
  const reader = ["stty rows 24 cols 80; exec",
    quote(process.execPath), quote(cli), "--internal-tour", quote(tourPath)
  ].join(" ");
  const command = "cat | timeout -k 1s 25s script -q -e -c " + quote(reader) + " /dev/null";
  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["-c", command], {
      env: { ...process.env, TERM: "xterm-256color", CI: "true" }
    });
    const decoder = new StringDecoder("utf8");
    const screen = new TerminalScreen(80, 24);
    const frameEnd = "\x1b[?2026l";
    let stdout = "";
    let stderr = "";
    let frames = 0;
    let snapshot = "";
    const frameWaiters = new Set<{ at: number; resolve: (advanced: boolean) => void }>();
    const textWaiters = new Set<{ text: string; resolve: (found: boolean) => void }>();
    const fail = (message: string): void => {
      child.stdin.end("q");
      child.kill("SIGKILL");
      reject(new Error(message + "\n--- rendered screen ---\n" + screen.text() +
        "\n--- raw tail ---\n" + stdout.slice(-1200)));
    };
    const deadline = setTimeout(() => {
      fail("the reader did not display " + JSON.stringify(expected) + " within 20s");
    }, 20000);
    // Writing after the reader died must not take the test process down;
    // the close handler reports the real status.
    child.stdin.on("error", () => undefined);
    child.stdout.on("data", (data: Buffer) => {
      const text = decoder.write(data);
      stdout += text;
      screen.write(text);
      frames = countOccurrences(stdout, frameEnd);
      for (const waiter of [...frameWaiters]) {
        if (frames > waiter.at) {
          frameWaiters.delete(waiter);
          waiter.resolve(true);
        }
      }
      for (const waiter of [...textWaiters]) {
        if (stdout.includes(waiter.text)) {
          textWaiters.delete(waiter);
          waiter.resolve(true);
        }
      }
    });
    child.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });
    child.once("error", error => {
      clearTimeout(deadline);
      reject(error);
    });
    child.once("close", status => {
      clearTimeout(deadline);
      child.stdin.destroy();
      resolve({ status, stdout, stderr, screen: snapshot || screen.text() });
    });
    const nextFrame = (ms: number): Promise<boolean> => new Promise(resolve => {
      const waiter = { at: frames, resolve };
      frameWaiters.add(waiter);
      setTimeout(() => {
        if (frameWaiters.delete(waiter)) resolve(false);
      }, ms);
    });
    const waitForText = (text: string, ms: number): Promise<boolean> => new Promise(resolve => {
      if (stdout.includes(text)) {
        resolve(true);
        return;
      }
      const waiter = { text, resolve };
      textWaiters.add(waiter);
      setTimeout(() => {
        if (textWaiters.delete(waiter)) resolve(false);
      }, ms);
    });
    void (async () => {
      // The first screenful paints in full — its rows were blank — so the
      // first paragraph is a stable "the reader has attached" signal.
      if (!await waitForText("Paragraph line 000.", 10000)) {
        fail("the reader never displayed the top of the Step");
        return;
      }
      for (let page = 0; page < 60; page++) {
        if (screen.text().includes(expected)) break;
        child.stdin.write(" ");
        // At the bottom of the Step a PageDown repaints nothing: the loop
        // then ends on the clamped screen instead of waiting forever.
        if (!await nextFrame(2000)) break;
      }
      // Snapshot before quitting: the exit sequence must not influence the
      // asserted screen state.
      snapshot = screen.text();
      if (!snapshot.includes(expected)) {
        fail("paging to the end never displayed " + JSON.stringify(expected));
        return;
      }
      child.stdin.end("q");
    })().catch(error => { fail(String(error)); });
  });
}

test("the detached reader entry rejects a non-TTY host without hiding the error", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "codetour-terminal-host-"));
  try {
    initGitWorktree(dir);
    const tourPath = path.join(dir, "tour.tour");
    writeFileSync(tourPath, JSON.stringify({
      title: "Playback", steps: [{ title: "Introduction", description: "Hello TermDOM" }]
    }));
    const result = spawnSync(process.execPath, [cli, "--internal-tour", tourPath], {
      encoding: "utf8", timeout: 10000
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /TermDOM requires an interactive terminal/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


test("the real TermDOM reader supports a pseudo-terminal and keyboard-driven finish", {
  skip: process.platform !== "linux"
}, () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "codetour-terminal-pty-"));
  try {
    initGitWorktree(dir);
    const tourPath = path.join(dir, "tour.tour");
    writeFileSync(tourPath, JSON.stringify({
      title: "Playback",
      steps: [
        { title: "Introduction", description: "First description" },
        { title: "Conclusion", description: "Second description" }
      ]
    }));
    // 'script' provides a genuine PTY; the keyboard sequence is sent after
    // TermDOM has attached. This exercises the bundled public reader.
    const command = [
      "(sleep 2; printf '\\033[Cq')",
      "| timeout -k 1s 10s script -q -e -c",
      "'" + process.execPath + " " + cli + " --internal-tour " + tourPath + "'",
      "/dev/null"
    ].join(" ");
    const result = spawnSync("bash", ["-lc", command], {
      encoding: "utf8", timeout: 16000,
      env: { ...process.env, TERM: "xterm-256color", CI: "true" }
    });
    assert.equal(result.status, 0, (result.stderr || "") + "\n" +
      (result.stdout || "").slice(-1200));
    assert.match(result.stdout, /Introduction/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the reader scrolls a Step longer than one screenful", {
  skip: process.platform !== "linux"
}, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "codetour-terminal-scroll-"));
  try {
    initGitWorktree(dir);
    const tourPath = path.join(dir, "tour.tour");
    const paragraphs = Array.from({ length: 200 },
      (_, index) => "Paragraph line " + String(index).padStart(3, "0") + ".");
    writeFileSync(tourPath, JSON.stringify({
      title: "Long Step",
      steps: [{ title: "Long", description: paragraphs.join("\n\n") }]
    }));
    // TermDOM repaints only the cells that change, so after the first frame
    // the shared "Paragraph line " prefix is never re-emitted and the last
    // paragraph reaches the terminal as a few digit cells. The assertion
    // therefore decodes the rendered screen instead of scanning the raw
    // byte stream — the exact mismatch that failed ubuntu-latest (#86).
    const session = await scrollTourUntilVisible(tourPath, "Paragraph line 199.");
    assert.equal(session.status, 0, session.stderr + "\n" + session.stdout.slice(-1500));
    assert.ok(session.screen.includes("Paragraph line 199."),
      "the last paragraph must be on screen after paging to the end of the Step\n" +
      session.screen);
    assert.ok(!session.screen.includes("Paragraph line 000."),
      "the first screenful must have scrolled off the 24-row terminal\n" +
      session.screen);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reaching unsupported terminal content stops the whole Tour with a nonzero exit", {
  skip: process.platform !== "linux"
}, () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "codetour-terminal-failfast-"));
  try {
    initGitWorktree(dir);
    const tourPath = path.join(dir, "tour.tour");
    writeFileSync(tourPath, JSON.stringify({
      title: "Blocked Tour",
      steps: [
        { title: "Supported", description: "First working step" },
        { title: "Unsupported CSS", description: "<style>p { color: red }</style>" },
        { title: "Must not reach", description: "Third step" }
      ]
    }));
    // Send next only after the initial render, and q later in case the reader
    // mistakenly continues. A failure must already have stopped the Tour.
    const command = [
      "(sleep 2; printf '\\033[C'; sleep 3; printf q)",
      "| timeout -k 1s 10s script -q -e -c",
      "'" + process.execPath + " " + cli + " --internal-tour " + tourPath + "'",
      "/dev/null"
    ].join(" ");
    const result = spawnSync("bash", ["-lc", command], {
      encoding: "utf8", timeout: 16000,
      env: { ...process.env, TERM: "xterm-256color", CI: "true" }
    });
    assert.notEqual(result.status, 0, "unsupported content must not be treated as success");
    assert.match(result.stdout + result.stderr,
      /CodeTour terminal stopped: Tour 'Blocked Tour', step 2 \('Unsupported CSS'\), HTML\/CSS/);
    assert.doesNotMatch(result.stdout, /Must not reach/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

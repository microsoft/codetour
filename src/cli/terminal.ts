import type { CodeTour } from "../store";
import { escapeHtml, renderMarkdownToHtml } from "../player/markdown";
import { NarrationController } from "./narration/NarrationController";
import { createSystemSpeech } from "./narration/SystemSpeech";
import { palette } from "./palette";
import { renderTerminalDescription, TerminalStepRenderError } from "./terminalContent";
import { resolveReadonlyStepContext } from "./stepContext";
import { fit, railWindow, tail, terminalLayout, type TerminalLayout } from "./terminalLayout";
import {
  buildStepChatContext,
  commitFileReader,
  openTerminalChat,
  StepConversations
} from "./stepChatSupport";

/**
 * Split one logical line into rows no wider than `width` cells. Continuation
 * rows start with `indent` so wrapped code stays aligned under its source.
 */
function wrapLine(line: string, width: number, indent: string): string[] {
  if (line.length <= width) return [line];
  const rows: string[] = [];
  let rest = line;
  let prefix = "";
  while (rest.length > width - prefix.length) {
    const limit = width - prefix.length;
    rows.push(prefix + rest.slice(0, limit));
    rest = rest.slice(limit);
    prefix = indent;
  }
  rows.push(prefix + rest);
  return rows;
}

/** Rows the reader's chrome takes before the rail can paint an item. */
const RAIL_CHROME_ROWS = 6;

/** "1 exchange" / "2 exchanges", shared by the chat head and the status line. */
function exchangesLabel(count: number): string {
  return count + (count === 1 ? " exchange" : " exchanges");
}

/**
 * The renderer runs in a dedicated terminal process. Only TermDOM owns the
 * terminal DOM and input; CodeTour keeps the step state in this process.
 */
export async function runTerminalTour(tour: CodeTour, root: string): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("TermDOM requires an interactive terminal (TTY).");
  }
  // Required lazily: plain HTML reading must work without a terminal host.
  // The package is kept external to the VS Code extension bundle.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { TermDOM } = require("@b9g/termdom") as {
    TermDOM: new (options?: Record<string, unknown>) => {
      attach(): Promise<void>;
      dispose(): Promise<void>;
      document: Document;
      window: Window;
    };
  };
  const term = new TermDOM({
    scripting: "none",
    ptyEmbeds: "none",
    csp: "default-src 'none'; img-src data: https:"
  });
  await term.attach();

  const { document, window } = term;
  // Render on the alternate screen: the reader owns the whole viewport, any
  // output printed before the takeover (a runtime warning, the shell prompt)
  // cannot offset the cell buffer, and the reader's scrollback is restored
  // when the Tour ends.
  try {
    await document.documentElement.requestFullscreen();
  } catch {
    // A transport without fullscreen support still renders inline.
  }
  let layout: TerminalLayout = terminalLayout(Math.floor(window.innerWidth || 80));
  let rows = Math.floor(window.innerHeight || 24);
  const css = document.createElement("style");
  css.textContent = [
    `body { color: ${palette.text}; background-color: ${palette.background}; }`,
    // The Tour chrome is a top rule and a bottom status line; the Step rail
    // and the conversation panel sit between them (ADR 0027, ADR 0026).
    `.topbar { position: absolute; top: 0; left: 0; width: 100%; height: 1ch; display: flex; }`,
    `.brand { color: ${palette.primary}; font-weight: bold; }`,
    `.sep { color: ${palette.borderStrong}; margin: 0 1ch; }`,
    `.tour { flex: 1; overflow: hidden; white-space: pre; color: ${palette.text}; }`,
    `.step-count { color: ${palette.muted}; white-space: pre; }`,
    `.body { position: absolute; top: 1ch; bottom: 1ch; left: 0; width: 100%; display: flex; }`,
    `.rail { flex: none; box-sizing: border-box; border-right: 1px solid ${palette.border}; background-color: ${palette.panel}; padding-top: 1ch; overflow: hidden; }`,
    `.rail-title { padding: 0 1ch; color: ${palette.muted}; margin-bottom: 1ch; }`,
    `.rail-more { color: ${palette.muted}; }`,
    `.rail-item { height: 1ch; padding: 0 1ch; white-space: pre; overflow: hidden; color: ${palette.faint}; }`,
    `.rail-item.active { background-color: ${palette.element}; color: ${palette.text}; }`,
    `.rail-bar { color: ${palette.primary}; }`,
    `.rail-n { color: ${palette.muted}; }`,
    `.rail-item.active .rail-n { color: ${palette.primary}; }`,
    // The fullscreen root is pinned to the viewport, so the document scroller
    // never repaints: the Step scrolls inside its own box instead (ADR 0025).
    `.content { flex: 1; min-width: 0; min-height: 0; overflow-y: auto; padding: 1ch 2ch 2ch; }`,
    // The Step chat lives in its own right-hand panel, like an editor sidebar:
    // it keeps its scroll position while the reader walks the Step (ADR 0026).
    `.chat { flex: none; box-sizing: border-box; border-left: 1px solid ${palette.border}; background-color: ${palette.panel}; display: flex; flex-direction: column; min-height: 0; }`,
    `.chat-head { display: flex; justify-content: space-between; padding: 0 1ch; margin-top: 1ch; }`,
    `.chat-title { color: ${palette.primary}; font-weight: bold; }`,
    `.chat-meta { color: ${palette.muted}; }`,
    `.chat-body { flex: 1; min-height: 0; overflow-y: auto; padding: 0 1ch; }`,
    `.chat-suggestions { list-style: none; margin: 1ch 0; padding: 0; }`,
    `.chat-suggestion { white-space: pre-wrap; }`,
    `.sugg-key { color: ${palette.primary}; font-weight: bold; }`,
    `.role { font-weight: bold; margin-top: 1ch; }`,
    `.role-user { color: ${palette.info}; }`,
    `.role-agent { color: ${palette.primary}; }`,
    `.question { margin: 0; }`,
    `.exchange { margin-top: 1ch; }`,
    `.answer { margin: 0 0 1ch 1ch; }`,
    `.answer-error { color: ${palette.error}; }`,
    `.answer-pending { color: ${palette.muted}; }`,
    `.tool { color: ${palette.muted}; margin-left: 1ch; white-space: pre-wrap; }`,
    `.composer { flex: none; box-sizing: border-box; margin: 0 1ch 1ch; border: 1px solid ${palette.borderStrong}; background-color: ${palette.element}; padding: 0 1ch; }`,
    `.composer-prompt { color: ${palette.primary}; }`,
    `.composer-text { color: ${palette.text}; white-space: pre; }`,
    `.composer-hint { color: ${palette.muted}; white-space: pre; }`,
    `.status { position: absolute; bottom: 0; left: 0; width: 100%; height: 1ch; box-sizing: border-box; display: flex; justify-content: space-between; padding: 0 1ch; background-color: ${palette.panel}; color: ${palette.muted}; }`,
    `.status-left { display: flex; }`,
    `.mode { color: ${palette.background}; background-color: ${palette.primary}; font-weight: bold; padding: 0 1ch; margin-right: 1ch; }`,
    `.status-right { color: ${palette.muted}; white-space: pre; }`,
    `.anchor { color: ${palette.info}; white-space: pre; margin: 0; }`,
    `h1 { color: ${palette.primary}; font-weight: bold; }`,
    `h2 { color: ${palette.accent}; }`,
    `a { color: ${palette.info}; }`,
    `code { color: ${palette.accent}; }`,
    `pre { background-color: ${palette.element}; padding: 1ch; white-space: pre-wrap; }`,
    `pre code { color: ${palette.text}; }`,
    `pre code.language-diagram { white-space: pre; }`,
    `blockquote { border-left: 1px solid ${palette.borderStrong}; padding-left: 1ch; color: ${palette.warning}; }`,
    `table { margin: 1ch 0; }`,
    `button { color: ${palette.text}; background-color: ${palette.element}; padding: 0 1ch; }`,
    // A source row is a raised panel: the head names the file, the body keeps
    // code and diff on a darker surface. Diff rows carry their own tint so the
    // two directions survive a terminal that downsamples colour (ADR 0027).
    `.source { margin-top: 1ch; border: 1px solid ${palette.border}; background-color: ${palette.panel}; }`,
    `.source-head { display: flex; justify-content: space-between; padding: 0 1ch; background-color: ${palette.element}; color: ${palette.primary}; font-weight: bold; }`,
    `.source-tag { color: ${palette.muted}; font-weight: normal; }`,
    `.source-body { padding: 0 1ch 1ch; }`,
    `.source-line { white-space: pre; }`,
    `.diff-add { color: ${palette.diffAdded}; background-color: ${palette.diffAddedBackground}; }`,
    `.diff-remove { color: ${palette.diffRemoved}; background-color: ${palette.diffRemovedBackground}; }`,
    `.diff-hunk { color: ${palette.diffHunk}; background-color: ${palette.element}; }`
  ].join("\n");
  document.head.appendChild(css);

  const topbar = document.createElement("header");
  topbar.className = "topbar";
  const brand = document.createElement("span");
  brand.className = "brand";
  brand.textContent = "▌ codetour";
  const separator = document.createElement("span");
  separator.className = "sep";
  separator.textContent = "│";
  const tourTitle = document.createElement("span");
  tourTitle.className = "tour";
  const stepCount = document.createElement("span");
  stepCount.className = "step-count";
  topbar.append(brand, separator, tourTitle, stepCount);

  const body = document.createElement("div");
  body.className = "body";
  const rail = document.createElement("nav");
  rail.className = "rail";
  rail.style.width = layout.railWidth + "ch";
  rail.style.display = layout.railWidth ? "block" : "none";
  const article = document.createElement("article");
  article.className = "content";
  const aside = document.createElement("aside");
  aside.className = "chat";
  aside.style.width = layout.chatWidth + "ch";
  const chatTitle = document.createElement("div");
  chatTitle.className = "chat-title";
  const chatMeta = document.createElement("div");
  chatMeta.className = "chat-meta";
  const chatHead = document.createElement("div");
  chatHead.className = "chat-head";
  chatHead.append(chatTitle, chatMeta);
  const chatBody = document.createElement("div");
  chatBody.className = "chat-body";
  const composer = document.createElement("div");
  composer.className = "composer";
  const composerPrompt = document.createElement("span");
  composerPrompt.className = "composer-prompt";
  composerPrompt.textContent = "❯";
  const composerText = document.createElement("span");
  composerText.className = "composer-text";
  const composerLine = document.createElement("div");
  composerLine.append(composerPrompt, composerText);
  const composerHint = document.createElement("div");
  composerHint.className = "composer-hint";
  composer.append(composerLine, composerHint);
  aside.append(chatHead, chatBody, composer);
  body.append(rail, article, aside);

  const status = document.createElement("footer");
  status.className = "status";
  const statusLeft = document.createElement("div");
  statusLeft.className = "status-left";
  const mode = document.createElement("span");
  mode.className = "mode";
  const hints = document.createElement("span");
  hints.className = "hints";
  statusLeft.append(mode, hints);
  const statusRight = document.createElement("span");
  statusRight.className = "status-right";
  status.append(statusLeft, statusRight);

  document.body.append(topbar, body, status);

  let current = 0;
  let finished = false;
  let version = 0;
  const conversations = new StepConversations();
  const chat = openTerminalChat(root);
  const readCommitFile = commitFileReader(root);
  let liveAnswer: HTMLElement | undefined;
  let asking = false;
  let draft = "";
  let responding = false;
  // Optional voice narration (spec #79): off for every session, nothing
  // persisted. The controller owns the speech engine, never TermDOM.
  /** The Step the voice last spoke; only real Step changes narrate again. */
  let lastNarrated = -1;
  /** A requested Step can still be rendering while the preceding one is visible. */
  let displayedStep = -1;
  let pendingNarration = false;
  /** The latest nonblocking narration failure, shown until speech recovers. */
  let speechWarning: string | undefined;
  const narration = new NarrationController({
    engine: createSystemSpeech(),
    onWarning: message => {
      speechWarning = message;
      updateStatus();
    },
    onSpeaking: () => {
      if (!speechWarning) return;
      speechWarning = undefined;
      updateStatus();
    }
  });

  function updateStatus(): void {
    mode.textContent = asking ? "ASK" : responding ? "WAIT" : "READ";
    if (asking) {
      hints.textContent = " enter send · esc cancel";
    } else {
      const keys = layout.compactHints
        ? ["←/→ step", "j/k scroll"]
        : ["←/→ previous/next", "j/k scroll", "PgUp/PgDn page"];
      if (chat.responder && !responding) keys.push("a ask");
      keys.push("q quit");
      hints.textContent = " " + keys.join(" · ");
    }
    const segments: string[] = [];
    // The discrete narration state of the session, first in the row so a
    // narrow terminal cuts the least important segments, never it (spec #79).
    segments.push(narration.isEnabled() ? "VOICE ON" : "VOICE OFF");
    if (speechWarning) segments.push(speechWarning);
    if (chat.provider) segments.push(chat.provider.name.toLowerCase());
    const count = conversations.exchanges(current).length;
    if (count) segments.push(exchangesLabel(count));
    // The status line is one row shared with the key hints: the right side
    // yields first, and its first segments are the ones that must survive.
    statusRight.textContent = fit(segments.join(" · "),
      Math.max(30, layout.columns - (layout.compactHints ? 48 : 72)));
  }

  /**
   * Narrate the displayed Step's description. The reader supplies the
   * description explicitly and only on real Step changes: a re-render of the
   * same Step (resize, scroll, repaint, the chat) never restarts the voice,
   * and narration is never triggered from `render()` itself (spec #79).
   */
  function narrateDisplayedStep(reread: boolean): void {
    if (!narration.isEnabled() || displayedStep < 0) return;
    if (!reread && displayedStep === lastNarrated) return;
    lastNarrated = displayedStep;
    narration.onStepChanged(tour.steps[displayedStep]?.description ?? "");
  }

  function narrateCommittedStep(): void {
    if (finished || !pendingNarration || displayedStep !== current) return;
    pendingNarration = false;
    narrateDisplayedStep(false);
  }

  function toggleVoice(): void {
    narration.setEnabled(!narration.isEnabled());
    // Turning the voice on reads the displayed Step immediately, unless a
    // navigation is still rendering: its pendingNarration defers speech until
    // the render succeeds, so a Step that fails validation is never spoken.
    // Turning the voice off has already cut the speech inside the controller.
    if (narration.isEnabled() && displayedStep === current) narrateDisplayedStep(true);
    updateStatus();
  }

  /** One screenful of the Step box, measured in the scroller's own units. */
  function pageRows(): number {
    return Math.max(1, article.clientHeight);
  }

  function updateChatPrompt(): void {
    const questions = tour.steps[current]?.questions ?? [];
    const width = layout.composerWidth;
    const text = asking
      ? tail(draft, width - 1) + "▌"
      : !chat.responder
        ? "no ACP agent"
        : responding
          ? "answering…"
          : "ask about this step…";
    composerText.textContent = " " + fit(text, width);
    composerHint.textContent = asking
      ? "question for this step"
      : responding
        ? "answer streaming"
        : !chat.responder
          ? "no agent on PATH"
          : questions.length
            ? "a ask · 1-" + Math.min(4, questions.length) + " suggestion"
            : "a ask";
  }

  function pinChat(): void {
    chatBody.scrollTop = chatBody.scrollHeight;
  }

  function renderRail(): void {
    rail.replaceChildren();
    if (!layout.railWidth) return;
    const title = document.createElement("div");
    title.className = "rail-title";
    title.textContent = "steps";
    rail.appendChild(title);
    // The rail never hides the active Step: it shows the rows around it and
    // marks the hidden ones, however long the Tour is for the viewport.
    const capacity = Math.max(1, rows - RAIL_CHROME_ROWS);
    const window = railWindow(tour.steps.length, current, capacity);
    const marker = (): void => {
      const more = document.createElement("div");
      more.className = "rail-item rail-more";
      more.textContent = "  ⋮";
      rail.appendChild(more);
    };
    if (window.before) marker();
    for (let index = window.start; index < window.end; index++) {
      const step = tour.steps[index];
      const item = document.createElement("div");
      item.className = "rail-item" + (index === current ? " active" : "");
      const bar = document.createElement("span");
      bar.className = "rail-bar";
      bar.textContent = index === current ? "▌" : " ";
      const number = document.createElement("span");
      number.className = "rail-n";
      number.textContent = String(index + 1).padStart(2, " ");
      const label = document.createElement("span");
      label.className = "rail-t";
      label.textContent = " " + fit(step.title || "Step " + (index + 1),
        layout.railLabelWidth);
      item.append(bar, number, label);
      rail.appendChild(item);
    }
    if (window.after) marker();
  }

  function renderChat(): void {
    chatTitle.textContent = "conversation";
    const exchanges = conversations.exchanges(current);
    chatMeta.textContent = !chat.responder
      ? "no agent"
      : exchanges.length
        ? exchangesLabel(exchanges.length)
        : "ready";
    updateChatPrompt();
    chatBody.replaceChildren();
    if (!chat.responder) {
      const unavailable = document.createElement("p");
      unavailable.className = "answer-pending";
      unavailable.textContent =
        "No ACP agent is installed (Vibe, Copilot CLI, Codex or Claude Code).";
      chatBody.appendChild(unavailable);
    }
    const questions = tour.steps[current]?.questions ?? [];
    if (questions.length) {
      const list = document.createElement("ol");
      list.className = "chat-suggestions";
      questions.forEach((question, index) => {
        const item = document.createElement("li");
        item.className = "chat-suggestion";
        const key = document.createElement("span");
        key.className = "sugg-key";
        key.textContent = (index + 1) + " ";
        item.append(key, document.createTextNode(question));
        list.appendChild(item);
      });
      chatBody.appendChild(list);
    }
    for (const exchange of exchanges) {
      const block = document.createElement("div");
      block.className = "exchange";
      const asker = document.createElement("div");
      asker.className = "role role-user";
      asker.textContent = "▌ you";
      const question = document.createElement("p");
      question.className = "question";
      question.textContent = exchange.question;
      const agent = document.createElement("div");
      agent.className = "role role-agent";
      agent.textContent = "▌ " + (chat.provider?.name.toLowerCase() ?? "agent");
      block.append(asker, question, agent);
      for (const tool of exchange.tools) {
        const use = document.createElement("p");
        use.className = "tool";
        use.textContent = "⚙ " + tool;
        block.appendChild(use);
      }
      const answer = document.createElement("div");
      answer.className = "answer";
      if (exchange.error) {
        answer.classList.add("answer-error");
        answer.textContent = exchange.error;
      } else if (exchange.pending) {
        answer.classList.add("answer-pending");
        // Answers stream as plain text until complete, then as Markdown.
        answer.textContent = exchange.answer || "… answering";
        liveAnswer = answer;
      } else {
        answer.innerHTML = renderMarkdownToHtml(exchange.answer);
      }
      block.appendChild(answer);
      chatBody.appendChild(block);
    }
    pinChat();
  }

  async function ask(question: string): Promise<void> {
    const step = tour.steps[current];
    const stepIndex = current;
    const text = question.trim();
    if (!step || !text || responding) return;
    const exchange = conversations.begin(stepIndex, text);
    if (!chat.responder) {
      conversations.fail(stepIndex, exchange,
        "No ACP agent is installed to answer this question.");
      renderChat();
      return;
    }
    responding = true;
    updateStatus();
    renderChat();
    try {
      const answer = await chat.responder.answer({
        question: text,
        context: buildStepChatContext(tour, step,
          resolveReadonlyStepContext(root, tour, step), readCommitFile),
        history: conversations.history(stepIndex),
        workspaceRoot: root
      }, {
        onAnswerDelta: delta => {
          conversations.append(stepIndex, exchange, delta);
          if (liveAnswer && current === stepIndex) {
            liveAnswer.textContent = exchange.answer;
            pinChat();
          }
        },
        onActivity: message => {
          exchange.tools.push(message);
          if (current === stepIndex) renderChat();
        },
        onToolUse: tool => {
          const label = (tool.forbidden ? "refused " : "") +
            (tool.kind || "tool") + (tool.title ? ": " + tool.title : "");
          if (!exchange.tools.includes(label)) exchange.tools.push(label);
          if (current === stepIndex) renderChat();
        }
      });
      conversations.complete(stepIndex, exchange, answer);
    } catch (error) {
      conversations.fail(stepIndex, exchange,
        error instanceof Error ? error.message : String(error));
    } finally {
      responding = false;
      liveAnswer = undefined;
      if (current === stepIndex) {
        renderChat();
      }
      updateStatus();
    }
  }

  async function render(): Promise<void> {
    if (finished) return;
    const step = tour.steps[current];
    const request = ++version;
    if (!step) {
      article.textContent = "This Tour has no steps.";
      return;
    }
    const descriptionHtml = await renderTerminalDescription(tour, current, root, {
      // The Step rail, the chat panel and the body padding all take cells
      // from the viewport before the description can use it.
      width: layout.textWidth
    });
    if (finished || request !== version) return;
    const context = resolveReadonlyStepContext(root, tour, step);
    if (step.display === "diff" && context.kind !== "diff") {
      throw new TerminalStepRenderError(tour, current, "Git diff",
        "persisted base/head snapshot or file comparison unavailable");
    }
    tourTitle.textContent = fit(tour.title, layout.titleWidth);
    stepCount.textContent = "step " + (current + 1) + "/" + tour.steps.length;
    renderRail();
    const anchor = step.file || step.uri || step.directory || step.view || "";
    const target = anchor ? anchor + (step.line ? ":" + step.line : "") : "";
    // The anchor keeps its path whole; the kind suffix is the first thing to
    // go when the Step column is tight, since the source head repeats it.
    const suffix = context.kind === "diff" ? " · diff" : "";
    const anchorText = target + suffix;
    // A long path keeps its file name and line number: tail, not fit.
    const shownAnchor = anchorText.length <= layout.textWidth
      ? anchorText
      : tail(target, layout.textWidth);
    const label = target
      ? '<p class="anchor">' + escapeHtml(shownAnchor) + "</p>"
      : "";
    article.innerHTML = label + '<div class="role role-agent">▌ codetour</div>' +
      "<h1>" + escapeHtml(step.title || "Step " + (current + 1)) + "</h1>" +
      descriptionHtml;
    if (context.kind === "diff" || context.kind === "code" ||
        context.kind === "unavailable") {
      const section = document.createElement("section");
      section.className = "source";
      const head = document.createElement("div");
      head.className = "source-head";
      const title = document.createElement("span");
      title.className = "source-label";
      // A diff label also carries the base/head refs; the head names the file,
      // and the refs are already the first rows of the diff body.
      const sourceLabel = (context.label || "Source context").replace(/ \([^)]*\)$/, "");
      title.textContent = tail(sourceLabel, Math.max(8, layout.codeWidth - 6));
      const tag = document.createElement("span");
      tag.className = "source-tag";
      tag.textContent = context.kind === "unavailable" ? "n/a" : context.kind;
      head.append(title, tag);
      const sourceBody = document.createElement("div");
      sourceBody.className = "source-body";
      const content = context.kind === "unavailable"
        ? context.diagnostic || "Target unavailable"
        : context.text || "";
      // `white-space: pre` clips anything wider than the terminal. Wrap the
      // logical line and keep continuation rows aligned under the code, so no
      // source or diff line is silently lost.
      const width = layout.codeWidth;
      const indent = context.kind === "code" ? "       " :
        context.kind === "diff" ? "  " : "";
      for (const line of content.split("\n")) {
        const classes: string[] = [];
        if (context.kind === "diff") {
          if (line.startsWith("+") && !line.startsWith("+++")) classes.push("diff-add");
          if (line.startsWith("-") && !line.startsWith("---")) classes.push("diff-remove");
          if (line.startsWith("@@")) classes.push("diff-hunk");
        }
        for (const chunk of wrapLine(line, width, indent)) {
          const row = document.createElement("div");
          row.className = "source-line";
          for (const name of classes) row.classList.add(name);
          row.textContent = chunk || " ";
          sourceBody.appendChild(row);
        }
      }
      section.append(head, sourceBody);
      article.appendChild(section);
    }
    renderChat();
    updateStatus();
    // The scroller is the Step box, not the fullscreen document (ADR 0025).
    article.scrollTop = 0;
    displayedStep = current;
  }
  /**
   * Move to another Step. The previous narration is cut at the keypress; the
   * new one is committed only for the Step this navigation actually displays —
   * a superseded or failed render narrates nothing, and `render()` itself
   * never starts the voice (spec #79).
   */
  function goToStep(next: number): void {
    current = next;
    pendingNarration = true;
    narration.interrupt();
    void render().then(narrateCommittedStep).catch(fatal);
  }
  async function close(): Promise<void> {
    finished = true;
    ++version;
    // Speech stops and its subprocess is released, fatal error paths included.
    await narration.dispose();
    await chat.dispose();
    await term.dispose();
  }
  async function fatal(error: unknown): Promise<void> {
    // The alternate screen still owns the terminal while TermDOM is attached:
    // an error written before the restore is erased with it.
    await close();
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener("resize", () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = undefined;
      const nextLayout = terminalLayout(Math.floor(window.innerWidth || 80));
      const nextRows = Math.floor(window.innerHeight || 24);
      if (nextLayout.columns === layout.columns && nextRows === rows) return;

      const scrollTop = article.scrollTop;
      layout = nextLayout;
      rows = nextRows;
      rail.style.width = layout.railWidth + "ch";
      rail.style.display = layout.railWidth ? "block" : "none";
      aside.style.width = layout.chatWidth + "ch";
      const redraw = render();
      const redrawVersion = version;
      void redraw.then(() => {
        narrateCommittedStep();
        if (finished || version !== redrawVersion) return;
        article.scrollTop = Math.min(scrollTop,
          Math.max(0, article.scrollHeight - article.clientHeight));
      }).catch(fatal);
    }, 100);
  });
  document.addEventListener("keydown", (event: KeyboardEvent) => {
    const key = event.key;
    if (asking) {
      // The prompt owns the keyboard: never let "q", a digit or an arrow
      // navigate while the reader is typing a question.
      if (key === "Enter") {
        const question = draft.trim();
        asking = false;
        draft = "";
        updateStatus();
        updateChatPrompt();
        if (question) void ask(question);
      } else if (key === "Escape") {
        asking = false;
        draft = "";
        updateStatus();
        updateChatPrompt();
      } else if (key === "Backspace") {
        draft = draft.slice(0, -1);
        updateChatPrompt();
      } else if (key.length === 1) {
        draft += key;
        updateChatPrompt();
      } else {
        return;
      }
      event.preventDefault();
      return;
    }
    if (key === "q" || key === "Escape") void close();
    else if (key === "a" && chat.responder && !responding) {
      asking = true;
      draft = "";
      updateStatus();
      updateChatPrompt();
    } else if (/^[1-9]$/.test(key)) {
      const question = tour.steps[current]?.questions?.[Number(key) - 1];
      if (question && !responding) void ask(question);
      else return;
    } else if ((key === "ArrowRight" || key === "n") && current < tour.steps.length - 1) {
      goToStep(current + 1);
    } else if ((key === "ArrowLeft" || key === "p") && current > 0) {
      goToStep(current - 1);
    } else if (key === "v" || key === "V") {
      // A single unmodified V toggles the voice: Ctrl+V, Cmd+V and Alt+V are
      // not the narration shortcut (spec #79). A "v" typed in the chat prompt
      // has already been kept as text by the asking branch above.
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      toggleVoice();
    } else if (key === "j" || key === "ArrowDown") article.scrollTop += 1;
    else if (key === "k" || key === "ArrowUp") article.scrollTop -= 1;
    else if (key === "PageDown" || key === " ") article.scrollTop += pageRows();
    else if (key === "PageUp") article.scrollTop -= pageRows();
    else return;
    event.preventDefault();
  });
  if (!tour.steps.length) {
    tourTitle.textContent = fit(tour.title, layout.titleWidth);
    stepCount.textContent = "step 0/0";
    article.textContent = "Tour has no steps. Press q to quit.";
    renderChat();
    updateStatus();
  } else {
    try {
      await render();
      narrateCommittedStep();
    } catch (error) {
      await close();
      throw error;
    }
  }
}

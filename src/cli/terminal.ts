import type { CodeTour } from "../store";
import { escapeHtml, renderMarkdownToHtml } from "../player/markdown";
import { createSystemSpeech } from "./narration/SystemSpeech";
import { palette } from "./palette";
import { commitFileReader, openTerminalChat } from "./stepChatSupport";
import { fit, tail } from "./terminalLayout";
import { createReader, type TourReader } from "./reader/reader";
import type { ConversationResponder } from "./reader/collaborators";
import { translateKey } from "./reader/readerInput";
import type { ReaderViewModel } from "./reader/viewModel";

/**
 * The TermDOM rendering adapter of the terminal Tour reader (spec #93).
 * Everything that reads a Tour — navigation, narration, conversation,
 * scroll — lives in the reading module (`src/cli/reader`); this file keeps
 * only what paints: the CSS and palette (ADR 0027), the chrome DOM, the
 * alternate-screen request and restore (ADR 0025), the keyboard capture
 * translated into reader key inputs, the debounced resize listener with
 * measured extents reported back, the Step-box and conversation-panel
 * scrollers, and the line wrapping and fit/tail truncation of the pure
 * layout module (ADR 0028). The adapter owns no reading behavior.
 */

/** The TermDOM host, lazily required: plain HTML reading works without it. */
interface TermDomHost {
  attach(): Promise<void>;
  dispose(): Promise<void>;
  document: Document;
  window: Window;
}

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

/**
 * The renderer runs in a dedicated terminal process. The entry point
 * composes the session: it validates the TTY, attaches TermDOM, wires the
 * injected collaborators (the conversation responder from the Step Chat
 * support seams, the speech engine from the narration modules) into the
 * reader, and hands the reader to this adapter. Only TermDOM owns the
 * terminal DOM and input; the reading state machine lives in the module.
 */
export async function runTerminalTour(tour: CodeTour, root: string): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("TermDOM requires an interactive terminal (TTY).");
  }
  // Required lazily: plain HTML reading must work without a terminal host.
  // The package is kept external to the VS Code extension bundle.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { TermDOM } = require("@b9g/termdom") as {
    TermDOM: new (options?: Record<string, unknown>) => TermDomHost;
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

  // The composition root (spec #93): the ACP session layer stays behind the
  // Step Chat support seams and is adapted to the reader's responder port;
  // no agent process is started until the first question.
  const chat = openTerminalChat(root);
  const responder: ConversationResponder | undefined = chat.responder
    ? {
      providerName: chat.provider?.name,
      answer: (request, events) => chat.responder!.answer(request, events),
      cancel: () => chat.responder!.cancel?.(),
      dispose: () => chat.dispose()
    }
    : undefined;

  let surface: TermDomSurface | undefined;
  const reader = createReader({
    tour,
    root,
    columns: Math.floor(window.innerWidth || 80),
    rows: Math.floor(window.innerHeight || 24),
    speechEngine: createSystemSpeech(),
    responder,
    readCommitFile: commitFileReader(root),
    // The adapter paints exactly when the reader says its view model moved.
    onViewChange: () => surface?.paint()
  });
  surface = new TermDomSurface({ term, document, reader, tour });
  surface.listen(window, document);
  await reader.open();
  const fatal = reader.getState().fatal;
  if (fatal) {
    // The initial render failed: restore the alternate screen before the
    // diagnostic reaches the terminal (ADR 0025), then let the entry point
    // print it.
    await surface.teardown();
    throw new Error(fatal.message);
  }
}

interface TermDomSurfaceOptions {
  term: TermDomHost;
  document: Document;
  reader: TourReader;
  tour: CodeTour;
}

/**
 * The paint-only surface: chrome DOM, keyboard capture, debounced resize,
 * and one `paint()` that renders whatever view model the reader reports.
 */
class TermDomSurface {
  private readonly term: TermDomHost;
  private readonly document: Document;
  private readonly reader: TourReader;
  private readonly tour: CodeTour;

  private readonly tourTitle: HTMLElement;
  private readonly stepCount: HTMLElement;
  private readonly rail: HTMLElement;
  private readonly article: HTMLElement;
  private readonly aside: HTMLElement;
  private readonly chatTitle: HTMLElement;
  private readonly chatMeta: HTMLElement;
  private readonly chatBody: HTMLElement;
  private readonly composerText: HTMLElement;
  private readonly composerHint: HTMLElement;
  private readonly mode: HTMLElement;
  private readonly hints: HTMLElement;
  private readonly statusRight: HTMLElement;

  /** The single alternate-screen restore, shared by every teardown caller. */
  private teardownPromise: Promise<void> | undefined;

  constructor(options: TermDomSurfaceOptions) {
    this.term = options.term;
    this.document = options.document;
    this.reader = options.reader;
    this.tour = options.tour;

    const { document } = this;
    const layout = this.reader.getState().layout;
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
    this.tourTitle = tourTitle;
    this.stepCount = stepCount;

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
    this.rail = rail;
    this.article = article;
    this.aside = aside;
    this.chatTitle = chatTitle;
    this.chatMeta = chatMeta;
    this.chatBody = chatBody;
    this.composerText = composerText;
    this.composerHint = composerHint;

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
    this.mode = mode;
    this.hints = hints;
    this.statusRight = statusRight;

    document.body.append(topbar, body, status);
  }

  /**
   * The keyboard and resize capture: the reader decides what an input means,
   * the adapter maps events, keeps the debounce, and prevents the terminal's
   * own handling of exactly the keys the reader consumed.
   */
  listen(window: Window, document: Document): void {
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    window.addEventListener("resize", () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resizeTimer = undefined;
        this.reader.resize(
          Math.floor(window.innerWidth || 80),
          Math.floor(window.innerHeight || 24)
        );
      }, 100);
    });
    document.addEventListener("keydown", (event: KeyboardEvent) => {
      const view = this.reader.getState();
      // The same pure translation the reader applies decides whether the
      // terminal keeps the key: an unhandled one is never preventDefaulted.
      const action = translateKey({
        asking: view.composer.mode === "asking",
        responding: view.conversation.responding,
        hasResponder: view.conversation.hasResponder,
        suggestions: view.conversation.suggestions,
        currentStep: view.currentStep,
        stepCount: this.tour.steps.length,
        // One screenful of the Step box, in the scroller's own units.
        pageRows: Math.max(1, view.scroll.stepViewportRows)
      }, {
        key: event.key,
        ctrl: event.ctrlKey,
        meta: event.metaKey,
        alt: event.altKey
      });
      if (action.type === "unhandled") return;
      event.preventDefault();
      this.reader.pressKey({
        key: event.key,
        ctrl: event.ctrlKey,
        meta: event.metaKey,
        alt: event.altKey
      });
    });
  }

  /**
   * Paint the reader's view model, then report the measured scroller extents
   * so the reader can clamp and restore its scroll offsets, and apply them.
   */
  paint(): void {
    const view = this.reader.getState();
    if (view.finished) {
      // The session is over: restore the alternate screen (and print the
      // diagnostic after the restore, when a render failed — ADR 0025).
      void this.teardown();
      return;
    }
    const layout = view.layout;
    this.tourTitle.textContent = fit(view.tourTitle, layout.titleWidth);
    this.stepCount.textContent = view.stepCount;
    this.rail.style.width = layout.railWidth + "ch";
    this.rail.style.display = layout.railWidth ? "block" : "none";
    this.aside.style.width = layout.chatWidth + "ch";
    this.paintRail(view);
    this.paintArticle(view);
    this.paintChat(view);
    this.paintStatus(view);
    this.reader.onExtentsMeasured({
      stepViewportRows: this.article.clientHeight,
      stepContentRows: this.article.scrollHeight,
      chatViewportRows: this.chatBody.clientHeight,
      chatContentRows: this.chatBody.scrollHeight
    });
    // The reader owns the scroll offsets; the scrollers are the adapter's.
    const settled = this.reader.getState();
    this.article.scrollTop = settled.scroll.stepScrollTop;
    this.chatBody.scrollTop = settled.scroll.chatScrollTop;
  }

  /** Release the reader's collaborators, then restore the alternate screen. */
  teardown(): Promise<void> {
    if (!this.teardownPromise) {
      this.teardownPromise = this.restore();
    }
    return this.teardownPromise;
  }

  private async restore(): Promise<void> {
    await this.reader.close();
    await this.term.dispose();
    const fatal = this.reader.getState().fatal;
    if (fatal) {
      // The alternate screen still owns the terminal until the restore: an
      // error written before it is erased with it (ADR 0025).
      console.error(fatal.message);
      process.exitCode = 1;
    }
  }

  /** The Step rail: the window the reader computed, never a navigator (ADR 0028). */
  private paintRail(view: ReaderViewModel): void {
    const { document } = this;
    this.rail.replaceChildren();
    if (!view.railVisible) return;
    const title = document.createElement("div");
    title.className = "rail-title";
    title.textContent = "steps";
    this.rail.appendChild(title);
    const marker = (): void => {
      const more = document.createElement("div");
      more.className = "rail-item rail-more";
      more.textContent = "  ⋮";
      this.rail.appendChild(more);
    };
    if (view.rail.before) marker();
    for (const item of view.rail.items) {
      const row = document.createElement("div");
      row.className = "rail-item" + (item.active ? " active" : "");
      const bar = document.createElement("span");
      bar.className = "rail-bar";
      bar.textContent = item.active ? "▌" : " ";
      const number = document.createElement("span");
      number.className = "rail-n";
      number.textContent = String(item.index + 1).padStart(2, " ");
      const label = document.createElement("span");
      label.className = "rail-t";
      label.textContent = " " + fit(item.title, view.layout.railLabelWidth);
      row.append(bar, number, label);
      this.rail.appendChild(row);
    }
    if (view.rail.after) marker();
  }

  /** The Step box: anchor, title, description HTML, and the source panel. */
  private paintArticle(view: ReaderViewModel): void {
    const { document } = this;
    const layout = view.layout;
    if (view.emptyMessage !== undefined) {
      this.article.textContent = view.emptyMessage;
      return;
    }
    // The anchor keeps its path whole; the kind suffix is the first thing
    // to go when the Step column is tight, since the source head repeats
    // it. A long path keeps its file name and line: tail, not fit.
    const suffix = view.source?.kind === "diff" ? " · diff" : "";
    const target = suffix && view.anchorText.endsWith(suffix)
      ? view.anchorText.slice(0, -suffix.length)
      : view.anchorText;
    const shownAnchor = view.anchorText.length <= layout.textWidth
      ? view.anchorText
      : tail(target, layout.textWidth);
    const label = target ? '<p class="anchor">' + escapeHtml(shownAnchor) + "</p>" : "";
    this.article.innerHTML = label + '<div class="role role-agent">▌ codetour</div>' +
      "<h1>" + escapeHtml(view.stepTitle) + "</h1>" +
      view.descriptionHtml;
    const source = view.source;
    if (source) {
      const section = document.createElement("section");
      section.className = "source";
      const head = document.createElement("div");
      head.className = "source-head";
      const title = document.createElement("span");
      title.className = "source-label";
      title.textContent = tail(source.label, Math.max(8, layout.codeWidth - 6));
      const tag = document.createElement("span");
      tag.className = "source-tag";
      tag.textContent = source.tag;
      head.append(title, tag);
      const sourceBody = document.createElement("div");
      sourceBody.className = "source-body";
      // `white-space: pre` clips anything wider than the terminal. Wrap the
      // logical line and keep continuation rows aligned under the code, so no
      // source or diff line is silently lost.
      const indent = source.kind === "code" ? "       " :
        source.kind === "diff" ? "  " : "";
      for (const line of source.lines) {
        const classes: string[] = [];
        if (source.kind === "diff") {
          if (line.startsWith("+") && !line.startsWith("+++")) classes.push("diff-add");
          if (line.startsWith("-") && !line.startsWith("---")) classes.push("diff-remove");
          if (line.startsWith("@@")) classes.push("diff-hunk");
        }
        for (const chunk of wrapLine(line, layout.codeWidth, indent)) {
          const row = document.createElement("div");
          row.className = "source-line";
          for (const name of classes) row.classList.add(name);
          row.textContent = chunk || " ";
          sourceBody.appendChild(row);
        }
      }
      section.append(head, sourceBody);
      this.article.appendChild(section);
    }
  }

  /** The conversation panel: head, suggestions, exchanges, composer (ADR 0026). */
  private paintChat(view: ReaderViewModel): void {
    const { document } = this;
    const conversation = view.conversation;
    const layout = view.layout;
    this.chatTitle.textContent = conversation.title;
    this.chatMeta.textContent = conversation.meta;
    const width = layout.composerWidth;
    // The caret stays visible over a long draft: tail, not fit.
    const prompt = view.composer.mode === "asking"
      ? tail(view.composer.draft, width - 1) + "▌"
      : view.composer.prompt;
    this.composerText.textContent = " " + fit(prompt, width);
    this.composerHint.textContent = view.composer.hint;
    this.chatBody.replaceChildren();
    if (!conversation.hasResponder) {
      const unavailable = document.createElement("p");
      unavailable.className = "answer-pending";
      unavailable.textContent =
        "No ACP agent is installed (Vibe, Copilot CLI, Codex or Claude Code).";
      this.chatBody.appendChild(unavailable);
    }
    if (conversation.suggestions.length) {
      const list = document.createElement("ol");
      list.className = "chat-suggestions";
      conversation.suggestions.forEach((question, index) => {
        const item = document.createElement("li");
        item.className = "chat-suggestion";
        const key = document.createElement("span");
        key.className = "sugg-key";
        key.textContent = (index + 1) + " ";
        item.append(key, document.createTextNode(question));
        list.appendChild(item);
      });
      this.chatBody.appendChild(list);
    }
    for (const exchange of conversation.exchanges) {
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
      agent.textContent = "▌ " + (conversation.providerName ?? "agent").toLowerCase();
      block.append(asker, question, agent);
      for (const tool of exchange.toolUses) {
        const use = document.createElement("p");
        use.className = "tool";
        use.textContent = "⚙ " + (tool.forbidden ? "refused " : "") +
          (tool.kind || "tool") + (tool.title ? ": " + tool.title : "");
        block.appendChild(use);
      }
      if (exchange.activity) {
        const use = document.createElement("p");
        use.className = "tool";
        use.textContent = "⚙ " + exchange.activity;
        block.appendChild(use);
      }
      const answer = document.createElement("div");
      answer.className = "answer";
      if (exchange.failed) {
        answer.classList.add("answer-error");
        answer.textContent = exchange.answer;
      } else if (exchange.pending) {
        answer.classList.add("answer-pending");
        // Answers stream as plain text until complete, then as Markdown.
        answer.textContent = exchange.answer || "… answering";
      } else {
        // Answers settle as Markdown once complete or interrupted.
        answer.innerHTML = renderMarkdownToHtml(exchange.answer);
        if (exchange.interrupted) {
          const stopped = document.createElement("p");
          stopped.className = "answer-pending";
          stopped.textContent = "Answer interrupted.";
          answer.appendChild(stopped);
        }
      }
      block.appendChild(answer);
      this.chatBody.appendChild(block);
    }
  }

  /** The status line: mode and hints left, precedence-ordered segments right. */
  private paintStatus(view: ReaderViewModel): void {
    const layout = view.layout;
    this.mode.textContent = view.status.mode;
    this.hints.textContent = view.status.hints;
    // The status line is one row shared with the key hints: the right side
    // yields first, and its first segments are the ones that must survive.
    this.statusRight.textContent = fit(view.status.rightSegments.join(" · "),
      Math.max(30, layout.columns - (layout.compactHints ? 48 : 72)));
  }
}

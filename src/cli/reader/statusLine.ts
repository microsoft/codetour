import type { ConversationState, ReaderStatusLine } from "./viewModel";

/**
 * The status line of the reader as pure data: the mode chip, the key hints
 * and the right-side segments in their fixed precedence (spec #93). The
 * adapter joins and truncates the segments; the order — voice state first,
 * then speech warning, provider and exchange count — is reading behavior
 * the tests pin, because a narrow terminal cuts the least important
 * segments and never the voice state (spec #79).
 */

/** "1 exchange" / "n exchanges", shared by the conversation head meta and the status line. */
export function exchangesLabel(count: number): string {
  return count + (count === 1 ? " exchange" : " exchanges");
}

export interface StatusLineInput {
  /** The conversation state the mode chip and hints depend on (spec #93). */
  conversation: ConversationState;
  compactHints: boolean;
  narrationEnabled: boolean;
  speechWarning: string | undefined;
  /** Lowercase provider name, when an agent is installed. */
  providerName: string | undefined;
  exchangeCount: number;
}

export function statusLine(input: StatusLineInput): ReaderStatusLine {
  const { asking, responding, hasResponder } = input.conversation;
  // Ask mode owns the keyboard and wins the mode chip over a streaming answer.
  const mode = asking ? "ASK" : responding ? "WAIT" : "READ";
  let hints: string;
  if (asking) {
    hints = " enter send · esc cancel";
  } else {
    const keys = input.compactHints
      ? ["←/→ step", "j/k scroll"]
      : ["←/→ previous/next", "j/k scroll", "PgUp/PgDn page"];
    if (hasResponder && !responding) keys.push("a ask");
    // While an answer streams, quitting would lose it: the same key first
    // interrupts the answer in flight (ADR 0031).
    keys.push(responding ? "q stop" : "q quit");
    hints = " " + keys.join(" · ");
  }
  const rightSegments: string[] = [
    input.narrationEnabled ? "VOICE ON" : "VOICE OFF"
  ];
  if (input.speechWarning) rightSegments.push(input.speechWarning);
  if (input.providerName) rightSegments.push(input.providerName.toLowerCase());
  if (input.exchangeCount) rightSegments.push(exchangesLabel(input.exchangeCount));
  return { mode, hints, rightSegments };
}

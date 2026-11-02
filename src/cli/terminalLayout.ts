/**
 * The cell budget of the terminal reader. The Step keeps its own scroller, the
 * Step conversation its right-hand panel (ADR 0026), and the Step rail only
 * appears when the terminal is wide enough to leave the Step readable.
 *
 * Widths are whole terminal cells, borders included: the rail and the chat
 * panel are laid out with `box-sizing: border-box`.
 */
export interface TerminalLayout {
  columns: number;
  /** Total columns of the Step rail, its right border included; 0 when hidden. */
  railWidth: number;
  /** Total columns of the conversation panel, its left border included. */
  chatWidth: number;
  /** Columns available to the rendered Step description. */
  textWidth: number;
  /** Columns available to a source or diff row inside its box. */
  codeWidth: number;
  /** Columns available to the Tour title in the wordmark bar. */
  titleWidth: number;
  /** Characters available to a Step title in the rail, marker included. */
  railLabelWidth: number;
  /** Characters available to the composer's prompt line. */
  composerWidth: number;
  /** True when the long status hints would not fit next to the panel. */
  compactHints: boolean;
}

/** Below this width the rail would eat more than it explains. */
const RAIL_MIN_COLUMNS = 100;
/** Total columns of the Step rail, border included. */
export const RAIL_WIDTH = 26;
const CHAT_MIN_COLUMNS = 36;
const CHAT_MAX_COLUMNS = 48;
/** The reader refuses to lay out below a usable 60-column screen. */
const MIN_COLUMNS = 60;
/** Above this width the status line can afford the spelled-out key hints. */
const WIDE_HINTS_COLUMNS = 120;

export function terminalLayout(columns: number): TerminalLayout {
  const width = Math.max(MIN_COLUMNS, Math.floor(columns));
  const chatWidth = Math.min(CHAT_MAX_COLUMNS,
    Math.max(CHAT_MIN_COLUMNS, Math.floor(width * 0.37)));
  const railWidth = width >= RAIL_MIN_COLUMNS ? RAIL_WIDTH : 0;
  return {
    columns: width,
    railWidth,
    chatWidth,
    // The Step pays 2 cells of padding on each side; a source box pays its
    // own border and padding on top of that.
    textWidth: Math.max(20, width - railWidth - chatWidth - 6),
    codeWidth: Math.max(20, width - railWidth - chatWidth - 8),
    // The wordmark bar holds the brand, the separator, the Step count and
    // some slack; the rail marker takes 4 cells before the Step title, and the
    // composer prompt, its space, the panel border, margins and padding take 9.
    titleWidth: Math.max(8, width - 26),
    railLabelWidth: Math.max(4, railWidth - 7),
    composerWidth: Math.max(4, chatWidth - 9),
    compactHints: width < WIDE_HINTS_COLUMNS
  };
}

/**
 * Truncate `text` to `width` characters, marking the cut with one ellipsis
 * character. Code points are kept whole so an emoji or an astral character is
 * never split; a wide glyph still occupies two terminal cells, as everywhere
 * else in the reader.
 */
export function fit(text: string, width: number): string {
  if (width <= 0) return "";
  const chars = Array.from(text);
  if (chars.length <= width) return text;
  return width === 1 ? "…" : chars.slice(0, width - 1).join("") + "…";
}

/**
 * Keep the last `width` characters of `text`, marking the cut with one
 * ellipsis. A prompt uses it so the caret stays visible while a long question
 * is typed.
 */
export function tail(text: string, width: number): string {
  if (width <= 0) return "";
  const chars = Array.from(text);
  if (chars.length <= width) return text;
  return width === 1 ? "…" : "…" + chars.slice(chars.length - (width - 1)).join("");
}

/** The slice of the Step rail that keeps the active Step on screen. */
export interface RailWindow {
  start: number;
  end: number;
  /** Rows hidden above the window; the caller shows one marker for them. */
  before: boolean;
  /** Rows hidden below the window; the caller shows one marker for them. */
  after: boolean;
}

/**
 * Fit the rail around the active Step: the rail must never hide the `▌` that
 * tells the reader where they are. `capacity` is the number of rows the rail
 * can paint, marker rows included.
 */
export function railWindow(total: number, current: number, capacity: number): RailWindow {
  const rows = Math.max(1, Math.floor(capacity));
  if (total <= rows) return { start: 0, end: total, before: false, after: false };
  if (rows < 3) {
    const start = Math.min(Math.max(0, current), total - 1);
    return { start, end: start + 1, before: false, after: false };
  }
  const visible = rows - 2;
  let start = Math.max(0, current - Math.floor(visible / 2));
  let end = Math.min(total, start + visible);
  start = Math.max(0, end - visible);
  return { start, end, before: start > 0, after: end < total };
}

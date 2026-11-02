/**
 * The dark palette of the OpenCode TUI, shared by the terminal and HTML
 * readers so a Tour looks the same on both surfaces (ADR 0027).
 *
 * A near-black canvas and neutral raised surfaces keep the terminal's own
 * scrollback from showing through as a blue veil, and they leave the red and
 * green of a code diff as the only saturated colours on screen.
 */
export const palette = {
  background: "#0a0a0a",
  panel: "#141414",
  element: "#1e1e1e",
  border: "#2a2a2a",
  borderStrong: "#3c3c3c",
  text: "#eeeeee",
  muted: "#808080",
  faint: "#b5b5b5",
  primary: "#fab283",
  info: "#5c9cf5",
  accent: "#9d7cd8",
  warning: "#e5c07b",
  success: "#7fd88f",
  error: "#e06c75",
  diffAdded: "#b8db87",
  diffAddedBackground: "#20303b",
  diffRemoved: "#e26a75",
  diffRemovedBackground: "#37222c",
  diffHunk: "#82aaff"
} as const;

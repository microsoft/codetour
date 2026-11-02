/**
 * The Narration Spell Dictionary (spec #91): the fixed mapping from an inline
 * code identifier token to the letter-by-letter spoken spelling the voice
 * reads in its place. Keys are lowercase pure-letter tokens; digits keep being
 * split off by the #90 rules and stay digits for the OS voice. A token absent
 * from the dictionary is spoken as the ordinary lowercase word. This constant
 * is the single source of truth: no letter map or acronym heuristic derives
 * spellings from it.
 */
export const SPELL_WORDS: Readonly<Record<string, string>> = {
  mcp: "èm ci pi",
  acp: "éï ci pi",
  html: "ache te èm elle",
  css: "ci è ès",
  json: "ji è ès onne",
  api: "é pi i",
  cli: "ci èl i",
  utf: "iou ti èf",
  ts: "te ès"
};

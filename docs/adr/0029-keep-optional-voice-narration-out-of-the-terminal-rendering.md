# Keep optional voice narration out of the terminal rendering

A Tour Step is read while the reader looks at the code it explains, and the
terminal reader is the one surface that can speak: it owns the keyboard and a
local process. Narration is optional and local (spec #79): no AI agent, no
network service, no model download, and the OS default voice with its normal
language selection — nothing about the voice is configured, detected or
persisted. Every session starts silent; a single unmodified `v` toggles it, a
`v` typed in the chat prompt stays text, and the status line carries a discrete
`VOICE ON` / `VOICE OFF` segment next to the provider and exchange counts.

The speech lives in its own module, `src/cli/narration`, and the reader keeps
only the policy:

- `prepareText.ts` is a pure Markdown-to-spoken-text transformation, shared by
  nothing: prose, headings and list text in document order without formatting
  punctuation, one fixed sentence per rich construct — `Voir diagramme` for a
  Mermaid fence, `Voir image` for an image, `Bloc de code` for any other code
  fence — inline identifiers as ordinary words and links by their visible
  label. An empty description stays silent. The display pipeline and its
  Mermaid validation rules stay authoritative for what the reader sees.
- `SystemSpeech.ts` is the replaceable local engine: `say` on macOS and a
  fixed PowerShell System.Speech command on Windows. The utterance is always
  data, never a command — one argv element after the end-of-options marker on
  macOS (a description starting with a dash cannot become an option) or UTF-8
  stdin behind the fixed Windows command. One utterance at a time; cancelling
  kills the process and settles the utterance as completed, so an interruption
  can never surface as an engine failure. Platforms without local speech fail
  cleanly and the reader stays usable. `CODETOUR_SPEECH_COMMAND` runs one
  explicit speech command instead, the same seam `CODETOUR_ACP_COMMAND`
  already gives the chat — the deterministic tests put a fake engine at the
  real process boundary.
- `NarrationController.ts` owns the speech state. A generation counter stamps
  every attempt, and any outcome of an older attempt is ignored: rapid
  navigation with a slow engine can never overlap or resume stale speech.
  Finishing an utterance is not an event — nothing ever advances the reader.

The reader narrates only the displayed Step's description, never sources,
diffs, anchors, questions or ACP exchanges, and it never starts the voice from
`render()`: that function also runs on resize and its output is versioned.
Navigation cuts the previous speech at the keypress and commits the new
narration only for the Step that navigation actually displays — a superseded or
failed render narrates nothing. Closing the reader cancels speech and releases
the subprocess, fatal error paths included.

The macOS engine is smoke-tested against the real `say` (opt-in,
`CODETOUR_SPEECH_SMOKE=1`, because it is audible). The Windows adapter is
implemented and unit-tested against a fake `powershell` — the fixed argv, the
utterance on stdin, the kill on cancel — but it has not been exercised on a
real Windows terminal yet; that validation remains open and is not simulated.

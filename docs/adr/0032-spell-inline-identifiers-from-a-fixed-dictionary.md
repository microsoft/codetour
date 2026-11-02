# Spell inline identifiers from a fixed dictionary

The narration voice speaks an identifier token found in the Narration Spell Dictionary (`src/cli/narration/spellWords.ts`) as its recorded letter-by-letter spelling; every other token of the #90 splitting stays an ordinary lowercase word. The dictionary is the single source of truth: no letter map, no length heuristic, no exception list derives or overrides a spelling. The rationale is that the default OS voice of spec #79 is French and mangles short English acronyms — a fixed dictionary is the simplest fix, without voice switching or language detection.

## Consequences

A token equal to a dictionary key is spelled wherever the #90 splitting leaves it, including in slash-separated path segments: `src/cli/narration` speaks as « src ci èl i narration », accepted for uniformity over contextual exceptions. Phonetic quality can only be checked by a human listening through the opt-in smoke test (`CODETOUR_SPEECH_SMOKE=1`), so phonetic changes go through that listening pass, recording adjustments in `SPELL_WORDS`.

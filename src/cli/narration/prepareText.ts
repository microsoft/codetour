import { isMermaidFenceInfo } from "codetour-description-renderer";

/**
 * The spoken text of a Tour Step description (spec #79): the same Markdown the
 * reader displays, prepared for the voice independently of the visual TermDOM
 * rendering. These transformations are fixed MVP rules, not options: the
 * display pipeline and its Mermaid validation rules stay authoritative for
 * what the reader sees.
 */

/** A Mermaid fence is a backtick fence with the `mermaid` info string. */
const FENCE_OPEN_PATTERN = /^\s{0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE_PATTERN = /^\s{0,3}(`{3,}|~{3,})[ \t]*$/;
/** `[label]: destination` lines exist only to resolve reference links. */
const LINK_DEFINITION_PATTERN = /^\s{0,3}\[[^\]]+\]:\s*\S/;
const IMAGE_PATTERN = /!\[[^\]]*\]\([^)]*\)/g;
const REFERENCE_IMAGE_PATTERN = /!\[([^\]]*)\](?:\[([^\]]*)\])?/g;
const INLINE_LINK_PATTERN = /\[([^\]]+)\]\([^)]*\)/g;
const REFERENCE_LINK_PATTERN = /\[([^\]]+)\]\[[^\]]*\]/g;
const HTML_TAG_PATTERN = /<\/?[a-zA-Z][^>]*>/g;
const HEADING_PATTERN = /^#{1,6}\s+/;
const ORDERED_LIST_PATTERN = /^\d+[.)]\s+/;
const BULLET_LIST_PATTERN = /^[-*+]\s+/;
const BLOCKQUOTE_PATTERN = /^>\s?/;
const THEMATIC_BREAK_PATTERN = /^\s{0,3}([-*_])[ \t]*(\1[ \t]*){2,}$/;
const TABLE_SEPARATOR_PATTERN = /^\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
/**
 * Emphasis pairs. A delimiter run must wrap non-space text, so multiplication
 * prose like "2 * 3 * 4" keeps its asterisks; single underscores are left
 * alone entirely because intraword underscores are identifiers, not italics.
 */
const BOLD_PATTERN = /(\*\*|__)(\S(?:[^*_]*\S)?)\1/g;
const ITALIC_PATTERN = /\*(\S(?:[^*]*\S)?)\*/g;
const STRIKETHROUGH_PATTERN = /~~(\S(?:[^~]*\S)?)~~/g;

/** The one fixed sentence each rich Markdown construct is spoken as. */
export const DIAGRAM_SPOKEN_TEXT = "Voir diagramme";
export const IMAGE_SPOKEN_TEXT = "Voir image";
export const CODE_SPOKEN_TEXT = "Bloc de code";

/** True when a fence line opens a Mermaid diagram, as the renderer classifies them. */
function opensDiagram(line: string): boolean {
  const match = line.match(FENCE_OPEN_PATTERN);
  if (!match || !match[1].startsWith("`")) return false;
  // The shared renderer only treats ```mermaid fences as diagrams; a ~~~mermaid
  // fence is displayed as a plain code block, so the voice says the same.
  return isMermaidFenceInfo(match[2].trim());
}

/** One prose line with every formatting marker removed, in speaking order. */
function speakProseLine(line: string, imageReferences: Set<string>): string {
  if (LINK_DEFINITION_PATTERN.test(line)) return "";
  let text = line
    // Images and links are spoken as their visible meaning, never their
    // target: the reader sees the picture and the label, not the URL.
    .replace(IMAGE_PATTERN, IMAGE_SPOKEN_TEXT)
    .replace(REFERENCE_IMAGE_PATTERN, (image, label: string, reference: string | undefined) =>
      imageReferences.has((reference || label).trim().replace(/\s+/g, " ").toLowerCase())
        ? IMAGE_SPOKEN_TEXT : image)
    .replace(INLINE_LINK_PATTERN, "$1")
    .replace(REFERENCE_LINK_PATTERN, "$1")
    // Inline code identifiers become ordinary words.
    .replace(/`+/g, "")
    .replace(HTML_TAG_PATTERN, "");
  for (;;) {
    const unquoted = text.replace(BLOCKQUOTE_PATTERN, "");
    if (unquoted === text) break;
    text = unquoted;
  }
  text = text
    .replace(HEADING_PATTERN, "")
    .replace(BULLET_LIST_PATTERN, "")
    .replace(ORDERED_LIST_PATTERN, "");
  if (THEMATIC_BREAK_PATTERN.test(text)) return "";
  // A table row is its cell text; the separator row is pure formatting.
  if (text.includes("|")) {
    if (TABLE_SEPARATOR_PATTERN.test(text)) return "";
    text = text.replace(/\|/g, " ");
  }
  return text
    .replace(BOLD_PATTERN, "$2")
    .replace(ITALIC_PATTERN, "$1")
    .replace(STRIKETHROUGH_PATTERN, "$1")
    .trim();
}

/**
 * The text a Step description is narrated as, in the description's own order:
 * prose, headings and list text without their formatting punctuation, one
 * fixed sentence per Mermaid fence, image and other code fence, inline code
 * identifiers as ordinary words and links by their visible label. An empty
 * description produces no text at all — the voice never invents a summary.
 */
export function prepareNarrationText(description: string): string {
  const spoken: string[] = [];
  const imageReferences = new Set(Array.from(description.matchAll(/^\s{0,3}\[([^\]]+)\]:\s*\S/gm),
    match => match[1].trim().replace(/\s+/g, " ").toLowerCase()));
  let openingFence: string | undefined;
  for (const sourceLine of description.split("\n")) {
    // Blockquote containers do not change whether their contents are code.
    const line = sourceLine.replace(/^(?: {0,3}>[ \t]?)+/, "");
    if (openingFence) {
      const closingFence = line.match(FENCE_CLOSE_PATTERN)?.[1];
      if (closingFence?.[0] === openingFence[0] && closingFence.length >= openingFence.length) {
        openingFence = undefined;
      }
      continue;
    }
    const fence = line.match(FENCE_OPEN_PATTERN);
    if (fence) {
      openingFence = fence[1];
      spoken.push(opensDiagram(line) ? DIAGRAM_SPOKEN_TEXT : CODE_SPOKEN_TEXT);
      continue;
    }
    const text = speakProseLine(line, imageReferences);
    // Paragraph breaks add nothing the voice needs: one line is one pause.
    if (!text) continue;
    spoken.push(text);
  }
  return spoken.join("\n").trim();
}

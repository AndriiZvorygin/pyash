// Prose segmentation is shared between the itinerary cut verb and the qwen
// say verb: both turn a block of written text into speakable pieces.
//
// The two callers differ in how they treat markdown and in what they do with
// a text that yields no sentences, so the difference is an option here
// rather than two copies of the same regular expressions drifting apart.

// A text is speakable when it holds a letter or a digit. Punctuation alone
// is not something to speak.
export function hasSpeakableContent(text = "") {
  return /[\p{L}\p{N}]/u.test(String(text ?? ""));
}

// A markdown divider is a rule of dashes, stars or underscores on a line of
// its own. It is formatting, not text.
export function isMarkdownDivider(text = "") {
  const value = String(text ?? "").trim();
  if (!value) return false;
  return /^(?:[-*_]\s*){3,}$/u.test(value);
}

// Split prose into sentences.
//
// `stripMarkdown` drops emphasis and code markers, which would otherwise be
// read as sentence boundaries. `keepWholeWhenEmpty` returns the text as one
// sentence when the split finds nothing, which is what the speech path
// wants: a fragment with no full stop is still worth speaking.
export function splitProseSentences(text = "", { stripMarkdown = false, keepWholeWhenEmpty = false } = {}) {
  const source = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!source) return [];
  let normalized = source
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ");
  if (stripMarkdown) {
    // Drop markdown emphasis/code markers that can break sentence boundary detection.
    normalized = normalized.replace(/(\*\*|__|~~|`+)/g, "");
  }
  normalized = normalized.trim();
  if (!normalized) return [];
  const protectedRefs = normalized
    .replace(/(\d)\s*\.\s*(\d)/g, "$1§$2")
    .replace(/(\d)\s*:\s*(\d)/g, "$1§$2")
    .replace(/\b((?:[A-Za-z]\.){2,})/g, (m) => m.replaceAll(".", "§"));
  const matches = protectedRefs.match(/[^.!?]+(?:[.!?]+(?:["'”’)\]]+)?(?=\s|$)|$)/g);
  const sentences = (matches ?? [protectedRefs])
    .map((entry) => String(entry ?? "").replace(/§/g, ".").replace(/\s+/g, " ").trim())
    .filter((entry) => /[\p{L}\p{N}]/u.test(entry))
    .filter(Boolean);
  if (keepWholeWhenEmpty) return sentences.length ? sentences : [normalized];
  return sentences;
}

// Split prose into paragraphs, the units a writer separates with a blank
// line. A divider between paragraphs is formatting and is dropped.
export function splitProseParagraphs(text = "") {
  const source = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!source) return [];
  return source
    .split(/\n\s*\n+/u)
    .map((entry) => String(entry ?? "").replace(/[ \t]+\n/g, "\n").replace(/\s+/g, " " ).trim())
    .filter(Boolean)
    .filter((entry) => !isMarkdownDivider(entry))
    .filter((entry) => hasSpeakableContent(entry));
}

// Split prose into phrases, the units a writer separates with punctuation.
// A phrase is shorter than a sentence and is what a caption needs.
export function splitProsePhrases(text = "") {
  const source = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!source) return [];
  return source
    .split(/[,.\n]+/u)
    .map((entry) => String(entry ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((entry) => hasSpeakableContent(entry));
}

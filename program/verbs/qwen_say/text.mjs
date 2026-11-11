import { splitProseSentences } from "../../library/prose_segmentation.mjs";

export function countWords(text = "") {
  const matches = String(text ?? "").trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

function wordTokens(text = "") {
  return String(text ?? "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function assertChunkIntegrity(text = "", chunks = []) {
  const source = wordTokens(text);
  const merged = wordTokens((Array.isArray(chunks) ? chunks : []).join(" "));
  if (!source.length || !merged.length) return true;
  const sourceHead = source.slice(0, 6).join(" ");
  const mergedHead = merged.slice(0, 6).join(" ");
  const coverage = merged.length / Math.max(1, source.length);
  // Keep this as a soft guard: noisy upstream text can be heavily normalized
  // before synthesis, so strict lexical matching is not reliable enough to
  // justify aborting the whole run.
  return !(mergedHead !== sourceHead || coverage < 0.9);
}

function splitByWordBudget(text = "", maxWords = 90) {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out = [];
  for (let i = 0; i < words.length; i += maxWords) {
    const chunk = words.slice(i, i + maxWords).join(" ").trim();
    if (chunk) out.push(chunk);
  }
  return out;
}

function hasTerminalSentencePunctuation(text = "") {
  return /[.!?…]["')\]]*$/u.test(String(text ?? "").trim());
}

function numberToWords(numRaw) {
  const num = Number(numRaw);
  if (!Number.isFinite(num) || num < 0) return String(numRaw ?? "");
  const n = Math.trunc(num);
  const ones = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
  const teens = ["ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  if (n < 10) return ones[n];
  if (n < 20) return teens[n - 10];
  if (n < 100) {
    const t = Math.trunc(n / 10);
    const o = n % 10;
    return o ? `${tens[t]} ${ones[o]}` : tens[t];
  }
  if (n < 1000) {
    const h = Math.trunc(n / 100);
    const rest = n % 100;
    return rest ? `${ones[h]} hundred ${numberToWords(rest)}` : `${ones[h]} hundred`;
  }
  if (n < 1000000) {
    const th = Math.trunc(n / 1000);
    const rest = n % 1000;
    return rest ? `${numberToWords(th)} thousand ${numberToWords(rest)}` : `${numberToWords(th)} thousand`;
  }
  return String(n);
}

function twoDigitWords(num) {
  const n = Math.max(0, Math.trunc(Number(num) || 0));
  if (n < 10) return numberToWords(n);
  if (n < 20) return numberToWords(n);
  const tens = Math.trunc(n / 10) * 10;
  const ones = n % 10;
  if (!ones) return numberToWords(tens);
  return `${numberToWords(tens)}-${numberToWords(ones)}`;
}

export function yearToWords(valueRaw) {
  const value = Math.trunc(Number(valueRaw));
  if (!Number.isFinite(value) || value < 100) return "";
  if (value >= 1000) {
    const high = Math.trunc(value / 100);
    const low = value % 100;
    if (low === 0) return `${twoDigitWords(high)}-hundred`;
    return `${twoDigitWords(high)}-${twoDigitWords(low)}`;
  }
  const high = Math.trunc(value / 100);
  const low = value % 100;
  if (!low) return `${numberToWords(high)}-hundred`;
  return `${numberToWords(high)}-${twoDigitWords(low)}`;
}

export function integerToWordsHyphenated(valueRaw) {
  const value = Math.trunc(Number(valueRaw));
  if (!Number.isFinite(value) || value < 0) return String(valueRaw ?? "");
  if (value < 100) return twoDigitWords(value);
  const scales = [
    { size: 1000000000, name: "billion" },
    { size: 1000000, name: "million" },
    { size: 1000, name: "thousand" }
  ];
  for (const scale of scales) {
    if (value >= scale.size) {
      const high = Math.trunc(value / scale.size);
      const rem = value % scale.size;
      const left = integerToWordsHyphenated(high);
      if (!rem) return `${left}-${scale.name}`;
      return `${left}-${scale.name}-${integerToWordsHyphenated(rem)}`;
    }
  }
  const hundreds = Math.trunc(value / 100);
  const rem = value % 100;
  if (!rem) return `${numberToWords(hundreds)}-hundred`;
  return `${numberToWords(hundreds)}-hundred-${twoDigitWords(rem)}`;
}

export function normalizeQwenSayChunkText(text = "") {
  const chunk = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!chunk) return "";
  if (hasTerminalSentencePunctuation(chunk)) return `${chunk}.`;
  return `${chunk}..`;
}

export function ensureTrailingDoublePeriod(text = "") {
  const chunk = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!chunk) return "";
  if (chunk.endsWith("..")) return chunk;
  if (chunk.endsWith(".")) return `${chunk}.`;
  return `${chunk}..`;
}

export function applyTailPauseMarkup(text = "", markup = "") {
  const source = String(text ?? "").trim();
  const token = String(markup ?? "").trim();
  if (!source || !token) return source;
  if (source.includes(token)) return source;
  return `${source} ${token}`.trim();
}

export function sanitizeQwenSayScriptText(text = "", mapConfig = {}) {
  const source = String(text ?? "");
  if (!source) return "";
  const percentWord = String(mapConfig?.percent ?? "percent").trim() || "percent";
  const referenceSeparatorRaw = String(mapConfig?.referenceSeparator ?? ".").trim() || ".";
  const referenceSeparator = /[A-Za-z]/.test(referenceSeparatorRaw) && !/\s/.test(referenceSeparatorRaw)
    ? ` ${referenceSeparatorRaw} `
    : referenceSeparatorRaw;
  const ordinal1st = String(mapConfig?.ordinal1st ?? "first").trim() || "first";
  const ordinal2nd = String(mapConfig?.ordinal2nd ?? "second").trim() || "second";
  const ordinal3rd = String(mapConfig?.ordinal3rd ?? "third").trim() || "third";
  const pointWord = String(mapConfig?.pointWord ?? "point").trim() || "point";
  const citationNumberWords = (valueRaw) => {
    const n = Number(valueRaw);
    if (!Number.isFinite(n)) return String(valueRaw ?? "");
    if (n >= 0 && n < 100) return twoDigitWords(n);
    return integerToWordsHyphenated(n);
  };

  const lineBreakMarker = "\u241E";
  let sanitized = source.replace(/\r\n/g, "\n");
  // Strip markdown wrappers so TTS receives plain prose.
  sanitized = sanitized.replace(/^\s{0,3}#{1,6}\s*/gm, "");
  sanitized = sanitized.replace(/(^|\s)#(?=[\p{L}\p{N}])/gu, "$1");
  sanitized = sanitized.replace(/\*\*(.*?)\*\*/g, "$1");
  sanitized = sanitized.replace(/__(.*?)__/g, "$1");
  sanitized = sanitized.replace(/\*(.*?)\*/g, "$1");
  sanitized = sanitized.replace(/_(.*?)_/g, "$1");
  sanitized = sanitized.replace(/`([^`]+)`/g, "$1");
  sanitized = sanitized.replace(/^\s*[-*+]\s+/gm, "");
  sanitized = sanitized.replace(/^\s*\d+[.)]\s+/gm, "");
  sanitized = sanitized.replace(/\n+/g, ` ${lineBreakMarker} `);
  sanitized = sanitized.replace(/\u2026/g, "...");
  sanitized = sanitized.replace(/\b1st\b/gi, ordinal1st);
  sanitized = sanitized.replace(/\b2nd\b/gi, ordinal2nd);
  sanitized = sanitized.replace(/\b3rd\b/gi, ordinal3rd);
  sanitized = sanitized.replace(/(\d+)\s*:\s*(\d+)/g, (_, chapter, verse) => {
    return `${citationNumberWords(chapter)} ${citationNumberWords(verse)}`;
  });
  sanitized = sanitized.replace(/(\d+)\s*\.\s*(\d+)/g, `$1${referenceSeparator}$2`);
  sanitized = sanitized.replace(/(\d+)\.(\d+)/g, (_, left, right) => {
    return `${numberToWords(left)} ${pointWord} ${numberToWords(right)}`;
  });
  // Qwen TTS can clip lead-ins around colons; normalize remaining colons to commas.
  sanitized = sanitized.replace(/:/g, ",");
  sanitized = sanitized.replace(/%/g, ` ${percentWord}`);
  sanitized = sanitized.replace(/\b(\d{1,3}(?:,\d{3})+)\b/g, (_, grouped) => {
    const numeric = Number(String(grouped).replace(/,/g, ""));
    return integerToWordsHyphenated(numeric);
  });
  sanitized = sanitized.replace(/\b(\d{3,4})\b/g, (_, yearToken) => yearToWords(yearToken));
  sanitized = sanitized.replace(/\b(\d+)\b/g, (_, digits) => integerToWordsHyphenated(digits));
  // Preserve sentence boundary when citations end a line, e.g. "(Acts 20:35)\nNext..."
  // becomes "(Acts twenty thirty-five). Next..."
  sanitized = sanitized.replace(new RegExp(`\\)\\s*${lineBreakMarker}\\s*`, "g"), "). ");
  sanitized = sanitized.replace(new RegExp(lineBreakMarker, "g"), " ");
  // Keep apostrophes and common punctuation; only normalize typographic variants.
  sanitized = sanitized.replace(/[“”]/g, "\"").replace(/[‘’]/g, "'");
  sanitized = sanitized.replace(/\s+/g, " ").trim();
  return sanitized;
}

export function splitQwenSayTextChunks(text = "", { forceSentenceChunks = false } = {}) {
  const source = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!source) return [];
  const words = countWords(source);
  const shouldChunk = source.length > 800 || words > 130;
  if (!forceSentenceChunks && !shouldChunk) return [source];

  const paragraphs = source
    .split(/\n\s*\n+/)
    .map(p => String(p ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const units = paragraphs.length ? paragraphs : [source.replace(/\s+/g, " ").trim()];

  const chunks = [];
  for (const paragraph of units) {
    const sentences = splitProseSentences(paragraph);
    if (!sentences.length) {
      chunks.push(...splitByWordBudget(paragraph, 90).map(normalizeQwenSayChunkText).filter(Boolean));
      continue;
    }
    for (const sentence of sentences) {
      if (countWords(sentence) > 95) {
        chunks.push(...splitByWordBudget(sentence, 90).map(normalizeQwenSayChunkText).filter(Boolean));
      } else {
        const chunk = normalizeQwenSayChunkText(sentence);
        if (chunk) chunks.push(chunk);
      }
    }
  }

  return chunks.length ? chunks : [source];
}


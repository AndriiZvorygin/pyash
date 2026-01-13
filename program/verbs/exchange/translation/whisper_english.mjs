import { MOODS } from "../../../library/grammar/keywords.mjs";
import { QUOTED_TEXT_PREFIX } from "../../../understand/constants.mjs";

const PUNCTUATION_RE = /[.,;:!?]/g;
const WHITESPACE_RE = /\s+/g;
const ROLE_ALIASES = new Map([
  ["subject", "su"],
  ["object", "ob"],
  ["subj", "su"],
  ["obj", "ob"]
]);

const isQuotedTextToken = (token) => token.startsWith(QUOTED_TEXT_PREFIX);

function collapseQuotedBlocks(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "quoted" && i + 1 < tokens.length) {
      const lang = tokens[i + 1];
      let endIndex = -1;
      for (let j = i + 2; j + 1 < tokens.length; j++) {
        if (tokens[j] === lang && tokens[j + 1] === "quoted") {
          endIndex = j;
          break;
        }
      }
      if (endIndex === -1) {
        throw new Error(`whisper: missing closing quoted block for ${lang}`);
      }
      const text = tokens.slice(i + 2, endIndex).join(" ");
      out.push(`${QUOTED_TEXT_PREFIX}${text}`);
      i = endIndex + 1;
      continue;
    }
    out.push(token);
  }
  return out;
}

function normalizeMoodSuffix(tokens) {
  const firstIdx = tokens.findIndex((token) => !isQuotedTextToken(token));
  if (firstIdx === -1) return tokens.slice();
  let lastIdx = -1;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (!isQuotedTextToken(tokens[i])) {
      lastIdx = i;
      break;
    }
  }
  const prefixMood = MOODS.includes(tokens[firstIdx]) ? tokens[firstIdx] : null;
  const suffixMood = lastIdx >= 0 && MOODS.includes(tokens[lastIdx]) ? tokens[lastIdx] : null;

  if (prefixMood && suffixMood && firstIdx !== lastIdx) {
    throw new Error("whisper: mood appears in both prefix and suffix positions");
  }
  if (!prefixMood && !suffixMood) {
    throw new Error("whisper: missing mood token");
  }
  if (prefixMood && !suffixMood) {
    const next = tokens.slice(0, firstIdx).concat(tokens.slice(firstIdx + 1));
    next.push(prefixMood);
    return next;
  }
  return tokens.slice();
}

export function normalizeWhisperEnglishTokens(line) {
  const trimmed = (line ?? "").trim();
  if (!trimmed) return [];

  let normalized = trimmed.toLowerCase();
  normalized = normalized.replace(PUNCTUATION_RE, " ");
  normalized = normalized.replace(WHITESPACE_RE, " ").trim();
  if (!normalized) return [];

  const rawTokens = normalized.split(" ");
  const withQuotes = collapseQuotedBlocks(rawTokens);
  const aliased = withQuotes.map((token) => {
    if (isQuotedTextToken(token)) return token;
    return ROLE_ALIASES.get(token) ?? token;
  });
  return normalizeMoodSuffix(aliased);
}

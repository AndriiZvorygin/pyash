// These are the short grammatical endings used by the lwonprom grammar.
// Noun, adjective, case, voice, tense, aspect, and final mood endings join
// the word immediately before them.
const FUSED_ENDINGS = new Set([
  "gi", "ye", "pu", "ci",
  "na", "ka", "ta", "wu", "ti", "ma", "yi", "yu",
  "mwah", "pwah", "swih", "da", "te", "ga", "so", "pwih",
  "twah", "twih", "myah", "lwah", "lwih", "ksih", "tweh", "nweh",
  "lweh", "we", "twoh", "de", "nwah", "tloh", "nyeh", "sweh",
  "txih", "gvih", "ryoh", "pwok", "psek", "pxeh", "pxoh", "dxoh",
  "greh", "rweh", "xwih", "kxeh", "lwoh", "bvah", "dvah", "je",
  "gveh", "vwih", "bveh", "dzih", "tsi7h", "vyah", "gvah", "zreh",
  "bu", "sa7", "si7", "tsi2h", "ta7",
  "ra", "ki", "pfih", "pyoh", "vi"
]);

const SENTENCE_PARTICLES = new Set([
  "ya", "do", "tu", "cu", "si", "ri", "tcih", "lo", "cyih", "dwih",
  "pcih", "psih", "tseh", "twuh", "rwih", "jwih", "mwih", "mu", "nwoh",
  "lu", "byih", "kcu7h", "dyah", "pceh", "pruh", "swuh", "ru", "ksuh",
  "t6", "zlih", "n6", "gyih", "pi7", "si2", "prah", "def", "syi7h"
]);

const FUSED_MOODS = new Set([
  "ya", "do", "def", "prah", "ret", "que", "can", "pe", "pi7",
  "li", "tu", "cu", "si", "ri", "di", "tcih", "lo", "cyih", "dwih",
  "pcih", "psih", "tseh", "twuh", "rwih", "jwih", "mwih", "mu", "nwoh",
  "lu", "byih", "kcuh", "kcu7h", "dyah", "pceh", "pruh", "swuh", "ru",
  "ksuh", "t6", "zlih", "n6", "gyih", "si2", "syi7h"
]);

// Quantifier grammar attaches to a noun/pro-form head in the Pyac surface.
// Keep the structural sequence available for decoding while rendering these
// noun phrases as one spoken word.
const FUSED_NOUN_GRAMMAR_HEADS = new Set(["cyah", "clah", "ya"]);
const FUSED_NOUN_GRAMMAR_SUFFIXES = new Set(["tlih", "tlah", "wi", "no"]);

function tokens(value) {
  if (typeof value !== "string") return [];
  return value.match(/"[^"\n]*"|\S+/gu) ?? [];
}

export function renderPyashSurface(value, {
  fusedEndings = FUSED_ENDINGS,
  sentenceParticles = SENTENCE_PARTICLES,
  fusedMoods = FUSED_MOODS
} = {}) {
  const rendered = [];
  const inputTokens = tokens(value);
  for (const [index, token] of inputTokens.entries()) {
    const clean = token.replace(/[.,;:]+$/u, "");
    const previous = inputTokens[index - 1]?.replace(/[.,;:]+$/u, "");
    const nounGrammarSuffix = FUSED_NOUN_GRAMMAR_SUFFIXES.has(clean)
      && FUSED_NOUN_GRAMMAR_HEADS.has(previous);
    const mood = fusedMoods.has(clean) && index === inputTokens.length - 1;
    if (
      rendered.length > 0 &&
      (fusedEndings.has(clean) || nounGrammarSuffix || mood) &&
      (!sentenceParticles.has(clean) || mood) &&
      !/^"/u.test(token)
    ) {
      rendered[rendered.length - 1] += token;
      continue;
    }
    rendered.push(token);
  }
  return rendered.join(" ");
}

function phraseSurface(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  if (typeof value.name === "string") return value.name;
  if (typeof value.text === "string") return JSON.stringify(value.text);
  if (typeof value.num === "number") return String(value.num);
  if (typeof value.bool === "boolean") return value.bool ? "truth" : "lie";
  return "";
}

export function renderPyashSentenceSurface(sentence) {
  if (!sentence || typeof sentence !== "object") return "";
  const parts = [
    phraseSurface(sentence.su),
    phraseSurface(sentence.ob),
    typeof sentence.be === "string" ? sentence.be : "",
    typeof sentence.mood === "string" ? sentence.mood : ""
  ].filter(Boolean);
  return renderPyashSurface(parts.join(" "));
}

// Pyac is the VLIW-compatible word form. Keep the older export names as
// compatibility aliases for callers that adopted the first pipeline pass.
export const renderPyacSurface = renderPyashSurface;
export const renderPyacSentenceSurface = renderPyashSentenceSurface;

export const PYASH_SURFACE_FUSED_ENDINGS = Object.freeze([...FUSED_ENDINGS]);
export const PYASH_SURFACE_SENTENCE_PARTICLES = Object.freeze([...SENTENCE_PARTICLES]);
export const PYASH_SURFACE_FUSED_MOODS = Object.freeze([...FUSED_MOODS]);
export const PYASH_SURFACE_FUSED_NOUN_GRAMMAR_HEADS = Object.freeze([...FUSED_NOUN_GRAMMAR_HEADS]);
export const PYASH_SURFACE_FUSED_NOUN_GRAMMAR_SUFFIXES = Object.freeze([...FUSED_NOUN_GRAMMAR_SUFFIXES]);

import { sentenceToPyash } from "../../../beautiful.mjs";

// These are the short grammatical endings used by the lwonprom grammar.
// Sentence moods remain separate final particles; noun, adjective, case,
// voice, tense, and aspect endings join the word immediately before them.
const FUSED_ENDINGS = new Set([
  "ye", "pu", "ci",
  "na", "ka", "ta", "wu", "ti", "ma", "yi", "yu",
  "mwah", "pwah", "swih", "da", "te", "ga", "so", "pwih",
  "twah", "twih", "myah", "lwah", "lwih", "ksih", "tweh", "nweh",
  "lweh", "we", "twoh", "de", "nwah", "tloh", "nyeh", "sweh",
  "txih", "gvih", "ryoh", "pwok", "psek", "pxeh", "pxoh", "dxoh",
  "greh", "rweh", "xwih", "kxeh", "lwoh", "bvah", "dvah", "je",
  "gveh", "vwih", "bveh", "dzih", "tsi7h", "vyah", "gvah", "zreh",
  "bu", "sa7", "si7", "tsi2h", "ta7",
  "ra", "ki", "pfih", "pyoh"
]);

const SENTENCE_PARTICLES = new Set([
  "ya", "do", "tu", "cu", "si", "ri", "tcih", "lo", "cyih", "dwih",
  "pcih", "psih", "tseh", "twuh", "rwih", "jwih", "mwih", "mu", "nwoh",
  "lu", "byih", "kcu7h", "dyah", "pceh", "pruh", "swuh", "ru", "ksuh",
  "t6", "zlih", "n6", "gyih", "pi7", "si2", "prah", "def"
]);

function tokens(value) {
  if (typeof value !== "string") return [];
  return value.match(/"[^"\n]*"|\S+/gu) ?? [];
}

export function renderPyashSurface(value, {
  fusedEndings = FUSED_ENDINGS,
  sentenceParticles = SENTENCE_PARTICLES
} = {}) {
  const rendered = [];
  for (const token of tokens(value)) {
    const clean = token.replace(/[.,;:]+$/u, "");
    if (
      rendered.length > 0 &&
      fusedEndings.has(clean) &&
      !sentenceParticles.has(clean) &&
      !/^"/u.test(token)
    ) {
      rendered[rendered.length - 1] += token;
      continue;
    }
    rendered.push(token);
  }
  return rendered.join(" ");
}

export function renderPyashSentenceSurface(sentence) {
  return renderPyashSurface(sentenceToPyash(sentence));
}

export const PYASH_SURFACE_FUSED_ENDINGS = Object.freeze([...FUSED_ENDINGS]);
export const PYASH_SURFACE_SENTENCE_PARTICLES = Object.freeze([...SENTENCE_PARTICLES]);

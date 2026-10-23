import {
  COMPOUND_LEXICON_NAMES,
  loadCompoundLexicon,
  parseCompoundLexicon,
  queryCompoundLexicon
} from "./compound_lexicon.mjs";
export {
  buildDerivedCompoundCoverage,
  loadCuratedCompoundDecompositions,
  renderDerivedCompoundCoveragePya,
  resolveDerivedCompound,
  sourceTermsFromDictionaryRows
} from "./compound_coverage.mjs";
export {
  buildCompoundVerificationPrompt,
  classifyCompoundCertainty,
  classifyCompoundCoverage,
  createDefaultMindCompoundVerifier,
  createMindCompoundVerifier,
  parseCompoundVerificationResponse,
  verifyCompoundCoverage
} from "./compound_verification.mjs";

const sources = Object.freeze({
  french: "compound_lexicon_french.pya",
  russian: "compound_lexicon_russian.pya",
  hindi: "compound_lexicon_hindi.pya",
  interlingua: "compound_lexicon_interlingua.pya"
});

export const MULTILINGUAL_COMPOUND_LEXICON_SOURCES = sources;

function sourceFor(language) {
  const filename = sources[language];
  if (!filename) throw new Error(`unsupported compound lexicon language: ${language}`);
  return new URL(`./${filename}`, import.meta.url);
}

export function parseMultilingualCompoundLexicon(source, language) {
  return parseCompoundLexicon(source, {
    name: COMPOUND_LEXICON_NAMES[language],
    language
  });
}

export function loadMultilingualCompoundLexicon(language, { url = sourceFor(language) } = {}) {
  return loadCompoundLexicon({
    url,
    name: COMPOUND_LEXICON_NAMES[language],
    language
  });
}

export function queryMultilingualCompoundLexicon(entries, language, criteria = {}) {
  return queryCompoundLexicon(entries, criteria, {
    name: COMPOUND_LEXICON_NAMES[language],
    language
  });
}

export const loadFrenchCompoundLexicon = (options) => loadMultilingualCompoundLexicon("french", options);
export const loadRussianCompoundLexicon = (options) => loadMultilingualCompoundLexicon("russian", options);
export const loadHindiCompoundLexicon = (options) => loadMultilingualCompoundLexicon("hindi", options);
export const loadInterlinguaCompoundLexicon = (options) => loadMultilingualCompoundLexicon("interlingua", options);

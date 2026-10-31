import {
  COMPOUND_LEXICON_NAMES,
  loadChineseCompoundLexicon,
  loadCompoundLexicon,
  parseCompoundLexicon,
  queryCompoundLexicon
} from "./compound_lexicon.mjs";
import pyashWords from "../pyashWords.json" with { type: "json" };
import { buildCompoundAtomLinks } from "./compound_atom_links.mjs";
export {
  buildCompoundAtomLinks,
  linkCompoundToAtom,
  linkedCompoundAtom
} from "./compound_atom_links.mjs";
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

export function parseMultilingualCompoundLexicon(source, language, { atomicEntries = pyashWords } = {}) {
  return parseCompoundLexicon(source, {
    name: COMPOUND_LEXICON_NAMES[language],
    language,
    atomicEntries
  });
}

export function loadMultilingualCompoundLexicon(language, { url = sourceFor(language), atomicEntries = pyashWords } = {}) {
  return loadCompoundLexicon({
    url,
    name: COMPOUND_LEXICON_NAMES[language],
    language,
    atomicEntries
  });
}

export async function loadAllCompoundAtomLinks({ atomicEntries = pyashWords } = {}) {
  const catalogs = await Promise.all([
    loadChineseCompoundLexicon({ atomicEntries }),
    ...Object.keys(sources).map((language) => loadMultilingualCompoundLexicon(language, { atomicEntries }))
  ]);
  return buildCompoundAtomLinks({
    atomicEntries,
    compoundEntries: catalogs.flat()
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

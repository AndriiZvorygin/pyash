import { readFileSync } from "node:fs";

import {
  decodePhraseVliw,
  lowerPhraseVliw,
  renderVliwPyac,
  renderVliwStructuralPyash
} from "../../../library/vliw/phrase.mjs";
import { renderEnglishFromVliw } from "./pyac_to_english_pyash.mjs";
import { parseLordPrayerLowering } from "./lord_prayer_lowering.mjs";

export const LORD_PRAYER_TRANSLATION_FORMAT = "lord-prayer-translation-v2";

const DEFAULT_LOWERING = parseLordPrayerLowering(readFileSync(
  new URL("./lord_prayer_lowering.pya", import.meta.url),
  "utf8"
));

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-lord-prayer-translation";
  error.details = details;
  return error;
}

function selected(lexicon, term) {
  const entry = lexicon?.entries?.find((candidate) => candidate?.term === term);
  const candidate = entry?.semanticCandidates?.find((item) => item.id === entry.selectedCandidateId);
  if (!candidate?.pyashSequence?.length) {
    throw invalid("Lord's Prayer translation requires a selected Pyash candidate", { term });
  }
  return [...candidate.pyashSequence];
}

export function renderLordPrayerClauseFromVliw(input, { signatures = [] } = {}) {
  const decoded = decodePhraseVliw(input);
  const structural = renderVliwStructuralPyash(decoded);
  const index = signatures.indexOf(structural);
  if (index < 0) {
    throw invalid("Lord's Prayer VLIW clause has no semantic projection", { structural });
  }
  const pyac = renderVliwPyac(decoded);
  const english = renderEnglishFromVliw(decoded);
  return {
    index,
    pyash: english.englishPyash,
    structural,
    pyac,
    englishPyash: english.englishPyash,
    english: english.english,
    vliw: {
      format: decoded.format,
      words: [...decoded.words],
      vectors: decoded.vectors.map((vector) => [...vector]),
      phraseEnds: [...decoded.phraseEnds],
      moodIndex: decoded.moodIndex
    }
  };
}

function lowerSequence(sequence, lexicon) {
  return sequence.flatMap((item) => {
    if (item.term) {
      const selectedSequence = selected(lexicon, item.term);
      if (item.take !== undefined && item.take > selectedSequence.length) {
        throw invalid("Lord's Prayer lowering take exceeds selected term sequence", {
          term: item.term,
          take: item.take,
          length: selectedSequence.length
        });
      }
      return [
        ...selectedSequence.slice(0, item.take ?? selectedSequence.length),
        ...item.markers
      ];
    }
    return [item.pya];
  });
}

function clause(index, loweringClause, components, signatures) {
  const lowered = lowerPhraseVliw({ tokens: components });
  const projection = renderLordPrayerClauseFromVliw(lowered.vectors, { signatures });
  const { locator, source } = loweringClause;
  if (projection.index !== index) {
    throw invalid("Lord's Prayer clause order does not match its VLIW projection", { locator, index, actual: projection.index });
  }
  return {
    id: `lord-prayer-${locator.toLowerCase().replace(/[^a-z0-9]+/gu, "-")}`,
    locator,
    canonical: source,
    source,
    components: [...components],
    ...projection
  };
}

export function buildLordPrayerTranslation({ lexicon, lowering = DEFAULT_LOWERING } = {}) {
  if (!lexicon || !Array.isArray(lexicon.entries)) {
    throw invalid("Lord's Prayer translation requires a parsed lexicon");
  }
  if (!lowering || !Array.isArray(lowering.clauses) || lowering.clauses.length === 0) {
    throw invalid("Lord's Prayer translation requires parsed lowering data");
  }
  const prepared = lowering.clauses.map((loweringClause) => ({
    loweringClause,
    components: lowerSequence(loweringClause.sequence, lexicon)
  }));
  const signatures = prepared.map(({ components }) => renderVliwStructuralPyash(
    decodePhraseVliw(lowerPhraseVliw({ tokens: components }).vectors)
  ));
  const clauses = prepared.map(({ loweringClause, components }, index) => (
    clause(index, loweringClause, components, signatures)
  ));

  return {
    format: LORD_PRAYER_TRANSLATION_FORMAT,
    reference: lowering.metadata.reference,
    clauses
  };
}

import {
  decodePhraseVliw,
  lowerPhraseVliw,
  renderVliwPyac,
  renderVliwStructuralPyash
} from "../../../library/vliw/phrase.mjs";
import { renderEnglishFromVliw } from "./pyac_to_english_pyash.mjs";

export const LORD_PRAYER_TRANSLATION_FORMAT = "lord-prayer-translation-v1";

const CLAUSE_SOURCES = Object.freeze([
  ["Matthew 6:9a", "Our Father in heaven, may your name be kept holy."],
  ["Matthew 6:10a", "Let your Kingdom come."],
  ["Matthew 6:10b", "Let your will be done, as in heaven, so on earth."],
  ["Matthew 6:11", "Give us today our daily bread."],
  ["Matthew 6:12a", "Forgive us our debts."],
  ["Matthew 6:12b", "As we also forgive our debtors."],
  ["Matthew 6:13a", "Bring us not into temptation."],
  ["Matthew 6:13b", "But deliver us from the evil one."],
  ["Matthew 6:13c", "For yours is the Kingdom, the power, and the glory forever."],
  ["Matthew 6:13d", "Amen."]
]);

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

function ending(sequence, ...markers) {
  const result = [...sequence];
  if (result.length === 0) throw invalid("Lord's Prayer phrase has no lexical head");
  result.push(...markers);
  return result;
}

const LORD_PRAYER_VLIW_SIGNATURES = Object.freeze([
  "nyah ye hpap wu cyak te sa ye hnim na swut pyoh jwih",
  "sa ye hyap syun na hlam jwih",
  "sa ye hmuc na cyak te tlap ta tcun jwih",
  "nyah yi tren myah nyah ye dlat ci hpup ka kwin pcih",
  "nyah yi nyah ye hdef pu ka hson pcih",
  "nyah na pcah nyah ye hdef hgen pu ka hson ra li",
  "nyah yi no hyoc ma tlak pcih",
  "pyuh nyah yi cwak so hxuc pcih",
  "hyap syun na wa htaf na wa nyam na hnis pu myah sa ye li",
  "hret li"
]);

export function renderLordPrayerClauseFromVliw(input) {
  const decoded = decodePhraseVliw(input);
  const pyash = renderVliwStructuralPyash(decoded);
  const index = LORD_PRAYER_VLIW_SIGNATURES.indexOf(pyash);
  if (index < 0) {
    throw invalid("Lord's Prayer VLIW clause has no semantic projection", { pyash });
  }
  const pyac = renderVliwPyac(decoded);
  const english = renderEnglishFromVliw(decoded);
  return {
    index,
    pyash,
    pyac,
    pyashSurface: pyac,
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

function clause(index, components) {
  const [locator, source] = CLAUSE_SOURCES[index];
  const lowered = lowerPhraseVliw({ tokens: components });
  const projection = renderLordPrayerClauseFromVliw(lowered.vectors);
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

export function buildLordPrayerTranslation({ lexicon } = {}) {
  if (!lexicon || !Array.isArray(lexicon.entries)) {
    throw invalid("Lord's Prayer translation requires a parsed lexicon");
  }

  const our = selected(lexicon, "our");
  const us = our.slice(0, 1);
  const yours = selected(lexicon, "yours");
  const kingdom = selected(lexicon, "kingdom");
  const clauses = [
    clause(0, [
      ...our,
      ...ending(selected(lexicon, "father"), "wu"),
      ...ending(selected(lexicon, "heaven"), "te"),
      ...yours,
      ...ending(selected(lexicon, "name"), "na"),
      ...selected(lexicon, "holy"), "pyoh", "jwih"
    ]),
    clause(1, [
      ...yours,
      ...ending(kingdom, "na"),
      ...selected(lexicon, "come"), "jwih"
    ]),
    clause(2, [
      ...yours,
      ...ending(selected(lexicon, "will"), "na"),
      ...ending(selected(lexicon, "heaven"), "te"),
      ...ending(selected(lexicon, "earth"), "ta"),
      "tcun", "jwih"
    ]),
    clause(3, [
      ...ending(us, "yi"),
      ...ending(selected(lexicon, "today"), "myah"),
      ...our,
      ...selected(lexicon, "daily"),
      ...selected(lexicon, "give"), "pcih"
    ]),
    clause(4, [
      ...ending(us, "yi"),
      ...our,
      ...ending(selected(lexicon, "debts"), "ka"),
      ...selected(lexicon, "forgive"), "pcih"
    ]),
    clause(5, [
      ...ending(us, "na"),
      "pcah",
      ...our,
      ...ending(selected(lexicon, "debtors"), "ka"),
      ...selected(lexicon, "forgive"), "ra", "li"
    ]),
    clause(6, [
      ...ending(us, "yi"),
      "no",
      ...ending(selected(lexicon, "temptation"), "ma"),
      ...selected(lexicon, "bring"), "pcih"
    ]),
    clause(7, [
      "pyuh",
      ...ending(us, "yi"),
      ...ending(selected(lexicon, "evil"), "so"),
      ...selected(lexicon, "deliver"), "pcih"
    ]),
    clause(8, [
      ...ending(kingdom, "na"),
      "wa",
      ...ending(selected(lexicon, "power"), "na"),
      "wa",
      ...ending(selected(lexicon, "glory"), "na"),
      ...ending(selected(lexicon, "forever"), "pu", "myah"),
      ...yours,
      "li"
    ]),
    clause(9, [...selected(lexicon, "amen"), "li"])
  ];

  return {
    format: LORD_PRAYER_TRANSLATION_FORMAT,
    reference: "Matthew 6:9-13",
    clauses
  };
}

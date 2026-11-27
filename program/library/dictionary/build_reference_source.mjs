import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseCsv } from "csv-parse/sync";

import pyashWords from "../pyashWords.json" with { type: "json" };
import { buildProgram } from "../../program.mjs";
import { loadEnglish30k, english30kLookupVariants, normalizeEnglish30kWord } from "../translation/english30k_coverage.mjs";
import { loadEnglishWordNetBridges } from "../translation/english_wordnet_bridges.mjs";
import { loadEnglishWordNetFrequencyResources } from "../translation/english_wordnet_frequency.mjs";
import { parseCompoundLexicon } from "../translation/compound_lexicon.mjs";
import { harvestWiktionary } from "../../../command/wiktionary_harvest.mjs";
import {
  parseCowWordNetCrosswalkPya,
  lookupCowChineseFormsByWordNetSenses
} from "../translation/cow_wordnet_crosswalk.mjs";
import {
  acceptedChineseCharacterAtomRows,
  parseChineseCharacterAtomLinks
} from "../translation/chinese_character_atom_refinery.mjs";
import { loadEnglishGrammarCatalog } from "../translation/english_grammar.mjs";
import { collectOperationSignatures } from "./operation_signatures.mjs";
import { defaultVerbSpelling } from "./verb_defaults.mjs";

const OUTPUT = new URL("./reference.pya", import.meta.url);
const RELEASE = "Open English WordNet 2025";
const SUMO_RELEASE = "WordNet 3.0 mapping snapshot f0c126842d098a312e390479b38ecfbac018f8ed";
const CURATED_GLOSS_RELEASE = "pyash authored";
// A concept WordNet does not index can still have a standard definition if
// Wiktionary carries one. The archive is mounted on the Kiwix host, so the
// identifier is the article name and the URL is derived from it: nothing is
// downloaded into the repository.
const WIKTIONARY_DATASET = "wiktionary";
const WIKTIONARY_RELEASE = "en_all_nopic_2026-08";
const WIKTIONARY_SITE = "https://zim.zvorygin.ca";
/**
 * How many bridge senses the build is allowed to drop, by reason.
 *
 * These were silent `continue`s until the counts were made visible. The
 * `ambiguousTarget` figure dominates because a compound may declare the same
 * English target as an atom and as its sibling compounds (`death` is `mwan` plus
 * five compounds), so the surface no longer names one sequence. Resolving that is
 * a vocabulary decision, not something the builder may guess.
 *
 * The baseline is a ceiling, not a target: raising it is a deliberate edit that
 * says "we know more senses are now unplaceable, and we accept it".
 */
const DROPPED_SENSE_BASELINE = Object.freeze({
  ambiguousTarget: 4741,
  absentTarget: 20,
  malformedSense: 0,
  compoundNoSequence: 6,
  compoundNoDefinition: 0
});
const ACCEPTED_CURATED_STATUSES = new Set(["accepted-curated", "accepted-delimited", "accepted-deterministic"]);
const ACCEPTED_WORDNET_STATUSES = new Set(["accepted-llm", "repaired-llm", "accepted-deterministic"]);
const LANGUAGE_FILES = Object.freeze({
  ar: "dictionary_ar.json",
  es: "dictionary_es.json",
  fi: "dictionary_fi.json",
  fr: "dictionary_fr.json",
  he: "dictionary_he.json",
  hi: "dictionary_hi.json",
  ia: "dictionary_ia.json",
  id: "dictionary_id.json",
  isv: "dictionary_isv.json",
  nl: "dictionary_nl.json",
  ru: "dictionary_ru.json",
  tr: "dictionary_tr.json",
  uk: "dictionary_uk.json",
  zh: "dictionary_zh.json"
});
const POS = new Set(["a", "n", "r", "s", "v"]);
const HAN = /\p{Script=Han}/u;
const ATOM_BY_PYA = new Map(pyashWords.map((row) => [String(row.pya).toLowerCase(), row]));
const CANONICAL_PYA_BY_HNUC = new Map();
for (const row of pyashWords) {
  const hnuc = String(row.hnuc).toLowerCase();
  if (!CANONICAL_PYA_BY_HNUC.has(hnuc)) CANONICAL_PYA_BY_HNUC.set(hnuc, row.pya);
}

function normalizedSurface(value) {
  return normalizeEnglish30kWord(String(value ?? "").replace(/[_-]+/gu, " "));
}

function sequenceKey(sequence) {
  return canonicalizeSequence(sequence).join(" ");
}

function canonicalizeSequence(sequence) {
  return sequence.map((word) => {
    const atom = ATOM_BY_PYA.get(String(word).trim().toLowerCase());
    if (!atom) throw new Error(`compound or dictionary key uses an unknown Pyash atom: ${word}`);
    return CANONICAL_PYA_BY_HNUC.get(String(atom.hnuc).toLowerCase());
  });
}

function addForm(entry, language, value) {
  const surface = String(value ?? "").normalize("NFC").trim();
  if (!surface) return;
  const normalized = surface.normalize("NFC");
  if (!normalized) return;
  const identity = `${language}\u0000${normalized}`;
  if (!entry.formIdentities.has(identity)) {
    entry.formIdentities.add(identity);
    entry.forms.push({ language, surface, normalized });
  }
}

function addSourceLink(entry, dataset, release, identifier, relation) {
  const identity = `${dataset}\u0000${release}\u0000${identifier}\u0000${relation}`;
  if (!entry.sourceLinkIdentities.has(identity)) {
    entry.sourceLinkIdentities.add(identity);
    entry.sourceLinks.push({ dataset, release, identifier, relation });
  }
}

// An authored gloss for a concept with no WordNet sense. It is recorded under
// its own dataset so a reader can distinguish an authored definition from a
// WordNet sense gloss.
function addSourceGloss(entry, language, dataset, release, identifier, gloss) {
  const text = String(gloss ?? "").normalize("NFC").trim();
  if (!text) return;
  const identity = `${language}\u0000${dataset}\u0000${release}\u0000${identifier}\u0000${text}`;
  if (entry.sourceGlossIdentities.has(identity)) return;
  entry.sourceGlossIdentities.add(identity);
  entry.sourceGlosses.push({ language, dataset, release, identifier, text });
}

function addWordNetSense(entry, candidate) {
  const identifier = String(candidate.senseId ?? candidate.source ?? "").trim().toLowerCase();
  const gloss = String(candidate.gloss ?? candidate.definition ?? "").normalize("NFC").trim();
  if (!/^[anrvs]:\d{8}-[anrvs]$/u.test(identifier) || !POS.has(identifier[0]) || !gloss) return;
  addSourceLink(entry, "wordnet", RELEASE, identifier, "exact-sense");
  const identity = `${identifier}\u0000${gloss}`;
  if (!entry.sourceGlossIdentities.has(identity)) {
    entry.sourceGlossIdentities.add(identity);
    entry.sourceGlosses.push({
      language: "en",
      dataset: "wordnet",
      release: RELEASE,
      identifier,
      text: gloss
    });
  }
  for (const lemma of candidate.lemmas ?? []) addForm(entry, "en", lemma);
  addForm(entry, "en", candidate.target);
}

function buildEnglishFrequencyIndex(rows) {
  const ranks = new Map();
  for (const row of rows) {
    for (const variant of english30kLookupVariants(row.word)) {
      const prior = ranks.get(variant);
      if (prior === undefined || row.rank < prior) ranks.set(variant, row.rank);
    }
  }
  return (value) => english30kLookupVariants(value)
    .map((variant) => ranks.get(variant))
    .filter(Number.isSafeInteger)
    .reduce((best, rank) => Math.min(best, rank), Number.POSITIVE_INFINITY);
}

function buildWordNetTagCountIndex(entries) {
  const counts = new Map();
  for (const row of entries) {
    const id = `${row.pos}:${row.synset}`.toLowerCase();
    if (!Number.isSafeInteger(row.tagCount) || row.tagCount < 0) continue;
    counts.set(id, Math.max(counts.get(id) ?? -1, row.tagCount));
  }
  return counts;
}

function wordCount(value) {
  return [...normalizedSurface(value).replace(/[\s\p{Pd}]/gu, "")]
    .filter((character) => /\p{L}/u.test(character)).length;
}

function compareCandidates(left, right, rankForEnglish, tagCounts) {
  const leftRank = rankForEnglish(left.target);
  const rightRank = rankForEnglish(right.target);
  if (leftRank !== rightRank) return leftRank - rightRank;
  const leftTags = tagCounts.get(left.senseId) ?? null;
  const rightTags = tagCounts.get(right.senseId) ?? null;
  if (leftTags !== null && rightTags !== null && leftTags !== rightTags) return rightTags - leftTags;
  return wordCount(left.target) - wordCount(right.target)
    || normalizedSurface(left.target).localeCompare(normalizedSurface(right.target))
    || String(left.senseId).localeCompare(String(right.senseId))
    || Number(left.provenance !== "wordnet-bridge") - Number(right.provenance !== "wordnet-bridge")
    || sequenceKey(left.pyashSequence).localeCompare(sequenceKey(right.pyashSequence));
}

function parseMapRows(source, name) {
  const sentences = buildProgram(source).sentences;
  if (!sentences.some((sentence) => sentence?.mood === "def" && sentence?.be === "map" && sentence?.su?.name === name)) {
    throw new Error(`missing Pyash map ${name}`);
  }
  return sentences.filter((sentence) => sentence?.mood === "ya"
    && typeof sentence.su?.text === "string"
    && typeof sentence.ob?.text === "string");
}

function decodeJsonRows(rows, label) {
  return rows.flatMap((sentence) => {
    try {
      const value = JSON.parse(sentence.ob.text);
      return Array.isArray(value) ? value : [value];
    } catch (error) {
      throw new Error(`${label} has malformed JSON at ${sentence.su.text}: ${error.message}`);
    }
  });
}

function buildUniqueTargetIndex(entries, atomRows = pyashWords) {
  const variants = new Map();
  const add = (surface, sequence) => {
    if (!surface || !Array.isArray(sequence) || sequence.length === 0) return;
    const canonicalSequence = canonicalizeSequence(sequence);
    for (const variant of english30kLookupVariants(surface)) {
      const sequences = variants.get(variant) ?? new Map();
      sequences.set(sequenceKey(canonicalSequence), canonicalSequence);
      variants.set(variant, sequences);
    }
  };
  for (const atom of atomRows) add(atom.en, [atom.pya]);
  for (const entry of entries) {
    add(entry.target, entry.pyashSequence);
    for (const alias of entry.aliases ?? []) add(alias, entry.pyashSequence);
  }
  return {
    /**
     * Resolve a surface to its one canonical sequence.
     *
     * Returns a discriminated result rather than `null` so the caller can say
     * *why* a target failed. An ambiguous target (`name` matches `cyik hnim`,
     * `hwum hnim`, `txif hnim`) and an absent one are different problems: the
     * first needs a vocabulary decision, the second needs a new entry.
     */
    resolve(surface) {
      const matches = new Map();
      for (const variant of english30kLookupVariants(surface)) {
        for (const [key, sequence] of variants.get(variant) ?? []) matches.set(key, sequence);
      }
      if (matches.size === 0) return { kind: "none" };
      if (matches.size > 1) return { kind: "ambiguous", sequences: [...matches.values()] };
      return { kind: "one", sequence: [...matches.values()][0] };
    }
  };
}

function collectAcceptedCompounds(curated, verified) {
  const bySequence = new Map();
  const all = [];
  const append = (entry, source) => {
    const accepted = source === "curated"
      ? ACCEPTED_CURATED_STATUSES.has(entry.status)
      : ACCEPTED_WORDNET_STATUSES.has(entry.status);
    if (!accepted || entry.pyashSequence?.length < 2) return;
    const sequence = entry.pyashSequence.map((word) => String(word).trim());
    if (sequence.some((word) => !word)) return;
    const normalized = { ...entry, source, pyashSequence: sequence };
    all.push(normalized);
    const key = sequenceKey(sequence);
    const rows = bySequence.get(key) ?? [];
    rows.push(normalized);
    bySequence.set(key, rows);
  };
  for (const row of curated) append(row, "curated");
  for (const row of verified) append(row, "wordnet");
  return { all, bySequence };
}

function reviewedSenseSequences(vocabularyReviews, bridgeEntries) {
  const bridgesBySense = new Map(bridgeEntries.map((row) => [String(row.source ?? "").toLowerCase(), row]));
  const reviewed = new Map();
  for (const review of vocabularyReviews) {
    if (review?.reviewStatus !== "accepted-curated") continue;
    const senseId = String(review.senseId ?? "").toLowerCase();
    const bridge = bridgesBySense.get(senseId);
    if (!bridge) throw new Error(`accepted vocabulary review references missing WordNet sense: ${senseId}`);
    const bridgePos = String(bridge.targetPartOfSpeech || senseId[0]).toLowerCase();
    const normalizedBridgePos = bridgePos === "s" ? "a" : bridgePos;
    const reviewPos = String(review.targetPartOfSpeech ?? "").toLowerCase();
    const normalizedReviewPos = reviewPos === "s" ? "a" : reviewPos;
    if (normalizedSurface(review.coverageTarget ?? review.target) !== normalizedSurface(bridge.target)
      || normalizedReviewPos !== normalizedBridgePos) {
      throw new Error(`accepted vocabulary review conflicts with WordNet bridge for ${senseId}`);
    }
    const sequence = canonicalizeSequence(review.pyashSequence ?? []);
    if (!sequence.length) throw new Error(`accepted vocabulary review has no Pyash sequence: ${senseId}`);
    const previous = reviewed.get(senseId);
    if (previous && sequenceKey(previous) !== sequenceKey(sequence)) {
      throw new Error(`conflicting accepted vocabulary reviews for ${senseId}`);
    }
    reviewed.set(senseId, sequence);
  }
  return reviewed;
}

function chooseSenseWinners(bridgeEntries, compoundGlosses, targetIndex, rankForEnglish, tagCounts, vocabularyReviews = []) {
  const candidates = [];
  const reviewedSequences = reviewedSenseSequences(vocabularyReviews, bridgeEntries);
  // Every skip is counted with a reason. These used to be bare `continue`s, so
  // thousands of bridge senses could vanish without the build mentioning it.
  const drops = {
    ambiguousTarget: { count: 0, examples: [] },
    absentTarget: { count: 0, examples: [] },
    malformedSense: { count: 0, examples: [] },
    compoundNoSequence: { count: 0, examples: [] },
    compoundNoDefinition: { count: 0, examples: [] }
  };
  const recordDrop = (reason, detail) => {
    const bucket = drops[reason];
    bucket.count += 1;
    if (bucket.examples.length < 5) bucket.examples.push(detail);
  };
  for (const row of bridgeEntries) {
    const senseId = String(row.source ?? "").toLowerCase();
    const reviewed = reviewedSequences.get(senseId);
    let sequence = reviewed;
    if (!sequence) {
      const resolved = targetIndex.resolve(row.target);
      if (resolved.kind === "ambiguous") {
        recordDrop("ambiguousTarget", {
          target: row.target,
          candidates: resolved.sequences.map(sequenceKey),
          senseId
        });
        continue;
      }
      if (resolved.kind === "none") {
        recordDrop("absentTarget", { target: row.target });
        continue;
      }
      sequence = resolved.sequence;
    }
    if (!/^[anrvs]:\d{8}-[anrvs]$/u.test(senseId) || !row.gloss) {
      recordDrop("malformedSense", { senseId, target: row.target, hasGloss: Boolean(row.gloss) });
      continue;
    }
    candidates.push({
      senseId,
      target: row.target,
      partOfSpeech: (row.targetPartOfSpeech || senseId[0]) === "s" ? "a" : row.targetPartOfSpeech || senseId[0],
      pyashSequence: sequence,
      gloss: row.gloss,
      lemmas: [...(row.lemmas ?? [])],
      equivalenceGroup: row.equivalenceGroup ?? "",
      provenance: "wordnet-bridge"
    });
  }
  for (const row of compoundGlosses) {
    const sequence = Array.isArray(row.pyashSequence) ? canonicalizeSequence(row.pyashSequence) : [];
    const senseId = String(row.senseId ?? "").toLowerCase();
    const reviewedSequence = reviewedSequences.get(senseId);
    if (reviewedSequence && sequenceKey(sequence) !== sequenceKey(reviewedSequence)) {
      recordDrop("compoundNoSequence", { senseId, reason: "reviewed sequence disagrees", target: row.target });
      continue;
    }
    const rawPartOfSpeech = String(row.partOfSpeech ?? senseId[0] ?? "").toLowerCase();
    const partOfSpeech = rawPartOfSpeech === "s" ? "a" : rawPartOfSpeech;
    if (sequence.length < 2 || !/^[anrvs]:\d{8}-[anrvs]$/u.test(senseId) || !POS.has(partOfSpeech)) {
      recordDrop("compoundNoSequence", { senseId, target: row.target });
      continue;
    }
    if (!row.definition) {
      recordDrop("compoundNoDefinition", { senseId, target: row.target });
      continue;
    }
    candidates.push({
      senseId,
      target: row.target,
      partOfSpeech,
      pyashSequence: sequence,
      gloss: row.definition,
      lemmas: [...(row.lemmas ?? [])],
      equivalenceGroup: "",
      provenance: "accepted-wordnet-compound"
    });
  }

  const uniqueCandidates = new Map();
  for (const candidate of candidates) {
    const identity = `${candidate.senseId}\u0000${sequenceKey(candidate.pyashSequence)}\u0000${normalizedSurface(candidate.target)}`;
    const prior = uniqueCandidates.get(identity);
    if (!prior) uniqueCandidates.set(identity, candidate);
    else {
      prior.lemmas = [...new Set([...prior.lemmas, ...candidate.lemmas])];
      if (!prior.gloss && candidate.gloss) prior.gloss = candidate.gloss;
      if (!prior.equivalenceGroup && candidate.equivalenceGroup) prior.equivalenceGroup = candidate.equivalenceGroup;
    }
  }

  const bySense = new Map();
  for (const candidate of uniqueCandidates.values()) {
    const rows = bySense.get(candidate.senseId) ?? [];
    rows.push(candidate);
    bySense.set(candidate.senseId, rows);
  }
  const senseWinners = [];
  for (const rows of bySense.values()) {
    rows.sort((left, right) => compareCandidates(left, right, rankForEnglish, tagCounts));
    senseWinners.push(rows[0]);
  }

  const byIdentity = new Map();
  for (const candidate of senseWinners) {
    const identity = `${sequenceKey(candidate.pyashSequence)}\u0000${candidate.partOfSpeech}`;
    const rows = byIdentity.get(identity) ?? [];
    rows.push(candidate);
    byIdentity.set(identity, rows);
  }
  const winners = [];
  let collisionGroups = 0;
  for (const rows of byIdentity.values()) {
    rows.sort((left, right) => compareCandidates(left, right, rankForEnglish, tagCounts));
    const equivalence = rows.length > 1
      && rows.every((row) => row.equivalenceGroup && row.equivalenceGroup === rows[0].equivalenceGroup);
    if (rows.length > 1) collisionGroups += 1;
    winners.push(...(equivalence ? rows : rows.slice(0, 1)));
  }
  return { winners, collisionGroups, candidateCount: candidates.length, drops };
}

function addChineseForms(entriesByKey, activeSenseToSequence, cowIndex, directChineseByCharacter, pinyinBySurface, jyutpingByCharacter) {
  const senseIds = [...activeSenseToSequence.keys()];
  const cowForms = lookupCowChineseFormsByWordNetSenses(cowIndex, senseIds);
  const cowCharacterCandidates = new Map();
  for (const form of cowForms) {
    const sequences = new Map();
    for (const senseId of form.matchedWordNetSenseIds) {
      const sequence = activeSenseToSequence.get(senseId);
      if (sequence) sequences.set(sequenceKey(sequence), sequence);
    }
    if (!sequences.size) continue;
    const hanCount = [...form.chinese].filter((character) => HAN.test(character)).length;
    if (hanCount === 1) {
      if (sequences.size !== 1) continue;
      const character = [...form.chinese].find((value) => HAN.test(value));
      const key = [...sequences.keys()][0];
      const candidates = cowCharacterCandidates.get(character) ?? new Map();
      candidates.set(key, sequences.get(key));
      cowCharacterCandidates.set(character, candidates);
      continue;
    }
    for (const sequence of sequences.values()) {
      const entry = entriesByKey.get(sequenceKey(sequence));
      if (entry) addForm(entry, "zh", form.chinese);
    }
  }
  for (const [character, sequenceRows] of cowCharacterCandidates) {
    const sequenceKeys = [...sequenceRows.keys()];
    if (sequenceKeys.length !== 1) continue;
    const sequenceKeyValue = sequenceKeys[0];
    const sequence = sequenceRows.get(sequenceKeyValue);
    if (!sequence || sequence.length !== 1) continue;
    const explicit = directChineseByCharacter.get(character);
    if (explicit && explicit !== sequenceKeyValue) continue;
    const entry = entriesByKey.get(sequenceKeyValue);
    if (entry) addForm(entry, "zh", character);
  }

  for (const [character, sequenceKeyValue] of directChineseByCharacter) {
    const entry = entriesByKey.get(sequenceKeyValue);
    if (!entry) continue;
    addForm(entry, "zh", character);
    for (const reading of pinyinBySurface.get(character) ?? []) addForm(entry, "zh-Latn-pinyin", reading);
    for (const reading of jyutpingByCharacter.get(character) ?? []) addForm(entry, "yue-Latn-jyutping", reading);
  }
}

function uniqueCharacterReading(surface, readingsByCharacter) {
  const characters = [...surface];
  if (!characters.length || characters.some((character) => !HAN.test(character))) return null;
  const readings = characters.map((character) => {
    const candidates = [...new Set(readingsByCharacter.get(character) ?? [])];
    return candidates.length === 1 ? candidates[0] : null;
  });
  if (readings.some((reading) => !reading)) return null;
  return readings.join(" ");
}

function addPinyinForms(entriesByKey, pinyinBySurface, jyutpingByCharacter) {
  const entriesByChineseSurface = new Map();
  for (const [key, entry] of entriesByKey) {
    for (const form of entry.forms) {
      if (form.language !== "zh") continue;
      const rows = entriesByChineseSurface.get(form.normalized) ?? new Map();
      rows.set(key, entry);
      entriesByChineseSurface.set(form.normalized, rows);
    }
  }
  for (const [surface, readings] of pinyinBySurface) {
    const candidates = entriesByChineseSurface.get(surface);
    if (candidates?.size !== 1) continue;
    const entry = [...candidates.values()][0];
    for (const reading of readings) addForm(entry, "zh-Latn-pinyin", reading);
  }
  for (const [surface, candidates] of entriesByChineseSurface) {
    if (candidates.size !== 1 || pinyinBySurface.has(surface)) continue;
    const pinyin = uniqueCharacterReading(surface, pinyinBySurface);
    const jyutping = uniqueCharacterReading(surface, jyutpingByCharacter);
    const entry = [...candidates.values()][0];
    if (pinyin) addForm(entry, "zh-Latn-pinyin", pinyin);
    if (jyutping) addForm(entry, "yue-Latn-jyutping", jyutping);
  }
}

function singleChineseOwners(entriesByKey) {
  const owners = new Map();
  for (const [key, entry] of entriesByKey) {
    for (const form of entry.forms) {
      if (form.language !== "zh") continue;
      const han = [...form.surface].filter((character) => HAN.test(character));
      if (han.length !== 1 || [...form.surface].length !== 1) continue;
      const keys = owners.get(form.surface) ?? new Set();
      keys.add(key);
      owners.set(form.surface, keys);
    }
  }
  return owners;
}

function addLegacyForms(entriesByKey, sourceDictionaries, rankForEnglish) {
  const englishIndex = new Map();
  for (const [key, entry] of entriesByKey) {
    for (const form of entry.forms) {
      if (form.language !== "en") continue;
      const normalized = normalizedSurface(form.surface);
      const keys = englishIndex.get(normalized) ?? new Set();
      keys.add(key);
      englishIndex.set(normalized, keys);
    }
  }
  const singleCharacterCandidates = new Map();
  for (const { language, rows } of sourceDictionaries) {
    for (const row of rows) {
      const normalizedEnglish = normalizedSurface(row.en);
      const keys = englishIndex.get(normalizedEnglish);
      const surface = String(row[language] ?? "").normalize("NFC").trim();
      if (!surface || !keys || keys.size !== 1) continue;
      const key = [...keys][0];
      const hanCount = [...surface].filter((character) => HAN.test(character)).length;
      if (language === "zh" && hanCount === 1) {
        const candidates = singleCharacterCandidates.get(surface) ?? [];
        candidates.push({ key, rank: rankForEnglish(row.en) });
        singleCharacterCandidates.set(surface, candidates);
      } else {
        addForm(entriesByKey.get(key), language, surface);
      }
    }
  }
  return singleCharacterCandidates;
}

function pyaEntryLines(entry) {
  const key = entry.sequence;
  const lines = [
    `su name tlat kwon ob text ${JSON.stringify(key)} at text "entry" be text ya`
  ];
  for (const form of entry.forms) {
    lines.push(`su name tlat kwon ob text ${JSON.stringify(key)} as text ${JSON.stringify(form.language)} from text ${JSON.stringify(form.surface)} to text ${JSON.stringify(form.normalized)} at text "lexical-form" be text ya`);
  }
  for (const link of entry.sourceLinks) {
    lines.push(`su name tlat kwon ob text ${JSON.stringify(key)} as text ${JSON.stringify(link.dataset)} from text ${JSON.stringify(link.release)} to text ${JSON.stringify(link.identifier)} by text ${JSON.stringify(link.relation)} at text "source-link" be text ya`);
  }
  for (const gloss of entry.sourceGlosses) {
    lines.push(`su name tlat kwon ob text ${JSON.stringify(key)} as text ${JSON.stringify(gloss.language)} from text ${JSON.stringify(gloss.dataset)} to text ${JSON.stringify(gloss.release)} by text ${JSON.stringify(gloss.identifier)} with text ${JSON.stringify(gloss.text)} at text "source-gloss" be text ya`);
  }
  for (const component of entry.components) {
    lines.push(`su name tlat kwon ob text ${JSON.stringify(key)} from text ${JSON.stringify(component)} at text "component" be text ya`);
  }
  for (const signature of entry.operationSignatures ?? []) {
    const dispatch = [
      signature.verb.length,
      ...signature.verb,
      signature.mood.length,
      ...signature.mood,
      signature.arguments.length,
      ...signature.arguments.flatMap((argument) => [
        argument.grammatical_case.length,
        ...argument.grammatical_case,
        argument.value_type.length,
        ...argument.value_type
      ])
    ];
    lines.push(`su name tlat kwon ob text ${JSON.stringify(key)} from ve ${dispatch.length} ${dispatch.join(" ")} at text "operation-signature" be text ya`);
    for (const argument of signature.arguments) {
      const descriptor = [
        argument.grammatical_case.length,
        ...argument.grammatical_case,
        argument.value_type.length,
        ...argument.value_type
      ];
      lines.push(`su name tlat kwon ob text ${JSON.stringify(key)} as ve ${descriptor.length} ${descriptor.join(" ")} from text ${JSON.stringify(argument.name)} to text ${JSON.stringify(argument.description)} at text "operation-argument" be text ya`);
    }
  }
  return lines;
}

export function buildAcceptedReferenceSource({
  atoms = pyashWords,
  bridgeCatalog,
  compoundEntries = [],
  compoundGlosses = [],
  vocabularyReviews = [],
  cowIndex,
  englishRows = [],
  wordNetFrequencyEntries = [],
  directChineseRows = [],
  grammarChineseRows = [],
  pinyinRows = [],
  jyutpingRows = [],
  legacyDictionaries = [],
  sumoRows = [],
  sumoConceptLinkRows = [],
  curatedGlosses = [],
  wiktionaryLinks = [],
  render = true
} = {}) {
  const entriesByKey = new Map();
  const getEntry = (sequence) => {
    const canonicalSequence = canonicalizeSequence(sequence);
    const key = sequenceKey(canonicalSequence);
    if (!entriesByKey.has(key)) {
      entriesByKey.set(key, {
        sequence: key,
        sequenceWords: [...canonicalSequence],
        forms: [],
        formIdentities: new Set(),
        sourceLinks: [],
        sourceLinkIdentities: new Set(),
        sourceGlosses: [],
        sourceGlossIdentities: new Set(),
        components: canonicalSequence.length > 1 ? [...canonicalSequence] : [],
        operationSignatures: []
      });
    }
    return entriesByKey.get(key);
  };

  for (const atom of atoms) {
    if (!atom?.pya || !atom?.en) continue;
    addForm(getEntry([atom.pya]), "en", atom.en);
  }
  for (const compound of compoundEntries) {
    if (!compound.pyashSequence?.length) continue;
    getEntry(compound.pyashSequence);
  }

  // The declared signature tables describe the verb surface. A verb can carry
  // signatures when every word of its key resolves to a vocabulary atom:
  // atomic verbs like `multiply` spell their English surface, whose atom is
  // `hgoc`, while compounds like `kl6m psas` already use pya words. Resolve the
  // English surface to its canonical pya key before building the entry.
  const { byVerb: signaturesByVerb } = collectOperationSignatures();
  let attachedSignatures = 0;
  const canonicalAtom = (token) => {
    if (ATOM_BY_PYA.has(token)) {
      return CANONICAL_PYA_BY_HNUC.get(String(ATOM_BY_PYA.get(token).hnuc).toLowerCase());
    }
    const englishAtom = atoms.find((row) => String(row.en).toLowerCase() === token);
    if (!englishAtom) return null;
    return CANONICAL_PYA_BY_HNUC.get(String(englishAtom.hnuc).toLowerCase());
  };
  for (const [verbKey, signatures] of signaturesByVerb) {
    const words = verbKey.split(" ").map((word) => word.trim().toLowerCase());
    // A surface with no atom may still carry a chosen default spelling, which is
    // itself a compound. Resolve through the same table the signature collector
    // uses so the entry key and the signature's verb words agree.
    const canonical = words.flatMap((word) => {
      const direct = canonicalAtom(word);
      if (direct) return [direct];
      const spelling = defaultVerbSpelling(word);
      return spelling ? spelling.map(canonicalAtom) : [null];
    });
    if (canonical.some((word) => !word)) continue;
    const entry = getEntry(canonical);
    entry.operationSignatures.push(...signatures);
    attachedSignatures += signatures.length;
  }

  const targetIndex = buildUniqueTargetIndex(compoundEntries, atoms);
  const rankForEnglish = buildEnglishFrequencyIndex(englishRows);
  const tagCounts = buildWordNetTagCountIndex(wordNetFrequencyEntries);
  const selectedSenses = chooseSenseWinners(
    bridgeCatalog.entries,
    compoundGlosses,
    targetIndex,
    rankForEnglish,
    tagCounts,
    vocabularyReviews
  );
  const activeSenseToSequence = new Map();
  for (const candidate of selectedSenses.winners) {
    const entry = getEntry(candidate.pyashSequence);
    addWordNetSense(entry, candidate);
    activeSenseToSequence.set(candidate.senseId, [...candidate.pyashSequence]);
  }
  const compoundsWithoutSense = new Map();
  for (const compound of compoundEntries) {
    if (!compound.pyashSequence?.length) continue;
    const key = sequenceKey(compound.pyashSequence);
    const group = compoundsWithoutSense.get(key) ?? [];
    group.push({
      senseId: String(compound.senseId ?? ""),
      target: compound.target ?? compound.surface,
      pyashSequence: compound.pyashSequence,
      provenance: compound.source
    });
    compoundsWithoutSense.set(key, group);
  }
  for (const [key, candidates] of compoundsWithoutSense) {
    const entry = entriesByKey.get(key);
    if (entry?.sourceGlosses.length) continue;
    candidates.sort((left, right) => compareCandidates(left, right, rankForEnglish, tagCounts));
    addForm(entry, "en", candidates[0]?.target);
  }

  const characterCandidates = new Map();
  const addCharacterCandidate = (row, priority) => {
    const character = String(row.character ?? "").normalize("NFC").trim();
    const rawSequence = String(row.pya ?? "").trim().split(/\s+/u).filter(Boolean);
    const sequence = rawSequence.length ? canonicalizeSequence(rawSequence) : [];
    if ([...character].length !== 1 || !HAN.test(character) || sequence.length !== 1 || !entriesByKey.has(sequence[0])) return;
    const rank = rankForEnglish(row.english);
    const candidates = characterCandidates.get(character) ?? [];
    candidates.push({ character, sequence, rank, priority, english: row.english ?? "" });
    characterCandidates.set(character, candidates);
  };
  for (const row of [...directChineseRows, ...grammarChineseRows]) addCharacterCandidate(row, 0);
  const selectedCharacterRows = [];
  for (const [character, candidates] of characterCandidates) {
    const bestPriority = Math.min(...candidates.map((candidate) => candidate.priority));
    const priorityRows = candidates.filter((candidate) => candidate.priority === bestPriority);
    const bestRank = Math.min(...priorityRows.map((candidate) => candidate.rank));
    const bestRows = Number.isFinite(bestRank)
      ? priorityRows.filter((candidate) => candidate.rank === bestRank)
      : priorityRows;
    const winners = new Set(bestRows.map((candidate) => sequenceKey(candidate.sequence)));
    if (winners.size === 1) selectedCharacterRows.push({
      character,
      pya: [...winners][0],
      english: bestRows[0].english
    });
  }
  const directChineseByCharacter = new Map();
  for (const row of selectedCharacterRows) {
    const character = String(row.character ?? "").normalize("NFC").trim();
    const rawSequence = String(row.pya ?? "").trim().split(/\s+/u).filter(Boolean);
    const sequence = rawSequence.length ? canonicalizeSequence(rawSequence) : [];
    if ([...character].length === 1 && sequence.length === 1 && entriesByKey.has(sequence[0])) {
      const prior = directChineseByCharacter.get(character);
      if (!prior || prior === sequenceKey(sequence)) directChineseByCharacter.set(character, sequenceKey(sequence));
      else directChineseByCharacter.delete(character);
    }
  }

  const pinyinBySurface = new Map();
  for (const row of pinyinRows) {
    const surface = String(row.surface ?? "").normalize("NFC").trim();
    const readings = [...new Set((row.readings ?? []).map((value) => String(value).trim()).filter(Boolean))];
    if (surface && readings.length) pinyinBySurface.set(surface, readings);
  }
  const jyutpingByCharacter = new Map();
  for (const row of jyutpingRows) {
    const character = String(row.character ?? "").normalize("NFC").trim();
    const reading = String(row.jyutping ?? "").trim();
    const target = String(row.pya ?? "").trim();
    if (character && reading && target && directChineseByCharacter.get(character) === target) {
      jyutpingByCharacter.set(character, [reading]);
    }
  }
  if (cowIndex) addChineseForms(entriesByKey, activeSenseToSequence, cowIndex, directChineseByCharacter, pinyinBySurface, jyutpingByCharacter);

  const legacySingleCharacterCandidates = addLegacyForms(entriesByKey, legacyDictionaries, rankForEnglish);
  const existingSingleCharacterOwners = singleChineseOwners(entriesByKey);
  for (const [character, candidates] of legacySingleCharacterCandidates) {
    if (existingSingleCharacterOwners.has(character) || candidates.length === 0) continue;
    candidates.sort((left, right) => left.rank - right.rank || left.key.localeCompare(right.key));
    const bestRank = candidates[0].rank;
    const winners = new Set(candidates.filter((row) => row.rank === bestRank).map((row) => row.key));
    if (winners.size !== 1) continue;
    const key = [...winners][0];
    const entry = entriesByKey.get(key);
    if (entry) addForm(entry, "zh", character);
  }
  addPinyinForms(entriesByKey, pinyinBySurface, jyutpingByCharacter);

  for (const row of sumoRows) {
    if (row?.kind !== "wordnet-mapping" || row.crosswalkStatus !== "unique") continue;
    for (const senseId of row.openEnglishWordNetIds ?? []) {
      const sequence = activeSenseToSequence.get(String(senseId).toLowerCase());
      if (!sequence) continue;
      addSourceLink(getEntry(sequence), "sumo", SUMO_RELEASE, row.sumoId, row.mappingRelation ?? "mapped-to");
    }
  }
  for (const record of sumoConceptLinkRows) {
    if (!Array.isArray(record?.pyashSequence) || record.pyashSequence.length === 0) continue;
    addSourceLink(getEntry(record.pyashSequence), "sumo", SUMO_RELEASE, record.sumoId, record.relation ?? "equivalent-to");
  }
  // A concept WordNet does not index cannot have an exact linked sense, so its
  // entry would carry no definition at all. An authored English gloss stands in
  // as the interim definition, marked with its own dataset so a reader can tell
  // it apart from a WordNet gloss.
  for (const record of curatedGlosses) {
    if (!Array.isArray(record?.pyashSequence) || record.pyashSequence.length === 0) continue;
    const entry = getEntry(record.pyashSequence);
    const identifier = record.pyashSequence.join(" ");
    // The writer requires a gloss to name a source that the entry also links,
    // so the authored gloss is paired with its own link record.
    addSourceLink(entry, "pyash-curated", CURATED_GLOSS_RELEASE, identifier, "authored-gloss");
    addSourceGloss(entry, "en", "pyash-curated", CURATED_GLOSS_RELEASE, identifier, record.gloss);
  }
  // A Wiktionary link is a citation, not a downloaded corpus: the identifier is
  // the article name and the URL is derived from the release and that name. The
  // gloss is Wiktionary's own domain-tagged definition, recorded under the
  // wiktionary dataset so a reader can tell which dictionary answered.
  for (const record of wiktionaryLinks) {
    if (!Array.isArray(record?.pyashSequence) || record.pyashSequence.length === 0) continue;
    if (typeof record.article !== "string" || !record.article.trim()) continue;
    const entry = getEntry(record.pyashSequence);
    addSourceLink(entry, WIKTIONARY_DATASET, WIKTIONARY_RELEASE, record.article, "exact-term");
    if (record.definition) {
      addSourceGloss(entry, "en", WIKTIONARY_DATASET, WIKTIONARY_RELEASE, record.article, record.definition);
    }
  }

  const languages = [...new Set([
    "en", ...Object.keys(LANGUAGE_FILES), "zh-Latn-pinyin", "yue-Latn-jyutping"
  ])].sort();
  const chineseSingleCharacterForms = singleChineseOwners(entriesByKey).size;
  const entries = [...entriesByKey.values()].sort((left, right) => left.sequence.localeCompare(right.sequence));
  for (const entry of entries) {
    entry.forms.sort((left, right) => left.language.localeCompare(right.language)
      || left.normalized.localeCompare(right.normalized)
      || left.surface.localeCompare(right.surface));
    entry.sourceLinks.sort((left, right) => left.dataset.localeCompare(right.dataset)
      || left.release.localeCompare(right.release)
      || left.identifier.localeCompare(right.identifier)
      || left.relation.localeCompare(right.relation));
    entry.sourceGlosses.sort((left, right) => left.identifier.localeCompare(right.identifier)
      || left.text.localeCompare(right.text));
  }
  const summary = {
    entries: entriesByKey.size,
    atoms: atoms.length,
    compoundEntries: compoundEntries.length,
    acceptedWordNetSenseCandidates: selectedSenses.candidateCount,
    selectedWordNetSenses: selectedSenses.winners.length,
    resolvedSenseCollisionGroups: selectedSenses.collisionGroups,
    droppedSenseRows: Object.fromEntries(
      Object.entries(selectedSenses.drops).map(([reason, bucket]) => [reason, bucket.count])
    ),
    droppedSenseExamples: Object.fromEntries(
      Object.entries(selectedSenses.drops)
        .filter(([, bucket]) => bucket.count > 0)
        .map(([reason, bucket]) => [reason, bucket.examples])
    ),
    chineseSingleCharacterForms,
    languages
  };
  if (!render) return { entries, summary };
  for (const [reason, bucket] of Object.entries(selectedSenses.drops)) {
    const ceiling = DROPPED_SENSE_BASELINE[reason] ?? 0;
    if (bucket.count > ceiling) {
      throw new Error(
        `the reference build now drops ${bucket.count} sense rows for ${reason}, up from ${ceiling}. `
        + `Either fix the target or raise DROPPED_SENSE_BASELINE deliberately.`
      );
    }
  }
  const lines = [
    'su name lyin kwon ob text "Pyash accepted vocabulary reference dictionary" be text ya',
    `su name lyin kwon ob text "Pyash accepted vocabulary reference" as num 1 from text ${JSON.stringify(languages.join(","))} to text "NFC" with text "pyac-vliw-dictionary/3" be text ya`
  ];
  for (const entry of entries) lines.push(...pyaEntryLines(entry));
  lines.push("prah", "");
  return {
    source: lines.join("\n"),
    entries,
    summary
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function loadReferenceSourceInputs() {
  const translation = (name) => new URL(`../translation/${name}`, import.meta.url);
  const sumoCatalog = new URL("../../../know/sumo/pyash_wordnet_mappings.pya", import.meta.url);
  const legacy = (name) => new URL(`../../../caterer/pyac/lyac/${name}`, import.meta.url);
  const [
    bridgeCatalog,
    curatedSource,
    verifiedSource,
    compoundGlossSource,
    cowSource,
    chineseLinksSource,
    kwonChineseSource,
    grammarCatalog,
    pinyinSource,
    jyutpingSource,
    sumoSource,
    sumoConceptLinkSource,
    englishSource,
    frequencyResources,
    legacyDictionaries,
    vocabularyReviewSource,
    curatedGlossSource,
    wiktionarySource
  ] = await Promise.all([
    loadEnglishWordNetBridges(),
    readFile(translation("compound_coverage_curated.pya"), "utf8"),
    readFile(translation("compound_coverage_wordnet_verified.pya"), "utf8"),
    readFile(translation("english_wordnet_compound_glosses.pya"), "utf8"),
    readFile(translation("cow_wordnet_crosswalk.pya"), "utf8"),
    readFile(translation("chinese_character_atom_links.pya"), "utf8"),
    readJson(legacy("kwon_zh.json")),
    loadEnglishGrammarCatalog(),
    readFile(translation("kwon_chinese_pinyin.pya"), "utf8"),
    readFile(translation("kwon_chinese_single_atoms.csv"), "utf8"),
    readFile(sumoCatalog, "utf8"),
    readFile(translation("sumo_concept_links.pya"), "utf8").catch((error) => {
      if (error?.code === "ENOENT") return "";
      throw error;
    }),
    loadEnglish30k(),
    loadEnglishWordNetFrequencyResources(),
    Promise.all(Object.entries(LANGUAGE_FILES).map(async ([language, filename]) => ({
      language,
      rows: await readJson(legacy(filename))
    }))),
    readFile(translation("vocabulary_entry_reviews.pya"), "utf8"),
    readFile(translation("curated_glosses.pya"), "utf8"),
    readFile(translation("wiktionary_links.pya"), "utf8")
  ]);
  const curatedEntries = parseCompoundLexicon(curatedSource, {
    name: "translation_compounds_derived_curated",
    language: "canonical",
    atomicEntries: pyashWords
  });
  const verifiedEntries = parseCompoundLexicon(verifiedSource, {
    name: "translation_compounds_derived_curated",
    language: "canonical",
    atomicEntries: pyashWords
  });
  const compounds = collectAcceptedCompounds(curatedEntries, verifiedEntries);
  const compoundGlossRows = decodeJsonRows(parseMapRows(
    compoundGlossSource,
    "translation_wordnet_compound_sense_glosses"
  ).filter((sentence) => sentence.su.text !== "format"), "WordNet compound glosses");
  const vocabularyReviews = decodeJsonRows(parseMapRows(
    vocabularyReviewSource,
    "translation_vocabulary_entry_reviews"
  ).filter((sentence) => sentence.su.text !== "format"), "vocabulary entry reviews");
  const cowIndex = parseCowWordNetCrosswalkPya(cowSource);
  const linkRows = parseChineseCharacterAtomLinks(chineseLinksSource);
  const directChineseRows = acceptedChineseCharacterAtomRows(kwonChineseSource, linkRows);
  const grammarChineseRows = grammarCatalog.chineseCharacterLinks.map((row) => ({
    character: row.character,
    english: row.english,
    pya: row.pya
  }));
  const pinyinRows = buildProgram(pinyinSource).sentences.flatMap((sentence) => {
    const surface = sentence?.su?.text;
    const readingText = sentence?.ob?.text;
    if (typeof surface !== "string" || surface.startsWith("meta:") || surface.startsWith("character:")
      || typeof readingText !== "string" || !readingText.trim()) return [];
    return [{ surface, readings: readingText.split(" || ").map((reading) => reading.trim()) }];
  });
  const jyutpingRows = parseCsv(jyutpingSource, { columns: true, skip_empty_lines: true }).map((row) => ({
    character: row.chinese_character,
    pya: row.pyash_atom,
    jyutping: row.cantonese_jyutping
  }));
  const sumoRows = decodeJsonRows(parseMapRows(sumoSource, "sumo_wordnet_evidence")
    .filter((sentence) => sentence.su.text !== "format" && sentence.su.text !== "metadata"), "SUMO crosswalk");
  const sumoConceptLinkRows = sumoConceptLinkSource.trim()
    ? decodeJsonRows(parseMapRows(sumoConceptLinkSource, "sumo_concept_links")
      .filter((sentence) => sentence.su.text !== "format"), "SUMO concept links")
    : [];
  // The map key is the Pyash spelling; the value is the authored English gloss.
  const curatedGlossRows = parseMapRows(curatedGlossSource, "translation_curated_glosses")
    .filter((sentence) => sentence.su.text !== "format" && sentence.su.text !== "scope")
    .flatMap((sentence) => {
      const pya = sentence.su.text.split(/\s+/u).filter(Boolean);
      const gloss = sentence.ob?.text;
      if (!pya.length || typeof gloss !== "string" || !gloss.trim()) return [];
      return [{ pyashSequence: pya, gloss: gloss.trim() }];
    });
  // The map key is the Pyash spelling; the value is the Wiktionary article name.
  // The definition is read from the mounted archive, so a build without the
  // Kiwix host still links the term and simply carries no gloss.
  const wiktionaryLinks = parseMapRows(wiktionarySource, "translation_wiktionary_links")
    .filter((sentence) => sentence.su.text !== "format"
      && !sentence.su.text.startsWith("scope"))
    .flatMap((sentence) => {
      const pya = sentence.su.text.split(/\s+/u).filter(Boolean);
      const article = sentence.ob?.text;
      if (!pya.length || typeof article !== "string" || !article.trim()) return [];
      return [{ pyashSequence: pya, article: article.trim() }];
    });
  const harvested = harvestWiktionary(wiktionaryLinks.map((record) => record.article));
  const definitionByArticle = new Map(harvested.map((row) => [row.entry, row.definition]));
  for (const record of wiktionaryLinks) {
    record.definition = definitionByArticle.get(record.article) ?? null;
  }
  return {
    bridgeCatalog,
    vocabularyReviews,
    compoundEntries: compounds.all,
    compoundGlosses: compoundGlossRows,
    cowIndex,
    englishRows: englishSource.rows,
    wordNetFrequencyEntries: frequencyResources.joined.entries,
    directChineseRows,
    grammarChineseRows,
    pinyinRows,
    jyutpingRows,
    legacyDictionaries,
    sumoRows,
    sumoConceptLinkRows,
    curatedGlosses: curatedGlossRows,
    wiktionaryLinks
  };
}

export async function generateAcceptedReferenceSource({ output = OUTPUT } = {}) {
  const built = buildAcceptedReferenceSource({ ...(await loadReferenceSourceInputs()), render: true });
  const outputPath = output instanceof URL ? fileURLToPath(output) : String(output);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, built.source, "utf8");
  return { ...built.summary, output: outputPath, bytes: Buffer.byteLength(built.source) };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  generateAcceptedReferenceSource().then((summary) => {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error.stack || error.message || String(error)}\n`);
    process.exitCode = 1;
  });
}

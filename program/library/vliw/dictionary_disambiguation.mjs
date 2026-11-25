import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";

import pyashWords from "../pyashWords.json" with { type: "json" };
import { loadDefaultEnglishSentenceResources } from "../translation/english_sentence.mjs";
import { english30kLookupVariants, normalizeEnglish30kWord } from "../translation/english30k_coverage.mjs";
import { loadEnglishWordNetFrequencyResources } from "../translation/english_wordnet_frequency.mjs";
import { parseCompoundLexicon } from "../translation/compound_lexicon.mjs";

const CURATED_COMPOUNDS_URL = new URL("../translation/compound_coverage_curated.pya", import.meta.url);
const VERIFIED_COMPOUNDS_URL = new URL("../translation/compound_coverage_wordnet_verified.pya", import.meta.url);
const CURATED_COMPOUNDS_NAME = "translation_compounds_derived_curated";
const ACCEPTED_CURATED_STATUSES = new Set(["accepted-curated", "accepted-delimited", "accepted-deterministic"]);
const ACCEPTED_WORDNET_STATUSES = new Set(["accepted-llm", "repaired-llm", "accepted-deterministic"]);

export const VLIW_DICTIONARY_COMPOUND_FORMAT = "vliw-dictionary-compounds-v1";
export const VLIW_DICTIONARY_COMPOUND_OUTPUT = new URL("../../../examples/out/vliw_dictionary_compounds.pya", import.meta.url);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizedTarget(value) {
  return normalizeEnglish30kWord(String(value ?? ""));
}

function compareOptionalText(left, right) {
  if (!left && right) return 1;
  if (left && !right) return -1;
  return compareText(left, right);
}

function sequenceKey(sequence) {
  return JSON.stringify(sequence);
}

function compareSequences(left, right) {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const comparison = compareText(left[index], right[index]);
    if (comparison !== 0) return comparison;
  }
  return left.length - right.length;
}

function letterCount(target) {
  const compact = normalizedTarget(target).replace(/[\s\p{Pd}]/gu, "");
  return [...compact].filter((character) => /\p{L}/u.test(character)).length;
}

function targetRankIndex(rows) {
  const ranks = new Map();
  for (const row of rows) {
    for (const variant of english30kLookupVariants(row.word)) {
      const key = normalizeEnglish30kWord(variant);
      const previous = ranks.get(key) ?? Number.POSITIVE_INFINITY;
      if (row.rank < previous) ranks.set(key, row.rank);
    }
  }
  return (target) => {
    const ranksForTarget = english30kLookupVariants(target)
      .map((variant) => ranks.get(normalizeEnglish30kWord(variant)))
      .filter(Number.isFinite);
    return ranksForTarget.length ? Math.min(...ranksForTarget) : null;
  };
}

function senseTagCountIndex(entries) {
  const tagCounts = new Map();
  for (const row of entries) {
    if (!Number.isSafeInteger(row.tagCount)) continue;
    const senseId = `${row.pos}:${row.synset}`.toLowerCase();
    tagCounts.set(senseId, Math.max(tagCounts.get(senseId) ?? -1, row.tagCount));
  }
  return tagCounts;
}

function acceptedRecord(entry, source) {
  const status = String(entry?.status ?? "");
  return source === "curated"
    ? ACCEPTED_CURATED_STATUSES.has(status)
    : ACCEPTED_WORDNET_STATUSES.has(status);
}

function candidateRecord(entry, source, rankForEnglish, senseTagCounts) {
  const pyashSequence = Array.isArray(entry?.pyashSequence)
    ? entry.pyashSequence.map((word) => String(word ?? "").trim())
    : [];
  const target = normalizedTarget(entry?.target);
  if (pyashSequence.length < 2 || pyashSequence.some((word) => !word) || !target) return null;

  const senseId = String(entry.senseId ?? "").trim().toLowerCase();
  const targetPartOfSpeech = String(entry.targetPartOfSpeech ?? senseId.slice(0, 1)).trim().toLowerCase();
  const tagCount = senseId ? senseTagCounts.get(senseId) : undefined;
  const recordId = String(entry.id ?? [source, senseId, target, pyashSequence.join(" ")].join(":"));
  return {
    source,
    recordId,
    sourceStatus: String(entry.status ?? ""),
    target,
    gloss: String(entry.gloss ?? "").trim(),
    pyashSequence,
    senseId,
    targetPartOfSpeech,
    english30kRank: rankForEnglish(target),
    wordNetTagCount: Number.isSafeInteger(tagCount) ? tagCount : null,
    letterCount: letterCount(target),
    provenance: String(entry.provenance ?? "")
  };
}

function compareSenseCandidates(left, right) {
  if (left.wordNetTagCount !== null && right.wordNetTagCount !== null) {
    const tagCountOrder = right.wordNetTagCount - left.wordNetTagCount;
    if (tagCountOrder !== 0) return tagCountOrder;
  }
  return compareOptionalText(left.targetPartOfSpeech, right.targetPartOfSpeech)
    || compareOptionalText(left.senseId, right.senseId)
    || compareText(left.source, right.source)
    || compareText(left.recordId, right.recordId);
}

function chooseCandidateSense(records) {
  return [...records].sort(compareSenseCandidates)[0];
}

function normalizeTargetCandidate(records) {
  const selectedSense = chooseCandidateSense(records);
  const curatedGloss = records
    .filter((record) => record.source === "curated" && record.gloss)
    .sort((left, right) => compareText(left.gloss, right.gloss) || compareText(left.recordId, right.recordId))[0];
  const senseGloss = selectedSense?.gloss ? selectedSense : null;
  const displayRecord = curatedGloss ?? senseGloss ?? selectedSense;
  return {
    target: records[0].target,
    pyashSequence: [...records[0].pyashSequence],
    gloss: displayRecord?.gloss ?? "",
    senseId: selectedSense?.senseId ?? "",
    targetPartOfSpeech: selectedSense?.targetPartOfSpeech ?? "",
    sourceLinks: selectedSense?.senseId ? [{
      dataset: "open-english-wordnet",
      release: "2025",
      identifier: selectedSense.senseId,
      relation: "exact-synset"
    }] : [],
    english30kRank: records[0].english30kRank,
    wordNetTagCount: selectedSense?.wordNetTagCount ?? null,
    letterCount: records[0].letterCount,
    candidateIds: [...new Set(records.map((record) => record.recordId))].sort(compareText),
    sourceKinds: [...new Set(records.map((record) => record.source))].sort(compareText),
    sourceStatuses: [...new Set(records.map((record) => record.sourceStatus))].sort(compareText),
    provenance: displayRecord?.provenance ?? ""
  };
}

function compareTargetCandidates(left, right) {
  const leftRank = left.english30kRank ?? Number.POSITIVE_INFINITY;
  const rightRank = right.english30kRank ?? Number.POSITIVE_INFINITY;
  if (leftRank !== rightRank) return leftRank - rightRank;
  if (left.wordNetTagCount !== null && right.wordNetTagCount !== null) {
    const tagCountOrder = right.wordNetTagCount - left.wordNetTagCount;
    if (tagCountOrder !== 0) return tagCountOrder;
  }
  return left.letterCount - right.letterCount
    || compareText(left.target, right.target)
    || compareOptionalText(left.targetPartOfSpeech, right.targetPartOfSpeech)
    || compareOptionalText(left.senseId, right.senseId)
    || compareText(left.candidateIds[0] ?? "", right.candidateIds[0] ?? "");
}

function candidateDecision(candidate) {
  return {
    target: candidate.target,
    english30kRank: candidate.english30kRank,
    wordNetTagCount: candidate.wordNetTagCount,
    letterCount: candidate.letterCount,
    targetPartOfSpeech: candidate.targetPartOfSpeech,
    senseId: candidate.senseId,
    candidateIds: candidate.candidateIds
  };
}

export function buildVliwDictionaryCompoundSelection({
  curatedEntries = [],
  verifiedEntries = [],
  rankForEnglish = () => null,
  senseTagCounts = new Map()
} = {}) {
  if (!Array.isArray(curatedEntries) || !Array.isArray(verifiedEntries)) {
    throw new TypeError("VLIW compound disambiguation requires curated and verified entry arrays");
  }
  if (typeof rankForEnglish !== "function" || !(senseTagCounts instanceof Map)) {
    throw new TypeError("VLIW compound disambiguation requires rank and exact sense-frequency indexes");
  }

  const candidatesBySequence = new Map();
  const targetRecordsBySequence = new Map();
  const append = (entry, source) => {
    if (!acceptedRecord(entry, source)) return;
    const candidate = candidateRecord(entry, source, rankForEnglish, senseTagCounts);
    if (!candidate) return;
    const key = sequenceKey(candidate.pyashSequence);
    const targetKey = candidate.target;
    if (!candidatesBySequence.has(key)) candidatesBySequence.set(key, candidate.pyashSequence);
    if (!targetRecordsBySequence.has(key)) targetRecordsBySequence.set(key, new Map());
    const targets = targetRecordsBySequence.get(key);
    if (!targets.has(targetKey)) targets.set(targetKey, []);
    targets.get(targetKey).push(candidate);
  };

  for (const entry of curatedEntries) append(entry, "curated");
  for (const entry of verifiedEntries) append(entry, "wordnet-verified");

  const entries = [];
  const decisions = [];
  let curatedWinnerCount = 0;
  let wordNetWinnerCount = 0;
  let unrankedWinnerCount = 0;
  let targetCandidateCount = 0;

  for (const [key, sequence] of candidatesBySequence) {
    const targetCandidates = [...targetRecordsBySequence.get(key).values()]
      .map(normalizeTargetCandidate)
      .sort(compareTargetCandidates);
    if (!targetCandidates.length) continue;
    targetCandidateCount += targetCandidates.length;
    const winner = targetCandidates[0];
    if (winner.sourceKinds.includes("curated")) curatedWinnerCount += 1;
    if (winner.senseId) wordNetWinnerCount += 1;
    if (winner.english30kRank === null) unrankedWinnerCount += 1;
    entries.push(winner);
    if (targetCandidates.length > 1) {
      decisions.push({
        pyashSequence: [...sequence],
        selectedTarget: winner.target,
        contenders: targetCandidates.map(candidateDecision)
      });
    }
  }

  entries.sort((left, right) => compareSequences(left.pyashSequence, right.pyashSequence));
  decisions.sort((left, right) => compareSequences(left.pyashSequence, right.pyashSequence));
  return {
    format: VLIW_DICTIONARY_COMPOUND_FORMAT,
    policy: "english30k-rank-ascending; exact-wordnet-tag-count-descending-when-comparable; fewer-unicode-letters-ignoring-spaces-and-dashes; normalized-target; part-of-speech; sense-id",
    summary: {
      sequenceCount: entries.length,
      targetCandidateCount,
      collisionSequenceCount: decisions.length,
      curatedWinnerCount,
      wordNetWinnerCount,
      unrankedWinnerCount
    },
    entries,
    decisions
  };
}

export async function loadVliwDictionaryCompoundSelection() {
  const [curatedSource, verifiedSource, englishResources, frequencyResources] = await Promise.all([
    readFile(CURATED_COMPOUNDS_URL, "utf8"),
    readFile(VERIFIED_COMPOUNDS_URL, "utf8"),
    loadDefaultEnglishSentenceResources(),
    loadEnglishWordNetFrequencyResources()
  ]);
  const curatedEntries = parseCompoundLexicon(curatedSource, {
    name: CURATED_COMPOUNDS_NAME,
    language: "canonical",
    atomicEntries: pyashWords
  });
  const verifiedEntries = parseCompoundLexicon(verifiedSource, {
    name: CURATED_COMPOUNDS_NAME,
    language: "canonical",
    atomicEntries: pyashWords
  });
  const selection = buildVliwDictionaryCompoundSelection({
    curatedEntries,
    verifiedEntries,
    rankForEnglish: targetRankIndex(englishResources.source.rows),
    senseTagCounts: senseTagCountIndex(frequencyResources.joined.entries)
  });
  return {
    ...selection,
    sourceHashes: {
      curated: sha256(curatedSource),
      verified: sha256(verifiedSource),
      english30k: englishResources.source.sourceHash,
      wordNetSenseFrequency: frequencyResources.indexHash
    }
  };
}

export function renderVliwDictionaryCompoundSelectionPya(selection) {
  if (!selection || selection.format !== VLIW_DICTIONARY_COMPOUND_FORMAT || !Array.isArray(selection.entries)) {
    throw new TypeError("VLIW compound catalog rendering requires a valid disambiguation result");
  }
  const lines = [
    "su name vliw_dictionary_compounds be map def",
    `su text "format" ob text ${JSON.stringify(selection.format)} ya`,
    `su text "policy" ob text ${JSON.stringify(selection.policy)} ya`,
    `su text "entry-count" ob num ${selection.entries.length} ya`
  ];
  for (const [name, hash] of Object.entries(selection.sourceHashes ?? {}).sort(([left], [right]) => compareText(left, right))) {
    lines.push(`su text ${JSON.stringify(`source-hash:${name}`)} ob text ${JSON.stringify(hash)} ya`);
  }
  for (const entry of selection.entries) {
    const row = {
      pyashSequence: entry.pyashSequence,
      target: entry.target,
      gloss: entry.gloss,
      senseId: entry.senseId,
      targetPartOfSpeech: entry.targetPartOfSpeech,
      sourceLinks: entry.sourceLinks,
      english30kRank: entry.english30kRank,
      wordNetTagCount: entry.wordNetTagCount,
      sourceStatuses: entry.sourceStatuses,
      sourceKinds: entry.sourceKinds,
      candidateIds: entry.candidateIds,
      provenance: entry.provenance
    };
    lines.push(`su text ${JSON.stringify(entry.pyashSequence.join(" "))} ob text ${JSON.stringify(JSON.stringify(row))} ya`);
  }
  lines.push("prah", "");
  return lines.join("\n");
}

export async function writeVliwDictionaryCompoundSelection(
  selection,
  output = VLIW_DICTIONARY_COMPOUND_OUTPUT
) {
  const outputUrl = output instanceof URL ? output : new URL(String(output), import.meta.url);
  await mkdir(new URL(".", outputUrl), { recursive: true });
  await writeFile(outputUrl, renderVliwDictionaryCompoundSelectionPya(selection), "utf8");
  return outputUrl;
}

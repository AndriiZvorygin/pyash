import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildProgram } from "../../program.mjs";
import {
  canonicalWordNetTargetPartOfSpeech,
  englishWordNetTargetId
} from "./english_wordnet_bridges.mjs";

export const ENGLISH_WORDNET_FREQUENCY_FORMAT = "princeton-wordnet-sense-frequency-v1";
export const ENGLISH_WORDNET_FREQUENCY_NAME = "frequency";
export const ENGLISH_WORDNET_FREQUENCY_CONFIG_URL = new URL("./english_wordnet_frequency.pya", import.meta.url);
export const ENGLISH_WORDNET_FREQUENCY_ALLOCATION_NAME = "allotment";
export const ENGLISH_WORDNET_FREQUENCY_ALLOCATION_CONFIG_URL = new URL("./english_wordnet_frequency_allocation.pya", import.meta.url);

const SENSE_KEY_POS = new Map([["1", "n"], ["2", "v"], ["3", "a"], ["4", "r"], ["5", "s"]]);
const ALLOWED_COVERAGE_TYPES = new Set(["atomic", "compound", "alias", "dictionary-alias"]);

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-english-wordnet-frequency";
  error.details = details;
  return error;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalize(value) {
  return typeof value === "string"
    ? value.normalize("NFC").trim().toLowerCase().replace(/[_-]+/gu, " ").replace(/\s+/gu, " ")
    : "";
}

function senseKeyParts(value, lineNumber) {
  const key = String(value ?? "").trim();
  const delimiter = key.lastIndexOf("%");
  if (delimiter < 1) throw invalid("WordNet sense index row has an invalid sense key", { lineNumber, key });
  const lemma = key.slice(0, delimiter);
  const match = key.slice(delimiter + 1).match(/^([1-5]):([0-9]{2}):([0-9]{2}):([^:]*):([0-9]*)$/u);
  if (!match) throw invalid("WordNet sense index row has an invalid sense key", { lineNumber, key });
  return {
    senseKey: key,
    lemma: normalize(lemma),
    pos: SENSE_KEY_POS.get(match[1]),
    senseType: match[1]
  };
}

export function parsePrincetonWordNetSenseIndex(source) {
  if (typeof source !== "string") throw invalid("Princeton WordNet sense index must be text");
  const rows = [];
  const byKey = new Map();
  for (const [index, rawLine] of source.split(/\r?\n/u).entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    const fields = line.split(/\s+/u);
    if (fields.length !== 4) throw invalid("Princeton WordNet sense index row must contain four fields", { lineNumber: index + 1 });
    const [key, offsetText, senseNumberText, tagCountText] = fields;
    const keyInfo = senseKeyParts(key, index + 1);
    const offset = Number(offsetText);
    const senseNumber = Number(senseNumberText);
    const tagCount = Number(tagCountText);
    if (!/^\d{8}$/u.test(offsetText)
      || !Number.isSafeInteger(senseNumber) || senseNumber < 1
      || !Number.isSafeInteger(tagCount) || tagCount < 0) {
      throw invalid("Princeton WordNet sense index row has an invalid offset, sense number, or tag count", {
        lineNumber: index + 1,
        key
      });
    }
    if (byKey.has(key)) throw invalid("Princeton WordNet sense index key is duplicated", { lineNumber: index + 1, key });
    const row = { ...keyInfo, offset, senseNumber, tagCount };
    rows.push(row);
    byKey.set(key, row);
  }
  return { format: ENGLISH_WORDNET_FREQUENCY_FORMAT, rows, byKey, sourceHash: sha256(source) };
}

function posAndSynset(value, senseKey, index) {
  const match = String(value ?? "").match(/^(\d{8})-([nvars])$/u);
  if (!match) throw invalid("Open English WordNet entry has an invalid synset identity", { index, senseKey, synset: value });
  const keyInfo = senseKeyParts(senseKey, index);
  if (keyInfo.pos !== match[2]) {
    throw invalid("Open English WordNet sense key part of speech disagrees with its synset", {
      index,
      senseKey,
      synset: value
    });
  }
  return { pos: match[2], synset: value };
}

export function parseOpenEnglishWordNetEntrySenseFiles(files = []) {
  if (!Array.isArray(files)) throw invalid("Open English WordNet entry files must be an array");
  const entries = [];
  const byKey = new Map();
  const sourceFiles = [];
  for (const file of files) {
    if (!file || typeof file.name !== "string" || !/^entries-.+\.json$/u.test(file.name)) continue;
    let data;
    try {
      data = JSON.parse(String(file.source ?? ""));
    } catch (error) {
      throw invalid("Open English WordNet entry JSON is malformed", { file: file.name, cause: error.message });
    }
    sourceFiles.push(file.name);
    for (const [surface, byPos] of Object.entries(data)) {
      if (!byPos || typeof byPos !== "object" || Array.isArray(byPos)) continue;
      for (const dataByPos of Object.values(byPos)) {
        for (const sense of Array.isArray(dataByPos?.sense) ? dataByPos.sense : []) {
          const senseKey = typeof sense?.id === "string" ? sense.id.trim() : "";
          const lemma = normalize(surface);
          const { pos, synset } = posAndSynset(sense?.synset, senseKey, entries.length + 1);
          if (!lemma) throw invalid("Open English WordNet entry sense has an empty lemma", { file: file.name, senseKey });
          const row = { senseKey, lemma, pos, synset, sourceFile: file.name };
          const previous = byKey.get(senseKey);
          if (previous) {
            if (previous.lemma !== lemma || previous.pos !== pos || previous.synset !== synset) {
              throw invalid("Open English WordNet lexical sense key is assigned inconsistently", { senseKey });
            }
            continue;
          }
          entries.push(row);
          byKey.set(senseKey, row);
        }
      }
    }
  }
  return {
    format: "open-english-wordnet-entry-sense-keys-v1",
    entries,
    byKey,
    sourceFiles: sourceFiles.sort(),
    sourceHash: sha256(files
      .filter((file) => /^entries-.+\.json$/u.test(file?.name ?? ""))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((file) => `${file.name}\u0000${file.source}`)
      .join("\u0000"))
  };
}

export function joinOpenEnglishWordNetSenseFrequencies({ entrySenses, frequency } = {}) {
  if (!Array.isArray(entrySenses?.entries) || !(frequency?.byKey instanceof Map)) {
    throw invalid("WordNet frequency join requires parsed OEWN entry senses and Princeton sense index");
  }
  const entries = entrySenses.entries.map((entry) => {
    const count = frequency.byKey.get(entry.senseKey);
    return {
      ...entry,
      tagCount: count ? count.tagCount : null,
      senseNumber: count ? count.senseNumber : null,
      ...(count ? { indexOffset: count.offset } : {})
    };
  });
  const matchedKeys = new Set(entries.filter((entry) => entry.tagCount !== null).map((entry) => entry.senseKey));
  return {
    format: "open-english-wordnet-princeton-frequency-join-v1",
    entries,
    matchedCount: matchedKeys.size,
    unmatchedCount: entries.length - matchedKeys.size,
    unmatchedIndexCount: frequency.rows.filter((row) => !entrySenses.byKey.has(row.senseKey)).length,
    entrySenseHash: entrySenses.sourceHash,
    frequencyHash: frequency.sourceHash
  };
}

export function allocateEnglishWordNetAnchors(records = [], {
  reservedTargetIds = [],
  reservedSources = []
} = {}) {
  if (!Array.isArray(records)) throw new TypeError("frequency allocation records must be an array");
  const reservedTargets = new Set(reservedTargetIds);
  const reservedSenseKeys = new Set(reservedSources);
  const sourceRows = new Map();
  for (const record of records) {
    const source = String(record?.source ?? "").trim();
    if (!source) throw invalid("frequency allocation record requires a source sense");
    if (sourceRows.has(source)) throw invalid("frequency allocation source sense is duplicated", { source });
    sourceRows.set(source, record);
  }

  const candidatesBySource = new Map();
  const residualReasons = new Map();
  const ambiguousSources = new Set();
  for (const [source, record] of sourceRows) {
    if (reservedSenseKeys.has(source)) continue;
    const candidatesByTarget = new Map();
    for (const candidate of Array.isArray(record?.candidates) ? record.candidates : []) {
      const targetId = String(candidate?.targetId ?? "").trim();
      const lemma = normalize(candidate?.lemma);
      const target = typeof candidate?.target === "string"
        ? candidate.target.normalize("NFC").trim()
        : "";
      const pyashSequence = Array.isArray(candidate?.pyashSequence)
        ? candidate.pyashSequence.filter((word) => typeof word === "string" && word.trim()).map((word) => word.trim())
        : [];
      const rank = Number(candidate?.rank);
      if (!targetId || !target || !lemma || !Number.isFinite(rank) || rank < 1 || pyashSequence.length === 0) continue;
      const tagCount = Number.isSafeInteger(candidate?.tagCount) && candidate.tagCount >= 0
        ? candidate.tagCount
        : null;
      const edge = { ...candidate, source, lemma, target, targetId, pyashSequence, rank, tagCount };
      const prior = candidatesByTarget.get(targetId);
      if (!prior || edge.rank < prior.rank
        || (edge.rank === prior.rank && edge.tagCount !== null && prior.tagCount !== null && edge.tagCount > prior.tagCount)
        || (edge.rank === prior.rank && edge.tagCount !== null && prior.tagCount === null)) {
        candidatesByTarget.set(targetId, edge);
      }
    }
    const candidates = [...candidatesByTarget.values()].sort((left, right) => (
      left.rank - right.rank
        || (left.tagCount !== null && right.tagCount !== null ? right.tagCount - left.tagCount : 0)
        || left.targetId.localeCompare(right.targetId)
        || left.lemma.localeCompare(right.lemma)
    ));
    candidatesBySource.set(source, candidates);
    const bestRank = candidates[0]?.rank;
    const bestRankRows = candidates.filter((candidate) => candidate.rank === bestRank);
    if (bestRankRows.length > 1) {
      const allHaveTagCounts = bestRankRows.every((candidate) => candidate.tagCount !== null);
      const bestTagCount = allHaveTagCounts
        ? Math.max(...bestRankRows.map((candidate) => candidate.tagCount))
        : null;
      const tiedTop = allHaveTagCounts
        ? bestRankRows.filter((candidate) => candidate.tagCount === bestTagCount)
        : bestRankRows;
      if (tiedTop.length > 1) {
        ambiguousSources.add(source);
        residualReasons.set(source, "english30k-and-wordnet-tag-count-tie-within-synset");
      }
    }
    if (candidates.length === 0) {
      const hasCovered = (record.candidates ?? []).some((candidate) => candidate?.targetId && candidate?.pyashSequence?.length);
      residualReasons.set(source, hasCovered ? "no-ranked-english30k-lemma" : "no-covered-atom-or-compound-lemma");
    }
  }

  const nextCandidate = new Map([...candidatesBySource.keys()].map((source) => [source, 0]));
  const heldByTarget = new Map();
  const blockedTargets = new Set();
  const contestedSources = new Set();
  const sourceTarget = new Map();
  while (true) {
    const proposals = new Map();
    for (const source of candidatesBySource.keys()) {
      if (sourceTarget.has(source) || ambiguousSources.has(source)) continue;
      const candidates = candidatesBySource.get(source);
      let index = nextCandidate.get(source) ?? 0;
      while (index < candidates.length
        && (reservedTargets.has(candidates[index].targetId) || blockedTargets.has(candidates[index].targetId))) index += 1;
      nextCandidate.set(source, index + 1);
      if (index >= candidates.length) continue;
      const candidate = candidates[index];
      const group = proposals.get(candidate.targetId) ?? [];
      group.push(candidate);
      proposals.set(candidate.targetId, group);
    }
    if (proposals.size === 0) break;

    for (const [targetId, newProposals] of proposals) {
      const current = heldByTarget.get(targetId);
      const contenders = [...(current ? [current] : []), ...newProposals];
      const bestRank = Math.min(...contenders.map((candidate) => candidate.rank));
      const bestRankRows = contenders.filter((candidate) => candidate.rank === bestRank);
      let top = bestRankRows;
      if (top.length > 1 && top.every((candidate) => candidate.tagCount !== null)) {
        const bestTagCount = Math.max(...top.map((candidate) => candidate.tagCount));
        top = top.filter((candidate) => candidate.tagCount === bestTagCount);
      }
      const distinctTopSources = new Set(top.map((candidate) => candidate.source));
      if (distinctTopSources.size > 1) {
        blockedTargets.add(targetId);
        heldByTarget.delete(targetId);
        for (const candidate of contenders) {
          sourceTarget.delete(candidate.source);
          contestedSources.add(candidate.source);
        }
        continue;
      }

      const winner = top[0];
      heldByTarget.set(targetId, winner);
      sourceTarget.set(winner.source, targetId);
      for (const candidate of contenders) {
        if (candidate.source === winner.source) continue;
        if (sourceTarget.get(candidate.source) === targetId) sourceTarget.delete(candidate.source);
      }
    }
  }

  const assignments = [...heldByTarget.values()]
    .sort((left, right) => left.source.localeCompare(right.source))
    .map((candidate) => ({
      source: candidate.source,
      lemma: candidate.lemma,
      target: candidate.target,
      targetId: candidate.targetId,
      targetKind: candidate.targetKind,
      targetPartOfSpeech: candidate.targetPartOfSpeech,
      pyashSequence: candidate.pyashSequence,
      english30kRank: candidate.rank,
      tagCount: candidate.tagCount,
      ...(candidate.senseKey ? { senseKey: candidate.senseKey } : {}),
      ...(candidate.senseNumber ? { senseNumber: candidate.senseNumber } : {})
    }));
  const assignedSources = new Set(assignments.map((row) => row.source));
  const residual = [...sourceRows.entries()]
    .filter(([source]) => !reservedSenseKeys.has(source) && !assignedSources.has(source))
    .map(([source, record]) => {
      const candidates = candidatesBySource.get(source) ?? [];
      const reason = residualReasons.get(source)
        ?? (contestedSources.has(source)
          ? "anchor-contested-by-equal-frequency-senses"
          : candidates.every((candidate) => reservedTargets.has(candidate.targetId))
            ? "all-candidate-anchors-reserved"
            : "candidate-anchors-assigned-to-higher-frequency-senses");
      return {
        source,
        pos: record.pos,
        synset: record.synset,
        lemmas: Array.isArray(record.lemmas) ? [...record.lemmas] : [],
        gloss: String(record.gloss ?? ""),
        reason,
        ...(Number.isSafeInteger(record.tagCount) ? { tagCount: record.tagCount } : {}),
        candidates: candidates.map((candidate) => ({
          lemma: candidate.lemma,
          target: candidate.target,
          targetId: candidate.targetId,
          pyashSequence: candidate.pyashSequence,
          english30kRank: candidate.rank,
          tagCount: candidate.tagCount,
          ...(candidate.senseKey ? { senseKey: candidate.senseKey } : {}),
          ...(candidate.senseNumber ? { senseNumber: candidate.senseNumber } : {})
        }))
      };
    });
  const preserved = [...reservedSenseKeys].filter((source) => sourceRows.has(source)).map((source) => ({ source }));
  return {
    assignments,
    residual,
    preserved,
    blockedTargetIds: [...blockedTargets].sort(),
    counts: {
      senses: sourceRows.size,
      assignments: assignments.length,
      residual: residual.length,
      preserved: preserved.length,
      contestedTargets: blockedTargets.size
    }
  };
}

function isModelGeneratedBridge(entry) {
  const evidence = String(entry?.evidence ?? "");
  if (evidence.startsWith("atom-target sense selection;")) return false;
  return /sense-link sweep.*model-qwen|model qwen3\.5:9b/iu.test(evidence);
}

function isFrequencyAllocatedBridge(entry) {
  return String(entry?.evidence ?? "").startsWith("frequency-first anchor allocation");
}

export function reconcileEnglishWordNetFrequencyBridgeRows({
  existingEntries = [],
  assignments = [],
  resolveTarget = () => null
} = {}) {
  if (!Array.isArray(existingEntries) || !Array.isArray(assignments)) {
    throw invalid("WordNet frequency reconciliation requires entry and assignment arrays");
  }
  const preservedEntries = [];
  const modelEntries = [];
  for (const entry of existingEntries) {
    if (isFrequencyAllocatedBridge(entry)) continue;
    if (isModelGeneratedBridge(entry)) modelEntries.push(entry);
    else preservedEntries.push(entry);
  }
  const assignmentBySource = new Map(assignments.map((row) => [row.source, row]));
  const retainedModelEntries = [];
  const supersededModelEntries = [];
  for (const entry of modelEntries) {
    const allocation = assignmentBySource.get(entry.source);
    const targetPartOfSpeech = canonicalWordNetTargetPartOfSpeech(
      entry.targetPartOfSpeech || String(entry.source ?? "").slice(0, 1)
    );
    const allocationPartOfSpeech = canonicalWordNetTargetPartOfSpeech(
      allocation?.targetPartOfSpeech || String(allocation?.source ?? "").slice(0, 1)
    );
    const coverage = resolveTarget(entry.target, { partOfSpeech: targetPartOfSpeech });
    const sequence = Array.isArray(coverage?.pyashSequence) ? coverage.pyashSequence : [];
    if (allocation && sequence.length > 0
      && allocation.pyashSequence.join(" ") === sequence.join(" ")
      && allocationPartOfSpeech === targetPartOfSpeech) {
      retainedModelEntries.push(entry);
    } else {
      supersededModelEntries.push({
        source: entry.source,
        target: entry.target,
        evidence: entry.evidence,
        priorSequence: sequence,
        allocated: allocation ? {
          target: allocation.target,
          targetId: allocation.targetId,
          pyashSequence: allocation.pyashSequence,
          english30kRank: allocation.english30kRank,
          tagCount: allocation.tagCount
        } : null,
        reason: allocation ? "frequency-allocation-selected-a-different-anchor" : "no-frequency-allocation-for-sense"
      });
    }
  }
  const retainedSources = new Set([...preservedEntries, ...retainedModelEntries].map((entry) => entry.source));
  const newAssignments = assignments.filter((row) => !retainedSources.has(row.source));
  return {
    preservedEntries,
    retainedModelEntries,
    supersededModelEntries,
    newAssignments,
    counts: {
      preserved: preservedEntries.length,
      modelExisting: modelEntries.length,
      modelRetained: retainedModelEntries.length,
      modelSuperseded: supersededModelEntries.length,
      frequencyAssignmentsAdded: newAssignments.length
    }
  };
}

export function buildEnglishWordNetFrequencyAllocationRecords({
  wordnetIndex,
  frequencyJoin,
  rankForEnglish = () => Number.POSITIVE_INFINITY,
  resolveWord = () => null
} = {}) {
  if (!(wordnetIndex?.bySynset instanceof Map)) throw invalid("frequency allocation requires a WordNet index");
  if (!Array.isArray(frequencyJoin?.entries)) throw invalid("frequency allocation requires joined tag-count entries");
  const tagCountBySourceLemma = new Map();
  const tagCountBySource = new Map();
  for (const row of frequencyJoin.entries) {
    if (!Number.isSafeInteger(row.tagCount) || row.tagCount < 0) continue;
    const source = `${row.pos}:${row.synset}`;
    tagCountBySourceLemma.set(`${source}\u0000${normalize(row.lemma)}`, {
      tagCount: row.tagCount,
      senseNumber: row.senseNumber,
      senseKey: row.senseKey
    });
    tagCountBySource.set(source, Math.max(tagCountBySource.get(source) ?? 0, row.tagCount));
  }
  const records = [];
  for (const [source, rows] of wordnetIndex.bySynset) {
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const pos = source.slice(0, 1);
    const synset = source.slice(2);
    const lemmas = [...new Set(rows.map((row) => normalize(row.lemma)).filter(Boolean))].sort();
    const record = {
      source,
      pos,
      synset,
      lemmas,
      gloss: String(rows.map((row) => row.gloss).find(Boolean) ?? ""),
      ...(tagCountBySource.has(source) ? { tagCount: tagCountBySource.get(source) } : {}),
      candidates: []
    };
    for (const lemma of lemmas) {
      const rankValue = Number(rankForEnglish(lemma));
      const coverage = resolveWord(lemma, { pos, senseId: source });
      const pyashSequence = Array.isArray(coverage?.pyashSequence)
        ? coverage.pyashSequence.filter((word) => typeof word === "string" && word.trim()).map((word) => word.trim())
        : [];
      if (!ALLOWED_COVERAGE_TYPES.has(coverage?.coverageType) || pyashSequence.length === 0) continue;
      if (["alias", "dictionary-alias"].includes(coverage.coverageType)
        && !["atomic", "compound"].includes(coverage.canonicalCoverageType)) continue;
      const targetKind = coverage.coverageType === "compound" || pyashSequence.length > 1 ? "compound" : "atom";
      const targetPartOfSpeech = canonicalWordNetTargetPartOfSpeech(pos);
      const proposedTarget = String(coverage.canonicalEnglish || coverage.target || lemma).normalize("NFC").trim();
      const canonicalCoverage = resolveWord(proposedTarget, { pos });
      const canonicalSequence = Array.isArray(canonicalCoverage?.pyashSequence)
        ? canonicalCoverage.pyashSequence.filter((word) => typeof word === "string" && word.trim()).map((word) => word.trim())
        : [];
      if (!ALLOWED_COVERAGE_TYPES.has(canonicalCoverage?.coverageType)
        || canonicalSequence.length === 0
        || canonicalSequence.join(" ") !== pyashSequence.join(" ")) continue;
      const canonicalKind = canonicalCoverage.coverageType === "compound" || canonicalSequence.length > 1
        ? "compound"
        : "atom";
      if (canonicalKind !== targetKind) continue;
      const target = String(canonicalCoverage.canonicalEnglish || canonicalCoverage.target || proposedTarget).normalize("NFC").trim();
      const targetId = englishWordNetTargetId(targetKind, pyashSequence, targetPartOfSpeech);
      const frequency = tagCountBySourceLemma.get(`${source}\u0000${lemma}`);
      record.candidates.push({
        lemma,
        target,
        targetKind,
        targetId,
        targetPartOfSpeech,
        pyashSequence,
        rank: Number.isFinite(rankValue) && rankValue > 0 ? rankValue : null,
        tagCount: frequency?.tagCount ?? null,
        ...(frequency?.senseKey ? { senseKey: frequency.senseKey } : {}),
        ...(frequency?.senseNumber ? { senseNumber: frequency.senseNumber } : {})
      });
    }
    records.push(record);
  }
  return records.sort((left, right) => left.source.localeCompare(right.source));
}

export function buildEnglishWordNetAtomCoverage({
  atoms = [],
  resolveCoverage = () => null,
  rankForEnglish = () => Number.POSITIVE_INFINITY,
  wordnetRecords = [],
  bridgeRecords = []
} = {}) {
  if (!Array.isArray(atoms) || !Array.isArray(wordnetRecords) || !Array.isArray(bridgeRecords)) {
    throw invalid("atom coverage requires atom, WordNet, and bridge record arrays");
  }
  const byTarget = new Map();
  for (const atom of atoms) {
    const english = typeof atom?.en === "string" ? atom.en.normalize("NFC").trim() : "";
    const pyac = typeof atom?.pya === "string" ? atom.pya.trim() : "";
    if (!pyac) continue;
    const targetId = `atom:${pyac}`;
    const row = byTarget.get(targetId) ?? { id: targetId, targetId, pyac, labels: [] };
    if (english && !row.labels.some((label) => normalize(label) === normalize(english))) row.labels.push(english);
    byTarget.set(targetId, row);
  }

  const targetsBySource = new Map();
  for (const sense of bridgeRecords) {
    if (typeof sense?.source !== "string" || typeof sense?.link?.targetId !== "string") continue;
    const targets = targetsBySource.get(sense.source) ?? [];
    targets.push(sense.link.targetId);
    targetsBySource.set(sense.source, targets);
  }

  const candidatesByTarget = new Map();
  for (const sense of wordnetRecords) {
    for (const candidate of Array.isArray(sense?.candidates) ? sense.candidates : []) {
      if (candidate?.targetKind !== "atom" || typeof candidate.targetId !== "string") continue;
      const row = {
        source: sense.source,
        targetId: candidate.targetId,
        pos: sense.pos,
        targetPartOfSpeech: candidate.targetPartOfSpeech || canonicalWordNetTargetPartOfSpeech(sense.pos),
        synset: sense.synset,
        lemmas: [...(sense.lemmas ?? [])],
        definition: String(sense.gloss ?? "").split(";")[0].trim(),
        matchedLemma: candidate.lemma,
        english30kRank: Number.isFinite(candidate.rank) ? candidate.rank : null,
        tagCount: Number.isSafeInteger(candidate.tagCount) ? candidate.tagCount : null,
        activeTargetIds: [...(targetsBySource.get(sense.source) ?? [])].sort(),
        ...(candidate.senseKey ? { senseKey: candidate.senseKey } : {})
      };
      const candidateSequence = Array.isArray(candidate.pyashSequence)
        ? candidate.pyashSequence
        : String(candidate.targetId).replace(/^atom:/u, "").replace(/:(?:a|n|r|v)$/u, "").split("+");
      const targetBaseId = `atom:${candidateSequence.join("+")}`;
      const rows = candidatesByTarget.get(targetBaseId) ?? [];
      if (!rows.some((existing) => existing.source === row.source && existing.matchedLemma === row.matchedLemma)) rows.push(row);
      candidatesByTarget.set(targetBaseId, rows);
    }
  }

  const linksByTarget = new Map();
  for (const sense of bridgeRecords) {
    const targetId = sense?.link?.targetId;
    const pyac = Array.isArray(sense?.link?.pyashSequence) ? sense.link.pyashSequence.join("+") : "";
    if (typeof targetId !== "string" || !targetId.startsWith("atom:") || !pyac) continue;
    const baseTargetId = `atom:${pyac}`;
    const rows = linksByTarget.get(baseTargetId) ?? [];
    rows.push({
      source: sense.source,
      pos: sense.pos,
      targetPartOfSpeech: canonicalWordNetTargetPartOfSpeech(sense.link.targetPartOfSpeech || sense.pos),
      synset: sense.synset,
      lemmas: [...(sense.lemmas ?? [])],
      definition: String(sense.gloss ?? "").split(";")[0].trim(),
      target: sense.link.target,
      pyacSequence: [...(sense.link.pyashSequence ?? [])],
      certainty: sense.link.certainty,
      evidence: sense.link.evidence
    });
    linksByTarget.set(baseTargetId, rows);
  }

  return [...byTarget.values()].map((atom) => {
    const labelCoverage = atom.labels.map((label) => ({
      label,
      coverageType: resolveCoverage(label)?.coverageType ?? "none",
      rank: Number(rankForEnglish(label))
    }));
    const candidates = (candidatesByTarget.get(atom.targetId) ?? []).sort((left, right) => (
      (left.english30kRank ?? Number.MAX_SAFE_INTEGER) - (right.english30kRank ?? Number.MAX_SAFE_INTEGER)
        || (right.tagCount ?? -1) - (left.tagCount ?? -1)
        || left.source.localeCompare(right.source)
        || left.matchedLemma.localeCompare(right.matchedLemma)
    ));
    const links = (linksByTarget.get(atom.targetId) ?? []).sort((left, right) => left.source.localeCompare(right.source));
    const hasLexicalLabel = labelCoverage.some((label) => label.coverageType !== "grammar");
    const linkedTargetParts = new Set(links.map((link) => link.targetPartOfSpeech));
    const availableCandidates = candidates.filter((candidate) => (
      candidate.activeTargetIds.length === 0
      && !linkedTargetParts.has(candidate.targetPartOfSpeech)
    ));
    const status = !atom.labels.length
        ? "missing-english-gloss"
        : !hasLexicalLabel
          ? "grammar-no-lexical-sense"
          : candidates.length > 0
            ? availableCandidates.length > 0
              ? "direct-candidates-unlinked"
              : links.length > 0 ? "linked" : "direct-candidates-already-linked"
            : links.length > 0 ? "linked" : "no-direct-wordnet-candidate";
    const ranks = labelCoverage.map((label) => label.rank).filter((rank) => Number.isFinite(rank) && rank > 0);
    return {
      ...atom,
      labels: [...atom.labels].sort((left, right) => left.localeCompare(right)),
      english30kRank: ranks.length ? Math.min(...ranks) : null,
      labelCoverage,
      status,
      links,
      directCandidates: candidates.map((candidate) => ({
        ...candidate,
        targetPartOfSpeech: candidate.targetPartOfSpeech,
        availableTargetPartOfSpeech: availableCandidates.some((available) => (
          available.source === candidate.source && available.matchedLemma === candidate.matchedLemma
        ))
      }))
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
}

export function parseEnglishWordNetFrequencyConfig(source) {
  if (typeof source !== "string") throw invalid("WordNet frequency configuration must be Pyash text");
  const sentences = buildProgram(source).sentences;
  const header = sentences.find((sentence) => sentence?.mood === "def"
    && sentence?.be === "map"
    && sentence?.su?.name === ENGLISH_WORDNET_FREQUENCY_NAME);
  if (!header) throw invalid("WordNet frequency configuration has no canonical map header");
  const metadata = {};
  for (const sentence of sentences) {
    if (sentence?.mood !== "ya" || typeof sentence.su?.text !== "string") continue;
    if (typeof sentence.ob?.text === "string") metadata[sentence.su.text] = sentence.ob.text;
  }
  if (metadata.format !== ENGLISH_WORDNET_FREQUENCY_FORMAT || !metadata["index-path"] || !metadata["index-sha256"]) {
    throw invalid("WordNet frequency configuration is incomplete", { format: metadata.format });
  }
  return metadata;
}

export function parseEnglishWordNetFrequencyAllocationConfig(source) {
  if (typeof source !== "string") throw invalid("WordNet frequency allocation configuration must be Pyash text");
  const sentences = buildProgram(source).sentences;
  const header = sentences.find((sentence) => sentence?.mood === "def"
    && sentence?.be === "map"
    && sentence?.su?.name === ENGLISH_WORDNET_FREQUENCY_ALLOCATION_NAME);
  if (!header) throw invalid("WordNet frequency allocation configuration has no canonical map header");
  const metadata = {};
  for (const sentence of sentences) {
    if (sentence?.mood !== "ya" || typeof sentence.su?.text !== "string") continue;
    if (typeof sentence.ob?.text === "string") metadata[sentence.su.text] = sentence.ob.text;
    if (Number.isSafeInteger(sentence.ob?.num)) metadata[sentence.su.text] = sentence.ob.num;
  }
  if (metadata.format !== "english-wordnet-frequency-allocation-v1"
    || !Number.isSafeInteger(metadata["allocation-batch-size"])
    || !Number.isSafeInteger(metadata["maximum-compound-components"])
    || metadata["atom-coverage-format"] !== "english-wordnet-atom-coverage-v1"
    || metadata["atom-coverage-scope"] !== "every distinct Pyac identity in pyashWords"
    || !Number.isSafeInteger(metadata["atom-coverage-batch-size"])
    || !String(metadata["atom-unlinked-policy"] ?? "").trim()
    || metadata["compound-candidate-source"] !== "english30k-closed-wordnet-multiword-existing-atoms-v1"
    || metadata["compound-candidate-order"] !== "english30k-rank-ascending-princeton-tag-count-descending"
    || !Number.isSafeInteger(metadata["compound-verification-batch-size"])
    || !String(metadata["compound-verification-revision"] ?? "").trim()
    || metadata["compound-head-relation-policy"] !== "advisory"
    || !String(metadata["alias-target-policy"] ?? "").trim()) {
    throw invalid("WordNet frequency allocation configuration is incomplete", { format: metadata.format });
  }
  return metadata;
}

export async function loadEnglishWordNetFrequencyResources({
  configUrl = ENGLISH_WORDNET_FREQUENCY_CONFIG_URL,
  repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../")
} = {}) {
  const config = parseEnglishWordNetFrequencyConfig(await readFile(configUrl, "utf8"));
  const indexPath = resolve(repositoryRoot, config["index-path"]);
  const source = await readFile(indexPath, "utf8");
  const frequency = parsePrincetonWordNetSenseIndex(source);
  if (frequency.sourceHash !== config["index-sha256"]) {
    throw invalid("Princeton WordNet sense index hash does not match configuration", {
      expected: config["index-sha256"],
      actual: frequency.sourceHash,
      path: indexPath
    });
  }
  const directory = resolve(repositoryRoot, "know/wordnet/open-english-wordnet-2025-json");
  const names = (await readdir(directory)).filter((name) => /^entries-.+\.json$/u.test(name)).sort();
  const files = await Promise.all(names.map(async (name) => ({
    name,
    source: await readFile(resolve(directory, name), "utf8")
  })));
  const entrySenses = parseOpenEnglishWordNetEntrySenseFiles(files);
  const joined = joinOpenEnglishWordNetSenseFrequencies({ entrySenses, frequency });
  return {
    config,
    indexPath,
    indexHash: frequency.sourceHash,
    frequency,
    entrySenses,
    joined,
    sourceHash: sha256(`${frequency.sourceHash}\u0000${entrySenses.sourceHash}`)
  };
}

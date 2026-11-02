import pyashWords from "../program/library/pyashWords.json" with { type: "json" };
import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildEnglishWordNetBridgeIndex,
  parseEnglishWordNetBridgeCatalog
} from "../program/library/translation/english_wordnet_bridges.mjs";
import {
  buildEnglishWordNetFrequencyAllocationRecords,
  allocateEnglishWordNetAnchors,
  ENGLISH_WORDNET_FREQUENCY_ALLOCATION_CONFIG_URL,
  loadEnglishWordNetFrequencyResources,
  parseEnglishWordNetFrequencyAllocationConfig,
  reconcileEnglishWordNetFrequencyBridgeRows
} from "../program/library/translation/english_wordnet_frequency.mjs";
import { loadEnglishWordNetCompoundDecisions } from "../program/library/translation/english_wordnet_compound_decisions.mjs";
import { renderEnglishWordNetSenseLinksPya } from "../program/library/translation/english_wordnet_linker.mjs";
import {
  english30kLookupVariants,
  lookupEnglish30kCoverage
} from "../program/library/translation/english30k_coverage.mjs";
import { loadDefaultEnglishSentenceResources } from "../program/library/translation/english_sentence.mjs";
import {
  buildWordNetHeadRelationIndex,
  hasWordNetHeadSenseRelation
} from "../program/library/translation/english_wordnet.mjs";
import { loadCoverage } from "./compound_coverage.mjs";

export { buildWordNetHeadRelationIndex, hasWordNetHeadSenseRelation };

const COMMAND_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(COMMAND_DIRECTORY, "..");
const ARTIFACT_ROOT = join(REPOSITORY_ROOT, "artifacts");
const BRIDGE_PATH = new URL("../program/library/translation/english_wordnet_bridges.pya", import.meta.url);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalized(value) {
  return typeof value === "string"
    ? value.normalize("NFC").trim().toLowerCase().replace(/[_-]+/gu, " ").replace(/\s+/gu, " ")
    : "";
}

function sequence(value) {
  return Array.isArray(value)
    ? value.filter((word) => typeof word === "string" && word.trim()).map((word) => word.trim())
    : [];
}

function modelGenerated(entry) {
  return /sense-link sweep.*model-qwen|model qwen3\.5:9b/iu.test(String(entry?.evidence ?? ""));
}

function frequencyGenerated(entry) {
  return String(entry?.evidence ?? "").startsWith("frequency-first anchor allocation");
}

function targetIdentity(coverage, target) {
  const pyashSequence = sequence(coverage?.pyashSequence);
  const targetKind = coverage?.coverageType === "compound" || pyashSequence.length > 1 ? "compound" : "atom";
  return {
    target: String(coverage?.canonicalEnglish || coverage?.target || target).normalize("NFC").trim(),
    pyashSequence,
    targetKind,
    targetId: `${targetKind}:${pyashSequence.join("+")}`
  };
}

export function buildWordResolver(resources, compoundCoverage) {
  const atoms = new Map();
  for (const entry of pyashWords) {
    const target = normalized(entry?.en);
    const pyash = String(entry?.pya ?? "").trim();
    if (target && pyash && !atoms.has(target)) {
      atoms.set(target, { coverageType: "atomic", canonicalEnglish: target, pyashSequence: [pyash] });
    }
  }
  const compounds = new Map();
  for (const record of compoundCoverage.accepted) {
    const pyashSequence = sequence(record.pyashSequence);
    if (pyashSequence.length < 2 || pyashSequence.length > 3) continue;
    const coverage = {
      coverageType: "compound",
      canonicalEnglish: String(record.target).normalize("NFC").trim(),
      target: String(record.target).normalize("NFC").trim(),
      pyashSequence,
      id: record.id
    };
    for (const word of [record.target, ...(record.aliases ?? [])]) {
      const key = normalized(word);
      if (key && !atoms.has(key) && !compounds.has(key)) compounds.set(key, coverage);
    }
  }
  return (word) => {
    const key = normalized(word);
    const coverage = lookupEnglish30kCoverage(resources.coverage, word);
    if (coverage?.coverageType === "grammar") return {
      coverageType: "grammar",
      canonicalEnglish: normalized(word),
      pyashSequence: sequence(coverage.pyashSequence)
    };
    if (["alias", "dictionary-alias"].includes(coverage?.coverageType)) {
      const canonical = normalized(coverage.canonicalEnglish);
      const canonicalCoverage = lookupEnglish30kCoverage(resources.coverage, coverage.canonicalEnglish);
      let canonicalSequence = sequence(canonicalCoverage?.pyashSequence);
      let canonicalType = canonicalCoverage?.coverageType;
      if (!canonicalCoverage && atoms.has(canonical)) {
        canonicalSequence = sequence(atoms.get(canonical)?.pyashSequence);
        canonicalType = "atomic";
      } else if (!canonicalCoverage && compounds.has(canonical)) {
        canonicalSequence = sequence(compounds.get(canonical)?.pyashSequence);
        canonicalType = "compound";
      }
      const aliasSequence = sequence(coverage.pyashSequence);
      if (!canonical || !["atomic", "compound"].includes(canonicalType)
        || canonicalSequence.join(" ") !== aliasSequence.join(" ")) return null;
      return {
        coverageType: coverage.coverageType,
        canonicalEnglish: coverage.canonicalEnglish,
        canonicalCoverageType: canonicalType,
        pyashSequence: aliasSequence
      };
    }
    if (atoms.has(key)) return atoms.get(key);
    if (compounds.has(key)) return compounds.get(key);
    if (!coverage) return null;
    if (coverage.coverageType === "atomic") return {
      coverageType: "atomic",
      canonicalEnglish: coverage.canonicalEnglish,
      pyashSequence: sequence(coverage.pyashSequence)
    };
    if (coverage.coverageType === "compound" && sequence(coverage.pyashSequence).length >= 2) return {
      coverageType: "compound",
      canonicalEnglish: coverage.canonicalEnglish || normalized(word),
      pyashSequence: sequence(coverage.pyashSequence)
    };
    return null;
  };
}

function rankLookup(resources) {
  const ranks = new Map();
  for (const row of resources.source.rows) {
    for (const variant of english30kLookupVariants(row.word)) {
      if (!ranks.has(normalized(variant))) ranks.set(normalized(variant), row.rank);
    }
  }
  return (word) => ranks.get(normalized(word)) ?? Number.POSITIVE_INFINITY;
}

function bridgeRecord(entry, resolveWord) {
  const source = String(entry.source ?? "");
  const separator = source.indexOf(":");
  const pos = source.slice(0, separator);
  const synset = source.slice(separator + 1);
  const identity = targetIdentity(resolveWord(entry.target), entry.target);
  if (!identity.pyashSequence.length) {
    throw new Error(`cannot preserve existing WordNet bridge without resolvable anchor: ${source} -> ${entry.target}`);
  }
  return {
    source,
    pos,
    synset,
    gloss: entry.gloss,
    lemmas: entry.lemmas,
    status: entry.certainty === "deterministic" ? "accepted-deterministic" : "accepted-llm",
    link: {
      ...identity,
      targetPartOfSpeech: entry.targetPartOfSpeech || pos,
      certainty: entry.certainty,
      evidence: entry.evidence,
      ...(entry.equivalenceGroup ? { equivalenceGroup: entry.equivalenceGroup } : {}),
      ...(entry.equivalenceEvidence ? { equivalenceEvidence: entry.equivalenceEvidence } : {})
    }
  };
}

function allocationRecord(record, allocation) {
  return {
    source: record.source,
    pos: record.pos,
    synset: record.synset,
    gloss: record.gloss,
    lemmas: [...record.lemmas],
    status: "accepted-deterministic",
    link: {
      target: allocation.target,
      targetId: allocation.targetId,
      targetKind: allocation.targetKind,
      pyashSequence: [...allocation.pyashSequence],
      targetPartOfSpeech: record.pos,
      certainty: "deterministic",
      evidence: `frequency-first anchor allocation: exact lemma ${allocation.lemma} at English30k rank ${allocation.english30kRank}; ${allocation.tagCount === null ? "no exact-key Princeton tag count" : `Princeton WordNet 3.1 tag count ${allocation.tagCount}`} (sense key ${allocation.senseKey ?? "unmatched exact lexical key"})`
    }
  };
}

function definitionOnly(gloss) {
  return String(gloss ?? "").split(";")[0].trim().slice(0, 320);
}

function senseTagCountIndex(entries) {
  const result = new Map();
  for (const row of entries) {
    const id = `${row.pos}:${row.synset}`;
    if (!Number.isSafeInteger(row.tagCount)) continue;
    result.set(id, Math.max(result.get(id) ?? -1, row.tagCount));
  }
  return result;
}

export function compoundWorklist(
  residual,
  compoundRecords,
  reservedTargetIds,
  assignedTargetIds,
  decisionsById = new Map(),
  decisionRevision = "",
  {
    wordnetIndex = null,
    senseTagCounts = new Map(),
    rankForEnglish = () => Number.POSITIVE_INFINITY,
    maximumCompoundComponents = 3
  } = {}
) {
  const headRelationIndex = buildWordNetHeadRelationIndex(wordnetIndex?.relations ?? []);
  const residualByTerm = new Map();
  const residualBySource = new Map();
  for (const record of residual) {
    residualBySource.set(record.source, record);
    for (const lemma of record.lemmas) {
      const key = normalized(lemma);
      residualByTerm.set(key, [...(residualByTerm.get(key) ?? []), record.source]);
    }
  }
  const targetIdsInUse = new Set([...reservedTargetIds, ...assignedTargetIds]);
  const rows = [];
  for (const record of compoundRecords) {
    const components = record.componentGlosses ?? record.sourceMorphemes ?? [];
    const target = normalized(record.target);
    const aliases = (record.aliases ?? []).map(normalized);
    const senseSources = [...new Set([target, ...aliases].flatMap((term) => residualByTerm.get(term) ?? []))].sort();
    if (senseSources.length === 0) continue;
    const rankedTargetSenseEvidence = senseSources
      .map((source) => residualBySource.get(source))
      .filter(Boolean)
      .map((sense) => {
        const rankRows = (sense.candidates ?? []).filter((candidate) => (
          [target, ...aliases].includes(normalized(candidate.lemma))
        ));
        const matchingLemmas = sense.lemmas.filter((lemma) => [target, ...aliases].includes(normalized(lemma)));
        const frequencyRanks = [
          ...rankRows.map((row) => Number(row.english30kRank ?? row.rank)),
          ...matchingLemmas.map((lemma) => Number(rankForEnglish(lemma)))
        ].filter((rank) => Number.isFinite(rank) && rank > 0);
        const exactTagCounts = [
          ...rankRows.map((row) => row.tagCount),
          senseTagCounts.get(sense.source)
        ].filter(Number.isSafeInteger);
        return {
          source: sense.source,
          pos: sense.pos,
          lemmas: [...sense.lemmas],
          definition: definitionOnly(sense.gloss),
          frequencyRank: frequencyRanks.length ? Math.min(...frequencyRanks) : Number.MAX_SAFE_INTEGER,
          tagCount: exactTagCounts.length ? Math.max(...exactTagCounts) : -1
        };
      })
      .sort((left, right) => left.frequencyRank - right.frequencyRank
        || right.tagCount - left.tagCount
        || left.source.localeCompare(right.source));
    const allComponentSenseEvidence = components
      .flatMap((component) => (wordnetIndex?.senses?.(component) ?? []).map((sense) => ({
        component,
        source: `${sense.pos}:${sense.synset}`,
        lemmas: [...(sense.lemmas ?? [])],
        definition: definitionOnly(sense.gloss),
        tagCount: senseTagCounts.get(`${sense.pos}:${sense.synset}`) ?? -1
      })))
      .sort((left, right) => right.tagCount - left.tagCount
        || left.component.localeCompare(right.component)
        || left.source.localeCompare(right.source));
    const finalComponent = String(components.at(-1) ?? "").trim();
    const allHeadComponentSenses = allComponentSenseEvidence
      .filter((sense) => sense.component === finalComponent);
    const rankedTargetWithHeadEvidence = rankedTargetSenseEvidence
      .map((sense) => ({
        ...sense,
        compatibleHeadSenseIds: allHeadComponentSenses
          .filter((componentSense) => hasWordNetHeadSenseRelation(sense.source, componentSense.source, headRelationIndex))
          .map((componentSense) => componentSense.source)
      }))
      .sort((left, right) => Number(right.compatibleHeadSenseIds.length > 0) - Number(left.compatibleHeadSenseIds.length > 0)
        || left.frequencyRank - right.frequencyRank
        || right.tagCount - left.tagCount
        || left.source.localeCompare(right.source));
    const selectedTargetRows = rankedTargetWithHeadEvidence.slice(0, 4);
    const selectedHeadComponentSenses = [];
    for (const targetSense of selectedTargetRows.filter((sense) => sense.compatibleHeadSenseIds.length > 0)) {
      if (selectedHeadComponentSenses.some((sense) => targetSense.compatibleHeadSenseIds.includes(sense.source))) continue;
      const nextHeadSense = allHeadComponentSenses
        .filter((sense) => targetSense.compatibleHeadSenseIds.includes(sense.source))
        .sort((left, right) => right.tagCount - left.tagCount || left.source.localeCompare(right.source))
        .find((sense) => !selectedHeadComponentSenses.some((selected) => selected.source === sense.source));
      if (nextHeadSense && selectedHeadComponentSenses.length < 4) selectedHeadComponentSenses.push(nextHeadSense);
    }
    for (const sense of allHeadComponentSenses) {
      if (selectedHeadComponentSenses.length >= 4) break;
      if (!selectedHeadComponentSenses.some((selected) => selected.source === sense.source)) selectedHeadComponentSenses.push(sense);
    }
    const componentSenseEvidence = [...new Set(components.map((component) => String(component ?? "").trim()))]
      .flatMap((component) => {
        const componentRows = allComponentSenseEvidence.filter((sense) => sense.component === component);
        const selectedRows = component === finalComponent
          ? [
            ...selectedHeadComponentSenses,
            ...componentRows.filter((sense) => !selectedHeadComponentSenses.some((selected) => selected.source === sense.source))
          ].slice(0, 4)
          : componentRows.slice(0, 4);
        return selectedRows;
      })
      .map(({ tagCount, ...sense }) => sense);
    const selectedHeadSenseIds = new Set(selectedHeadComponentSenses.map((sense) => sense.source));
    const targetEvidenceWithHead = selectedTargetRows.map(({ frequencyRank, tagCount, ...sense }) => ({
      ...sense,
      compatibleHeadSenseIds: sense.compatibleHeadSenseIds.filter((id) => selectedHeadSenseIds.has(id))
    }));
    const frequencyRank = rankedTargetSenseEvidence.length
      ? Math.min(...rankedTargetSenseEvidence.map((sense) => sense.frequencyRank))
      : Number.MAX_SAFE_INTEGER;
    const frequencyTagCount = rankedTargetSenseEvidence
      .filter((sense) => sense.frequencyRank === frequencyRank)
      .reduce((best, sense) => Math.max(best, sense.tagCount), -1);
    const pyashSequence = sequence(record.pyashSequence);
    if (pyashSequence.length < 2 || pyashSequence.length > maximumCompoundComponents) continue;
    const targetId = `compound:${pyashSequence.join("+")}`;
    rows.push({
      ...record,
      id: record.id,
      target,
      aliases,
      source: record.provenance,
      senseSources,
      pyashSequence,
      componentGlosses: record.componentGlosses,
      sourceSurfaces: record.sourceSurfaces,
      sourceMorphemesByLanguage: record.sourceMorphemesByLanguage,
      frequencyRank,
      frequencyTagCount,
      status: "candidate-closed",
      disposition: targetIdsInUse.has(targetId)
        ? "target-identity-already-linked"
        : decisionsById.get(record.id)?.decisionRevision === decisionRevision
          ? `already-${decisionsById.get(record.id).status}`
          : targetEvidenceWithHead.length === 0 || !targetEvidenceWithHead.some((sense) => sense.compatibleHeadSenseIds.length > 0)
            ? "no-wordnet-head-evidence"
          : "ready-for-housekeeper-verification",
      targetId,
      targetSenseEvidence: targetEvidenceWithHead,
      componentSenseEvidence,
      verificationRecord: {
        ...record,
        frequencyRank,
        frequencyTagCount,
        componentSenseEvidence,
        targetSenseEvidence: targetEvidenceWithHead
      },
      evidence: record.evidence
    });
  }
  return rows.sort((left, right) => left.frequencyRank - right.frequencyRank
    || right.frequencyTagCount - left.frequencyTagCount
    || left.target.localeCompare(right.target)
    || left.id.localeCompare(right.id));
}

function renderRowsPya({ name, format, runId, records, extra = {} }) {
  const lines = [
    `su name ${name} be map def`,
    `su text "format" ob text ${JSON.stringify(format)} ya`,
    `su text "run-id" ob text ${JSON.stringify(runId)} ya`,
    ...Object.entries(extra).map(([key, value]) => `su text ${JSON.stringify(key)} ob text ${JSON.stringify(value)} ya`),
    ...records.map((record) => `su text ${JSON.stringify(record.id ?? record.source ?? record.target)} ob text ${JSON.stringify(JSON.stringify(record))} ya`),
    "prah"
  ];
  return `${lines.join("\n")}\n`;
}

function renderManifestPya(manifest) {
  return [
    "su name allotment be map def",
    `su text "format" ob text "english-wordnet-frequency-allocation-artifact-v1" ya`,
    ...Object.entries(manifest).map(([key, value]) => `su text ${JSON.stringify(key)} ob text ${JSON.stringify(typeof value === "string" ? value : JSON.stringify(value))} ya`),
    "prah",
    ""
  ].join("\n");
}

async function atomicWrite(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await rm(temporary, { force: true });
  await writeFile(temporary, contents, "utf8");
  await rename(temporary, path);
}

async function acquireLock(path) {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, "wx");
  await handle.writeFile(`${process.pid}\n`, "utf8");
  await handle.close();
  return () => rm(path, { force: true });
}

function batchFilename(kind, index) {
  return `${kind}-${String(index).padStart(5, "0")}.pya`;
}

async function writeBatches(directory, { kind, name, format, runId, records, batchSize, sourceHash, coverageHash }) {
  const count = Math.ceil(records.length / batchSize);
  for (let index = 0; index < count; index += 1) {
    const batch = records.slice(index * batchSize, (index + 1) * batchSize);
    await atomicWrite(join(directory, "batches", batchFilename(kind, index + 1)), renderRowsPya({
      name,
      format,
      runId,
      records: batch,
      extra: {
        "batch-index": index + 1,
        "source-hash": sourceHash,
        "coverage-hash": coverageHash
      }
    }));
  }
  return count;
}

export async function prepareWordNetFrequencyAllocation() {
  const allocationConfigSource = await readFile(ENGLISH_WORDNET_FREQUENCY_ALLOCATION_CONFIG_URL, "utf8");
  const allocationConfig = parseEnglishWordNetFrequencyAllocationConfig(allocationConfigSource);
  const [resources, frequency, linkerSource, compoundDecisions] = await Promise.all([
    loadDefaultEnglishSentenceResources(),
    loadEnglishWordNetFrequencyResources(),
    readFile(new URL("../program/library/translation/english_wordnet_bridges.pya", import.meta.url), "utf8"),
    loadEnglishWordNetCompoundDecisions()
  ]);
  const compoundCoverage = await loadCoverage({
    maximumCompoundComponents: allocationConfig["maximum-compound-components"],
    wordnetIndex: resources.wordnet.index
  });
  const catalog = parseEnglishWordNetBridgeCatalog(linkerSource);
  const resolveWord = buildWordResolver(resources, compoundCoverage);
  const rankForEnglish = rankLookup(resources);
  const records = buildEnglishWordNetFrequencyAllocationRecords({
    wordnetIndex: resources.wordnet.index,
    frequencyJoin: frequency.joined,
    rankForEnglish,
    resolveWord
  });
  const preservedEntries = catalog.entries.filter((entry) => !modelGenerated(entry) && !frequencyGenerated(entry));
  const preservedRecords = preservedEntries.map((entry) => bridgeRecord(entry, resolveWord));
  const reservedTargetIds = preservedRecords.map((record) => record.link.targetId);
  const reservedSources = preservedRecords.map((record) => record.source);
  const allocation = allocateEnglishWordNetAnchors(records, { reservedTargetIds, reservedSources });
  const reconciliation = reconcileEnglishWordNetFrequencyBridgeRows({
    existingEntries: catalog.entries,
    assignments: allocation.assignments,
    resolveTarget: resolveWord
  });
  const recordsBySource = new Map(records.map((record) => [record.source, record]));
  const addedRecords = reconciliation.newAssignments.map((assignment) => allocationRecord(
    recordsBySource.get(assignment.source),
    assignment
  ));
  const retainedModelRecords = reconciliation.retainedModelEntries.map((entry) => bridgeRecord(entry, resolveWord));
  const finalRecords = [...preservedRecords, ...retainedModelRecords, ...addedRecords];
  const bridgeIndex = buildEnglishWordNetBridgeIndex({
    entries: finalRecords.map((record) => ({
      source: record.source,
      target: record.link.target,
      pyashSequence: record.link.pyashSequence,
      targetKind: record.link.targetKind,
      targetId: record.link.targetId,
      targetPartOfSpeech: record.link.targetPartOfSpeech,
      certainty: record.link.certainty,
      evidence: record.link.evidence,
      equivalenceGroup: record.link.equivalenceGroup,
      equivalenceEvidence: record.link.equivalenceEvidence
    })),
    resolveTarget: resolveWord
  });
  const inactiveAdded = addedRecords.filter((record) => !bridgeIndex.bySense.has(record.source));
  if (inactiveAdded.length > 0) {
    throw new Error(`frequency allocator produced ${inactiveAdded.length} bridge additions that fail active collision validation`);
  }
  const finalCatalog = renderEnglishWordNetSenseLinksPya({
    records: finalRecords,
    source: "Open English WordNet 2025; Princeton WordNet 3.1 exact sense-key frequency allocation",
    sourceHash: frequency.sourceHash,
    name: "translation_english_wordnet_bridges"
  });
  const residualCompounds = compoundWorklist(
    allocation.residual,
    compoundCoverage.candidates,
    reservedTargetIds,
    allocation.assignments.map((row) => row.targetId),
    compoundDecisions.byId,
    allocationConfig["compound-verification-revision"],
    {
      wordnetIndex: resources.wordnet.index,
      senseTagCounts: senseTagCountIndex(frequency.joined.entries),
      rankForEnglish,
      maximumCompoundComponents: allocationConfig["maximum-compound-components"]
    }
  );
  const sourceHash = sha256(stableJson({
    openEnglishWordNet: resources.wordnet.sourceHash,
    openEnglishWordNetEntryKeys: frequency.entrySenses.sourceHash,
    princetonSenseIndex: frequency.indexHash
  }));
  const coverageIdentity = {
    english30k: resources.source.sourceHash,
    bridges: catalog.entries.map((entry) => [entry.source, entry.target, entry.certainty, entry.evidence]).sort((a, b) => a[0].localeCompare(b[0])),
    atoms: pyashWords.map((entry) => [normalized(entry?.en), String(entry?.pya ?? "")]).sort((a, b) => a[0].localeCompare(b[0])),
    acceptedCompounds: compoundCoverage.accepted.map((record) => [
      normalized(record.target),
      ...(record.aliases ?? []).map(normalized),
      sequence(record.pyashSequence)
    ]).sort((a, b) => a[0].localeCompare(b[0])),
    compoundCandidates: compoundCoverage.candidates.map((record) => [
      record.id,
      normalized(record.target),
      (record.componentGlosses ?? []).map(normalized),
      sequence(record.pyashSequence)
    ]).sort((a, b) => a[0].localeCompare(b[0])),
    compoundDecisions: compoundDecisions.rows.map((record) => [record.candidateId, record.status]).sort((a, b) => a[0].localeCompare(b[0])),
    allocationConfig,
    tagMatches: frequency.joined.matchedCount
  };
  const coverageHash = sha256(stableJson(coverageIdentity));
  const runId = `wordnet-frequency-allocation-${sourceHash.slice(0, 12)}-${coverageHash.slice(0, 12)}`;
  return {
    runId,
    sourceHash,
    coverageHash,
    allocationConfig,
    allocation,
    reconciliation,
    residualCompounds,
    finalCatalog,
    sourceRecordCount: records.length,
    exactTagMatches: frequency.joined.matchedCount,
    unmatchedTagKeys: frequency.joined.unmatchedCount,
    orphanFrequencyKeys: frequency.joined.unmatchedIndexCount,
    preservedTargetIds: reservedTargetIds,
    bridgePath: fileURLToPath(BRIDGE_PATH)
  };
}

export async function runWordNetFrequencyAllocation({ artifactRoot = ARTIFACT_ROOT, apply = true } = {}) {
  const result = await prepareWordNetFrequencyAllocation();
  const directory = join(resolve(artifactRoot), result.runId);
  await mkdir(directory, { recursive: true });
  const releaseLock = await acquireLock(join(directory, ".allocation.lock"));
  const manifestPath = join(directory, "manifest.pya");
  const bridgePath = result.bridgePath;
  const bridgeOutputHash = sha256(result.finalCatalog);
  try {
    const assignmentBatchCount = await writeBatches(directory, {
      kind: "assignments",
      name: "translation_wordnet_frequency_assignments",
      format: "english-wordnet-frequency-assignments-v1",
      runId: result.runId,
      records: result.reconciliation.newAssignments,
      batchSize: result.allocationConfig["allocation-batch-size"],
      sourceHash: result.sourceHash,
      coverageHash: result.coverageHash
    });
    const residualBatchCount = await writeBatches(directory, {
      kind: "residual",
      name: "translation_wordnet_frequency_residuals",
      format: "english-wordnet-frequency-residuals-v1",
      runId: result.runId,
      records: result.allocation.residual,
      batchSize: result.allocationConfig["allocation-batch-size"],
      sourceHash: result.sourceHash,
      coverageHash: result.coverageHash
    });
    await atomicWrite(join(directory, "model-reconciliation.pya"), renderRowsPya({
      name: "translation_wordnet_model_reconciliation",
      format: "english-wordnet-model-reconciliation-v1",
      runId: result.runId,
      records: [
        ...result.reconciliation.retainedModelEntries.map((entry) => {
          const allocation = result.allocation.assignments.find((row) => row.source === entry.source);
          return {
            id: entry.source,
            source: entry.source,
            target: entry.target,
            priorEvidence: entry.evidence,
            decision: "retained-frequency-allocation-matched",
            allocated: allocation ? {
              target: allocation.target,
              targetId: allocation.targetId,
              pyashSequence: allocation.pyashSequence,
              english30kRank: allocation.english30kRank,
              tagCount: allocation.tagCount
            } : null
          };
        }),
        ...result.reconciliation.supersededModelEntries.map((row) => ({ ...row, id: row.source, decision: "superseded" }))
      ],
      extra: { "coverage-hash": result.coverageHash }
    }));
    await atomicWrite(join(directory, "compound-candidates.pya"), renderRowsPya({
      name: "translation_wordnet_compound_candidates",
      format: "english-wordnet-compound-worklist-v1",
      runId: result.runId,
      records: result.residualCompounds.map((row) => ({ ...row, id: row.id })),
      extra: { "source-hash": result.sourceHash, "coverage-hash": result.coverageHash }
    }));
    await atomicWrite(join(directory, "bridge-catalog.pya"), result.finalCatalog);
    const manifest = {
      runId: result.runId,
      status: "artifacts-complete",
      sourceHash: result.sourceHash,
      coverageHash: result.coverageHash,
      recordCount: result.sourceRecordCount,
      exactTagMatches: result.exactTagMatches,
      unmatchedTagKeys: result.unmatchedTagKeys,
      orphanFrequencyKeys: result.orphanFrequencyKeys,
      assignmentBatchCount,
      residualBatchCount,
      frequencyAssignedSenses: result.allocation.assignments.length,
      newFrequencyLinks: result.reconciliation.newAssignments.length,
      residualSenses: result.allocation.residual.length,
      preservedBridges: result.reconciliation.counts.preserved,
      modelLinksRetained: result.reconciliation.counts.modelRetained,
      modelLinksSuperseded: result.reconciliation.counts.modelSuperseded,
      compoundCandidates: result.residualCompounds.length,
      compoundCandidatesReady: result.residualCompounds.filter((row) => row.disposition === "ready-for-housekeeper-verification").length,
      compoundCandidatesWithoutWordNetHeadEvidence: result.residualCompounds.filter((row) => row.disposition === "no-wordnet-head-evidence").length,
      bridgeOutputHash
    };
    await atomicWrite(manifestPath, renderManifestPya(manifest));
    if (apply) {
      await atomicWrite(bridgePath, result.finalCatalog);
      manifest.status = "applied";
      await atomicWrite(manifestPath, renderManifestPya(manifest));
    }
    return {
      ...manifest,
      artifactDirectory: directory,
      manifestPath,
      bridgePath: apply ? bridgePath : join(directory, "bridge-catalog.pya"),
      applied: apply,
      allocationCounts: result.allocation.counts,
      reconciliationCounts: result.reconciliation.counts
    };
  } finally {
    await releaseLock();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runWordNetFrequencyAllocation().then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  });
}

import { createHash } from "node:crypto";
import { appendFile, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DERIVED_COMPOUND_CURATED_NAME,
  renderDerivedCompoundCoveragePya,
  WORDNET_VERIFIED_COMPOUNDS_URL
} from "../program/library/translation/compound_coverage.mjs";
import {
  loadEnglishWordNetCompoundGlosses,
  buildEnglishWordNetCompoundGlosses,
  mergeEnglishWordNetCompoundGlosses,
  writeEnglishWordNetCompoundGlosses
} from "../program/library/translation/english_wordnet_compound_glosses.mjs";
import {
  compareCompoundSenseRecords,
  deduplicateCompoundSenseRecords
} from "../program/library/translation/compound_sense_dedupe.mjs";
import { loadCompoundLexicon } from "../program/library/translation/compound_lexicon.mjs";
import {
  canonicalWordNetTargetPartOfSpeech,
  englishWordNetTargetId
} from "../program/library/translation/english_wordnet_bridges.mjs";
import {
  ENGLISH_WORDNET_COMPOUND_DECISIONS_URL,
  loadEnglishWordNetCompoundDecisions,
  renderEnglishWordNetCompoundDecisionAppend,
  renderEnglishWordNetCompoundDecisions
} from "../program/library/translation/english_wordnet_compound_decisions.mjs";
import { parseEnglishWordNetFrequencyAllocationConfig } from "../program/library/translation/english_wordnet_frequency.mjs";
import { componentGlossLookupAlternatives } from "../program/library/translation/english_wordnet_sense_compounds.mjs";
import { verifyCompoundRecords } from "./compound_coverage_verify.mjs";
import {
  prepareWordNetFrequencyAllocation,
  runWordNetFrequencyAllocation
} from "./wordnet_frequency_allocate.mjs";

const COMMAND_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(COMMAND_DIRECTORY, "..");
const ARTIFACT_ROOT = join(REPOSITORY_ROOT, "artifacts");
const ALLOCATION_CONFIG_URL = new URL("../program/library/translation/english_wordnet_frequency_allocation.pya", import.meta.url);

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

function sequence(value) {
  return Array.isArray(value)
    ? value.filter((word) => typeof word === "string" && word.trim()).map((word) => word.trim())
    : [];
}

function candidateId(record) {
  return String(record?.id ?? "").trim() || `compound-candidate-${sha256(stableJson({
    target: record?.target,
    sourceMorphemes: record?.sourceMorphemes,
    sourceSurfaces: record?.sourceSurfaces,
    pyashSequence: record?.pyashSequence
  })).slice(0, 24)}`;
}

function groupKey(record) {
  return `${String(record?.target ?? "").trim().toLowerCase()}\u0000${stableJson(record?.sourceSurfaces ?? {})}`;
}

function lacksWordNetHeadRelation(row) {
  const targetSenseEvidence = row?.targetSenseEvidence ?? row?.verificationRecord?.targetSenseEvidence;
  return !Array.isArray(targetSenseEvidence)
    || !targetSenseEvidence.some((sense) => Array.isArray(sense?.compatibleHeadSenseIds)
      && sense.compatibleHeadSenseIds.length > 0);
}

export function groupWordNetCompoundCandidates(records = [], completedIds = new Set()) {
  if (!Array.isArray(records)) throw new TypeError("compound candidates must be an array");
  const groups = new Map();
  for (const row of records) {
    const record = row?.verificationRecord ?? row;
    const id = candidateId(record);
    if (completedIds.has(id)) continue;
    const key = groupKey(record);
    const group = groups.get(key) ?? [];
    group.push({ ...record, id });
    groups.set(key, group);
  }
  const frequencyRank = (group) => Math.min(...group
    .map((record) => Number(record.frequencyRank))
    .filter((rank) => Number.isFinite(rank) && rank > 0), Number.MAX_SAFE_INTEGER);
  const frequencyTagCount = (group) => Math.max(-1, ...group
    .map((record) => Number(record.frequencyTagCount))
    .filter(Number.isSafeInteger));
  return [...groups.values()].sort((left, right) => (
    frequencyRank(left) - frequencyRank(right)
    || frequencyTagCount(right) - frequencyTagCount(left)
    || left[0].target.localeCompare(right[0].target)
    || candidateId(left[0]).localeCompare(candidateId(right[0]))
  ));
}

export function selectCurrentRevisionCompounds(records = [], decisionRevision = "") {
  if (!Array.isArray(records)) throw new TypeError("verified compounds must be an array");
  const revision = String(decisionRevision ?? "").trim();
  if (!revision) throw new TypeError("compound decision revision is required");
  return records.filter((record) => String(record?.decisionRevision ?? "").trim() === revision);
}

export function acceptedDecisionsForRevision(records = [], decisionRevision = "") {
  if (!Array.isArray(records)) throw new TypeError("compound decisions must be an array");
  const revision = String(decisionRevision ?? "").trim();
  if (!revision) throw new TypeError("compound decision revision is required");
  return records.filter((record) => (
    String(record?.decisionRevision ?? "").trim() === revision
    && acceptedDecision(record)
    && !String(record?.promotionStatus ?? "").startsWith("retired-")
  ));
}

export function wordNetCompoundDecisionRecord(record) {
  const id = candidateId(record);
  const status = String(record?.verificationStatus ?? record?.status ?? "").trim();
  const coverageStatus = String(record?.coverageStatus
    ?? (record?.status !== status ? record?.status : "")
    ?? "").trim();
  return {
    ...record,
    ...(coverageStatus ? { coverageStatus } : {}),
    status,
    candidateId: id
  };
}

function renderMapPya({ name, format, runId, records, metadata = {} }) {
  const lines = [
    `su name ${name} be map def`,
    `su text "format" ob text ${JSON.stringify(format)} ya`,
    `su text "run-id" ob text ${JSON.stringify(runId)} ya`,
    ...Object.entries(metadata).map(([key, value]) => `su text ${JSON.stringify(key)} ob text ${JSON.stringify(String(value))} ya`),
    ...records.map((record) => `su text ${JSON.stringify(record.id)} ob text ${JSON.stringify(JSON.stringify(record))} ya`),
    "prah",
    ""
  ];
  return lines.join("\n");
}

function renderManifestPya(manifest) {
  const lines = [
    "su name compounds be map def",
    ...Object.entries(manifest).map(([key, value]) => `su text ${JSON.stringify(key)} ob text ${JSON.stringify(typeof value === "string" ? value : JSON.stringify(value))} ya`),
    "prah",
    ""
  ];
  return lines.join("\n");
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

async function readVerifiedWordNetCompounds() {
  try {
    return await loadCompoundLexicon({
      url: WORDNET_VERIFIED_COMPOUNDS_URL,
      name: DERIVED_COMPOUND_CURATED_NAME,
      language: "canonical"
    });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function writeVerifiedWordNetCompounds(records) {
  const path = fileURLToPath(WORDNET_VERIFIED_COMPOUNDS_URL);
  if (records.length === 0) {
    await rm(path, { force: true });
    return;
  }
  await atomicWrite(path, renderDerivedCompoundCoveragePya(
    records,
    { name: DERIVED_COMPOUND_CURATED_NAME }
  ));
}

export function acceptedDecision(record) {
  const accepted = ["accepted-deterministic", "accepted-llm", "repaired-llm"].includes(record?.status);
  if (!accepted) return false;
  const components = Array.isArray(record?.componentGlosses)
    ? record.componentGlosses
    : Array.isArray(record?.sourceMorphemes)
      ? record.sourceMorphemes
      : Array.isArray(record?.morphemes) ? record.morphemes : [];
  const modifiers = components.slice(0, -1).map((component) => String(component ?? "").trim());
  const modifierSenseIds = Array.isArray(record?.verificationModifierSenseIds)
    ? record.verificationModifierSenseIds.map((senseId) => String(senseId ?? "").trim())
    : [];
  const modifierEvidence = Array.isArray(record?.verificationModifierEvidence)
    ? record.verificationModifierEvidence.map((evidence) => String(evidence ?? "").trim())
    : [];
  const modifierRelations = Array.isArray(record?.verificationModifierRelations)
    ? record.verificationModifierRelations.map((relation) => String(relation ?? "").trim().toLowerCase())
    : [];
  const componentSenseIds = Array.isArray(record?.verificationComponentSenseIds)
    ? record.verificationComponentSenseIds.map((senseId) => String(senseId ?? "").trim())
    : [];
  const sourceGlossSenseIds = Array.isArray(record?.verificationSourceGlossSenseIds)
    ? record.verificationSourceGlossSenseIds.map((senseId) => String(senseId ?? "").trim())
    : [];
  const componentSenseEvidence = Array.isArray(record?.componentSenseEvidence) ? record.componentSenseEvidence : [];
  const modifierEvidenceValid = modifiers.length > 0
    && modifierSenseIds.length === modifiers.length
    && modifierEvidence.length === modifiers.length
    && modifierRelations.length === modifiers.length
    && modifiers.every((modifier, index) => modifier
      && modifierEvidence[index]
      && modifierRelations[index] === "literal"
      && componentSenseEvidence.some((sense) => String(sense?.component ?? "").trim() === modifier
        && String(sense?.source ?? "").trim() === modifierSenseIds[index]));
  const compactEvidenceValid = record?.verificationComposition === "literal"
    && componentSenseIds.length === components.length
    && sourceGlossSenseIds.length === components.length
    && componentSenseIds.every((senseId, index) => {
      const component = String(components[index] ?? "").trim();
      const sense = componentSenseEvidence.find((row) => String(row?.component ?? "").trim() === component
        && String(row?.source ?? "").trim() === senseId);
      if (!senseId || !sense) return false;
      const sourceGlossSenseId = sourceGlossSenseIds[index];
      const sourceGlossExists = (sense.mappingLookupSenseEvidence ?? []).some((row) => (
        String(row?.source ?? "").trim() === sourceGlossSenseId
      ));
      if (String(sense.mappingKind ?? "").trim() === "word-suggestion") return Boolean(sourceGlossSenseId && sourceGlossExists);
      return !sourceGlossSenseId || sourceGlossExists;
    })
    && String(record?.verificationHeadSenseId ?? "").trim() === componentSenseIds.at(-1);
  const componentChoiceSenseIds = Array.isArray(record?.verificationComponentSenseIds)
    ? record.verificationComponentSenseIds.map((senseId) => String(senseId ?? "").trim())
    : [];
  const componentChoiceGlosses = Array.isArray(record?.verificationSourceGlosses)
    ? record.verificationSourceGlosses.map((gloss) => String(gloss ?? "").trim().toLowerCase())
    : [];
  const componentChoiceMeanings = Array.isArray(record?.verificationComponentMeanings)
    ? record.verificationComponentMeanings.map((meaning) => String(meaning ?? "").trim())
    : [];
  const componentChoiceValid = record?.verificationMethod === "wordnet-sense-component-choice"
    && record?.verificationComposition === "literal"
    && Boolean(String(record?.verificationRationale ?? "").trim())
    && componentChoiceSenseIds.length === components.length
    && componentChoiceGlosses.length === components.length
    && componentChoiceMeanings.length === components.length
    && componentChoiceSenseIds.every((senseId, index) => {
      const component = String(components[index] ?? "").trim();
      const sense = componentSenseEvidence.find((row) => String(row?.component ?? "").trim() === component
        && String(row?.source ?? "").trim() === senseId);
      if (!senseId || !sense || !componentChoiceGlosses[index]) return false;
      const linkedMeaning = String(sense.definition ?? "").split(";")[0].slice(0, 180).trim();
      return componentGlossLookupAlternatives(componentChoiceGlosses[index])
        .includes(String(sense.mappingLookupGloss ?? "").trim().toLowerCase())
        && linkedMeaning === componentChoiceMeanings[index];
    })
    && String(record?.verificationHeadSenseId ?? "").trim() === componentChoiceSenseIds.at(-1);
  const headRelationValid = String(record?.headRelationPolicy ?? "").trim() === "advisory"
    || record?.verificationHeadRelation === "supported";
  return Boolean(
    String(record?.verificationSenseId ?? "").trim()
    && String(record?.verificationHeadSenseId ?? "").trim()
    && headRelationValid
    && (compactEvidenceValid || modifierEvidenceValid || componentChoiceValid)
  );
}

function compoundSenseId(record) {
  return String(record?.senseId ?? record?.verificationSenseId ?? "").trim();
}

function buildSequenceOwners(records) {
  const owners = new Map();
  for (const record of records) {
    const target = String(record.target ?? "").trim().toLowerCase();
    const partOfSpeech = canonicalWordNetTargetPartOfSpeech(
      record.targetPartOfSpeech || String(record.senseId ?? "").slice(0, 1)
    );
    const key = englishWordNetTargetId("compound", sequence(record.pyashSequence), partOfSpeech);
    if (!key) continue;
    const targets = owners.get(key) ?? new Set();
    targets.add(target);
    owners.set(key, targets);
  }
  return owners;
}

function buildPromotedCompoundRecord(decision, { senseId, target, targetPartOfSpeech, pyashSequence, decisionRevision }) {
  const componentLayers = Array.isArray(decision.componentLayers) ? decision.componentLayers : [];
  return {
    senseId,
    targetPartOfSpeech,
    decisionRevision,
    verificationDecisionId: decision.candidateId,
    verificationDecisionIds: decision.candidateId ? [decision.candidateId] : [],
    verificationStatus: decision.status,
    ...(decision.coverageStatus ? { coverageStatus: decision.coverageStatus } : {}),
    id: target,
    surface: target,
    target,
    aliases: Array.isArray(decision.aliases) ? decision.aliases : [],
    morphemes: Array.isArray(decision.morphemes) ? decision.morphemes : decision.sourceMorphemes,
    sourceMorphemes: Array.isArray(decision.sourceMorphemes) ? decision.sourceMorphemes : decision.morphemes,
    componentGlosses: Array.isArray(decision.componentGlosses) ? decision.componentGlosses : [],
    head: decision.head ?? decision.componentGlosses?.at(-1),
    modifiers: Array.isArray(decision.modifiers) ? decision.modifiers : decision.componentGlosses?.slice(0, -1) ?? [],
    pyashSequence,
    componentLayers,
    maxLayer: Number.isInteger(decision.maxLayer)
      ? decision.maxLayer
      : componentLayers.length ? Math.max(...componentLayers) : undefined,
    sourceSurfaces: decision.sourceSurfaces ?? {},
    sourceMorphemesByLanguage: decision.sourceMorphemesByLanguage ?? {},
    componentRoles: Array.isArray(decision.componentRoles) ? decision.componentRoles : [],
    morphologyStatus: decision.morphologyStatus ?? "lexical-compound",
    morphologySignals: Array.isArray(decision.morphologySignals) ? decision.morphologySignals : [],
    confidence: String(decision.confidence ?? "verified-wordnet-compound"),
    ...(decision.verificationRationale ? { verificationRationale: decision.verificationRationale } : {}),
    provenance: "WordNet frequency compound verification through Housekeeper",
    status: decision.status
  };
}

function mergeAliasesForSense(winner, rows) {
  const target = String(winner.target ?? "").trim().toLowerCase();
  const aliases = new Set();
  for (const row of rows) {
    const rowTarget = String(row?.target ?? "").trim();
    if (rowTarget && rowTarget.toLowerCase() !== target) aliases.add(rowTarget);
    for (const alias of Array.isArray(row?.aliases) ? row.aliases : []) {
      const value = String(alias ?? "").trim();
      if (value && value.toLowerCase() !== target) aliases.add(value);
    }
  }
  return [...aliases];
}

function mergeDecisionIdsForSequence(winner, rows) {
  const winnerSequence = sequence(winner.pyashSequence).join(" ");
  const ids = new Set();
  for (const row of rows) {
    if (sequence(row.pyashSequence).join(" ") !== winnerSequence) continue;
    if (typeof row.verificationDecisionId === "string" && row.verificationDecisionId) {
      ids.add(row.verificationDecisionId);
    }
    for (const id of Array.isArray(row.verificationDecisionIds) ? row.verificationDecisionIds : []) {
      if (typeof id === "string" && id) ids.add(id);
    }
  }
  return [...ids];
}

export function promoteAcceptedCompoundRecords(existingRecords, decisions, { usedTargetIds = [], decisionRevision = "" } = {}) {
  if (!Array.isArray(existingRecords) || !Array.isArray(decisions)) {
    throw new TypeError("compound promotion requires existing records and decisions");
  }
  const deduped = deduplicateCompoundSenseRecords(existingRecords);
  const records = deduped.records.map((record) => ({ ...record }));
  const recordsBySense = new Map(records
    .map((record, index) => [compoundSenseId(record), index])
    .filter(([senseId]) => Boolean(senseId)));
  let sequenceOwners = buildSequenceOwners(records);
  const reservedTargetIds = new Set(usedTargetIds);
  const promotionsBySense = new Set();
  const affectedSenseIds = new Set(deduped.removals.map((row) => row.senseId));
  const rawDecisions = decisions.map((decision) => {
    if (!acceptedDecision(decision)) return decision;
    const target = String(decision.target ?? "").trim().toLowerCase();
    const senseId = compoundSenseId(decision);
    if (!senseId) return { ...decision, promotionStatus: "missing-sense-id" };
    if (!target) return { ...decision, promotionStatus: "missing-target" };
    const targetPartOfSpeech = canonicalWordNetTargetPartOfSpeech(
      decision.targetPartOfSpeech || senseId.slice(0, 1)
    );
    const pyashSequence = sequence(decision.pyashSequence);
    const targetId = englishWordNetTargetId("compound", pyashSequence, targetPartOfSpeech);
    if (!targetId) return { ...decision, promotionStatus: "missing-target-part-of-speech" };
    const record = buildPromotedCompoundRecord(decision, {
      senseId,
      target,
      targetPartOfSpeech,
      pyashSequence,
      decisionRevision
    });
    affectedSenseIds.add(senseId);
    const existingIndex = recordsBySense.get(senseId);
    if (existingIndex !== undefined) {
      const existing = records[existingIndex];
      const sameSequence = sequence(existing.pyashSequence).join(" ") === pyashSequence.join(" ");
      if (sameSequence) {
        records[existingIndex] = {
          ...existing,
          decisionRevision,
          aliases: mergeAliasesForSense(existing, [existing, record]),
          verificationDecisionIds: mergeDecisionIdsForSequence(existing, [existing, record])
        };
        return { ...decision, promotionStatus: "already-active" };
      }

      let order;
      try {
        order = compareCompoundSenseRecords(record, existing);
      } catch {
        return { ...decision, promotionStatus: "missing-component-layers-for-sense-tie" };
      }
      if (order >= 0) {
        records[existingIndex] = {
          ...existing,
          aliases: mergeAliasesForSense(existing, [existing, record])
        };
        return {
          ...decision,
          promotionStatus: pyashSequence.length > sequence(existing.pyashSequence).length
            ? "longer-sequence-superseded"
            : "same-length-compound-not-selected"
        };
      }

      const owners = sequenceOwners.get(targetId) ?? new Set();
      if (reservedTargetIds.has(targetId) || [...owners].some((owner) => owner !== target)) {
        return { ...decision, promotionStatus: "target-identity-conflict" };
      }
      records[existingIndex] = {
        ...record,
        aliases: mergeAliasesForSense(record, [record, existing])
      };
      sequenceOwners = buildSequenceOwners(records);
      promotionsBySense.add(senseId);
      return { ...decision, promotionStatus: "promoted-to-derived-index" };
    }

    const owners = sequenceOwners.get(targetId) ?? new Set();
    if (reservedTargetIds.has(targetId) || [...owners].some((owner) => owner !== target)) {
      return { ...decision, promotionStatus: "target-identity-conflict" };
    }
    owners.add(target);
    sequenceOwners.set(targetId, owners);
    recordsBySense.set(senseId, records.length);
    records.push(record);
    promotionsBySense.add(senseId);
    return { ...decision, promotionStatus: "promoted-to-derived-index" };
  });

  const updatedDecisions = rawDecisions.map((decision) => {
    if (!acceptedDecision(decision)) return decision;
    if ([
      "missing-sense-id",
      "missing-target",
      "missing-target-part-of-speech",
      "target-identity-conflict",
      "missing-component-layers-for-sense-tie"
    ].includes(decision.promotionStatus)) return decision;
    const senseId = compoundSenseId(decision);
    const activeIndex = recordsBySense.get(senseId);
    if (activeIndex === undefined) return decision;
    const active = records[activeIndex];
    const decisionSequence = sequence(decision.pyashSequence).join(" ");
    if (decisionSequence === sequence(active.pyashSequence).join(" ")) {
      return {
        ...decision,
        promotionStatus: decision.promotionStatus === "promoted-to-derived-index"
          ? decision.promotionStatus
          : "already-active"
      };
    }
    return {
      ...decision,
      promotionStatus: sequence(decision.pyashSequence).length > sequence(active.pyashSequence).length
        ? "longer-sequence-superseded"
        : "same-length-compound-not-selected"
    };
  });
  const promotions = records.filter((record) => promotionsBySense.has(compoundSenseId(record)));
  return {
    decisions: updatedDecisions,
    promotions,
    records,
    activeCount: records.length,
    affectedSenseIds: [...affectedSenseIds],
    conflicts: updatedDecisions.filter((record) => String(record.promotionStatus ?? "").includes("conflict"))
  };
}

export async function promoteAcceptedCompounds(decisions, {
  usedTargetIds = [],
  decisionRevision = "",
  readExisting = readVerifiedWordNetCompounds,
  writeRecords = writeVerifiedWordNetCompounds,
  readGlosses = loadEnglishWordNetCompoundGlosses,
  writeGlosses = writeEnglishWordNetCompoundGlosses,
  readDecisionRows = async () => (await loadEnglishWordNetCompoundDecisions()).rows
} = {}) {
  const existing = await readExisting();
  const promoted = promoteAcceptedCompoundRecords(existing, decisions, { usedTargetIds, decisionRevision });
  await writeRecords(promoted.records);
  if (promoted.affectedSenseIds.length > 0) {
    const affectedSenseIds = new Set(promoted.affectedSenseIds);
    const [currentGlosses, decisionRows] = await Promise.all([readGlosses(), readDecisionRows()]);
    const decisionsById = new Map([...decisionRows, ...decisions]
      .filter((decision) => typeof decision?.candidateId === "string" && decision.candidateId)
      .map((decision) => [decision.candidateId, decision]));
    const replacements = buildEnglishWordNetCompoundGlosses(
      promoted.records.filter((record) => affectedSenseIds.has(record.senseId)),
      [...decisionsById.values()]
    );
    const retained = currentGlosses.records.filter((record) => !affectedSenseIds.has(record.senseId));
    await writeGlosses(mergeEnglishWordNetCompoundGlosses(retained, replacements));
  }
  const { records: _records, ...result } = promoted;
  return result;
}

export async function runWordNetFrequencyCompoundSweep({ artifactRoot = ARTIFACT_ROOT } = {}) {
  const allocationConfig = parseEnglishWordNetFrequencyAllocationConfig(await readFile(ALLOCATION_CONFIG_URL, "utf8"));
  const decisionRevision = String(allocationConfig["compound-verification-revision"] ?? "").trim();
  if (!decisionRevision) throw new Error("compound verification requires a configured decision revision");
  const allocation = await prepareWordNetFrequencyAllocation();
  const currentCandidates = allocation.residualCompounds.filter((record) => (
    record.disposition === "ready-for-housekeeper-verification" || record.disposition.startsWith("already-")
  ));
  const readyCandidates = currentCandidates.filter((record) => record.disposition === "ready-for-housekeeper-verification");
  const decisionsPath = fileURLToPath(ENGLISH_WORDNET_COMPOUND_DECISIONS_URL);
  let decisionsState = await loadEnglishWordNetCompoundDecisions();
  const decisionsById = new Map(decisionsState.rows.map((row) => [row.candidateId, row]));
  const currentCandidateIds = new Set(currentCandidates.map((row) => candidateId(row.verificationRecord ?? row)));
  const completedIds = new Set([...currentCandidateIds].filter((id) => (
    decisionsById.get(id)?.decisionRevision === decisionRevision
  )));
  const groups = groupWordNetCompoundCandidates(readyCandidates, completedIds);
  const directory = join(resolve(artifactRoot), allocation.runId, "compound-verification");
  await mkdir(directory, { recursive: true });
  const releaseLock = await acquireLock(join(directory, ".compound-sweep.lock"));
  const manifestPath = join(directory, "manifest.pya");
  let completedGroups = 0;
  let batchIndex = 0;
  const batchSize = allocationConfig["compound-verification-batch-size"];
  const usedTargetIds = [
    ...allocation.preservedTargetIds,
    ...allocation.allocation.assignments.map((row) => row.targetId)
  ];
  try {
    const resumedAccepted = acceptedDecisionsForRevision([...decisionsById.values()], decisionRevision);
    if (resumedAccepted.length > 0) {
      const restored = await promoteAcceptedCompounds(resumedAccepted, {
        usedTargetIds,
        decisionRevision,
        readDecisionRows: async () => [...decisionsById.values()]
      });
      for (const decision of restored.decisions) {
        const previous = decisionsById.get(decision.candidateId);
        if (stableJson(previous) !== stableJson(decision)) {
          decisionsById.set(decision.candidateId, decision);
          await appendFile(decisionsPath, renderEnglishWordNetCompoundDecisionAppend(decision), "utf8");
        }
      }
    } else {
      await promoteAcceptedCompounds([], { usedTargetIds, decisionRevision });
    }
    await atomicWrite(manifestPath, renderManifestPya({
      runId: allocation.runId,
      status: "running",
      decisionRevision,
      sourceHash: allocation.sourceHash,
      coverageHash: allocation.coverageHash,
      candidateCount: currentCandidates.length,
      candidatesWithoutWordNetHeadRelation: allocation.residualCompounds.filter(lacksWordNetHeadRelation).length,
      completedCandidateCount: completedIds.size,
      remainingCandidateCount: groups.reduce((count, group) => count + group.length, 0),
      completedGroups,
      batchSize,
      parallelism: allocationConfig["compound-verification-parallelism"]
    }));

    while (groups.length > 0) {
      const batchGroups = [];
      let batchCount = 0;
      while (groups.length > 0 && (batchGroups.length === 0 || batchCount + groups[0].length <= batchSize)) {
        const group = groups.shift();
        batchGroups.push(group);
        batchCount += group.length;
      }
      batchIndex += 1;
      const batchRecords = batchGroups.flat();
      const batchAdded = [];
      const verification = JSON.parse(await verifyCompoundRecords(batchRecords, {
        mode: "summary",
        mindName: "mind",
        parallelism: allocationConfig["compound-verification-parallelism"],
        onRecord: async ({ record }) => {
          const previous = decisionsById.get(candidateId(record));
          const decision = wordNetCompoundDecisionRecord({
            ...record,
            decisionRevision,
            ...(previous ? {
              previousDecision: {
                decisionRevision: previous.decisionRevision ?? "legacy-v1",
                status: previous.status,
                rationale: String(previous.verificationRationale ?? previous.reasons?.join("; ") ?? "").slice(0, 240)
              }
            } : {})
          });
          const id = decision.candidateId;
          decisionsById.set(id, decision);
          batchAdded.push(decision);
          await appendFile(decisionsPath, renderEnglishWordNetCompoundDecisionAppend(decision), "utf8");
        }
      }));
      const promoted = await promoteAcceptedCompounds(batchAdded, {
        usedTargetIds,
        decisionRevision,
        readDecisionRows: async () => [...decisionsById.values()]
      });
      for (const decision of promoted.decisions) {
        const previous = decisionsById.get(decision.candidateId);
        decisionsById.set(decision.candidateId, decision);
        if (stableJson(previous) !== stableJson(decision)) {
          await appendFile(decisionsPath, renderEnglishWordNetCompoundDecisionAppend(decision), "utf8");
        }
      }
      const batchFile = join(directory, `batch-${String(batchIndex).padStart(4, "0")}.pya`);
      await atomicWrite(batchFile, renderMapPya({
        name: "translation_wordnet_compound_verification_batch",
        format: "english-wordnet-compound-verification-batch-v1",
        runId: allocation.runId,
        records: batchAdded.map((record) => ({ id: record.candidateId, ...record })),
        metadata: {
          "batch-index": batchIndex,
          "candidate-count": batchAdded.length,
          accepted: verification.accepted,
          uncertain: verification.uncertain,
          rejected: verification.rejected,
          promoted: promoted.promotions.length
        }
      }));
      completedGroups += batchGroups.length;
      process.stderr.write(`[wordnet-compounds] groups ${completedGroups}/${completedGroups + groups.length}; candidates ${[...currentCandidateIds].filter((id) => (
        decisionsById.get(id)?.decisionRevision === decisionRevision
      )).length}/${currentCandidates.length}\n`);
      await atomicWrite(manifestPath, renderManifestPya({
        runId: allocation.runId,
        status: "running",
        decisionRevision,
        sourceHash: allocation.sourceHash,
        coverageHash: allocation.coverageHash,
        candidateCount: currentCandidates.length,
        candidatesWithoutWordNetHeadRelation: allocation.residualCompounds.filter(lacksWordNetHeadRelation).length,
        completedCandidateCount: [...currentCandidateIds].filter((id) => (
          decisionsById.get(id)?.decisionRevision === decisionRevision
        )).length,
        remainingCandidateCount: groups.reduce((count, group) => count + group.length, 0),
        completedGroups,
        batchCount: batchIndex,
        batchSize,
        parallelism: allocationConfig["compound-verification-parallelism"],
        accepted: [...decisionsById.values()].filter((row) => row.decisionRevision === decisionRevision && acceptedDecision(row)).length,
        promoted: selectCurrentRevisionCompounds(await readVerifiedWordNetCompounds(), decisionRevision).length,
        linkedAcceptedDecisions: [...decisionsById.values()].filter((row) => row.decisionRevision === decisionRevision && acceptedDecision(row) && ["promoted-to-derived-index", "already-active"].includes(row.promotionStatus)).length,
        uncertain: [...decisionsById.values()].filter((row) => row.decisionRevision === decisionRevision && row.status === "uncertain-llm").length,
        rejected: [...decisionsById.values()].filter((row) => row.decisionRevision === decisionRevision && ["rejected-llm", "rejected-deterministic"].includes(row.status)).length
      }));
    }

    const finalManifest = {
      runId: allocation.runId,
      status: "compounds-verified-refreshing-bridges",
      decisionRevision,
      sourceHash: allocation.sourceHash,
      coverageHash: allocation.coverageHash,
      candidateCount: currentCandidates.length,
      candidatesWithoutWordNetHeadRelation: allocation.residualCompounds.filter(lacksWordNetHeadRelation).length,
      completedCandidateCount: [...currentCandidateIds].filter((id) => (
        decisionsById.get(id)?.decisionRevision === decisionRevision
      )).length,
      remainingCandidateCount: 0,
      completedGroups,
      batchCount: batchIndex,
      batchSize,
      parallelism: allocationConfig["compound-verification-parallelism"],
      accepted: [...decisionsById.values()].filter((row) => row.decisionRevision === decisionRevision && acceptedDecision(row)).length,
      promoted: selectCurrentRevisionCompounds(await readVerifiedWordNetCompounds(), decisionRevision).length,
      linkedAcceptedDecisions: [...decisionsById.values()].filter((row) => row.decisionRevision === decisionRevision && acceptedDecision(row) && ["promoted-to-derived-index", "already-active"].includes(row.promotionStatus)).length,
      uncertain: [...decisionsById.values()].filter((row) => row.decisionRevision === decisionRevision && row.status === "uncertain-llm").length,
      rejected: [...decisionsById.values()].filter((row) => row.decisionRevision === decisionRevision && ["rejected-llm", "rejected-deterministic"].includes(row.status)).length
    };
    await atomicWrite(manifestPath, renderManifestPya(finalManifest));
    const bridgeAllocation = await runWordNetFrequencyAllocation({ apply: true });
    finalManifest.status = "complete";
    finalManifest.bridgeAllocationRunId = bridgeAllocation.runId;
    finalManifest.activeBridgeCount = bridgeAllocation.frequencyAssignedSenses;
    finalManifest.newFrequencyLinks = bridgeAllocation.newFrequencyLinks;
    finalManifest.residualSenses = bridgeAllocation.residualSenses;
    finalManifest.bridgePath = bridgeAllocation.bridgePath;
    await atomicWrite(manifestPath, renderManifestPya(finalManifest));
    return {
      ...finalManifest,
      directory,
      manifestPath,
      decisionsPath,
      verifiedCompoundCatalog: fileURLToPath(WORDNET_VERIFIED_COMPOUNDS_URL)
    };
  } catch (error) {
    await atomicWrite(manifestPath, renderManifestPya({
      runId: allocation.runId,
      status: "failed-resumable",
      decisionRevision,
      error: String(error?.message ?? error).slice(0, 500),
      sourceHash: allocation.sourceHash,
      coverageHash: allocation.coverageHash,
      candidatesWithoutWordNetHeadRelation: allocation.residualCompounds.filter(lacksWordNetHeadRelation).length,
      completedCandidateCount: [...currentCandidateIds].filter((id) => (
        decisionsById.get(id)?.decisionRevision === decisionRevision
      )).length,
      remainingCandidateCount: groups.reduce((count, group) => count + group.length, 0),
      completedGroups,
      batchCount: batchIndex,
      batchSize
    }));
    throw error;
  } finally {
    await releaseLock();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runWordNetFrequencyCompoundSweep().then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  });
}

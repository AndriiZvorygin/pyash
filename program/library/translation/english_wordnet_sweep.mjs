import { buildProgram } from "../../program.mjs";
import {
  buildEnglishWordNetBridgeIndex,
  parseEnglishWordNetBridgeCatalog
} from "./english_wordnet_bridges.mjs";
import { renderEnglishWordNetSenseLinksPya } from "./english_wordnet_linker.mjs";

export const ENGLISH_WORDNET_SWEEP_FORMAT = "english-wordnet-sense-sweep-v1";
export const ENGLISH_WORDNET_SENSE_ORDERING = "english30k-minimum-source-lemma-rank-v1";
export const ENGLISH_WORDNET_SWEEP_MANIFEST_NAME = "translation_english_wordnet_sweep_manifest";
export const ENGLISH_WORDNET_SWEEP_BATCH_NAME = "translation_english_wordnet_sweep_batch";
export const ENGLISH_WORDNET_SWEEP_AUTOMATIC_NAME = "translation_english_wordnet_sweep_automatic_links";

const ACCEPTED_STATUSES = new Set(["accepted-existing", "accepted-edge", "accepted-deterministic"]);
const CATEGORIES = Object.freeze([
  "linked-existing",
  "automatic-link",
  "needs-equivalence-review",
  "needs-sense-choice",
  "needs-atom-or-compound-anchor"
]);

function normalized(value) {
  return typeof value === "string" ? value.normalize("NFC").trim().toLowerCase() : "";
}

function sequence(value) {
  return Array.isArray(value)
    ? value.filter((word) => typeof word === "string" && word.trim()).map((word) => word.trim())
    : [];
}

function senseRank(record, rankForEnglish) {
  const terms = [...new Set([
    ...(Array.isArray(record?.sourceTerms) ? record.sourceTerms : []),
    ...(Array.isArray(record?.lemmas) ? record.lemmas : [])
  ].map(normalized).filter(Boolean))];
  const ranks = terms.map((term) => Number(rankForEnglish(term))).filter((rank) => Number.isFinite(rank) && rank > 0);
  if (ranks.length > 0) return Math.min(...ranks);
  const existing = Number(record?.english30kRank);
  return Number.isFinite(existing) && existing > 0 ? existing : Number.POSITIVE_INFINITY;
}

export function rankEnglishWordNetSenseRecords(records = [], { rankForEnglish = () => Number.POSITIVE_INFINITY } = {}) {
  if (!Array.isArray(records)) throw new TypeError("WordNet sense records must be an array");
  return records.map((record) => {
    const rank = senseRank(record, rankForEnglish);
    return { ...record, english30kRank: Number.isFinite(rank) ? rank : null };
  }).sort((left, right) => (
    (left.english30kRank ?? Number.POSITIVE_INFINITY) - (right.english30kRank ?? Number.POSITIVE_INFINITY)
      || normalized(left.source).localeCompare(normalized(right.source))
      || normalized(left.id).localeCompare(normalized(right.id))
  ));
}

function safeRecord(record, category, reason = "") {
  return {
    id: String(record?.id ?? ""),
    source: String(record?.source ?? ""),
    pos: String(record?.pos ?? ""),
    synset: String(record?.synset ?? ""),
    lemmas: Array.isArray(record?.lemmas) ? record.lemmas : [],
    sourceTerms: Array.isArray(record?.sourceTerms) ? record.sourceTerms : [],
    gloss: String(record?.gloss ?? ""),
    ...(Number.isFinite(Number(record?.english30kRank)) && Number(record.english30kRank) > 0
      ? { english30kRank: Number(record.english30kRank) }
      : {}),
    sourceStatus: String(record?.status ?? "review"),
    ...(Number.isFinite(Number(record?.english30kRank)) && Number(record.english30kRank) > 0
      ? { english30kRank: Number(record.english30kRank) }
      : {}),
    category,
    ...(reason ? { reason } : {}),
    ...(["linked-existing", "automatic-link", "needs-equivalence-review"].includes(category) && record?.link
      ? { link: record.link }
      : {}),
    ...(Array.isArray(record?.candidates) && record.candidates.length > 0
      ? {
        candidates: record.candidates.map((candidate) => ({
          target: candidate.target,
          pyashSequence: sequence(candidate.pyashSequence),
          targetKind: candidate.targetKind,
          targetId: candidate.targetId,
          selectable: candidate.selectable === true,
          edgeEligible: candidate.edgeEligible === true,
          evidence: candidate.evidence
        }))
      }
      : {})
  };
}

export function classifyEnglishWordNetSenseSweep(records = []) {
  if (!Array.isArray(records)) throw new TypeError("WordNet sweep records must be an array");
  const bridgeEntries = records
    .filter((record) => ACCEPTED_STATUSES.has(record?.status) && record?.link?.target)
    .map((record) => ({
      source: `${record.pos}:${record.synset}`,
      target: normalized(record.link.target),
      pyashSequence: sequence(record.link.pyashSequence),
      targetKind: record.link.targetKind,
      targetId: record.link.targetId,
      targetPartOfSpeech: record.link.targetPartOfSpeech || record.pos,
      certainty: record.link.certainty || "deterministic",
      evidence: record.link.evidence || "deterministic WordNet sweep",
      ...(record.link.equivalenceGroup ? { equivalenceGroup: record.link.equivalenceGroup } : {}),
      ...(record.link.equivalenceEvidence ? { equivalenceEvidence: record.link.equivalenceEvidence } : {})
    }));
  const activeBySense = buildEnglishWordNetBridgeIndex({ entries: bridgeEntries }).bySense;
  const categorized = records.map((record) => {
    const source = `${record?.pos}:${record?.synset}`;
    if (record?.status === "accepted-existing") {
      return safeRecord(record, activeBySense.has(source) ? "linked-existing" : "needs-equivalence-review");
    }
    if (["accepted-edge", "accepted-deterministic"].includes(record?.status)) {
      return activeBySense.has(source)
        ? safeRecord(record, "automatic-link")
        : safeRecord(record, "needs-equivalence-review", "proposed anchor collides with another WordNet sense");
    }
    const candidates = Array.isArray(record?.candidates) ? record.candidates : [];
    if (candidates.some((candidate) => candidate?.selectable === true)) {
      return safeRecord(record, "needs-sense-choice", "existing anchor choices need contextual sense selection");
    }
    return safeRecord(record, "needs-atom-or-compound-anchor", "no selectable existing atom or accepted compound anchor");
  });
  const counts = Object.fromEntries(CATEGORIES.map((category) => [category, 0]));
  for (const record of categorized) counts[record.category] += 1;
  return { records: categorized, counts };
}

export function partitionEnglishWordNetSenseSweep(records = [], batchSize = 1000) {
  if (!Array.isArray(records)) throw new TypeError("WordNet sweep records must be an array");
  const size = Math.max(1, Math.trunc(Number(batchSize) || 1000));
  const batches = [];
  for (let offset = 0; offset < records.length; offset += size) {
    batches.push(records.slice(offset, offset + size));
  }
  return batches;
}

function quoted(value) {
  return `quoted.text.${JSON.stringify(value, null, 2)}.text.quoted`;
}

function jsonRow(key, value) {
  return `su text ${JSON.stringify(key)} ob text ${quoted(value)} ya`;
}

export function renderEnglishWordNetSweepBatchPya({
  runId,
  batchIndex,
  sourceHash,
  coverageHash,
  records = []
} = {}) {
  if (!runId || !Number.isInteger(batchIndex) || batchIndex < 1) {
    throw new TypeError("WordNet sweep batch requires run and batch identities");
  }
  const lines = [
    `su name ${ENGLISH_WORDNET_SWEEP_BATCH_NAME} be map def`,
    `su text "format" ob text ${JSON.stringify(ENGLISH_WORDNET_SWEEP_FORMAT)} ya`,
    `su text "run-id" ob text ${JSON.stringify(runId)} ya`,
    `su text "batch-index" ob num ${batchIndex} ya`,
    `su text "source-hash" ob text ${JSON.stringify(sourceHash)} ya`,
    `su text "coverage-hash" ob text ${JSON.stringify(coverageHash)} ya`,
    ...records.map((record) => jsonRow(record.id, record))
  ];
  lines.push("prah");
  return `${lines.join("\n")}\n`;
}

export function renderEnglishWordNetSweepAutomaticLinksPya({
  runId,
  sourceHash,
  coverageHash,
  records = []
} = {}) {
  const lines = [
    `su name ${ENGLISH_WORDNET_SWEEP_AUTOMATIC_NAME} be map def`,
    `su text "format" ob text ${JSON.stringify(ENGLISH_WORDNET_SWEEP_FORMAT)} ya`,
    `su text "run-id" ob text ${JSON.stringify(runId)} ya`,
    `su text "source-hash" ob text ${JSON.stringify(sourceHash)} ya`,
    `su text "coverage-hash" ob text ${JSON.stringify(coverageHash)} ya`,
    ...records.map((record) => jsonRow(record.source, record))
  ];
  lines.push("prah");
  return `${lines.join("\n")}\n`;
}

export function renderEnglishWordNetSweepManifestPya({
  runId,
  sourceHash,
  coverageHash,
  status,
  batchSize,
  batchCount,
  completedBatchCount,
  recordCount,
  counts,
  ordering = ENGLISH_WORDNET_SENSE_ORDERING,
  error = ""
} = {}) {
  const lines = [
    `su name ${ENGLISH_WORDNET_SWEEP_MANIFEST_NAME} be map def`,
    `su text "format" ob text ${JSON.stringify(ENGLISH_WORDNET_SWEEP_FORMAT)} ya`,
    `su text "run-id" ob text ${JSON.stringify(runId)} ya`,
    `su text "source-hash" ob text ${JSON.stringify(sourceHash)} ya`,
    `su text "coverage-hash" ob text ${JSON.stringify(coverageHash)} ya`,
    `su text "status" ob text ${JSON.stringify(status)} ya`,
    `su text "batch-size" ob num ${batchSize} ya`,
    `su text "batch-count" ob num ${batchCount} ya`,
    `su text "completed-batch-count" ob num ${completedBatchCount} ya`,
    `su text "record-count" ob num ${recordCount} ya`,
    `su text "ordering" ob text ${JSON.stringify(ordering)} ya`,
    jsonRow("category-counts", counts ?? {}),
    ...(error ? [`su text "error" ob text ${JSON.stringify(error)} ya`] : [])
  ];
  lines.push("prah");
  return `${lines.join("\n")}\n`;
}

export function parseEnglishWordNetSweepPya(source) {
  if (typeof source !== "string") throw new TypeError("WordNet sweep artifact must be Pyash text");
  const sentences = buildProgram(source).sentences;
  const header = sentences.find((sentence) => sentence?.mood === "def" && sentence?.be === "map");
  if (!header?.su?.name?.startsWith("translation_english_wordnet_sweep_")) {
    throw new TypeError("WordNet sweep artifact has no sweep map header");
  }
  const rows = sentences.filter((sentence) => sentence?.mood === "ya" && typeof sentence?.su?.text === "string");
  return { mapName: header.su.name, rows };
}

export function activateEnglishWordNetSenseSweepLinks({
  catalogSource,
  records = [],
  runId,
  sourceHash = "",
  resolveTarget
} = {}) {
  if (typeof catalogSource !== "string") throw new TypeError("active WordNet bridge catalog must be Pyash text");
  if (!Array.isArray(records)) throw new TypeError("WordNet sweep records must be an array");
  const catalog = parseEnglishWordNetBridgeCatalog(catalogSource);
  const existingBySense = new Map(catalog.entries.map((entry) => [entry.source, entry]));
  const additions = [];
  const skipped = [];
  for (const record of records) {
    if (record?.category !== "automatic-link") continue;
    const source = String(record.source ?? "").trim().toLowerCase();
    const target = normalized(record?.link?.target);
    const pyashSequence = sequence(record?.link?.pyashSequence);
    if (!source || !target || pyashSequence.length === 0) {
      skipped.push({ source, reason: "automatic proposal lacks a sense, target, or Pyash sequence" });
      continue;
    }
    const existing = existingBySense.get(source);
    if (existing) {
      skipped.push({
        source,
        reason: existing.target === target
          && existing.targetPartOfSpeech === record.pos
          ? "sense already exists in the active catalog"
          : "sense already has a conflicting active catalog row"
      });
      continue;
    }
    additions.push({
      source,
      target,
      gloss: record.gloss,
      lemmas: record.lemmas,
      pyashSequence,
      targetKind: record.link.targetKind,
      targetId: record.link.targetId,
      targetPartOfSpeech: record.link.targetPartOfSpeech || record.pos,
      certainty: "deterministic",
      evidence: `${record.link.evidence || "unique low-degree WordNet edge"}; active through sweep ${runId} (source ${sourceHash})`
    });
  }

  const candidateIndex = buildEnglishWordNetBridgeIndex({
    entries: [...catalog.entries, ...additions],
    resolveTarget
  });
  const activeAdditions = additions.filter((entry) => candidateIndex.bySense.has(entry.source));
  for (const entry of additions) {
    if (candidateIndex.bySense.has(entry.source)) continue;
    skipped.push({ source: entry.source, reason: "target identity collides with a non-equivalent WordNet sense" });
  }

  const recordsToRender = activeAdditions.map((entry) => ({
    source: entry.source,
    pos: entry.targetPartOfSpeech,
    synset: entry.source.slice(2),
    gloss: entry.gloss,
    lemmas: entry.lemmas,
    status: "accepted-edge",
    link: entry
  }));
  const rendered = renderEnglishWordNetSenseLinksPya({
    records: recordsToRender,
    source: catalog.source,
    sourceHash,
    name: "translation_english_wordnet_sweep_additions"
  });
  const renderedLines = rendered.split(/\r?\n/u);
  const sourcesToRender = new Set(activeAdditions.map((entry) => entry.source));
  const bridgeLines = renderedLines.filter((line) => (
    [...sourcesToRender].some((source) => (
      line.startsWith(`su text ${JSON.stringify(source)} ob name `)
        || line.startsWith(`su text ${JSON.stringify(`sense-gloss:${source}`)} ob text `)
        || line.startsWith(`su text "sense-lemma:${source}:`)
    ))
  ));
  const expectedRows = activeAdditions.reduce((count, entry) => count + 1 + (
    entry.gloss && Array.isArray(entry.lemmas) && entry.lemmas.length > 0 ? 1 + entry.lemmas.length : 0
  ), 0);
  if (bridgeLines.length !== expectedRows) {
    throw new TypeError("could not render every verified automatic WordNet bridge row");
  }
  const catalogLines = catalogSource.trimEnd().split(/\r?\n/u);
  const endIndex = catalogLines.lastIndexOf("prah");
  if (endIndex < 0) throw new TypeError("active WordNet bridge catalog has no closing prah");
  const updatedLines = [...catalogLines.slice(0, endIndex), ...bridgeLines, ...catalogLines.slice(endIndex)];
  const updated = `${updatedLines.join("\n")}\n`;
  const parsedUpdated = parseEnglishWordNetBridgeCatalog(updated);
  const activeUpdated = buildEnglishWordNetBridgeIndex({
    entries: parsedUpdated.entries,
    resolveTarget
  });
  const inactiveRendered = activeAdditions.filter((entry) => !activeUpdated.bySense.has(entry.source));
  if (inactiveRendered.length > 0) {
    throw new TypeError("rendered automatic links failed active bridge validation");
  }
  return {
    catalog: updated,
    activated: activeAdditions.map((entry) => entry.source),
    skipped,
    totalCatalogEntries: parsedUpdated.entries.length
  };
}

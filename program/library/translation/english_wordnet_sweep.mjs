import { buildProgram } from "../../program.mjs";
import { buildEnglishWordNetBridgeIndex } from "./english_wordnet_bridges.mjs";

export const ENGLISH_WORDNET_SWEEP_FORMAT = "english-wordnet-sense-sweep-v1";
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

function safeRecord(record, category, reason = "") {
  return {
    id: String(record?.id ?? ""),
    source: String(record?.source ?? ""),
    pos: String(record?.pos ?? ""),
    synset: String(record?.synset ?? ""),
    lemmas: Array.isArray(record?.lemmas) ? record.lemmas : [],
    sourceTerms: Array.isArray(record?.sourceTerms) ? record.sourceTerms : [],
    gloss: String(record?.gloss ?? ""),
    sourceStatus: String(record?.status ?? "review"),
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

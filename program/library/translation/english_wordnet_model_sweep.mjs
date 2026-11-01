import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { buildProgram } from "../../program.mjs";
import {
  buildEnglishWordNetBridgeIndex,
  parseEnglishWordNetBridgeCatalog
} from "./english_wordnet_bridges.mjs";
import {
  ENGLISH_WORDNET_LINKER_DEFAULT_DUTY_SIZE,
  reconcileEnglishWordNetSenseLinks,
  renderEnglishWordNetSenseLinksPya,
  submitEnglishWordNetSenseLinks
} from "./english_wordnet_linker.mjs";
import {
  ENGLISH_WORDNET_SENSE_ORDERING,
  rankEnglishWordNetSenseRecords
} from "./english_wordnet_sweep.mjs";

export const ENGLISH_WORDNET_MODEL_SWEEP_FORMAT = "english-wordnet-model-sweep-v1";
export const ENGLISH_WORDNET_MODEL_SWEEP_PROMPT_VERSION = "definition-anchor-v1";
export const ENGLISH_WORDNET_MODEL_SWEEP_MANIFEST_NAME = "translation_english_wordnet_model_sweep_manifest";
export const ENGLISH_WORDNET_MODEL_SWEEP_BATCH_NAME = "translation_english_wordnet_model_sweep_batch";

function text(value) {
  return typeof value === "string" ? value.normalize("NFC").trim() : "";
}

function sha256(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function pyaJson(value) {
  return `quoted.text.${JSON.stringify(value, null, 2)}.text.quoted`;
}

function pyaJsonRow(key, value) {
  return `su text ${JSON.stringify(key)} ob text ${pyaJson(value)} ya`;
}

function modelBatchName(index) {
  return `batch-${String(index).padStart(5, "0")}.pya`;
}

function batchesOf(records, size) {
  const batches = [];
  for (let offset = 0; offset < records.length; offset += size) {
    batches.push(records.slice(offset, offset + size));
  }
  return batches;
}

export function selectEnglishWordNetModelSweepPilotRecords(records = [], limit = 12, {
  rankForEnglish = () => Number.POSITIVE_INFINITY,
  maxMultipleChoice = Math.max(1, Math.floor(Number(limit) / 6))
} = {}) {
  const boundedLimit = Math.max(1, Math.trunc(Number(limit) || 12));
  const rankedRecords = rankEnglishWordNetSenseRecords(records, { rankForEnglish });
  const rankById = new Map(rankedRecords.map((record) => [record.id, record.english30kRank ?? Number.POSITIVE_INFINITY]));
  const frequencyRank = (record) => rankById.get(record.id) ?? Number.POSITIVE_INFINITY;
  const byFrequency = (left, right) => frequencyRank(left) - frequencyRank(right)
    || text(left.source).localeCompare(text(right.source))
    || text(left.id).localeCompare(text(right.id));
  const eligible = records.filter((record) => (
    record?.category === "needs-sense-choice"
      && record.candidates?.some((candidate) => candidate?.selectable === true)
  ));
  const multipleChoice = eligible.filter((record) => (
    record.candidates.filter((candidate) => candidate?.selectable === true).length > 1
  )).sort(byFrequency);
  const singlesByPos = new Map();
  for (const record of eligible.filter((row) => !multipleChoice.includes(row))) {
    const pos = text(record.pos) || "unknown";
    if (!singlesByPos.has(pos)) singlesByPos.set(pos, []);
    singlesByPos.get(pos).push(record);
  }
  for (const rows of singlesByPos.values()) rows.sort(byFrequency);
  const choiceLimit = Math.max(0, Math.trunc(Number(maxMultipleChoice) || 0));
  const selected = multipleChoice.slice(0, Math.min(choiceLimit, boundedLimit));
  const singleRows = [...singlesByPos.values()].sort((left, right) => byFrequency(left[0], right[0]));
  let cursor = 0;
  while (selected.length < boundedLimit && singleRows.some((rows) => cursor < rows.length)) {
    for (const rows of singleRows) {
      if (selected.length >= boundedLimit) break;
      if (rows[cursor]) selected.push(rows[cursor]);
    }
    cursor += 1;
  }
  if (selected.length < boundedLimit) {
    const seen = new Set(selected.map((record) => record.id));
    for (const record of eligible) {
      if (selected.length >= boundedLimit) break;
      if (!seen.has(record.id)) selected.push(record);
    }
  }
  return rankEnglishWordNetSenseRecords(selected, { rankForEnglish });
}

function resultCounts(records) {
  return {
    accepted: records.filter((record) => record.status === "accepted-llm").length,
    rejected: records.filter((record) => record.status === "rejected-llm").length,
    uncertain: records.filter((record) => record.status === "uncertain-llm" || record.status === "review").length
  };
}

export function renderEnglishWordNetModelSweepBatchPya({
  runId,
  sourceHash,
  coverageHash,
  batchIndex,
  model,
  prompt = "",
  records = []
} = {}) {
  if (!runId || !Number.isInteger(batchIndex) || batchIndex < 1 || !Array.isArray(records)) {
    throw new TypeError("WordNet model sweep batch requires identities and records");
  }
  const lines = [
    `su name ${ENGLISH_WORDNET_MODEL_SWEEP_BATCH_NAME} be map def`,
    `su text "format" ob text ${JSON.stringify(ENGLISH_WORDNET_MODEL_SWEEP_FORMAT)} ya`,
    `su text "run-id" ob text ${JSON.stringify(runId)} ya`,
    `su text "source-hash" ob text ${JSON.stringify(sourceHash)} ya`,
    `su text "coverage-hash" ob text ${JSON.stringify(coverageHash)} ya`,
    `su text "batch-index" ob num ${batchIndex} ya`,
    `su text "model" ob text ${JSON.stringify(model)} ya`,
    ...(text(prompt) ? [pyaJsonRow("prompt", prompt)] : []),
    ...records.map((record) => pyaJsonRow(`record:${record.id}`, record)),
    "prah"
  ];
  return `${lines.join("\n")}\n`;
}

export function parseEnglishWordNetModelSweepBatchPya(source) {
  if (typeof source !== "string") throw new TypeError("WordNet model sweep artifact must be Pyash text");
  const sentences = buildProgram(source).sentences;
  const header = sentences.find((sentence) => (
    sentence?.mood === "def"
      && sentence?.be === "map"
      && sentence?.su?.name === ENGLISH_WORDNET_MODEL_SWEEP_BATCH_NAME
  ));
  if (!header) throw new TypeError("WordNet model sweep artifact has no batch map header");
  const values = new Map();
  const records = [];
  for (const sentence of sentences) {
    if (sentence?.mood !== "ya" || typeof sentence.su?.text !== "string") continue;
    if (sentence.su.text.startsWith("record:")) {
      if (typeof sentence.ob?.text !== "string") throw new TypeError("WordNet model sweep record is not quoted JSON text");
      records.push(JSON.parse(sentence.ob.text));
      continue;
    }
    if (typeof sentence.ob?.text === "string" || Number.isInteger(sentence.ob?.num)) {
      values.set(sentence.su.text, sentence.ob.text ?? sentence.ob.num);
    }
  }
  const batchIndex = Number(values.get("batch-index"));
  if (!values.get("run-id") || !Number.isInteger(batchIndex) || batchIndex < 1) {
    throw new TypeError("WordNet model sweep artifact has incomplete identity");
  }
  return {
    format: values.get("format"),
    runId: values.get("run-id"),
    sourceHash: values.get("source-hash"),
    coverageHash: values.get("coverage-hash"),
    batchIndex,
    model: values.get("model"),
    prompt: values.has("prompt") ? JSON.parse(values.get("prompt")) : "",
    records
  };
}

export function renderEnglishWordNetModelSweepManifestPya({
  runId,
  sourceHash,
  coverageHash,
  model,
  status,
  recordCount,
  batchSize,
  batchCount,
  completedBatchCount,
  counts,
  ordering = ENGLISH_WORDNET_SENSE_ORDERING,
  error = ""
} = {}) {
  const lines = [
    `su name ${ENGLISH_WORDNET_MODEL_SWEEP_MANIFEST_NAME} be map def`,
    `su text "format" ob text ${JSON.stringify(ENGLISH_WORDNET_MODEL_SWEEP_FORMAT)} ya`,
    `su text "prompt-version" ob text ${JSON.stringify(ENGLISH_WORDNET_MODEL_SWEEP_PROMPT_VERSION)} ya`,
    `su text "run-id" ob text ${JSON.stringify(runId)} ya`,
    `su text "source-hash" ob text ${JSON.stringify(sourceHash)} ya`,
    `su text "coverage-hash" ob text ${JSON.stringify(coverageHash)} ya`,
    `su text "model" ob text ${JSON.stringify(model)} ya`,
    `su text "ordering" ob text ${JSON.stringify(ordering)} ya`,
    `su text "status" ob text ${JSON.stringify(status)} ya`,
    `su text "record-count" ob num ${recordCount} ya`,
    `su text "batch-size" ob num ${batchSize} ya`,
    `su text "batch-count" ob num ${batchCount} ya`,
    `su text "completed-batch-count" ob num ${completedBatchCount} ya`,
    pyaJsonRow("decision-counts", counts ?? {}),
    ...(error ? [`su text "error" ob text ${JSON.stringify(error)} ya`] : []),
    "prah"
  ];
  return `${lines.join("\n")}\n`;
}

async function atomicWrite(filename, contents) {
  await mkdir(dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.tmp`;
  await rm(temporary, { force: true });
  await writeFile(temporary, contents, "utf8");
  await rename(temporary, filename);
}

async function acquireLock(filename) {
  await mkdir(dirname(filename), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(filename, "wx");
      await handle.writeFile(`${process.pid}\n`, "utf8");
      await handle.close();
      return async () => rm(filename, { force: true });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const lockText = await readFile(filename, "utf8");
      const lockPid = Number(lockText.trim());
      if (!Number.isSafeInteger(lockPid) || lockPid <= 0) {
        throw new Error("WordNet model sweep lock has no valid process identity");
      }
      try {
        process.kill(lockPid, 0);
      } catch (probeError) {
        if (probeError?.code === "EPERM") throw new Error(`WordNet model sweep is already running as pid ${lockPid}`);
        if (probeError?.code !== "ESRCH") throw probeError;
        await rm(filename, { force: true });
        continue;
      }
      throw new Error(`WordNet model sweep is already running as pid ${lockPid}`);
    }
  }
  throw new Error("could not acquire WordNet model sweep lock");
}

async function readCompletedBatch({ filename, expected }) {
  let source;
  try {
    source = await readFile(filename, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  const parsed = parseEnglishWordNetModelSweepBatchPya(source);
  const matching = parsed.format === ENGLISH_WORDNET_MODEL_SWEEP_FORMAT
    && parsed.runId === expected.runId
    && parsed.sourceHash === expected.sourceHash
    && parsed.coverageHash === expected.coverageHash
    && parsed.batchIndex === expected.batchIndex
    && parsed.model === expected.model
    && parsed.records.length === expected.ids.length
    && parsed.records.every((record, index) => record.id === expected.ids[index]);
  if (!matching) throw new Error(`WordNet model sweep checkpoint identity mismatch: ${filename}`);
  return parsed.records;
}

export async function runEnglishWordNetModelSweep({
  records = [],
  inventory = { entries: [], grammar: [] },
  sourceHash,
  coverageHash,
  runId,
  model,
  artifactDirectory,
  maxDutySenses = ENGLISH_WORDNET_LINKER_DEFAULT_DUTY_SIZE,
  maxChars,
  maxTokens,
  maxOutputTokens,
  rankForEnglish = () => Number.POSITIVE_INFINITY,
  submit,
  awaitHandle,
  onBatch = () => {}
} = {}) {
  if (!Array.isArray(records) || typeof submit !== "function" || typeof awaitHandle !== "function") {
    throw new TypeError("WordNet model sweep requires records, submit, and await adapters");
  }
  if (!sourceHash || !coverageHash || !runId || !model || !artifactDirectory) {
    throw new TypeError("WordNet model sweep requires stable run, source, coverage, and model identities");
  }
  const pending = rankEnglishWordNetSenseRecords(records.filter((record) => (
    record?.category === "needs-sense-choice"
      && record.candidates?.some((candidate) => candidate?.selectable === true)
  )), { rankForEnglish });
  const batchSize = Math.max(1, Math.trunc(Number(maxDutySenses) || ENGLISH_WORDNET_LINKER_DEFAULT_DUTY_SIZE));
  const batches = batchesOf(pending, batchSize);
  const directory = resolve(artifactDirectory);
  const batchDirectory = join(directory, "batches");
  await mkdir(batchDirectory, { recursive: true });
  const releaseLock = await acquireLock(join(directory, ".model-sweep.lock"));
  let completedBatchCount = 0;
  let completed = [];
  let status = "running";
  let failure = "";
  const linkerSourceHash = sha256(`${sourceHash}\u0000${coverageHash}\u0000${model}\u0000${ENGLISH_WORDNET_MODEL_SWEEP_PROMPT_VERSION}`);
  const manifestPath = join(directory, "manifest.pya");
  const writeManifest = () => atomicWrite(manifestPath, renderEnglishWordNetModelSweepManifestPya({
    runId,
    sourceHash,
    coverageHash,
    model,
    status,
    recordCount: pending.length,
    batchSize,
    batchCount: batches.length,
    completedBatchCount,
    counts: { ...resultCounts(completed), completed: completed.length },
    error: failure
  }));

  try {
    await writeManifest();
    for (const [offset, batch] of batches.entries()) {
      const batchIndex = offset + 1;
      const filename = join(batchDirectory, modelBatchName(batchIndex));
      const expected = {
        runId,
        sourceHash,
        coverageHash,
        batchIndex,
        model,
        ids: batch.map((record) => record.id)
      };
      const cached = await readCompletedBatch({ filename, expected });
      if (cached) {
        completed.push(...cached);
        completedBatchCount += 1;
        await onBatch({ batchIndex, batchCount: batches.length, reused: true, records: cached });
        await writeManifest();
        continue;
      }

      const queued = await submitEnglishWordNetSenseLinks({
        records: batch,
        inventory,
        sourceHash: linkerSourceHash,
        maxChars,
        maxTokens,
        maxOutputTokens,
        maxDutySenses: batch.length,
        submit
      });
      if (!queued.submitted || queued.queues.length !== 1) {
        throw new Error(`WordNet model sweep batch ${batchIndex} did not create exactly one Housekeeper duty`);
      }
      if (typeof queued.prompt !== "string") {
        throw new Error(`WordNet model sweep batch ${batchIndex} did not retain its exact model prompt`);
      }
      const reconciled = await reconcileEnglishWordNetSenseLinks({
        records: queued.records,
        inventory,
        sourceHash: linkerSourceHash,
        maxChars,
        maxTokens,
        maxOutputTokens,
        queues: queued.queues,
        submit,
        awaitHandle
      });
      const results = reconciled.records.filter((record) => batch.some((candidate) => candidate.id === record.id));
      if (results.length !== batch.length) {
        throw new Error(`WordNet model sweep batch ${batchIndex} returned an incomplete decision set`);
      }
      await atomicWrite(filename, renderEnglishWordNetModelSweepBatchPya({
        runId,
        sourceHash,
        coverageHash,
        batchIndex,
        model,
        prompt: queued.prompt,
        records: results
      }));
      completed.push(...results);
      completedBatchCount += 1;
      await onBatch({ batchIndex, batchCount: batches.length, reused: false, records: results });
      await writeManifest();
    }
    status = "complete";
    await writeManifest();
  } catch (error) {
    status = "failed";
    failure = text(error?.message ?? error).slice(0, 500);
    await writeManifest().catch(() => {});
    throw error;
  } finally {
    await releaseLock();
  }
  return {
    runId,
    directory,
    manifest: manifestPath,
    status,
    model,
    recordCount: pending.length,
    batchCount: batches.length,
    completedBatchCount,
    counts: { ...resultCounts(completed), completed: completed.length },
    records: completed
  };
}

export function activateEnglishWordNetModelSweepLinks({
  catalogSource,
  records = [],
  runId,
  sourceHash = "",
  model = "",
  resolveTarget
} = {}) {
  if (typeof catalogSource !== "string" || !Array.isArray(records)) {
    throw new TypeError("WordNet model activation requires a Pyash catalog and records");
  }
  const catalog = parseEnglishWordNetBridgeCatalog(catalogSource);
  const existingBySense = new Map(catalog.entries.map((entry) => [entry.source, entry]));
  const additions = [];
  const skipped = [];
  for (const record of records) {
    if (record?.status !== "accepted-llm" || !record?.link?.target) continue;
    const source = text(record.source).toLowerCase();
    if (!source || !Array.isArray(record.link.pyashSequence) || record.link.pyashSequence.length === 0) {
      skipped.push({ source, reason: "accepted model decision lacks a sense, target, or Pyash sequence" });
      continue;
    }
    if (existingBySense.has(source)) {
      skipped.push({ source, reason: "sense already exists in the active catalog" });
      continue;
    }
    additions.push({
      source,
      target: text(record.link.target).toLowerCase(),
      gloss: text(record.gloss),
      lemmas: Array.isArray(record.lemmas) ? [...record.lemmas] : [],
      pyashSequence: [...record.link.pyashSequence],
      targetKind: text(record.link.targetKind),
      targetId: text(record.link.targetId),
      targetPartOfSpeech: text(record.link.targetPartOfSpeech) || text(record.pos),
      certainty: "contextual",
      evidence: `${text(record.verificationRationale) || text(record.link.evidence) || "Qwen accepted the supplied WordNet anchor"}; model ${model}; sense-link sweep ${runId} (source ${sourceHash})`
    });
  }

  const candidateIndex = buildEnglishWordNetBridgeIndex({
    entries: [...catalog.entries, ...additions],
    resolveTarget
  });
  const activeAdditions = additions.filter((entry) => candidateIndex.bySense.has(entry.source));
  for (const entry of additions) {
    if (!candidateIndex.bySense.has(entry.source)) {
      skipped.push({ source: entry.source, reason: "target identity collides with a non-equivalent WordNet sense" });
    }
  }
  const rendered = renderEnglishWordNetSenseLinksPya({
    records: activeAdditions.map((entry) => ({
      source: entry.source,
      pos: entry.targetPartOfSpeech,
      synset: entry.source.slice(2),
      gloss: entry.gloss,
      lemmas: entry.lemmas,
      status: "accepted-llm",
      link: entry
    })),
    source: catalog.source,
    sourceHash,
    name: "translation_english_wordnet_model_sweep_additions"
  });
  const sourcesToRender = new Set(activeAdditions.map((entry) => entry.source));
  const bridgeLines = rendered.split(/\r?\n/u).filter((line) => (
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
    throw new TypeError("could not render every accepted model WordNet bridge row");
  }
  const catalogLines = catalogSource.trimEnd().split(/\r?\n/u);
  const endIndex = catalogLines.lastIndexOf("prah");
  if (endIndex < 0) throw new TypeError("active WordNet bridge catalog has no closing prah");
  const updated = `${[...catalogLines.slice(0, endIndex), ...bridgeLines, ...catalogLines.slice(endIndex)].join("\n")}\n`;
  const parsedUpdated = parseEnglishWordNetBridgeCatalog(updated);
  const activeUpdated = buildEnglishWordNetBridgeIndex({ entries: parsedUpdated.entries, resolveTarget });
  if (activeAdditions.some((entry) => !activeUpdated.bySense.has(entry.source))) {
    throw new TypeError("rendered model WordNet links failed active bridge validation");
  }
  return {
    catalog: updated,
    activated: activeAdditions.map((entry) => entry.source),
    skipped,
    totalCatalogEntries: parsedUpdated.entries.length
  };
}

export async function persistEnglishWordNetModelSweepCatalog({
  catalogPath,
  catalogSource,
  expectedCatalogHash,
  records,
  runId,
  sourceHash,
  model,
  resolveTarget
} = {}) {
  const current = await readFile(catalogPath, "utf8");
  if (sha256(current) !== expectedCatalogHash) {
    throw new Error("WordNet bridge catalog changed during model sense linking; preserve results and retry merge");
  }
  const result = activateEnglishWordNetModelSweepLinks({
    catalogSource,
    records,
    runId,
    sourceHash,
    model,
    resolveTarget
  });
  if (result.activated.length > 0) await atomicWrite(catalogPath, result.catalog);
  return result;
}

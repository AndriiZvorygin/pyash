import { createHash } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { buildProgram } from "../../program.mjs";
import {
  canonicalWordNetTargetPartOfSpeech,
  englishWordNetTargetId,
  buildEnglishWordNetBridgeIndex,
  parseEnglishWordNetBridgeCatalog
} from "./english_wordnet_bridges.mjs";
import { extractBoundedJsonObject } from "./english_verification.mjs";
import { englishWordNetDefinition, isCircularEnglishWordNetGloss } from "./english_wordnet_glosses.mjs";
import { renderEnglishWordNetSenseLinkRowsPya } from "./english_wordnet_linker.mjs";

export const ENGLISH_WORDNET_ATOM_SENSE_FORMAT = "english-wordnet-atom-sense-sweep-v1";
export const ENGLISH_WORDNET_ATOM_SENSE_PROMPT_REVISION = "atom-general-pos-gloss-choice-v8";
export const ENGLISH_WORDNET_ATOM_SENSE_CONFIG_URL = new URL("./english_wordnet_atom_sense_sweep.pya", import.meta.url);

export const ENGLISH_WORDNET_ATOM_SENSE_RESPONSE_FORMAT = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["decisions"],
  properties: {
    decisions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "status", "source", "rationale"],
        properties: {
          id: { type: "string" },
          status: { type: "string", enum: ["select", "uncertain", "no-fit"] },
          source: { type: ["string", "null"] },
          rationale: { type: "string", maxLength: 220 }
        }
      }
    }
  }
});

const MANIFEST_NAME = "translation";
const BATCH_NAME = "translation";
const DEFAULT_CONFIG = Object.freeze({
  "batch-max-items": 24,
  "batch-max-chars": 10000,
  "max-output-tokens": 2048,
  "max-attempts": 2,
  parallelism: 1
});

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-english-wordnet-atom-sense-sweep";
  error.details = details;
  return error;
}

function text(value) {
  return typeof value === "string" ? value.normalize("NFC").trim() : "";
}

function hash(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function pyaJson(value) {
  return `quoted.text.${JSON.stringify(value, null, 2)}.text.quoted`;
}

function pyaJsonRow(key, value) {
  return `su text ${JSON.stringify(key)} ob text ${pyaJson(value)} ya`;
}

function definition(value) {
  return englishWordNetDefinition(text(value)).slice(0, 240);
}

function unique(values) {
  return [...new Set(values.map(text).filter(Boolean))];
}

function normalizedLabel(value) {
  return text(value).toLowerCase().replace(/[_-]+/gu, " ").replace(/\s+/gu, " ");
}

export function parseEnglishWordNetAtomSenseConfig(source) {
  if (typeof source !== "string") throw invalid("atom sense sweep configuration must be Pyash text");
  const sentences = buildProgram(source).sentences;
  const header = sentences.find((sentence) => sentence?.mood === "def"
    && sentence?.be === "map"
    && sentence?.su?.name === "translation");
  if (!header) throw invalid("atom sense sweep configuration has no map header");
  const values = {};
  for (const sentence of sentences) {
    if (sentence?.mood !== "ya" || typeof sentence.su?.text !== "string") continue;
    if (typeof sentence.ob?.text === "string") values[sentence.su.text] = sentence.ob.text;
    if (Number.isSafeInteger(sentence.ob?.num)) values[sentence.su.text] = sentence.ob.num;
  }
  if (values.format !== ENGLISH_WORDNET_ATOM_SENSE_FORMAT
    || values["prompt-revision"] !== ENGLISH_WORDNET_ATOM_SENSE_PROMPT_REVISION) {
    throw invalid("atom sense sweep format or prompt revision is unsupported", { format: values.format });
  }
  const config = { ...DEFAULT_CONFIG, ...values };
  for (const key of ["batch-max-items", "batch-max-chars", "max-output-tokens", "max-attempts", "parallelism"]) {
    if (!Number.isSafeInteger(config[key]) || config[key] < 1) {
      throw invalid(`atom sense sweep ${key} must be a positive integer`);
    }
  }
  if (config["max-attempts"] > 2) throw invalid("atom sense sweep permits at most one retry");
  if (config.parallelism > 8) throw invalid("atom sense sweep parallelism cannot exceed eight Housekeeper jobs");
  return config;
}

export async function loadEnglishWordNetAtomSenseConfig({ configUrl = ENGLISH_WORDNET_ATOM_SENSE_CONFIG_URL } = {}) {
  return parseEnglishWordNetAtomSenseConfig(await readFile(configUrl, "utf8"));
}

export function buildEnglishWordNetAtomSenseWorklist(atomCoverage = [], {
  lemmaEntries = [],
  resolveTarget = null,
  reservedSources = new Set()
} = {}) {
  if (!Array.isArray(atomCoverage)) throw invalid("atom sense worklist requires atom coverage rows");
  return atomCoverage
    .filter((atom) => atom?.status === "direct-candidates-unlinked")
    .flatMap((atom) => {
      const labels = unique(atom.labels ?? []).sort((left, right) => left.localeCompare(right));
      const labelSet = new Set(labels.map(normalizedLabel));
      const candidatesByPos = new Map();
      for (const candidate of atom.directCandidates ?? []) {
        const pos = canonicalWordNetTargetPartOfSpeech(candidate?.pos);
        if (!pos || candidate.availableTargetPartOfSpeech === false || (candidate.activeTargetIds ?? []).length > 0) continue;
        const rows = candidatesByPos.get(pos) ?? [];
        rows.push(candidate);
        candidatesByPos.set(pos, rows);
      }
      return [...candidatesByPos.entries()].flatMap(([partOfSpeech, posCandidates]) => {
      const lemmaMappings = (Array.isArray(lemmaEntries) ? lemmaEntries : [])
        .filter((entry) => String(entry?.status ?? "").startsWith("accepted-"))
        .filter((entry) => !entry.partOfSpeech || canonicalWordNetTargetPartOfSpeech(entry.partOfSpeech) === partOfSpeech)
        .filter((entry) => labelSet.has(normalizedLabel(entry.surface)))
        .filter((entry) => {
          if (typeof resolveTarget !== "function") return false;
          const target = resolveTarget(entry.canonicalEnglish || entry.surface, { partOfSpeech });
          return Array.isArray(target?.pyashSequence) && target.pyashSequence.join(" ") === text(atom.pyac);
        })
        .map((entry) => ({ surface: text(entry.surface), lemma: text(entry.lemma), kind: text(entry.kind) }))
        .filter((entry) => entry.surface && entry.lemma);
      const permittedLemmas = new Set([
        ...labelSet,
        ...lemmaMappings.map((entry) => normalizedLabel(entry.lemma))
      ]);
      const bySource = new Map();
      const alreadyRepresented = [];
      for (const candidate of posCandidates) {
        if (canonicalWordNetTargetPartOfSpeech(candidate.pos) !== partOfSpeech) continue;
        if (!text(candidate?.source) || (candidate.activeTargetIds ?? []).length > 0) continue;
        if (reservedSources.has(candidate.source)) {
          alreadyRepresented.push({ source: candidate.source, matchedLemmas: [text(candidate.matchedLemma)], reason: "source-already-present-in-bridge-catalog" });
          continue;
        }
        const row = bySource.get(candidate.source) ?? {
          source: candidate.source,
          pos: text(candidate.pos),
          synset: text(candidate.synset),
          lemmas: unique(candidate.lemmas ?? []),
          definition: definition(candidate.definition),
          english30kRank: Number.isFinite(candidate.english30kRank) ? candidate.english30kRank : null,
          tagCount: Number.isSafeInteger(candidate.tagCount) ? candidate.tagCount : null,
          matchedLemmas: []
        };
        row.matchedLemmas = unique([...row.matchedLemmas, candidate.matchedLemma]);
        if (Number.isFinite(candidate.english30kRank)) {
          row.english30kRank = row.english30kRank === null
            ? candidate.english30kRank
            : Math.min(row.english30kRank, candidate.english30kRank);
        }
        if (Number.isSafeInteger(candidate.tagCount)) {
          row.tagCount = row.tagCount === null ? candidate.tagCount : Math.max(row.tagCount, candidate.tagCount);
        }
        bySource.set(candidate.source, row);
      }
      const allCandidates = [...bySource.values()];
      const labelMatchedCandidates = allCandidates.filter((candidate) => (
        candidate.matchedLemmas.some((lemma) => permittedLemmas.has(normalizedLabel(lemma)))
      ));
      const circularCandidates = labelMatchedCandidates.filter((candidate) => (
        isCircularEnglishWordNetGloss(candidate.definition, candidate.matchedLemmas)
      ));
      const candidates = labelMatchedCandidates.filter((candidate) => !circularCandidates.includes(candidate))
        .sort((left, right) => (
        (left.english30kRank ?? Number.MAX_SAFE_INTEGER) - (right.english30kRank ?? Number.MAX_SAFE_INTEGER)
          || (right.tagCount ?? -1) - (left.tagCount ?? -1)
          || left.source.localeCompare(right.source)
      ));
      const excludedCandidates = [
        ...allCandidates.filter((candidate) => !labelMatchedCandidates.includes(candidate)).map((candidate) => ({
        source: candidate.source,
        matchedLemmas: candidate.matchedLemmas,
        reason: "candidate-lemma-does-not-match-atom-label-or-accepted-lemma"
        })),
        ...circularCandidates.map((candidate) => ({
          source: candidate.source,
          matchedLemmas: candidate.matchedLemmas,
          reason: "candidate-definition-repeats-target-lemma"
        })),
        ...alreadyRepresented
      ];
      const targetId = englishWordNetTargetId("atom", [text(atom.pyac)], partOfSpeech);
      return [{
        id: targetId,
        targetId,
        responseId: `slot-${hash(targetId).slice(0, 16)}`,
        partOfSpeech,
        pyac: text(atom.pyac),
        labels,
        english30kRank: Number.isFinite(atom.english30kRank) ? atom.english30kRank : null,
        lemmaMappings,
        candidates,
        excludedCandidates
      }];
      });
    })
    .flat()
    .filter((atom) => atom.id && atom.pyac && atom.labels.length)
    .sort((left, right) => (
      (left.english30kRank ?? Number.MAX_SAFE_INTEGER) - (right.english30kRank ?? Number.MAX_SAFE_INTEGER)
        || left.id.localeCompare(right.id)
    ));
}

export function hashEnglishWordNetAtomSenseWorklist(worklist = []) {
  return hash(stableJson(worklist));
}

export function filterEnglishWordNetAtomSenseWorklist(worklist = [], atomIds = []) {
  if (!Array.isArray(worklist) || !Array.isArray(atomIds) || atomIds.length === 0) {
    throw invalid("atom sense worklist filtering requires a non-empty atom id list");
  }
  const requested = new Set(atomIds.map(text).filter(Boolean));
  if (requested.size !== atomIds.length) throw invalid("atom sense worklist filter contains duplicate or empty ids");
  const filtered = worklist.filter((item) => requested.has(item.id));
  if (filtered.length !== requested.size) {
    const found = new Set(filtered.map((item) => item.id));
    throw invalid("atom sense worklist filter references an unknown atom id", {
      missing: [...requested].filter((id) => !found.has(id))
    });
  }
  return filtered;
}

export function includeReopenedAtomSenseNoFitTargets(worklist = [], {
  reopenedEntries = [],
  atomCoverage = [],
  resolveTarget = null
} = {}) {
  if (!Array.isArray(worklist) || !Array.isArray(reopenedEntries) || !Array.isArray(atomCoverage)
    || typeof resolveTarget !== "function") {
    throw invalid("reopened atom sense targets require a worklist, bridge entries, coverage, and target resolver");
  }
  const rows = [...worklist];
  const knownIds = new Set(rows.map((row) => row.id));
  for (const entry of reopenedEntries) {
    const partOfSpeech = canonicalWordNetTargetPartOfSpeech(entry?.targetPartOfSpeech || entry?.source?.slice(0, 1));
    if (!partOfSpeech) continue;
    const target = resolveTarget(entry.target, { partOfSpeech });
    const pyashSequence = Array.isArray(target?.pyashSequence)
      ? target.pyashSequence.filter((word) => typeof word === "string" && word.trim()).map((word) => word.trim())
      : [];
    if (target?.coverageType !== "atomic" || pyashSequence.length !== 1) continue;
    const id = englishWordNetTargetId("atom", pyashSequence, partOfSpeech);
    if (knownIds.has(id)) continue;
    const atom = atomCoverage.find((row) => text(row?.pyac) === pyashSequence[0]);
    const labels = unique([...(atom?.labels ?? []), entry.target]);
    if (labels.length === 0) continue;
    rows.push({
      id,
      targetId: id,
      responseId: `slot-${hash(id).slice(0, 16)}`,
      partOfSpeech,
      pyac: pyashSequence[0],
      labels,
      english30kRank: Number.isFinite(atom?.english30kRank) ? atom.english30kRank : null,
      lemmaMappings: [],
      candidates: [],
      excludedCandidates: [{
        source: text(entry.source),
        matchedLemmas: unique(entry.lemmas ?? [entry.target]),
        reason: "reopened-target-has-no-eligible-candidates-after-lemma-validation"
      }]
    });
    knownIds.add(id);
  }
  return rows.sort((left, right) => (
    (left.english30kRank ?? Number.MAX_SAFE_INTEGER) - (right.english30kRank ?? Number.MAX_SAFE_INTEGER)
      || left.id.localeCompare(right.id)
  ));
}

function promptItem(item, candidates) {
  return [item.responseId || item.id, item.partOfSpeech, item.labels, candidates.map((candidate) => [
    candidate.source,
    candidate.definition
  ])];
}

export function buildEnglishWordNetAtomSensePrompt(items = []) {
  if (!Array.isArray(items) || items.length === 0) throw invalid("atom sense prompt requires at least one item");
  return [
    "Choose the supplied WordNet sense that matches each Pyash atom's English label(s) for the specified part of speech as a broad, ordinary general-language concept. These atomic anchors represent general vocabulary; a narrower specialized concept belongs in a compound.",
    "Do not infer a specialist domain from a bare label. Select a domain-marked candidate only when the atom labels explicitly support that domain. Do not invent missing context. If no general candidate fits, return no-fit; if multiple general senses remain indistinguishable from the labels, return uncertain. For those statuses source=null.",
    "When multiple sense definitions fit the same atom label, choose the definition that applies across the widest range of ordinary situations. Prefer the broader ordinary meaning over a narrower role or activity.",
    "A definition that repeats its matched target lemma is circular and must not be selected; circular definitions are excluded before this prompt is built.",
    "Choose from glosses only. Co-lemmas and frequency counts are intentionally omitted; do not infer a mismatch from synonyms that are not shown.",
    "Each input row is [response slot id, target POS, atom English label(s), candidates]. Each candidate is [sense id, definition]. Definitions omit usage examples. Use only supplied sense ids and give one short reason.",
    "Copy each response slot id exactly as shown. It is an opaque identifier; do not append the POS or reconstruct an atom id.",
    "Return JSON only: {\"decisions\":[{\"id\":\"slot-<supplied-id>\",\"status\":\"select|uncertain|no-fit\",\"source\":\"supplied sense id or null\",\"rationale\":\"short reason\"}]}. Include each response slot exactly once.",
    JSON.stringify(items.map(({ item, candidates }) => promptItem(item, candidates)))
  ].join("\n");
}

export function parseEnglishWordNetAtomSenseResponse(raw, items = []) {
  const source = typeof raw === "string" ? raw : JSON.stringify(raw ?? null);
  if (source.length > 1_000_000) return { valid: false, reason: "provider envelope exceeds the bounded character limit" };
  let payload;
  try {
    payload = JSON.parse(source);
  } catch {
    payload = extractBoundedJsonObject(source, { maxResponseChars: 12000 });
  }
  for (let depth = 0; payload && !Array.isArray(payload.decisions) && depth < 2; depth += 1) {
    const nested = typeof payload.response === "string"
      ? payload.response
      : typeof payload.message?.content === "string"
        ? payload.message.content
        : "";
    if (!nested || nested.length > 12000) break;
    try {
      payload = JSON.parse(nested);
    } catch {
      payload = extractBoundedJsonObject(nested, { maxResponseChars: 12000 });
    }
  }
  if (!payload || !Array.isArray(payload.decisions)) return { valid: false, reason: "response did not contain a decisions array" };
  const expected = new Map(items.map(({ item, candidates }) => [item.responseId || item.id, { item, candidates }]));
  const seen = new Set();
  const decisions = [];
  const issues = [];
  for (const row of payload.decisions) {
    const id = text(row?.id);
    const context = expected.get(id);
    if (!context) {
      issues.push("response contains an unknown atom id");
      continue;
    }
    if (seen.has(id)) {
      issues.push("response repeats an atom id");
      continue;
    }
    const status = text(row?.status).toLowerCase();
    if (!["select", "uncertain", "no-fit"].includes(status)) {
      issues.push("decision status is invalid");
      continue;
    }
    const rationale = text(row?.rationale);
    if (!rationale || rationale.length > 220) {
      issues.push("decision rationale is empty or too long");
      continue;
    }
    const selectedSource = row?.source === null ? "" : text(row?.source);
    if (status === "select") {
      if (!context.candidates.some((candidate) => candidate.source === selectedSource)) {
        issues.push("selected source is outside the supplied candidates");
        continue;
      }
    } else if (selectedSource) {
      issues.push("uncertain and no-fit decisions must not select a source");
      continue;
    }
    seen.add(id);
    decisions.push({
      id: context.item.id,
      targetId: context.item.targetId,
      partOfSpeech: context.item.partOfSpeech,
      pyac: context.item.pyac,
      labels: context.item.labels,
      status,
      source: status === "select" ? selectedSource : "",
      candidate: status === "select"
        ? context.candidates.find((candidate) => candidate.source === selectedSource)
        : null,
      rationale
    });
  }
  if (seen.size !== expected.size) issues.push("response omitted one or more atom ids");
  const selectedSources = decisions.filter((row) => row.status === "select").map((row) => row.source);
  if (new Set(selectedSources).size !== selectedSources.length) {
    return { valid: false, reason: "response assigned one WordNet sense to multiple atoms", partialDecisions: [] };
  }
  if (issues.length) return { valid: false, reason: issues[0], partialDecisions: decisions };
  return { valid: true, decisions };
}

export function renderEnglishWordNetAtomSenseBatchPya({
  runId,
  sourceHash,
  coverageHash,
  candidateHash,
  batchIndex,
  model,
  prompt,
  records = [],
  attempts = []
} = {}) {
  if (!runId || !Number.isInteger(batchIndex) || batchIndex < 1 || !Array.isArray(records)) {
    throw invalid("atom sense batch requires stable run and batch identities");
  }
  return [
    `su name ${BATCH_NAME} be map def`,
    `su text "format" ob text ${JSON.stringify(ENGLISH_WORDNET_ATOM_SENSE_FORMAT)} ya`,
    `su text "run-id" ob text ${JSON.stringify(runId)} ya`,
    `su text "source-hash" ob text ${JSON.stringify(sourceHash)} ya`,
    `su text "coverage-hash" ob text ${JSON.stringify(coverageHash)} ya`,
    `su text "candidate-hash" ob text ${JSON.stringify(candidateHash)} ya`,
    `su text "batch-index" ob num ${batchIndex} ya`,
    `su text "model" ob text ${JSON.stringify(model)} ya`,
    pyaJsonRow("prompt", prompt ?? ""),
    pyaJsonRow("records", records),
    pyaJsonRow("attempts", attempts),
    "prah",
    ""
  ].join("\n");
}

export function parseEnglishWordNetAtomSenseBatchPya(source) {
  if (typeof source !== "string") throw invalid("atom sense batch must be Pyash text");
  const sentences = buildProgram(source).sentences;
  const header = sentences.find((sentence) => sentence?.mood === "def"
    && sentence?.be === "map"
    && sentence?.su?.name === BATCH_NAME);
  if (!header) throw invalid("atom sense batch has no map header");
  const values = new Map();
  for (const sentence of sentences) {
    if (sentence?.mood === "ya" && typeof sentence.su?.text === "string" && typeof sentence.ob?.text === "string") {
      values.set(sentence.su.text, sentence.ob.text);
    }
  }
  const parsed = (key, fallback) => values.has(key) ? JSON.parse(values.get(key)) : fallback;
  const batchIndex = Number(sentences.find((sentence) => sentence?.su?.text === "batch-index")?.ob?.num);
  const direct = (key) => {
    const sentence = sentences.find((row) => row?.mood === "ya" && row?.su?.text === key);
    return text(sentence?.ob?.text);
  };
  const runId = direct("run-id");
  if (!runId || !Number.isInteger(batchIndex) || batchIndex < 1) throw invalid("atom sense batch identity is incomplete");
  return {
    runId,
    sourceHash: direct("source-hash"),
    coverageHash: direct("coverage-hash"),
    candidateHash: direct("candidate-hash"),
    batchIndex,
    model: direct("model"),
    prompt: parsed("prompt", ""),
    records: parsed("records", []),
    attempts: parsed("attempts", [])
  };
}

export function appendEnglishWordNetAtomSenseLinks({
  catalogSource,
  decisions = [],
  model,
  promptRevision = "",
  runId,
  resolveTarget
} = {}) {
  if (typeof catalogSource !== "string" || !Array.isArray(decisions) || typeof resolveTarget !== "function") {
    throw invalid("atom sense activation requires a bridge catalog, decisions, and target resolver");
  }
  const selected = decisions.filter((row) => row.status === "select");
  const parsed = parseEnglishWordNetBridgeCatalog(catalogSource);
  const existingSources = new Set(parsed.entries.map((entry) => entry.source));
  const selectedSources = new Set();
  const selectedTargets = new Set();
  const records = [];
  for (const decision of selected) {
    const source = text(decision.source);
    const targetId = text(decision.targetId);
    const targetPartOfSpeech = canonicalWordNetTargetPartOfSpeech(decision.partOfSpeech || decision.candidate?.pos);
    const candidate = decision.candidate;
    if (!source || !targetId || !candidate || !text(candidate.pos) || !targetPartOfSpeech) {
      throw invalid("selected atom sense decision lacks its supplied WordNet candidate", { id: decision.id });
    }
    if (canonicalWordNetTargetPartOfSpeech(candidate.pos) !== targetPartOfSpeech
      || targetId !== englishWordNetTargetId("atom", [text(decision.pyac)], targetPartOfSpeech)) {
      throw invalid("selected atom sense does not match its target part-of-speech slot", { id: decision.id, targetId });
    }
    if (existingSources.has(source) || selectedSources.has(source)) {
      throw invalid("selected WordNet sense is already linked", { source, id: decision.id });
    }
    if (selectedTargets.has(targetId)) throw invalid("an atom has more than one selected WordNet sense", { targetId });
    selectedSources.add(source);
    selectedTargets.add(targetId);
    const candidateTargets = unique(candidate.matchedLemmas ?? []);
    const target = [...candidateTargets, ...unique(decision.labels ?? [])].find((label) => {
      const coverage = resolveTarget(label, { partOfSpeech: targetPartOfSpeech });
      return Array.isArray(coverage?.pyashSequence)
        && coverage.pyashSequence.join(" ") === text(decision.pyac);
    });
    if (!target) throw invalid("selected atom has no English label resolving to its Pyac identity", { id: decision.id, targetId });
    records.push({
      source,
      pos: candidate.pos,
      gloss: text(candidate.definition),
      lemmas: unique(candidate.lemmas ?? []),
      status: "accepted-llm",
      link: {
        target,
        pyashSequence: [text(decision.pyac)],
        targetPartOfSpeech,
        certainty: "contextual",
        evidence: `atom-target sense selection; model ${text(model)}; prompt ${text(promptRevision) || "unspecified"}; run ${text(runId)}; rationale: ${text(decision.rationale)}`
      }
    });
  }
  const rows = renderEnglishWordNetSenseLinkRowsPya(records);
  if (selected.length !== records.length) throw invalid("not every selected decision produced a bridge row");
  if (rows.length === 0) return { catalogSource, added: [], withheld: [], entries: parsed.entries };
  const appendRows = (source, renderedRows) => {
    const body = source.replace(/\s*prah\s*$/u, "").trimEnd();
    if (body === source.trimEnd()) throw invalid("bridge catalog does not end in its canonical prah");
    return `${body}\n${renderedRows.join("\n")}\nprah\n`;
  };
  const candidateSource = appendRows(catalogSource, rows);
  const candidateCatalog = parseEnglishWordNetBridgeCatalog(candidateSource);
  const candidateIndex = buildEnglishWordNetBridgeIndex({ entries: candidateCatalog.entries, resolveTarget });
  const withheld = records.filter((record) => !candidateIndex.bySense.has(record.source)).map((record) => {
    const sequence = record.link.pyashSequence.join(" ");
    const conflictingSources = parsed.entries
      .filter((entry) => (
        canonicalWordNetTargetPartOfSpeech(entry.targetPartOfSpeech)
          === canonicalWordNetTargetPartOfSpeech(record.link.targetPartOfSpeech)
        && resolveTarget(entry.target, { partOfSpeech: record.link.targetPartOfSpeech })?.pyashSequence?.join(" ") === sequence
      ))
      .map((entry) => entry.source);
    return {
      source: record.source,
      target: record.link.target,
      reason: "target-already-linked-or-ambiguous",
      conflictingSources
    };
  });
  const withheldSources = new Set(withheld.map((row) => row.source));
  const activeRecords = records.filter((record) => !withheldSources.has(record.source));
  const activeRows = renderEnglishWordNetSenseLinkRowsPya(activeRecords);
  const nextSource = activeRows.length > 0 ? appendRows(catalogSource, activeRows) : catalogSource;
  const nextCatalog = parseEnglishWordNetBridgeCatalog(nextSource);
  const index = buildEnglishWordNetBridgeIndex({ entries: nextCatalog.entries, resolveTarget });
  for (const record of activeRecords) {
    const linked = index.bySense.get(record.source);
    const coverage = resolveTarget(record.link.target, { partOfSpeech: record.link.targetPartOfSpeech });
    if (!linked || linked.targetId !== englishWordNetTargetId("atom", record.link.pyashSequence, record.link.targetPartOfSpeech)
      || !coverage || coverage.pyashSequence.join(" ") !== record.link.pyashSequence.join(" ")) {
      throw invalid("atom sense bridge failed active-index validation", { source: record.source, target: record.link.target });
    }
  }
  return {
    catalogSource: nextSource,
    added: activeRecords.map((record) => record.source),
    withheld,
    entries: nextCatalog.entries
  };
}

export function renderEnglishWordNetAtomSenseManifestPya({
  runId,
  sourceHash,
  coverageHash,
  candidateHash,
  model,
  status,
  recordCount,
  completedCount,
  selectedCount,
  uncertainCount,
  noFitCount,
  skippedCount,
  promptRevision,
  error = ""
} = {}) {
  const lines = [
    `su name ${MANIFEST_NAME} be map def`,
    `su text "format" ob text ${JSON.stringify(ENGLISH_WORDNET_ATOM_SENSE_FORMAT)} ya`,
    `su text "prompt-revision" ob text ${JSON.stringify(promptRevision)} ya`,
    `su text "run-id" ob text ${JSON.stringify(runId)} ya`,
    `su text "source-hash" ob text ${JSON.stringify(sourceHash)} ya`,
    `su text "coverage-hash" ob text ${JSON.stringify(coverageHash)} ya`,
    `su text "candidate-hash" ob text ${JSON.stringify(candidateHash)} ya`,
    `su text "model" ob text ${JSON.stringify(model)} ya`,
    `su text "status" ob text ${JSON.stringify(status)} ya`,
    `su text "record-count" ob num ${Number(recordCount) || 0} ya`,
    `su text "completed-count" ob num ${Number(completedCount) || 0} ya`,
    `su text "selected-count" ob num ${Number(selectedCount) || 0} ya`,
    `su text "uncertain-count" ob num ${Number(uncertainCount) || 0} ya`,
    `su text "no-fit-count" ob num ${Number(noFitCount) || 0} ya`,
    `su text "skipped-count" ob num ${Number(skippedCount) || 0} ya`,
    ...(error ? [`su text "error" ob text ${JSON.stringify(error)} ya`] : []),
    "prah",
    ""
  ];
  return lines.join("\n");
}

function makeBatches(pending, { claimedSources, config }) {
  const batches = [];
  const skipped = [];
  let current = [];
  let currentSources = new Set();
  const flush = () => {
    if (current.length) batches.push(current);
    current = [];
    currentSources = new Set();
  };
  for (const item of pending) {
    if (item.candidates.length === 0) {
      const onlyCircularGlosses = item.excludedCandidates.length > 0
        && item.excludedCandidates.every((candidate) => candidate.reason === "candidate-definition-repeats-target-lemma");
      skipped.push({
        id: item.id,
        targetId: item.targetId,
        pyac: item.pyac,
        labels: item.labels,
        excludedCandidates: item.excludedCandidates,
        status: "no-fit",
        source: "",
        rationale: onlyCircularGlosses
          ? "Every matching candidate definition repeats its target lemma; circular definitions were withheld."
          : "No direct candidate lemma matches the atom labels or an accepted lemma mapping."
      });
      continue;
    }
    const candidates = item.candidates.filter((candidate) => !claimedSources.has(candidate.source));
    if (!candidates.length) {
      skipped.push({
        id: item.id,
        targetId: item.targetId,
        pyac: item.pyac,
        labels: item.labels,
        status: "uncertain",
        source: "",
        rationale: "All direct candidate senses are already linked or selected for another atom."
      });
      continue;
    }
    const candidateSources = new Set(candidates.map((candidate) => candidate.source));
    const overlaps = [...candidateSources].some((source) => currentSources.has(source));
    const itemEntry = { item, candidates };
    const proposed = [...current, itemEntry];
    const promptSize = buildEnglishWordNetAtomSensePrompt(proposed).length;
    if (current.length && (current.length >= config["batch-max-items"] || overlaps || promptSize > config["batch-max-chars"])) {
      flush();
    }
    const singlePromptSize = buildEnglishWordNetAtomSensePrompt([itemEntry]).length;
    if (singlePromptSize > config["batch-max-chars"]) {
      skipped.push({
        id: item.id,
        targetId: item.targetId,
        pyac: item.pyac,
        labels: item.labels,
        excludedCandidates: item.excludedCandidates,
        status: "uncertain",
        source: "",
        rationale: "Candidate list exceeds the configured safe prompt size."
      });
      continue;
    }
    current.push(itemEntry);
    for (const source of candidateSources) currentSources.add(source);
  }
  flush();
  return { batches, skipped };
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
      const owner = Number((await readFile(filename, "utf8")).trim());
      if (!Number.isSafeInteger(owner) || owner <= 0) throw invalid("atom sense sweep lock has no process identity");
      try {
        process.kill(owner, 0);
        throw invalid("atom sense sweep is already running", { owner });
      } catch (checkError) {
        if (checkError?.code !== "ESRCH") throw checkError;
        await rm(filename, { force: true });
      }
    }
  }
  throw invalid("could not acquire atom sense sweep lock");
}

function countDecisions(rows) {
  return {
    selected: rows.filter((row) => row.status === "select").length,
    uncertain: rows.filter((row) => row.status === "uncertain").length,
    noFit: rows.filter((row) => row.status === "no-fit").length
  };
}

function mergeAtomSenseParse(state, parsed) {
  for (const decision of parsed.valid ? parsed.decisions : parsed.partialDecisions ?? []) {
    state.partialDecisions.set(decision.id, decision);
  }
  const sourceOwners = new Map();
  for (const decision of state.partialDecisions.values()) {
    if (decision.status !== "select" || !decision.source) continue;
    const owner = sourceOwners.get(decision.source);
    if (!owner) {
      sourceOwners.set(decision.source, decision);
      continue;
    }
    for (const conflicted of [owner, decision]) {
      state.partialDecisions.set(conflicted.id, {
        ...conflicted,
        status: "uncertain",
        source: "",
        candidate: null,
        rationale: "Qwen attempts assigned the same WordNet sense to multiple atoms."
      });
    }
  }
  const decisions = [...state.partialDecisions.values()];
  const complete = decisions.length === state.batch.length
    && state.batch.every(({ item }) => state.partialDecisions.has(item.id));
  state.parsed = parsed.valid || complete
    ? { valid: true, decisions: state.batch.map(({ item }) => state.partialDecisions.get(item.id)) }
    : { valid: false, reason: parsed.reason, partialDecisions: decisions };
}

export async function runEnglishWordNetAtomSenseSweep({
  worklist,
  sourceHash,
  coverageHash,
  model,
  artifactDirectory,
  config = DEFAULT_CONFIG,
  submit,
  awaitHandle,
  runId,
  maxBatches = Number.POSITIVE_INFINITY,
  onBatch = () => {},
  onDispatch = () => {}
} = {}) {
  if (!Array.isArray(worklist) || typeof submit !== "function" || typeof awaitHandle !== "function") {
    throw invalid("atom sense sweep requires a worklist, Housekeeper submitter, and await function");
  }
  const candidateHash = hashEnglishWordNetAtomSenseWorklist(worklist);
  const stableRunId = runId || `wordnet-atom-sense-${text(sourceHash).slice(0, 12)}-${text(coverageHash).slice(0, 12)}-${candidateHash.slice(0, 10)}`;
  const directory = artifactDirectory;
  await mkdir(directory, { recursive: true });
  const release = await acquireLock(join(directory, ".atom-sense.lock"));
  const manifestPath = join(directory, "manifest.pya");
  const promptRevision = ENGLISH_WORDNET_ATOM_SENSE_PROMPT_REVISION;
  const completed = new Map();
  const writeProgress = async (status, error = "") => {
    const rows = worklist.map((item) => completed.get(item.id)).filter(Boolean);
    const counts = countDecisions(rows);
    await atomicWrite(manifestPath, renderEnglishWordNetAtomSenseManifestPya({
      runId: stableRunId, sourceHash, coverageHash, candidateHash, model,
      status, recordCount: worklist.length, completedCount: completed.size,
      selectedCount: counts.selected, uncertainCount: counts.uncertain,
      noFitCount: counts.noFit,
      skippedCount: rows.filter((row) => row.status === "uncertain" && !row.source).length,
      promptRevision,
      error: text(error).slice(0, 500)
    }));
  };
  try {
    const files = (await readdir(directory)).filter((name) => /^batch-[0-9]{5}\.pya$/u.test(name)).sort();
    for (const filename of files) {
      const batch = parseEnglishWordNetAtomSenseBatchPya(await readFile(join(directory, filename), "utf8"));
      if (batch.runId !== stableRunId || batch.sourceHash !== sourceHash || batch.coverageHash !== coverageHash
        || batch.candidateHash !== candidateHash || batch.model !== model) {
        throw invalid("existing batch checkpoint belongs to a different atom-sense input snapshot", { filename });
      }
      for (const record of batch.records) {
        if (completed.has(record.id)) throw invalid("atom sense checkpoint repeats a target", { id: record.id });
        completed.set(record.id, record);
      }
    }
    const recoveredAttempts = new Map();
    const attemptFiles = (await readdir(directory)).filter((name) => /^attempt-[0-9]{5}-[0-9]{2}\.pya$/u.test(name)).sort();
    for (const filename of attemptFiles) {
      const attemptBatch = parseEnglishWordNetAtomSenseBatchPya(await readFile(join(directory, filename), "utf8"));
      if (attemptBatch.runId !== stableRunId || attemptBatch.sourceHash !== sourceHash
        || attemptBatch.coverageHash !== coverageHash || attemptBatch.candidateHash !== candidateHash
        || attemptBatch.model !== model) {
        throw invalid("existing attempt checkpoint belongs to a different atom-sense input snapshot", { filename });
      }
      if (attemptBatch.batchIndex <= files.length) continue;
      const previous = recoveredAttempts.get(attemptBatch.batchIndex);
      if (!previous || attemptBatch.attempts.length > previous.attempts.length) {
        recoveredAttempts.set(attemptBatch.batchIndex, attemptBatch);
      }
    }

    const allSources = new Set(worklist.flatMap((item) => item.candidates.map((candidate) => candidate.source)));
    const activeSources = new Set(worklist.flatMap((item) => item.candidates
      .filter((candidate) => (candidate.activeTargetIds ?? []).length > 0)
      .map((candidate) => candidate.source)));
    const selectedSources = new Set();
    for (const row of completed.values()) if (row.status === "select" && row.source) selectedSources.add(row.source);
    const priorDecisionCount = completed.size;
    let batchIndex = files.length;
    let submittedBatchCount = 0;
    let dynamicSkipped = [];
    await writeProgress("running");

    while (completed.size < worklist.length && submittedBatchCount < maxBatches) {
      const claimedSources = new Set([...activeSources, ...selectedSources]);
      const pending = worklist.filter((item) => !completed.has(item.id));
      const { batches, skipped } = makeBatches(pending, { claimedSources, config });
      dynamicSkipped = skipped;
      if (batches.length === 0) {
        const records = skipped.filter((row) => !completed.has(row.id));
        if (!records.length) break;
        batchIndex += 1;
        const artifact = renderEnglishWordNetAtomSenseBatchPya({
          runId: stableRunId, sourceHash, coverageHash, candidateHash,
          batchIndex, model, prompt: "", records, attempts: []
        });
        await atomicWrite(join(directory, `batch-${String(batchIndex).padStart(5, "0")}.pya`), artifact);
        for (const record of records) completed.set(record.id, record);
        await writeProgress("running");
        await onBatch({ batchIndex, batchCount: null, decisions: records, skipped: true, reused: false });
        continue;
      }
      const wave = [];
      const waveSources = new Set(claimedSources);
      const waveLimit = Math.min(config.parallelism ?? 1, maxBatches - submittedBatchCount);
      for (const candidateBatch of batches) {
        if (wave.length >= waveLimit) break;
        const sources = candidateBatch.flatMap(({ candidates }) => candidates.map((candidate) => candidate.source));
        if (sources.some((source) => waveSources.has(source))) continue;
        const nextBatchIndex = batchIndex + wave.length + 1;
        const prompt = buildEnglishWordNetAtomSensePrompt(candidateBatch);
        const recovered = recoveredAttempts.get(nextBatchIndex);
        if (recovered && recovered.prompt !== prompt) {
          throw invalid("saved attempt prompt no longer matches the resumed batch", { batchIndex: nextBatchIndex });
        }
        const attempts = recovered?.attempts ?? [];
        const state = {
          batch: candidateBatch,
          batchIndex: nextBatchIndex,
          prompt,
          attempts,
          partialDecisions: new Map(),
          parsed: { valid: false, reason: "not submitted" }
        };
        for (const attempt of attempts) {
          if (attempt.response) mergeAtomSenseParse(state, parseEnglishWordNetAtomSenseResponse(attempt.response, candidateBatch));
          else if (attempt.error && !state.parsed.valid) state.parsed.reason = attempt.error;
        }
        if (attempts.at(-1)?.status === "submitted" && !state.parsed.valid) {
          state.parsed.reason = "awaiting recovered Housekeeper job";
        }
        wave.push(state);
        for (const source of sources) waveSources.add(source);
      }
      if (!wave.length) throw invalid("atom sense sweep could not construct a non-overlapping dispatch wave");
      await onDispatch({
        firstBatchIndex: wave[0].batchIndex,
        lastBatchIndex: wave.at(-1).batchIndex,
        count: wave.length
      });

      const persistAttempts = async (state) => {
        const attempt = state.attempts.at(-1)?.attempt ?? 1;
        await atomicWrite(join(directory, `attempt-${String(state.batchIndex).padStart(5, "0")}-${String(attempt).padStart(2, "0")}.pya`), renderEnglishWordNetAtomSenseBatchPya({
          runId: stableRunId, sourceHash, coverageHash, candidateHash,
          batchIndex: state.batchIndex, model, prompt: state.prompt, records: [], attempts: state.attempts
        }));
      };
      const queueAttempt = async (state) => {
        const attempt = state.attempts.length + 1;
        const handleId = `${stableRunId}-batch-${String(state.batchIndex).padStart(5, "0")}-attempt-${attempt}`;
        const requestPrompt = attempt === 1
          ? state.prompt
          : `${state.prompt}\nPrevious output failed validation: ${state.parsed.reason}. Return a complete corrected decisions array for exactly these ids.`;
        try {
          const submitted = await submit({
            handleId,
            prompt: requestPrompt,
            responseFormat: ENGLISH_WORDNET_ATOM_SENSE_RESPONSE_FORMAT,
            maxOutputTokens: config["max-output-tokens"]
          });
          state.attempts.push({ attempt, handleId: submitted?.handleId ?? handleId, status: "submitted" });
        } catch (error) {
          const detail = text(error?.message ?? error).slice(0, 500);
          state.attempts.push({ attempt, handleId, status: "failed", response: "", error: detail });
          state.parsed = { valid: false, reason: detail || "Housekeeper submission failed" };
        }
        await persistAttempts(state);
      };

      // Queue all first attempts in the wave before awaiting results. This lets Housekeeper
      // schedule the bounded wave across available workers while Pyash calls stay ordered.
      for (const state of wave) {
        const last = state.attempts.at(-1);
        if (!state.parsed.valid && last?.status !== "submitted"
          && state.attempts.length < config["max-attempts"]) {
          await queueAttempt(state);
        }
      }

      const outcomes = [];
      for (const state of wave) {
        while (!state.parsed.valid) {
          const last = state.attempts.at(-1);
          if (last?.status === "submitted") {
            try {
              last.response = String(await awaitHandle(last.handleId) ?? "");
              last.status = "complete";
              mergeAtomSenseParse(state, parseEnglishWordNetAtomSenseResponse(last.response, state.batch));
            } catch (error) {
              last.error = text(error?.message ?? error).slice(0, 500);
              last.status = "failed";
              state.parsed = {
                valid: false,
                reason: last.error || "Housekeeper duty failed",
                partialDecisions: [...state.partialDecisions.values()]
              };
            }
            await persistAttempts(state);
            await writeProgress("running");
            if (state.parsed.valid) break;
          }
          if (state.attempts.length >= config["max-attempts"]) break;
          await queueAttempt(state);
        }
        const partial = new Map((state.parsed.partialDecisions ?? []).map((row) => [row.id, row]));
        const decisions = state.parsed.valid
          ? state.parsed.decisions
          : state.batch.map(({ item }) => partial.get(item.id) ?? ({
            id: item.id,
            targetId: item.targetId,
            pyac: item.pyac,
            labels: item.labels,
            status: "uncertain",
            source: "",
            rationale: `Qwen response failed bounded validation: ${state.parsed.reason}.`
          }));
        outcomes.push({ ...state, decisions });
      }

      const waveSelectedSources = new Set();
      for (const outcome of outcomes) {
        const duplicate = outcome.decisions.find((row) => row.status === "select"
          && (claimedSources.has(row.source) || waveSelectedSources.has(row.source)));
        if (duplicate) throw invalid("a selected WordNet sense was already linked to a different atom", { id: duplicate.id, source: duplicate.source });
        for (const row of outcome.decisions) if (row.status === "select" && row.source) waveSelectedSources.add(row.source);
        const records = outcome.decisions.map((row) => ({ ...row }));
        await atomicWrite(join(directory, `batch-${String(outcome.batchIndex).padStart(5, "0")}.pya`), renderEnglishWordNetAtomSenseBatchPya({
          runId: stableRunId, sourceHash, coverageHash, candidateHash,
          batchIndex: outcome.batchIndex, model, prompt: outcome.prompt, records, attempts: outcome.attempts
        }));
        for (const record of records) {
          completed.set(record.id, record);
          if (record.status === "select" && record.source) selectedSources.add(record.source);
        }
        batchIndex = outcome.batchIndex;
        submittedBatchCount += 1;
        await writeProgress("running");
        await onBatch({ batchIndex, batchCount: null, decisions: records, skipped: false, reused: false });
      }
    }

    const records = worklist.map((item) => completed.get(item.id)).filter(Boolean);
    const counts = countDecisions(records);
    const status = completed.size === worklist.length ? "complete" : "paused";
    await writeProgress(status);
    return {
      runId: stableRunId,
      artifactDirectory: directory,
      manifestPath,
      sourceHash,
      coverageHash,
      candidateHash,
      model,
      status,
      recordCount: worklist.length,
      completedCount: completed.size,
      resumedCount: priorDecisionCount,
      submittedBatchCount,
      parallelism: config.parallelism ?? 1,
      ...counts,
      skippedCount: records.filter((row) => row.status === "uncertain" && !row.source).length,
      records,
      remainingCount: Math.max(0, worklist.length - completed.size),
      remainingSources: [...allSources].filter((source) => !selectedSources.has(source)).length,
      dynamicSkippedCount: dynamicSkipped.length
    };
  } catch (error) {
    try {
      await writeProgress("error", error?.message ?? error);
    } catch {
      // Preserve the original failure if artifact persistence also fails.
    }
    throw error;
  } finally {
    await release();
  }
}

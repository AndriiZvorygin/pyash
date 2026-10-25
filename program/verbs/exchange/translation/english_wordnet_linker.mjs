import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { buildProgram } from "../../../program.mjs";
import {
  buildTranslationVocabularyInventory,
  createQueuedMindTranslationVocabularySubmitter
} from "./translation_vocabulary_queue.mjs";
import { extractBoundedJsonObject } from "./english_verification.mjs";

export const ENGLISH_WORDNET_LINKER_FORMAT = "english-wordnet-linker-v1";
export const ENGLISH_WORDNET_LINKER_NAME = "translation_english_wordnet_linker";
export const ENGLISH_WORDNET_LINKER_CONFIG_URL = new URL("./english_wordnet_linker.pya", import.meta.url);
export const ENGLISH_WORDNET_LINKER_QUEUE_INTENT = "mind";
export const ENGLISH_WORDNET_LINKER_QUEUE_LANE = "durable";
export const ENGLISH_WORDNET_LINKER_DEFAULT_BATCH_SIZE = 200;
export const ENGLISH_WORDNET_LINKER_RESPONSE_FORMAT = Object.freeze({
  type: "object",
  required: ["verdict", "senses"],
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["complete", "partial", "uncertain"] },
    senses: {
      minItems: 1,
      type: "array",
      items: {
        type: "object",
        required: ["id", "status", "rationale"],
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          status: { type: "string", enum: ["accept", "reject", "uncertain"] },
          target: { type: "string" },
          pyashSequence: { type: "array", items: { type: "string" } },
          rationale: { type: "string" }
        }
      }
    }
  }
});

const ACCEPTED_STATUSES = new Set(["accepted-existing", "accepted-deterministic", "accepted-llm"]);
const LINK_STATUSES = new Set(["accept", "reject", "uncertain"]);
const MAX_RATIONALE_CHARS = 1200;
const WORDNET_POS = new Set(["a", "n", "r", "s", "v"]);

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-english-wordnet-linker";
  error.details = details;
  return error;
}

function text(value) {
  return typeof value === "string" ? value.normalize("NFC").trim() : "";
}

function normalized(value) {
  return text(value).toLowerCase().replace(/[ _-]+/gu, " ").replace(/\s+/gu, " ");
}

function hash(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function senseKey(pos, synset) {
  return `${pos}:${synset}`;
}

function senseId(source) {
  return `english-wordnet-sense-${hash(source).slice(0, 24)}`;
}

function sequence(value) {
  if (Array.isArray(value)) {
    return value.filter((word) => typeof word === "string" && word.trim()).map((word) => word.trim());
  }
  return typeof value === "string" && value.trim() ? [value.trim()] : [];
}

function sequenceKey(value) {
  return sequence(value).join(" ");
}

function sameSequence(left, right) {
  return sequenceKey(left) === sequenceKey(right);
}

function candidateId(record, target, pyashSequence) {
  return `${record.id}::${normalized(target)}::${sequenceKey(pyashSequence)}`;
}

function sourceTermSet(sourceTerms) {
  return new Set((Array.isArray(sourceTerms) ? sourceTerms : sourceTerms ? [sourceTerms] : [])
    .map(normalized)
    .filter(Boolean));
}

function sourceMatches(lemmas, terms) {
  if (terms.size === 0) return true;
  return lemmas.some((lemma) => terms.has(normalized(lemma)));
}

function bridgeFor(wordnetIndex, source, resolveWord) {
  const bridge = wordnetIndex?.bridgeIndex?.get(source);
  if (!bridge) return null;
  const coverage = typeof resolveWord === "function" ? resolveWord(bridge.target) : null;
  const pyashSequence = sequence(bridge.pyashSequence).length > 0
    ? sequence(bridge.pyashSequence)
    : sequence(coverage?.pyashSequence);
  return {
    target: normalized(bridge.target),
    pyashSequence,
    targetPartOfSpeech: text(bridge.targetPartOfSpeech),
    certainty: text(bridge.certainty) || "contextual",
    evidence: text(bridge.evidence)
  };
}

function linkCandidate(record, target, pyashSequence, {
  targetPartOfSpeech = record.pos,
  certainty = "contextual",
  evidence = ""
} = {}) {
  const targetName = normalized(target);
  const words = sequence(pyashSequence);
  if (!targetName || words.length === 0) return null;
  return {
    id: candidateId(record, targetName, words),
    target: targetName,
    pyashSequence: words,
    targetPartOfSpeech: text(targetPartOfSpeech) || record.pos,
    certainty: text(certainty) || "contextual",
    evidence: text(evidence)
  };
}

function directCandidates(record, resolveWord) {
  if (typeof resolveWord !== "function") return [];
  const candidates = new Map();
  for (const lemma of record.lemmas) {
    const coverage = resolveWord(lemma);
    if (!coverage?.pyashSequence?.length || coverage.coverageType === "dictionary-alias") continue;
    const candidate = linkCandidate(record, coverage.canonicalEnglish || lemma, coverage.pyashSequence, {
      targetPartOfSpeech: record.pos,
      certainty: "deterministic",
      evidence: `existing Pyash coverage for WordNet lemma ${lemma}`
    });
    if (candidate) candidates.set(sequenceKey(candidate.pyashSequence), candidate);
  }
  return [...candidates.values()];
}

function rowsForWordNetIndex(wordnetIndex) {
  if (!(wordnetIndex?.bySynset instanceof Map)) {
    throw invalid("WordNet linker requires an indexed WordNet resource");
  }
  return [...wordnetIndex.bySynset.entries()]
    .map(([key, rows]) => ({ key, rows: Array.isArray(rows) ? rows : [] }))
    .filter(({ key, rows }) => WORDNET_POS.has(key.slice(0, 1)) && key[1] === ":" && rows.length > 0)
    .sort((left, right) => left.key.localeCompare(right.key));
}

export function buildEnglishWordNetSenseLinkRecords({
  wordnetIndex,
  resolveWord,
  sourceTerms = [],
  limit = ENGLISH_WORDNET_LINKER_DEFAULT_BATCH_SIZE
} = {}) {
  const terms = sourceTermSet(sourceTerms);
  const max = Math.max(1, Math.trunc(Number(limit) || ENGLISH_WORDNET_LINKER_DEFAULT_BATCH_SIZE));
  const records = [];
  for (const { key, rows } of rowsForWordNetIndex(wordnetIndex)) {
    const pos = key.slice(0, 1);
    const synset = key.slice(2);
    const lemmas = [...new Set(rows.map((row) => normalized(row?.lemma)).filter(Boolean))].sort();
    if (!sourceMatches(lemmas, terms)) continue;
    const gloss = text(rows.map((row) => row?.gloss).find(Boolean));
    const id = senseId(key);
    const record = {
      id,
      source: key,
      pos,
      synset,
      lemmas,
      gloss,
      candidates: []
    };
    const existing = bridgeFor(wordnetIndex, key, resolveWord);
    if (existing?.target && existing.pyashSequence.length > 0) {
      record.status = "accepted-existing";
      record.link = existing;
    } else {
      record.candidates = directCandidates(record, resolveWord);
      if (record.candidates.length === 1) {
        record.status = "accepted-deterministic";
        record.link = record.candidates[0];
      } else {
        record.status = "review";
      }
    }
    records.push(record);
    if (records.length >= max) break;
  }
  return records;
}

function inventoryRowKey(row) {
  return `${normalized(row?.english)}\u0000${sequenceKey(row?.pyash)}`;
}

export function buildEnglishWordNetSenseLinkInventory({
  records = [],
  grammarEntries = [],
  anchors = [],
  baseInventory
} = {}) {
  const inventory = baseInventory ?? buildTranslationVocabularyInventory({
    sourceText: records.map((record) => `${record.gloss} ${record.lemmas.join(" ")}`).join(" "),
    candidates: records.map((record) => ({
      surface: record.lemmas.join(" "),
      context: [record.gloss]
    })),
    grammarEntries
  });
  const rows = [...(inventory.entries ?? [])];
  const seen = new Set(rows.map(inventoryRowKey));
  for (const anchor of [
    ...records.flatMap((record) => record.candidates ?? []),
    ...anchors
  ]) {
    const row = {
      english: anchor?.target ?? anchor?.english,
      pyash: anchor?.pyashSequence ?? anchor?.pyash
    };
    if (!normalized(row.english) || sequence(row.pyash).length === 0) continue;
    const key = inventoryRowKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ english: normalized(row.english), pyash: sequence(row.pyash) });
  }
  return {
    entries: rows.slice(0, 2800),
    grammar: [...(inventory.grammar ?? [])]
  };
}

export function buildEnglishWordNetSenseLinkPrompt({
  records = [],
  inventory = { entries: [], grammar: [] },
  source = "Open English WordNet"
} = {}) {
  if (!Array.isArray(records) || records.length === 0) {
    throw invalid("WordNet linker prompt requires sense records");
  }
  if (!Array.isArray(inventory.entries)) throw invalid("WordNet linker prompt requires an atom inventory");
  const senseRows = records.map((record) => JSON.stringify({
    id: record.id,
    source: record.source,
    partOfSpeech: record.pos,
    gloss: record.gloss,
    lemmas: record.lemmas,
    deterministicCandidates: record.candidates ?? []
  })).join("\n");
  return [
    "You are the bounded Pyash WordNet sense-linking worker.",
    "Link each supplied WordNet sense to one existing Pyash English anchor when the evidence supports it.",
    "Use the gloss, lemmas, and deterministic candidates as semantic evidence.",
    "Choose an anchor only from the supplied authoritative inventory.",
    "For an accepted link, target must be the exact English inventory key, never a Pyash token.",
    "Copy pyashSequence exactly from that inventory entry; do not put the Pyash token in target.",
    "Preserve uncertainty when the inventory or sense evidence is insufficient.",
    "A link selects an existing atom, accepted compound, or accepted lexical mapping; it does not create vocabulary.",
    "Return exactly one JSON object with this shape:",
    '{"verdict":"complete|partial|uncertain","senses":[{"id":"...","status":"accept|reject|uncertain","target":"...","pyashSequence":["..."],"rationale":"..."}]}',
    "Include exactly one result for every supplied sense id. Never return an empty senses array.",
    "For reject or uncertain, omit target and pyashSequence.",
    `SOURCE: ${text(source) || "Open English WordNet"}`,
    "AUTHORITATIVE PYASH ATOM AND COMPOUND INVENTORY:",
    inventory.entries.map(JSON.stringify).join("\n"),
    "AUTHORITATIVE PYASH GRAMMAR INVENTORY:",
    inventory.grammar.map(JSON.stringify).join("\n"),
    "WORDNET SENSES:",
    senseRows
  ].join("\n");
}

export function wordNetSenseLinkQueueHandle({ sourceHash, records = [], attempt = 1 } = {}) {
  const source = text(sourceHash);
  const ids = records.map((record) => text(record?.id)).filter(Boolean).sort().join("\u0000");
  if (!source || !ids) throw invalid("WordNet linker queue handle requires source hash and records");
  const retry = Math.max(1, Math.trunc(Number(attempt) || 1));
  return `english-wordnet-link-${hash(`${source}\u0000${ids}`).slice(0, 24)}${retry > 1 ? `-retry-${retry}` : ""}`;
}

export async function submitEnglishWordNetSenseLinks({
  records = [],
  inventory,
  sourceHash,
  source = "Open English WordNet",
  submit,
  attempt = 1
} = {}) {
  if (!Array.isArray(records)) throw invalid("WordNet linker records must be an array");
  const pending = records.filter((record) => !ACCEPTED_STATUSES.has(record?.status));
  if (pending.length === 0) return { submitted: false, records: [...records], pending: [] };
  if (typeof submit !== "function") throw invalid("WordNet linker requires a queue submitter");
  const handleId = wordNetSenseLinkQueueHandle({ sourceHash, records: pending, attempt });
  const prompt = buildEnglishWordNetSenseLinkPrompt({ records: pending, inventory, source });
  const response = await submit({
    handleId,
    prompt,
    candidates: pending,
    inventory,
    sourceHash
  });
  const status = text(response?.status || response?.ob?.text).toLowerCase();
  if (status !== "queued") {
    throw invalid("WordNet linker queue submission was not accepted", { handleId, response });
  }
  const queue = {
    handleId,
    status: "queued",
    intent: ENGLISH_WORDNET_LINKER_QUEUE_INTENT,
    lane: ENGLISH_WORDNET_LINKER_QUEUE_LANE,
    attempt: Math.max(1, Math.trunc(Number(attempt) || 1)),
    senseCount: pending.length
  };
  const pendingIds = new Set(pending.map((record) => record.id));
  return {
    submitted: true,
    handleId,
    prompt,
    response,
    queue,
    pending,
    records: records.map((record) => pendingIds.has(record.id) ? { ...record, queue } : { ...record })
  };
}

function inventoryMatch({ target, pyashSequence, record, inventory }) {
  const targetName = normalized(target);
  const words = sequence(pyashSequence);
  const options = [
    ...(record?.candidates ?? []),
    ...(inventory?.entries ?? [])
  ];
  return options.find((option) => (
    normalized(option?.target ?? option?.english) === targetName
    && sameSequence(option?.pyashSequence ?? option?.pyash, words)
  )) ?? null;
}

function providerResponseText(value) {
  if (value && typeof value === "object" && typeof value.response === "string") {
    return value.response;
  }
  const raw = String(value ?? "");
  try {
    const envelope = JSON.parse(raw);
    if (envelope && typeof envelope.response === "string") return envelope.response;
  } catch {
    // The bounded extractor below handles direct or noisy provider text.
  }
  return raw;
}

export function parseEnglishWordNetSenseLinkResponse(value, { records = [], inventory } = {}) {
  const raw = providerResponseText(value);
  const payload = extractBoundedJsonObject(raw);
  if (!payload) return { valid: false, reason: "response did not contain one bounded JSON object" };
  const verdict = text(payload.verdict).toLowerCase();
  if (!["complete", "partial", "uncertain"].includes(verdict)) {
    return { valid: false, reason: "response verdict must be complete, partial, or uncertain" };
  }
  if (!Array.isArray(payload.senses)) return { valid: false, reason: "response senses must be an array" };
  if (records.length > 0 && payload.senses.length === 0) {
    return { valid: false, reason: "response senses must contain at least one decision" };
  }
  const byId = new Map(records.map((record) => [record.id, record]));
  const seen = new Set();
  const links = [];
  for (const row of payload.senses) {
    const id = text(row?.id);
    if (!id || !byId.has(id) || seen.has(id)) return { valid: false, reason: "response contains an unknown or duplicated sense id" };
    seen.add(id);
    const status = text(row?.status).toLowerCase();
    if (!LINK_STATUSES.has(status)) return { valid: false, reason: "sense status must be accept, reject, or uncertain" };
    const rationale = text(row?.rationale);
    if (!rationale) return { valid: false, reason: "sense rationale is empty" };
    if (rationale.length > MAX_RATIONALE_CHARS) return { valid: false, reason: "sense rationale exceeds the bounded limit" };
    if (status === "accept") {
      const target = normalized(row?.target);
      const pyashSequence = sequence(row?.pyashSequence);
      if (!target || pyashSequence.length === 0) return { valid: false, reason: "accepted sense requires target and Pyash sequence" };
      const match = inventoryMatch({ target, pyashSequence, record: byId.get(id), inventory });
      if (!match) return { valid: false, reason: "accepted sense target is outside the supplied inventory" };
      links.push({
        id,
        status,
        target,
        pyashSequence,
        targetPartOfSpeech: byId.get(id).pos,
        certainty: "contextual",
        rationale,
        evidence: `Housekeeper WordNet sense link: ${rationale}`
      });
    } else {
      links.push({ id, status, rationale });
    }
  }
  return { valid: true, verdict, links, raw };
}

export function applyEnglishWordNetSenseLinkResponse(records, response) {
  if (!Array.isArray(records)) throw invalid("WordNet linker apply requires records");
  if (!response?.valid || !Array.isArray(response.links)) throw invalid("WordNet linker apply requires a valid response");
  const byId = new Map(response.links.map((link) => [link.id, link]));
  const updated = records.map((record) => {
    const link = byId.get(record.id);
    if (!link) return { ...record };
    if (link.status === "accept") {
      return {
        ...record,
        status: "accepted-llm",
        link: {
          target: link.target,
          pyashSequence: [...link.pyashSequence],
          targetPartOfSpeech: link.targetPartOfSpeech,
          certainty: link.certainty,
          evidence: link.evidence
        },
        verificationRationale: link.rationale
      };
    }
    return {
      ...record,
      status: link.status === "reject" ? "rejected-llm" : "uncertain-llm",
      verificationRationale: link.rationale
    };
  });
  return {
    records: updated,
    accepted: updated.filter((record) => ACCEPTED_STATUSES.has(record.status)),
    rejected: updated.filter((record) => record.status === "rejected-llm"),
    uncertain: updated.filter((record) => record.status === "uncertain-llm" || record.status === "review")
  };
}

function renderTargetName(value) {
  const target = normalized(value);
  if (!target || !/^[a-z0-9][a-z0-9_-]*(?: [a-z0-9][a-z0-9_-]*)*$/iu.test(target)) {
    throw invalid("WordNet bridge target cannot be rendered as a Pyash name", { target: value });
  }
  return target;
}

export function renderEnglishWordNetSenseLinksPya({
  records = [],
  source = "Open English WordNet",
  sourceHash = "",
  name = "translation_english_wordnet_bridges"
} = {}) {
  const accepted = records
    .filter((record) => ACCEPTED_STATUSES.has(record?.status) && record?.link?.target && sequence(record.link.pyashSequence).length > 0)
    .sort((left, right) => left.source.localeCompare(right.source));
  const seen = new Set();
  const lines = [
    `su name ${name} be map def`,
    `su text "format" ob text ${JSON.stringify("english-wordnet-bridge-v1")} ya`,
    `su text "source" ob text ${JSON.stringify(source)} ya`,
    `su text "source-hash" ob text ${JSON.stringify(sourceHash)} ya`,
    `su text "mode" ob text ${JSON.stringify("sense-level semantic bridge")} ya`
  ];
  for (const record of accepted) {
    if (seen.has(record.source)) continue;
    seen.add(record.source);
    const target = renderTargetName(record.link.target);
    const certainty = record.status === "accepted-deterministic" ? "deterministic" : "contextual";
    const evidence = record.link.evidence || record.evidence || `WordNet ${record.source} accepted anchor ${target}`;
    lines.push(`su text ${JSON.stringify(record.source)} ob name ${target} as text ${JSON.stringify(record.pos)} with text ${JSON.stringify(certainty)} via text ${JSON.stringify(evidence)} ya`);
  }
  lines.push("prah");
  return `${lines.join("\n")}\n`;
}

export function parseEnglishWordNetLinkerConfig(source) {
  if (typeof source !== "string") throw invalid("WordNet linker configuration must be text");
  const sentences = buildProgram(source).sentences;
  const header = sentences.find((sentence) => (
    sentence?.mood === "def"
      && sentence?.be === "map"
      && sentence?.su?.name === ENGLISH_WORDNET_LINKER_NAME
  ));
  if (!header) throw invalid("WordNet linker configuration has no canonical map header");
  const metadata = {};
  for (const sentence of sentences) {
    if (sentence?.mood !== "ya" || typeof sentence.su?.text !== "string") continue;
    if (typeof sentence.ob?.text === "string") metadata[sentence.su.text] = sentence.ob.text;
    if (Number.isInteger(sentence.ob?.num)) metadata[sentence.su.text] = sentence.ob.num;
  }
  if (metadata.format !== ENGLISH_WORDNET_LINKER_FORMAT) {
    throw invalid("WordNet linker configuration has an unsupported format", { format: metadata.format });
  }
  return {
    format: metadata.format,
    queueIntent: metadata["queue-intent"] || ENGLISH_WORDNET_LINKER_QUEUE_INTENT,
    queueLane: metadata["queue-lane"] || ENGLISH_WORDNET_LINKER_QUEUE_LANE,
    maxBatch: Math.max(1, Math.trunc(Number(metadata["max-batch"]) || ENGLISH_WORDNET_LINKER_DEFAULT_BATCH_SIZE))
  };
}

export async function loadEnglishWordNetLinkerConfig({ configUrl = ENGLISH_WORDNET_LINKER_CONFIG_URL } = {}) {
  return parseEnglishWordNetLinkerConfig(await readFile(configUrl, "utf8"));
}

export function createQueuedMindEnglishWordNetSenseLinkSubmitter(options = {}) {
  return createQueuedMindTranslationVocabularySubmitter({
    ...options,
    responseFormat: ENGLISH_WORDNET_LINKER_RESPONSE_FORMAT
  });
}

export async function createDefaultQueuedMindEnglishWordNetSenseLinkSubmitter(options = {}) {
  const [{ interpret }, { parse }] = await Promise.all([
    import("../../../bridge/index.mjs"),
    import("../../../understand/index.mjs")
  ]);
  return createQueuedMindEnglishWordNetSenseLinkSubmitter({ interpret, parse, ...options });
}

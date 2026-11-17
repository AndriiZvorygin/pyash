import { createReadStream } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";

import { buildProgram } from "../../program.mjs";

export const ENGLISH_WORDNET_COMPOUND_DECISIONS_NAME = "translation_wordnet_compound_decisions";
export const ENGLISH_WORDNET_COMPOUND_DECISIONS_URL = new URL("./english_wordnet_compound_decisions.pya", import.meta.url);
const DECISION_STATUSES = new Set([
  "accepted-deterministic",
  "accepted-llm",
  "repaired-llm",
  "not-selected-llm",
  "rejected-deterministic",
  "rejected-llm",
  "uncertain-llm"
]);

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-english-wordnet-compound-decisions";
  error.details = details;
  return error;
}

export function parseEnglishWordNetCompoundDecisions(source) {
  if (typeof source !== "string") throw invalid("WordNet compound decisions must be Pyash text");
  const sentences = buildProgram(source).sentences;
  const header = sentences.find((sentence) => sentence?.mood === "def"
    && sentence?.be === "map"
    && sentence?.su?.name === ENGLISH_WORDNET_COMPOUND_DECISIONS_NAME);
  if (!header) throw invalid("WordNet compound decisions have no canonical map header");
  const rowsById = new Map();
  for (const [index, sentence] of sentences.entries()) {
    if (sentence?.mood !== "ya" || typeof sentence.su?.text !== "string") continue;
    const id = sentence.su.text;
    if (typeof sentence.ob?.text !== "string") throw invalid("WordNet compound decision row requires JSON text", { index, id });
    let record;
    try {
      record = JSON.parse(sentence.ob.text);
    } catch (error) {
      throw invalid("WordNet compound decision row contains malformed JSON", { index, id, cause: error.message });
    }
    rowsById.set(id, normalizeDecisionRecord(record, id, index));
  }
  return decisionState(rowsById);
}

function normalizeDecisionRecord(record, id, index = 0) {
  const status = DECISION_STATUSES.has(record?.status)
    ? record.status
    : record?.verificationStatus;
  if (record?.candidateId !== id
    || !DECISION_STATUSES.has(status)
    || typeof record.target !== "string"
    || !Array.isArray(record.pyashSequence)
    || record.pyashSequence.length < 2
    || record.pyashSequence.length > 3) {
    throw invalid("WordNet compound decision record has an invalid identity, status, target, or sequence", { index, id });
  }
  return {
    ...record,
    ...(record.status !== status ? { coverageStatus: record.coverageStatus ?? record.status } : {}),
    status
  };
}

function decisionState(rowsById) {
  const rows = [...rowsById.values()].sort((left, right) => left.candidateId.localeCompare(right.candidateId));
  return { format: "english-wordnet-compound-decisions-v1", rows, byId: new Map(rows.map((row) => [row.candidateId, row])) };
}

export function renderEnglishWordNetCompoundDecisionAppend(record) {
  const id = String(record?.candidateId ?? "").trim();
  const status = DECISION_STATUSES.has(record?.status) ? record.status : record?.verificationStatus;
  if (!id || record?.candidateId !== id
    || !DECISION_STATUSES.has(status)
    || typeof record?.target !== "string"
    || !Array.isArray(record.pyashSequence)
    || record.pyashSequence.length < 2
    || record.pyashSequence.length > 3) {
    throw invalid("WordNet compound decision append has an invalid identity, status, target, or sequence", { id });
  }
  return `su text ${JSON.stringify(id)} ob text ${JSON.stringify(JSON.stringify(record))} ya\nprah\n`;
}

export function renderEnglishWordNetCompoundDecisions(records = []) {
  if (!Array.isArray(records)) throw invalid("WordNet compound decision renderer requires rows");
  const lines = [`su name ${ENGLISH_WORDNET_COMPOUND_DECISIONS_NAME} be map def`];
  const seen = new Set();
  for (const record of [...records].sort((left, right) => left.candidateId.localeCompare(right.candidateId))) {
    const id = String(record?.candidateId ?? "").trim();
    if (!id || seen.has(id)) throw invalid("WordNet compound decision identity is empty or duplicated", { id });
    seen.add(id);
    lines.push(`su text ${JSON.stringify(id)} ob text ${JSON.stringify(JSON.stringify(record))} ya`);
  }
  lines.push("prah", "");
  return lines.join("\n");
}

export async function loadEnglishWordNetCompoundDecisions({ url = ENGLISH_WORDNET_COMPOUND_DECISIONS_URL } = {}) {
  return parseEnglishWordNetCompoundDecisions(await readFile(url, "utf8"));
}

export async function createEnglishWordNetCompoundDecisionOffsetIndex({ url = ENGLISH_WORDNET_COMPOUND_DECISIONS_URL } = {}) {
  const metadata = await stat(url);
  const offsetsById = new Map();
  const input = createReadStream(url);
  let pending = Buffer.alloc(0);
  let pendingOffset = 0;
  let hasHeader = false;
  const indexLine = (lineBytes, offset) => {
    const line = lineBytes.at(-1) === 0x0d ? lineBytes.subarray(0, -1) : lineBytes;
    const sentences = buildProgram(line.toString("utf8")).sentences;
    for (const sentence of sentences) {
      if (sentence?.mood === "def" && sentence?.be === "map"
        && sentence?.su?.name === ENGLISH_WORDNET_COMPOUND_DECISIONS_NAME) {
        hasHeader = true;
        continue;
      }
      if (sentence?.mood !== "ya" || typeof sentence.su?.text !== "string") continue;
      offsetsById.set(sentence.su.text, { offset, length: lineBytes.length });
    }
  };
  for await (const chunk of input) {
    const data = pending.length > 0 ? Buffer.concat([pending, chunk]) : chunk;
    let start = 0;
    while (true) {
      const newline = data.indexOf(0x0a, start);
      if (newline < 0) break;
      indexLine(data.subarray(start, newline), pendingOffset + start);
      start = newline + 1;
    }
    pending = Buffer.from(data.subarray(start));
    pendingOffset += start;
  }
  if (pending.length > 0) indexLine(pending, pendingOffset);
  if (!hasHeader) throw invalid("WordNet compound decisions have no canonical map header");

  return {
    size: metadata.size,
    async load(candidateIds = []) {
      const rowsById = new Map();
      const handle = await open(url, "r");
      try {
        for (const id of new Set(candidateIds.map((value) => String(value ?? "").trim()).filter(Boolean))) {
          const location = offsetsById.get(id);
          if (!location) continue;
          const bytes = Buffer.alloc(location.length);
          const { bytesRead } = await handle.read(bytes, 0, bytes.length, location.offset);
          if (bytesRead !== location.length) throw invalid("WordNet compound decision index points outside the ledger", { id });
          const sentence = buildProgram(bytes.toString("utf8")).sentences.find((row) => row?.mood === "ya" && row?.su?.text === id);
          if (typeof sentence?.ob?.text !== "string") throw invalid("WordNet compound decision row requires JSON text", { id });
          let record;
          try {
            record = JSON.parse(sentence.ob.text);
          } catch (error) {
            throw invalid("WordNet compound decision row contains malformed JSON", { id, cause: error.message });
          }
          rowsById.set(id, normalizeDecisionRecord(record, id));
        }
      } finally {
        await handle.close();
      }
      return decisionState(rowsById);
    },
    noteAppended(records = [], startingOffset = metadata.size) {
      let offset = startingOffset;
      for (const record of records) {
        const rendered = renderEnglishWordNetCompoundDecisionAppend(record);
        const rowLineEnd = rendered.indexOf("\n") + 1;
        const rowLength = Buffer.byteLength(rendered.slice(0, rowLineEnd));
        offsetsById.set(record.candidateId, { offset, length: rowLength });
        offset += Buffer.byteLength(rendered);
      }
      this.size = offset;
    }
  };
}

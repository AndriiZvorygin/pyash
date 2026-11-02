import { readFile } from "node:fs/promises";

import { buildProgram } from "../../program.mjs";

export const ENGLISH_WORDNET_COMPOUND_DECISIONS_NAME = "translation_wordnet_compound_decisions";
export const ENGLISH_WORDNET_COMPOUND_DECISIONS_URL = new URL("./english_wordnet_compound_decisions.pya", import.meta.url);
const DECISION_STATUSES = new Set([
  "accepted-deterministic",
  "accepted-llm",
  "repaired-llm",
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
  const rows = [];
  const seen = new Set();
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
    if (seen.has(id)) throw invalid("WordNet compound candidate decision is duplicated", { index, id });
    seen.add(id);
    rows.push({
      ...record,
      ...(record.status !== status ? { coverageStatus: record.coverageStatus ?? record.status } : {}),
      status
    });
  }
  return { format: "english-wordnet-compound-decisions-v1", rows, byId: new Map(rows.map((row) => [row.candidateId, row])) };
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

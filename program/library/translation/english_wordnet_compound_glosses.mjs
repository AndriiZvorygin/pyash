import { readFile, rename, rm, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { buildProgram } from "../../program.mjs";

export const ENGLISH_WORDNET_COMPOUND_GLOSSES_NAME = "translation_wordnet_compound_sense_glosses";
export const ENGLISH_WORDNET_COMPOUND_GLOSSES_URL = new URL("./english_wordnet_compound_glosses.pya", import.meta.url);
const ENGLISH_WORDNET_COMPOUND_GLOSSES_FORMAT = "english-wordnet-compound-sense-glosses-v2";

function invalid(message) {
  const error = new Error(message);
  error.code = "invalid-english-wordnet-compound-glosses";
  return error;
}

export function buildEnglishWordNetCompoundGlosses(compoundRecords = [], decisions = []) {
  if (!Array.isArray(compoundRecords) || !Array.isArray(decisions)) {
    throw invalid("WordNet compound gloss construction requires compound and decision arrays");
  }
  const decisionsById = new Map(decisions.map((decision) => [decision.candidateId, decision]));
  const glosses = new Map();
  for (const compound of compoundRecords) {
    const senseId = String(compound?.senseId ?? "").trim();
    const target = String(compound?.target ?? "").normalize("NFC").trim();
    const pyashSequence = Array.isArray(compound?.pyashSequence)
      ? compound.pyashSequence.filter((word) => typeof word === "string" && word.trim()).map((word) => word.trim())
      : [];
    if (!senseId || !target || pyashSequence.length < 2 || pyashSequence.length > 3) continue;
    const decisionIds = [...new Set([
      ...(Array.isArray(compound.verificationDecisionIds) ? compound.verificationDecisionIds : []),
      compound.verificationDecisionId
    ].filter((id) => typeof id === "string" && id.trim()))];
    for (const decisionId of decisionIds) {
      const decision = decisionsById.get(decisionId);
      const evidence = decision?.targetSenseEvidence?.find((item) => item.source === senseId);
      if (!evidence?.definition) continue;
      const record = {
        senseId,
        target,
        partOfSpeech: String(evidence.pos ?? compound.targetPartOfSpeech ?? senseId.slice(0, 1)),
        lemmas: Array.isArray(evidence.lemmas) ? [...new Set(evidence.lemmas.filter((lemma) => typeof lemma === "string" && lemma.trim()))] : [target],
        definition: String(evidence.definition),
        pyashSequence,
        decisionId
      };
      const key = `${senseId} | ${target} | ${record.definition}`;
      if (!glosses.has(key)) glosses.set(key, record);
    }
  }
  return [...glosses.values()].sort((left, right) => (
    left.senseId.localeCompare(right.senseId)
      || left.target.localeCompare(right.target)
      || left.definition.localeCompare(right.definition)
  ));
}

export function renderEnglishWordNetCompoundGlosses(records = []) {
  if (!Array.isArray(records)) throw invalid("WordNet compound gloss rendering requires rows");
  const seen = new Set();
  const rows = records.map((record) => {
    const senseId = String(record?.senseId ?? "").trim();
    const target = String(record?.target ?? "").normalize("NFC").trim();
    const decisionId = String(record?.decisionId ?? "").trim();
    if (!senseId || !target || !String(record?.definition ?? "").trim() || !decisionId) {
      throw invalid("WordNet compound gloss row requires a sense, target, definition, and decision identity");
    }
    if (seen.has(decisionId)) throw invalid("WordNet compound gloss decision identity is duplicated");
    seen.add(decisionId);
    // Keep English gloss text in the value; the Pyash key is an opaque record identity.
    const key = decisionId;
    return `su text ${JSON.stringify(key)} ob text ${JSON.stringify(JSON.stringify(record))} ya`;
  });
  return [
    `su name ${ENGLISH_WORDNET_COMPOUND_GLOSSES_NAME} be map def`,
    `su text "format" ob text ${JSON.stringify(ENGLISH_WORDNET_COMPOUND_GLOSSES_FORMAT)} ya`,
    ...rows,
    "prah",
    ""
  ].join("\n");
}

export function mergeEnglishWordNetCompoundGlosses(existing = [], additions = []) {
  if (!Array.isArray(existing) || !Array.isArray(additions)) {
    throw invalid("WordNet compound gloss merge requires row arrays");
  }
  const merged = new Map();
  for (const record of [...existing, ...additions]) {
    const key = `${record?.senseId ?? ""} | ${record?.target ?? ""} | ${record?.definition ?? ""}`;
    if (!record?.senseId || !record?.target || !record?.definition) continue;
    merged.set(key, record);
  }
  return [...merged.values()].sort((left, right) => (
    left.senseId.localeCompare(right.senseId)
      || left.target.localeCompare(right.target)
      || left.definition.localeCompare(right.definition)
  ));
}

export function parseEnglishWordNetCompoundGlosses(source) {
  if (typeof source !== "string") throw invalid("WordNet compound gloss index must be Pyash text");
  const sentences = buildProgram(source).sentences;
  const header = sentences.find((sentence) => sentence?.mood === "def"
    && sentence?.be === "map"
    && sentence?.su?.name === ENGLISH_WORDNET_COMPOUND_GLOSSES_NAME);
  if (!header) throw invalid("WordNet compound gloss index has no canonical map header");
  const format = sentences.find((sentence) => sentence?.mood === "ya" && sentence?.su?.text === "format")?.ob?.text;
  if (format !== ENGLISH_WORDNET_COMPOUND_GLOSSES_FORMAT) {
    throw invalid("WordNet compound gloss index has an unsupported format");
  }
  const records = [];
  const seen = new Set();
  for (const sentence of sentences) {
    if (sentence?.mood !== "ya" || typeof sentence.su?.text !== "string" || sentence.su.text === "format") continue;
    if (typeof sentence.ob?.text !== "string") throw invalid("WordNet compound gloss row requires JSON text");
    let record;
    try {
      record = JSON.parse(sentence.ob.text);
    } catch (error) {
      throw invalid(`WordNet compound gloss row contains malformed JSON: ${error.message}`);
    }
    const decisionId = String(record?.decisionId ?? "").trim();
    if (!record?.senseId || !record?.target || !record?.definition || !decisionId
      || sentence.su.text !== decisionId || seen.has(decisionId)) {
      throw invalid("WordNet compound gloss row has an invalid or duplicate identity");
    }
    seen.add(decisionId);
    records.push(record);
  }
  return { format: ENGLISH_WORDNET_COMPOUND_GLOSSES_FORMAT, records };
}

export async function loadEnglishWordNetCompoundGlosses({ url = ENGLISH_WORDNET_COMPOUND_GLOSSES_URL } = {}) {
  return parseEnglishWordNetCompoundGlosses(await readFile(url, "utf8"));
}

export async function writeEnglishWordNetCompoundGlosses(records, { url = ENGLISH_WORDNET_COMPOUND_GLOSSES_URL } = {}) {
  const filename = url instanceof URL ? fileURLToPath(url) : String(url);
  const temporary = `${filename}.${process.pid}.tmp`;
  await mkdir(dirname(filename), { recursive: true });
  await rm(temporary, { force: true });
  await writeFile(temporary, renderEnglishWordNetCompoundGlosses(records), "utf8");
  await rename(temporary, filename);
}

export async function upsertEnglishWordNetCompoundGlosses(additions, { url = ENGLISH_WORDNET_COMPOUND_GLOSSES_URL } = {}) {
  let existing = [];
  try {
    existing = (await loadEnglishWordNetCompoundGlosses({ url })).records;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const merged = mergeEnglishWordNetCompoundGlosses(existing, additions);
  await writeEnglishWordNetCompoundGlosses(merged, { url });
  return merged;
}

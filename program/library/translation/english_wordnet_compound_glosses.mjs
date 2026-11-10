import { readFile, rename, rm, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { buildProgram } from "../../program.mjs";
import {
  KWON_LOOKUP_INDEX_PATHS,
  lookupKwonIndex,
  readKwonSourceHead,
  readKwonSourceLocators
} from "./kwon_lookup_index.mjs";

export const ENGLISH_WORDNET_COMPOUND_GLOSSES_NAME = "translation_wordnet_compound_sense_glosses";
export const ENGLISH_WORDNET_COMPOUND_GLOSSES_URL = new URL("./english_wordnet_compound_glosses.pya", import.meta.url);
const ENGLISH_WORDNET_COMPOUND_GLOSSES_SOURCE_ID = "program/library/translation/english_wordnet_compound_glosses.pya";

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
  const rows = records.map((record) => {
    const senseId = String(record?.senseId ?? "").trim();
    const target = String(record?.target ?? "").normalize("NFC").trim();
    if (!senseId || !target || !String(record?.definition ?? "").trim()) {
      throw invalid("WordNet compound gloss row requires a sense, target, and definition");
    }
    const key = `${senseId} | ${target} | ${record.definition}`;
    return `su text ${JSON.stringify(key)} ob text ${JSON.stringify(JSON.stringify(record))} ya`;
  });
  return [
    `su name ${ENGLISH_WORDNET_COMPOUND_GLOSSES_NAME} be map def`,
    `su text "format" ob text "english-wordnet-compound-sense-glosses-v1" ya`,
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
    const key = `${record?.senseId ?? ""} | ${record?.target ?? ""} | ${record?.definition ?? ""}`;
    if (!record?.senseId || !record?.target || !record?.definition || sentence.su.text !== key || seen.has(key)) {
      throw invalid("WordNet compound gloss row has an invalid or duplicate identity");
    }
    seen.add(key);
    records.push(record);
  }
  return { format: "english-wordnet-compound-sense-glosses-v1", records };
}

export async function loadEnglishWordNetCompoundGlosses({
  url = ENGLISH_WORDNET_COMPOUND_GLOSSES_URL,
  senseIds = null,
  indexPaths = KWON_LOOKUP_INDEX_PATHS,
  indexRoot
} = {}) {
  const rootOptions = indexRoot ? { root: indexRoot } : {};
  if (url instanceof URL && url.href === ENGLISH_WORDNET_COMPOUND_GLOSSES_URL.href && Array.isArray(senseIds)) {
    const selectedIds = new Set(senseIds
      .filter((senseId) => typeof senseId === "string" && senseId.trim())
      .map((senseId) => senseId.trim().toLowerCase()));
    let indexedLocators;
    try {
      const results = await Promise.all([...selectedIds].map((senseId) => lookupKwonIndex({
        kind: "wordnet", key: senseId, indexPath: indexPaths.wordnet, ...rootOptions
      })));
      indexedLocators = results.flat()
        .filter((locator) => locator?.sourceId === ENGLISH_WORDNET_COMPOUND_GLOSSES_SOURCE_ID);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (indexedLocators) {
      const uniqueLocators = [...new Map(indexedLocators.map((locator) => [locator.byteOffset, locator])).values()];
      const header = await readKwonSourceHead(ENGLISH_WORDNET_COMPOUND_GLOSSES_SOURCE_ID, { lineCount: 2, ...rootOptions });
      const rows = uniqueLocators.length > 0
        ? await readKwonSourceLocators(uniqueLocators, rootOptions)
        : [];
      return parseEnglishWordNetCompoundGlosses([
        ...header,
        ...rows.map((row) => row.line),
        "prah",
        ""
      ].join("\n"));
    }
  }
  const source = await readFile(url, "utf8");
  if (!Array.isArray(senseIds)) return parseEnglishWordNetCompoundGlosses(source);
  const selectedIds = new Set(senseIds
    .filter((senseId) => typeof senseId === "string" && senseId.trim())
    .map((senseId) => senseId.trim().toLowerCase()));
  const senseNeedles = [...selectedIds];
  const lines = source.split(/\r?\n/u);
  const selectedRows = lines.slice(2).filter((line) => (
    senseNeedles.some((senseId) => line.includes(senseId))
  ));
  return parseEnglishWordNetCompoundGlosses([
    lines[0] ?? "",
    lines[1] ?? "",
    ...selectedRows,
    "prah",
    ""
  ].join("\n"));
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

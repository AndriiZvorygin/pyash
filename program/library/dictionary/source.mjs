import { buildProgram } from "../../program.mjs";
import { lowerPyashProgram, lowerSentence } from "../vliw/index.mjs";
import { lookupLegacyPyaName } from "../vliw/quotes.mjs";

const PROFILE_KEY = "lyin kwon";
const ENTRY_RECORD_KEY = "tlat kwon";
const PROFILE_VERSION = "pyac-vliw-dictionary/3";

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be non-empty text`);
  }
  return value;
}

function keyForName(name) {
  const words = String(name ?? "").trim().split(/\s+/u).filter(Boolean);
  if (!words.length) throw new Error("dictionary entry requires a Pyash key");
  return words.map((word) => {
    const entry = lookupLegacyPyaName(word);
    if (!entry?.hnuc) throw new Error(`dictionary key word has no HNUC mapping: ${word}`);
    return Number.parseInt(entry.hnuc, 16);
  });
}

function parseVector(values, label) {
  if (!Array.isArray(values) || !values.length) throw new Error(`${label} requires a non-empty vector`);
  return values.map((word) => {
    const parsed = Number(String(word).replace(/^0x/iu, ""));
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 0xffff) {
      const hex = Number.parseInt(String(word).replace(/^0x/iu, ""), 16);
      if (!Number.isInteger(hex) || hex < 0 || hex > 0xffff) {
        throw new Error(`${label} contains an invalid uint16: ${word}`);
      }
      return hex;
    }
    return parsed;
  });
}

function parseSequence(words, cursor, label) {
  const count = words[cursor.index++];
  if (!Number.isInteger(count) || count < 1 || cursor.index + count > words.length) {
    throw new Error(`${label} has an invalid length-prefixed sequence`);
  }
  const sequence = words.slice(cursor.index, cursor.index + count);
  cursor.index += count;
  return sequence;
}

function parseOperationSignature(dispatch) {
  const words = parseVector(dispatch, "operation signature");
  const cursor = { index: 0 };
  const verb = parseSequence(words, cursor, "operation verb");
  const mood = parseSequence(words, cursor, "operation mood");
  const argumentCount = words[cursor.index++];
  if (!Number.isInteger(argumentCount) || argumentCount < 0) {
    throw new Error("operation signature has an invalid argument count");
  }
  const argumentsList = [];
  for (let index = 0; index < argumentCount; index += 1) {
    argumentsList.push({
      grammatical_case: parseSequence(words, cursor, "argument case"),
      value_type: parseSequence(words, cursor, "argument type")
    });
  }
  if (cursor.index !== words.length) throw new Error("operation signature has trailing words");
  return { verb, mood, arguments: argumentsList, results: [] };
}

function text(value, label) {
  return requireText(value?.text, label);
}

function buildEntryRecord(sentence, entries, entryByName) {
  const kind = sentence.at?.text;
  const target = requireText(sentence.ob?.text ?? sentence.ob?.name, "entry record ob key");
  const key = keyForName(target);
  let entry = entryByName.get(target);
  if (kind === "entry") {
    if (entry) throw new Error(`duplicate dictionary entry block: ${target}`);
    entry = {
      key,
      lexical_forms: [],
      source_links: [],
      source_glosses: [],
      component_keys: [],
      task_keys: [],
      references: [],
      operation_signatures: [],
      definition: []
    };
    entries.push(entry);
    entryByName.set(target, entry);
    return;
  }
  if (!entry) throw new Error(`${kind ?? "entry metadata"} precedes entry block ${target}`);

  if (kind === "lexical-form") {
    entry.lexical_forms.push({
      language: text(sentence.as, "lexical language"),
      surface: text(sentence.from, "lexical surface"),
      normalized: text(sentence.to, "normalized lexical surface")
    });
  } else if (kind === "source-link") {
    entry.source_links.push({
      dataset: text(sentence.as, "source dataset"),
      release: text(sentence.from, "source release"),
      identifier: text(sentence.to, "source identifier"),
      relation: text(sentence.by, "source relation")
    });
  } else if (kind === "source-gloss") {
    entry.source_glosses.push({
      language: text(sentence.as, "source gloss language"),
      dataset: text(sentence.from, "source gloss dataset"),
      release: text(sentence.to, "source gloss release"),
      identifier: text(sentence.by, "source gloss identifier"),
      text: text(sentence.with, "source gloss text")
    });
  } else if (kind === "component") {
    entry.component_keys.push(keyForName(sentence.from?.text ?? sentence.from?.name));
  } else if (kind === "task") {
    entry.task_keys.push(keyForName(sentence.with?.name));
  } else if (kind === "reference") {
    entry.references.push(keyForName(sentence.to?.name));
  } else if (kind === "operation-signature") {
    entry.operation_signatures.push(parseOperationSignature(sentence.from?.ve?.values));
  } else if (kind === "operation-argument") {
    const signature = entry.operation_signatures.at(-1);
    if (!signature) throw new Error("operation-argument must follow its operation-signature");
    const words = parseVector(sentence.as?.ve?.values, "operation argument descriptor");
    const cursor = { index: 0 };
    const grammaticalCase = parseSequence(words, cursor, "argument case");
    const valueType = parseSequence(words, cursor, "argument type");
    if (cursor.index !== words.length) throw new Error("operation argument descriptor has trailing words");
    const argument = signature.arguments.find((item) => (
      JSON.stringify(item.grammatical_case) === JSON.stringify(grammaticalCase)
      && JSON.stringify(item.value_type) === JSON.stringify(valueType)
    ));
    if (!argument) throw new Error("operation-argument does not match an argument in the preceding signature");
    argument.name = text(sentence.from, "operation argument name");
    argument.description = text(sentence.to, "operation argument description");
  } else if (kind === "operation-result") {
    const signature = entry.operation_signatures.at(-1);
    if (!signature) throw new Error("operation-result must follow its operation-signature");
    signature.results.push({
      value_type: parseVector(sentence.as?.ve?.values, "operation result type"),
      name: text(sentence.from, "operation result name"),
      description: text(sentence.to, "operation result description")
    });
  } else {
    throw new Error(`unsupported dictionary entry record type: ${kind ?? "(missing at)"}`);
  }
}

export function buildDictionarySource(source) {
  const sentences = buildProgram(source).sentences;
  const profileSentences = sentences.filter((sentence) => sentence.su?.name === PROFILE_KEY);
  const marker = profileSentences.find((sentence) => sentence.ob?.text && sentence.as === undefined);
  const metadata = profileSentences.find((sentence) => sentence.as?.num !== undefined);
  if (!marker || !metadata) {
    throw new Error("dictionary source requires profile and metadata sentences for lyin kwon");
  }
  if (metadata.to?.text !== "NFC" || metadata.with?.text !== PROFILE_VERSION) {
    throw new Error(`dictionary metadata must declare NFC and ${PROFILE_VERSION}`);
  }
  const languages = text(metadata.from, "volume languages").split(",").map((item) => item.trim());
  const entries = [];
  const entryByName = new Map();
  for (const sentence of sentences) {
    if (sentence?.mood === "prah") continue;
    if (sentence.su?.name === PROFILE_KEY) continue;
    if (sentence.su?.name === ENTRY_RECORD_KEY) {
      buildEntryRecord(sentence, entries, entryByName);
      continue;
    }
    const name = sentence.su?.name;
    const entry = entryByName.get(name);
    if (!entry) throw new Error(`definition sentence is not inside a declared entry: ${name ?? "(no su)"}`);
    let lowered;
    try {
      lowered = lowerSentence(sentence);
    } catch (error) {
      if (!["unsupported-sentence", "literal-width"].includes(error?.code)) throw error;
      lowered = lowerPyashProgram([sentence]).vectors.map((words) => ({ words }));
    }
    entry.definition.push(...lowered.map(({ words }) => Array.from(words)));
  }
  if (!entries.length) throw new Error("dictionary source contains no entry blocks");
  for (const entry of entries) {
    if (!entry.definition.length) entry.definition = null;
  }
  return {
    metadata: {
      kind: text(marker.ob, "dictionary kind"),
      title: text(metadata.ob, "dictionary title"),
      revision: metadata.as.num,
      languages,
      normalization_policy: metadata.to.text
    },
    entries
  };
}

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import pyashWords from "../pyashWords.json" with { type: "json" };
import { buildProgram } from "../../program.mjs";
import { buildAtomWordProposal, loadAtomWordGenerationInputs } from "./atom_word_generation.mjs";
import { parseEnglishGrammarCatalog } from "./english_grammar.mjs";

const execFileAsync = promisify(execFile);
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export const CHINESE_CHARACTER_ATOM_REFINERY_FORMAT = "chinese-character-atom-refinery-v1";
export const CHINESE_CHARACTER_ATOM_LINKS_NAME = "translation_chinese_character_atom_links";
export const CHINESE_CHARACTER_ATOM_REFINERY_NAME = "translation chinese character atoms";
export const CHINESE_CHARACTER_ATOM_FIRST_PASS_REFINERY_NAME = "translation chinese character atom first pass";
export const CHINESE_CHARACTER_ATOM_REFINERY_CONFIG_URL = new URL("./chinese_character_atom_refinery.pya", import.meta.url);
export const DEFAULT_CHINESE_CHARACTER_ATOM_ARTIFACT_ROOT = path.join(REPOSITORY_ROOT, "artifacts", "chinese-character-atom-refinery");

export const CHINESE_CHARACTER_ATOM_MATCH_RESPONSE_FORMAT = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["verdict", "confidence", "matches", "rationale"],
  properties: {
    verdict: { type: "string", enum: ["select", "no-fit", "uncertain"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    matches: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["targetId", "relation", "rationale"],
        properties: {
          targetId: { type: "string" },
          relation: { type: "string", enum: ["base", "marked", "same-sense"] },
          rationale: { type: "string", maxLength: 300 }
        }
      }
    },
    rationale: { type: "string", maxLength: 500 }
  }
});

export const CHINESE_CHARACTER_TRANSLATION_RESPONSE_FORMAT = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["verdict", "translations"],
  properties: {
    verdict: { type: "string", enum: ["complete", "partial", "uncertain"] },
    translations: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["english", "sense", "register", "evidence"],
        properties: {
          english: { type: "string", maxLength: 100 },
          sense: { type: "string", maxLength: 300 },
          register: { type: "string", maxLength: 100 },
          evidence: { type: "string", maxLength: 300 }
        }
      }
    }
  }
});

const PHONETIC_LANGUAGE_CODES = Object.freeze([
  "zh", "es", "en", "hi", "ar", "pt", "bn", "ru", "pa", "de", "id", "te", "ta", "vi",
  "ko", "fr", "mr", "ur", "tr", "it", "zhy", "gu", "fa", "pl", "kn", "ml", "my", "sw",
  "am", "ro", "az", "nl", "ku", "ne", "si", "hu", "el", "cs", "sv", "ka"
]);

export const CHINESE_CHARACTER_PHONETIC_RESPONSE_FORMAT = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["entries"],
  properties: {
    entries: {
      type: "array",
      maxItems: 40,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["language", "transcription", "source"],
        properties: {
          language: { type: "string", enum: [...PHONETIC_LANGUAGE_CODES] },
          transcription: { type: "string", maxLength: 100 },
          source: { type: "string", maxLength: 300 }
        }
      }
    }
  }
});

export const CHINESE_CHARACTER_ATOM_SOURCE_PATHS = Object.freeze({
  subtlex: path.join(REPOSITORY_ROOT, "sino-pyash", "sources", "subtlex-ch-2010", "SUBTLEX-CH-CHR.utf8.tsv"),
  junda: path.join(REPOSITORY_ROOT, "sino-pyash", "sources", "junda-local", "CharFreq-Modern.txt"),
  unihanArchive: path.join(REPOSITORY_ROOT, "sino-pyash", "sources", "unihan-18.0.0", "Unihan.zip"),
  cedict: path.resolve(REPOSITORY_ROOT, "..", "hkestlat", "cedict_1_0_ts_utf-8_mdbg.txt"),
  shuowen: path.join(REPOSITORY_ROOT, "sino-pyash", "sources", "classical-chinese", "shuowen", "shuowen.json"),
  analectsWenYen: path.join(REPOSITORY_ROOT, "sino-pyash", "sources", "classical-chinese", "analects", "gutenberg-23839-wen-yen.txt"),
  kwonChinese: path.join(REPOSITORY_ROOT, "caterer", "pyac", "lyac", "kwon_zh.json"),
  acceptedLinks: path.join(REPOSITORY_ROOT, "program", "library", "translation", "chinese_character_atom_links.pya"),
  englishGrammar: path.join(REPOSITORY_ROOT, "program", "library", "translation", "english_grammar.pya")
});

const HAN = /\p{Script=Han}/u;
const EXPLICIT_REGISTER_WORDS = /\b(courteous|polite|honorific|informal|formal|respectful|familiar|humble)\b/iu;
const CEDICT_REFERENCED_CHARACTER = /([\p{Script=Han}]{1,2})\[[^\]]+\]/gu;

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-chinese-character-atom-refinery";
  error.details = details;
  return error;
}

function parseProviderJsonResponse(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (typeof value.response === "string") return parseProviderJsonResponse(value.response);
    if (typeof value.message?.content === "string") return parseProviderJsonResponse(value.message.content);
    return value;
  }
  if (typeof value !== "string") return value;
  const parsed = JSON.parse(value);
  if (typeof parsed === "string") return parseProviderJsonResponse(parsed);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    if (typeof parsed.response === "string") return parseProviderJsonResponse(parsed.response);
    if (typeof parsed.message?.content === "string") return parseProviderJsonResponse(parsed.message.content);
  }
  return parsed;
}

function text(value) {
  return typeof value === "string" ? value.normalize("NFC").trim() : "";
}

function hash(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function normalizeEnglish(value) {
  return text(value).toLowerCase()
    .replace(/[_-]+/gu, " ")
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function codePointSort(left, right) {
  return (left.codePointAt(0) ?? 0) - (right.codePointAt(0) ?? 0);
}

function unique(values) {
  return [...new Set(values.map(text).filter(Boolean))];
}

async function readUnihanFile(archivePath, entryName) {
  const { stdout } = await execFileAsync("unzip", ["-p", archivePath, entryName], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
  return stdout;
}

export function parseSubtlexCharacterFrequency(source) {
  if (typeof source !== "string") throw invalid("SUBTLEX-CH source must be text");
  const rows = new Map();
  for (const line of source.split(/\r?\n/u)) {
    const match = line.match(/^(.+?)\t(\d+)\t([\d.]+)\t([\d.]+)\t(\d+)\t([\d.]+)\t([\d.]+)$/u);
    if (!match) continue;
    const character = match[1].normalize("NFC");
    if ([...character].length !== 1 || !HAN.test(character)) continue;
    rows.set(character, {
      count: Number(match[2]),
      perMillion: Number(match[3]),
      contextCount: Number(match[5]),
      contextPercent: Number(match[6])
    });
  }
  const ordered = [...rows.entries()].sort((left, right) => right[1].count - left[1].count
    || codePointSort(left[0], right[0]));
  return new Map(ordered.map(([character, row], index) => [character, { rank: index + 1, ...row }]));
}

export function parseJundaCharacterFrequency(source) {
  if (typeof source !== "string") throw invalid("Jun Da frequency source must be decoded text");
  const parsed = [];
  let fallbackRank = 0;
  for (const line of source.split(/\r?\n/u)) {
    const fields = line.trim().split(/[\t, ]+/u).filter(Boolean);
    const character = fields.find((field) => [...field].length === 1 && HAN.test(field));
    if (!character) continue;
    const rankField = fields.find((field) => /^\d{1,5}$/u.test(field));
    const rank = Number(rankField);
    fallbackRank += 1;
    parsed.push({ character: character.normalize("NFC"), rank: Number.isSafeInteger(rank) && rank > 0 ? rank : fallbackRank });
  }
  parsed.sort((left, right) => left.rank - right.rank || codePointSort(left.character, right.character));
  const result = new Map();
  for (const row of parsed) if (!result.has(row.character)) result.set(row.character, { rank: result.size + 1 });
  return result;
}

export function parseUnihanCharacterData(readingsSource, otherMappingsSource) {
  if (typeof readingsSource !== "string" || typeof otherMappingsSource !== "string") {
    throw invalid("Unihan sources must be text");
  }
  const characters = new Map();
  const getCharacter = (code) => {
    const character = String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    const row = characters.get(character) ?? { character, readings: { Mandarin: [], Cantonese: [] } };
    characters.set(character, row);
    return row;
  };
  for (const line of otherMappingsSource.split(/\r?\n/u)) {
    const match = line.match(/^(U\+[0-9A-F]+)\tkTGH\t2013:(\d+)$/u);
    if (!match) continue;
    const row = getCharacter(match[1]);
    row.standardIndex = Number(match[2]);
  }
  for (const line of readingsSource.split(/\r?\n/u)) {
    const match = line.match(/^(U\+[0-9A-F]+)\tk(Definition|Mandarin|Cantonese)\t(.+)$/u);
    if (!match) continue;
    const row = getCharacter(match[1]);
    if (match[2] === "Definition") row.unihanDefinition = match[3].trim();
    else {
      const key = match[2];
      row.readings[key] = unique([...row.readings[key], ...match[3].trim().split(/\s+/u)]);
    }
  }
  return new Map([...characters].filter(([, row]) => Number.isSafeInteger(row.standardIndex)));
}

export function parseCedictSingleCharacterGlosses(source) {
  if (typeof source !== "string") throw invalid("CC-CEDICT source must be text");
  const glosses = new Map();
  for (const line of source.split(/\r?\n/u)) {
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s*(.*)$/u);
    if (!match) continue;
    const definitions = match[4].replace(/^\/+|\/+$/gu, "").split("/")
      .map((definition) => definition.trim())
      .filter((definition) => definition && !/^CL:/u.test(definition));
    for (const form of unique([match[1], match[2]])) {
      if ([...form].length !== 1 || !HAN.test(form)) continue;
      const rows = glosses.get(form) ?? [];
      rows.push({ pinyin: match[3], definitions });
      glosses.set(form, rows);
    }
  }
  for (const [character, rows] of glosses) {
    const seen = new Set();
    glosses.set(character, rows.filter((row) => {
      const key = `${row.pinyin}\u0000${row.definitions.join("\u0000")}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }));
  }
  return glosses;
}

export function parseChineseCharacterAtomLinks(source) {
  if (typeof source !== "string") throw invalid("accepted Chinese character links must be Pyash text");
  const program = buildProgram(source);
  const links = [];
  for (const sentence of program.sentences) {
    if (sentence?.mood !== "ya" || typeof sentence.su?.text !== "string" || typeof sentence.ob?.text !== "string") continue;
    if (!sentence.su.text.startsWith("link:") && !sentence.su.text.startsWith("withdraw:")) continue;
    let row;
    try {
      row = JSON.parse(sentence.ob.text);
    } catch (error) {
      throw invalid("accepted Chinese character link row is malformed", { key: sentence.su.text, cause: error.message });
    }
    links.push({ key: sentence.su.text, ...row });
  }
  return links;
}

export function parseEnglishGrammarTargets(source) {
  if (typeof source !== "string") throw invalid("English grammar catalog must be Pyash text");
  return parseEnglishGrammarCatalog(source).entries
    .filter((entry) => entry.pyashSequence.length === 1)
    .map((entry) => ({
      id: `grammar:${entry.components.join("+")}`,
      kind: "grammar",
      english: entry.surface,
      pya: entry.pyashSequence[0],
      components: entry.components,
      evidence: entry.evidence
    }));
}

export function parseSubtlexSourceDescription(source) {
  if (typeof source !== "string") throw invalid("SUBTLEX-CH source description must be text");
  const lines = source.split(/\r?\n/u);
  return lines.slice(0, 2).map((line) => line.replace(/^"|"$/gu, "")).filter(Boolean).join("; ");
}

function englishHeads(cedictRows = [], unihanDefinition = "") {
  const terms = [];
  for (const row of cedictRows) {
    for (const definition of row.definitions) {
      const head = definition
        .replace(/\([^)]*\)/gu, " ")
        .replace(/\[[^\]]*\]/gu, " ")
        .replace(/\s+/gu, " ")
        .trim();
      if (head && !/[\p{Script=Han}]/u.test(head)) terms.push(head);
    }
  }
  for (const definition of unihanDefinition.split(/[;,]/u)) {
    const head = definition.trim();
    if (head && !/[\p{Script=Han}]/u.test(head)) terms.push(head);
  }
  return unique(terms);
}

function citedCharacters(cedictRows = []) {
  const cited = [];
  for (const row of cedictRows) {
    for (const definition of row.definitions) {
      for (const match of definition.matchAll(CEDICT_REFERENCED_CHARACTER)) {
        const character = match[1].normalize("NFC");
        if ([...character].length === 1 && HAN.test(character)) cited.push(character);
      }
    }
  }
  return unique(cited);
}

function hasExplicitContrast(cedictRows = []) {
  return cedictRows.some((row) => row.definitions.some((definition) => (
    /\bas opposed to\b|\bcontrasted with\b|\bunlike\b/iu.test(definition)
      || EXPLICIT_REGISTER_WORDS.test(definition)
  )));
}

function stripSubtlexMetadata(source) {
  return source.split(/\r?\n/u).filter((line, index) => index >= 3).join("\n");
}

function parsePyaJsonMap(source) {
  if (!text(source)) return [];
  const rows = [];
  for (const sentence of buildProgram(source).sentences) {
    if (sentence?.mood !== "ya" || typeof sentence.su?.text !== "string" || typeof sentence.ob?.text !== "string") continue;
    if (!sentence.su.text.startsWith("link:") && !sentence.su.text.startsWith("withdraw:")) continue;
    try {
      rows.push({ key: sentence.su.text, ...JSON.parse(sentence.ob.text) });
    } catch (error) {
      throw invalid("Chinese character link row is malformed", { key: sentence.su.text, cause: error.message });
    }
  }
  return rows;
}

export async function loadChineseCharacterAtomRefineryInputs({
  paths = CHINESE_CHARACTER_ATOM_SOURCE_PATHS,
  atomGenerationInputs
} = {}) {
  const [subtlexSource, unihanReadings, unihanOtherMappings, cedictSource, shuowenSource, analectsSource,
    kwonSource, acceptedLinksSource, grammarSource] = await Promise.all([
    fs.readFile(paths.subtlex, "utf8"),
    readUnihanFile(paths.unihanArchive, "Unihan_Readings.txt"),
    readUnihanFile(paths.unihanArchive, "Unihan_OtherMappings.txt"),
    fs.readFile(paths.cedict, "utf8"),
    fs.readFile(paths.shuowen, "utf8"),
    fs.readFile(paths.analectsWenYen, "utf8"),
    fs.readFile(paths.kwonChinese, "utf8"),
    fs.readFile(paths.acceptedLinks, "utf8").catch((error) => error?.code === "ENOENT" ? "" : Promise.reject(error)),
    fs.readFile(paths.englishGrammar, "utf8")
  ]);
  const kwonRows = JSON.parse(kwonSource);
  if (!Array.isArray(kwonRows)) throw invalid("Kwon Chinese vocabulary must be an array");
  const shuowenRows = JSON.parse(shuowenSource);
  if (!Array.isArray(shuowenRows)) throw invalid("Shuowen source must be an array");
  const shuowenByCharacter = new Map(shuowenRows.map((row) => [text(row?.char), row]).filter(([character]) => character));
  const subtlex = parseSubtlexCharacterFrequency(stripSubtlexMetadata(subtlexSource));
  let jundaSource = "";
  try {
    await fs.access(paths.junda);
    const decoded = await execFileAsync("iconv", ["-f", "GB18030", "-t", "UTF-8", paths.junda], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024
    });
    jundaSource = decoded.stdout;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const junda = jundaSource ? parseJundaCharacterFrequency(jundaSource) : new Map();
  const unihan = parseUnihanCharacterData(unihanReadings, unihanOtherMappings);
  const cedict = parseCedictSingleCharacterGlosses(cedictSource);
  const acceptedLinks = parsePyaJsonMap(acceptedLinksSource);
  const grammarTargets = parseEnglishGrammarTargets(grammarSource);
  const generation = atomGenerationInputs ?? await loadAtomWordGenerationInputs();
  const normalizedSubtlexSource = stripSubtlexMetadata(subtlexSource);
  const sourceHashes = {
    subtlex: hash(normalizedSubtlexSource),
    junda: jundaSource ? hash(jundaSource) : "unavailable-local-only",
    unihanReadings: hash(unihanReadings),
    unihanOtherMappings: hash(unihanOtherMappings),
    cedict: hash(cedictSource),
    shuowen: hash(shuowenSource),
    analects: hash(analectsSource),
    kwonChinese: hash(kwonSource),
    acceptedLinks: hash(acceptedLinksSource),
    englishGrammar: hash(grammarSource),
    atoms: hash(JSON.stringify(pyashWords))
  };
  return {
    subtlexSourceDescription: parseSubtlexSourceDescription(subtlexSource),
    subtlex,
    junda,
    unihan,
    cedict,
    shuowenByCharacter,
    analectsSource,
    kwonRows,
    acceptedLinks,
    grammarTargets,
    atomEntries: pyashWords,
    generation,
    sourceHashes,
    sourceHash: hash(JSON.stringify(sourceHashes))
  };
}

function oneCharacterMappings(rows = [], acceptedLinks = []) {
  const byCharacter = new Map();
  for (const row of rows) {
    const character = text(row?.zh);
    const pya = text(row?.pya);
    const english = text(row?.en);
    if ([...character].length !== 1 || !HAN.test(character) || !pya || pya.split(/\s+/u).length !== 1) continue;
    const links = byCharacter.get(character) ?? [];
    links.push({ english, pya, kind: "kwon", status: "existing" });
    byCharacter.set(character, links);
  }
  for (const link of acceptedLinks) {
    if (link.status !== "accepted") continue;
    const character = text(link.character);
    if ([...character].length !== 1 || !HAN.test(character) || !text(link.pya)) continue;
    const links = byCharacter.get(character) ?? [];
    links.push({ english: text(link.english), pya: text(link.pya), kind: "pyash-curated", status: "accepted" });
    byCharacter.set(character, links);
  }
  return byCharacter;
}

function atomTargets(atomEntries, grammarTargets) {
  const atoms = (atomEntries ?? []).filter((row) => text(row?.en) && text(row?.pya))
    .map((row) => ({ id: `atom:${text(row.pya)}`, kind: "atom", english: text(row.en), pya: text(row.pya) }));
  return [...atoms, ...grammarTargets];
}

function atomTargetIndex(targets) {
  const exactByAlias = new Map();
  const exactByToken = new Map();
  const tokensByPrefix = new Map();
  const firstIndexById = new Map();
  for (const [index, target] of targets.entries()) {
    const id = `${target.kind}:${target.pya}`;
    if (!firstIndexById.has(id)) firstIndexById.set(id, index);
    const aliases = [target.english, ...(target.kind === "grammar" ? [target.english.replace(/_$/u, "")] : [])]
      .map(normalizeEnglish).filter(Boolean);
    for (const alias of aliases) {
      const matches = exactByAlias.get(alias) ?? new Map();
      matches.set(id, { target, index });
      exactByAlias.set(alias, matches);
    }
    const labels = unique(normalizeEnglish(target.english).split(" ").filter((token) => token.length >= 4));
    for (const token of labels) {
      const row = { target, index, token };
      const tokenRows = exactByToken.get(token) ?? [];
      tokenRows.push(row);
      exactByToken.set(token, tokenRows);
      for (let length = 4; length <= token.length; length += 1) {
        const prefix = token.slice(0, length);
        const prefixRows = tokensByPrefix.get(prefix) ?? [];
        prefixRows.push(row);
        tokensByPrefix.set(prefix, prefixRows);
      }
    }
  }
  return { targets, exactByAlias, exactByToken, tokensByPrefix, firstIndexById };
}

function candidateEnglishPhrases(terms, targetIndex) {
  const exact = new Map();
  const normalizedTerms = unique(terms.map(normalizeEnglish));
  for (const term of normalizedTerms) {
    for (const [id, candidate] of targetIndex.exactByAlias.get(term) ?? []) {
      if (!exact.has(id) || exact.get(id).index < candidate.index) exact.set(id, candidate);
    }
  }
  return [...exact.entries()]
    .sort(([left], [right]) => targetIndex.firstIndexById.get(left) - targetIndex.firstIndexById.get(right))
    .map(([, candidate]) => candidate.target);
}

function lexicalCandidateTargets(terms, targetIndex, exactTargets) {
  const exactIds = new Set(exactTargets.map((target) => `${target.kind}:${target.pya}`));
  const heads = unique(terms.flatMap((term) => normalizeEnglish(term).split(" ")))
    .filter((token) => token.length >= 4);
  const scores = new Map();
  const addScore = (row, score) => {
    if (exactIds.has(`${row.target.kind}:${row.target.pya}`)) return;
    scores.set(row.index, (scores.get(row.index) ?? 0) + score);
  };
  for (const head of heads) {
    for (const row of targetIndex.exactByToken.get(head) ?? []) addScore(row, 4);
    for (let length = 4; length < head.length; length += 1) {
      for (const row of targetIndex.exactByToken.get(head.slice(0, length)) ?? []) addScore(row, 2);
    }
    for (const row of targetIndex.tokensByPrefix.get(head) ?? []) {
      if (row.token !== head) addScore(row, 2);
    }
  }
  const ranked = [...scores.entries()].map(([index, score]) => ({ target: targetIndex.targets[index], score, index }));
  ranked.sort((left, right) => right.score - left.score
    || (left.target.kind === right.target.kind ? 0 : left.target.kind === "atom" ? -1 : 1)
    || left.index - right.index);
  return ranked.slice(0, 24).map(({ target, score }, index) => ({
    ...target,
    candidateRank: index + 1,
    lexicalMatchScore: score
  }));
}

function counterpartRows(character, cedictRows, subtlex, junda = new Map()) {
  return citedCharacters(cedictRows).filter((cited) => cited !== character).map((cited) => ({
    character: cited,
    subtlexRank: subtlex.get(cited)?.rank ?? null,
    jundaRank: junda.get(cited)?.rank ?? null,
    rankSource: subtlex.has(character) && subtlex.has(cited)
      ? "subtlex-ch"
      : junda.has(character) && junda.has(cited)
        ? "junda-modern"
        : "unknown",
    rankRelation: subtlex.has(character) && subtlex.has(cited)
      ? (subtlex.get(character).rank < subtlex.get(cited).rank ? "more-frequent" : "less-frequent")
      : junda.has(character) && junda.has(cited)
        ? (junda.get(character).rank < junda.get(cited).rank ? "more-frequent" : "less-frequent")
        : "unknown"
  }));
}

export function buildChineseCharacterAtomWorklist(inputs, { includeMapped = true } = {}) {
  if (!inputs?.unihan || !inputs?.subtlex || !Array.isArray(inputs.atomEntries)) {
    throw invalid("Chinese character worklist requires parsed source inputs");
  }
  const mappings = oneCharacterMappings(inputs.kwonRows, inputs.acceptedLinks);
  const targets = atomTargets(inputs.atomEntries, inputs.grammarTargets ?? []);
  const targetIndex = atomTargetIndex(targets);
  const records = [];
  for (const [character, unihan] of inputs.unihan) {
    const cedictRows = inputs.cedict.get(character) ?? [];
    const existingMappings = mappings.get(character) ?? [];
    const explicitContrast = hasExplicitContrast(cedictRows);
    const relatedCharacters = counterpartRows(character, cedictRows, inputs.subtlex, inputs.junda);
    if (existingMappings.length > 0 && !includeMapped) continue;
    if (existingMappings.length > 0 && !explicitContrast) continue;
    const english = englishHeads(cedictRows, unihan.unihanDefinition ?? "");
    const exactTargets = candidateEnglishPhrases(english, targetIndex);
    const lexicalTargets = lexicalCandidateTargets(english, targetIndex, exactTargets);
    const frequency = inputs.subtlex.get(character) ?? null;
    const currentLinkIsGeneric = explicitContrast
      && relatedCharacters.some((related) => related.rankRelation === "less-frequent")
      && existingMappings.some((mapping) => (
        english.some((term) => normalizeEnglish(term) === normalizeEnglish(mapping.english))
      ));
    records.push({
      id: `zh-char-${character.codePointAt(0).toString(16).toLowerCase()}`,
      character,
      standardIndex: unihan.standardIndex,
      frequency: {
        subtlexRank: frequency?.rank ?? null,
        subtlexCount: frequency?.count ?? null,
        subtlexPerMillion: frequency?.perMillion ?? null,
        jundaRank: inputs.junda?.get(character)?.rank ?? null
      },
      readings: unihan.readings,
      evidence: {
        cedict: cedictRows,
        unihanDefinition: unihan.unihanDefinition ?? "",
        shuowen: inputs.shuowenByCharacter.get(character)?.content ?? "",
        classicalContexts: findCharacterContexts(inputs.analectsSource, character, 2)
      },
      englishCandidates: english,
      existingMappings,
      existingAtomCandidates: exactTargets.length > 0 ? exactTargets : lexicalTargets,
      exactAtomCandidates: exactTargets,
      relatedCharacters,
      specificityConflict: currentLinkIsGeneric,
      reviewPriority: currentLinkIsGeneric ? 0 : 1,
      status: existingMappings.length > 0
        ? (currentLinkIsGeneric ? "specificity-review" : "already-mapped")
        : exactTargets.length > 0
          ? "existing-atom-candidates"
          : lexicalTargets.length > 0
            ? "needs-semantic-match"
            : english.length > 0
              ? "needs-new-atom"
              : "needs-translation"
    });
  }
  records.sort((left, right) => {
    if (left.reviewPriority !== right.reviewPriority) return left.reviewPriority - right.reviewPriority;
    const leftHasPrimary = left.frequency.subtlexRank !== null;
    const rightHasPrimary = right.frequency.subtlexRank !== null;
    if (leftHasPrimary !== rightHasPrimary) return leftHasPrimary ? -1 : 1;
    if (leftHasPrimary && rightHasPrimary && left.frequency.subtlexRank !== right.frequency.subtlexRank) {
      return left.frequency.subtlexRank - right.frequency.subtlexRank;
    }
    if (!leftHasPrimary && left.frequency.jundaRank !== null && right.frequency.jundaRank !== null
      && left.frequency.jundaRank !== right.frequency.jundaRank) {
      return left.frequency.jundaRank - right.frequency.jundaRank;
    }
    return left.standardIndex - right.standardIndex || codePointSort(left.character, right.character);
  });
  return records;
}

export function findCharacterContexts(source, character, limit = 2, width = 34) {
  const textSource = String(source ?? "").normalize("NFC");
  const target = text(character);
  if (!target || !textSource.includes(target)) return [];
  const contexts = [];
  let from = 0;
  while (contexts.length < limit) {
    const index = textSource.indexOf(target, from);
    if (index < 0) break;
    const start = Math.max(0, index - width);
    const end = Math.min(textSource.length, index + target.length + width);
    const context = textSource.slice(start, end).replace(/\s+/gu, " ").trim();
    if (context && !contexts.includes(context)) contexts.push(context);
    from = index + target.length;
  }
  return contexts;
}

export function buildChineseCharacterAtomReviewPrompt(record) {
  if (!record?.character || !Array.isArray(record.existingAtomCandidates)) {
    throw invalid("atom review prompt requires a character record with candidate targets");
  }
  const cedict = (record.evidence?.cedict ?? []).slice(0, 8).map((row) => ({
    pinyin: row.pinyin,
    definitions: row.definitions.slice(0, 8).map((definition) => definition.slice(0, 240))
  }));
  return [
    "Choose only among the supplied Pyash targets. Do not invent a target or treat a shared broad English gloss as identical meaning.",
    "Prefer the more frequent unmarked Chinese character for a base atom. A lower-frequency character with added register, respect, politeness, or another semantic qualifier needs a correspondingly specific target; report no-fit if none is supplied.",
    "Return JSON with verdict (select, no-fit, or uncertain), confidence (high, medium, or low), matches (targetId, relation, rationale), and rationale. relation is base, marked, or same-sense.",
    "Set confidence high only when dictionary evidence directly supports one unmarked standalone sense and one base lexical atom. Use medium or low when senses compete, a register is marked, a grammar target remains equally plausible, or the evidence is indirect. The first pass automatically links only a single high-confidence base atom match.",
    `Character: ${record.character}`,
    `SUBTLEX-CH rank: ${record.frequency?.subtlexRank ?? "unknown"}`,
    `Jun Da modern-text rank (separate source, supplemental): ${record.frequency?.jundaRank ?? "unknown"}`,
    `English glosses: ${JSON.stringify(record.englishCandidates ?? [])}`,
    `CC-CEDICT evidence: ${JSON.stringify(cedict)}`,
    `Unihan definition: ${(record.evidence?.unihanDefinition ?? "").slice(0, 500)}`,
    `Shuowen definition: ${(record.evidence?.shuowen ?? "").slice(0, 500)}`,
    `Classical contexts (attestation only, not a standalone gloss): ${JSON.stringify((record.evidence?.classicalContexts ?? []).slice(0, 3))}`,
    `Related characters and ranks: ${JSON.stringify(record.relatedCharacters ?? [])}`,
    `Existing mappings: ${JSON.stringify(record.existingMappings ?? [])}`,
    `Candidate targets: ${JSON.stringify(record.existingAtomCandidates.map((target) => ({
      targetId: `${target.kind}:${target.pya}`,
      kind: target.kind,
      english: target.english,
      pya: target.pya,
      candidateRank: target.candidateRank ?? null,
      lexicalMatchScore: target.lexicalMatchScore ?? null,
      evidence: target.evidence ?? ""
    })))}`
  ].join("\n");
}

export function parseChineseCharacterAtomReviewResponse(value, record) {
  if (!record || !Array.isArray(record.existingAtomCandidates)) {
    throw invalid("atom review response requires its candidate record", { id: record?.id });
  }
  let response;
  try {
    response = parseProviderJsonResponse(value);
  } catch (error) {
    throw invalid("atom review response is malformed JSON", { id: record?.id, cause: error.message });
  }
  if (!response || !["select", "no-fit", "uncertain"].includes(response.verdict)
    || !["high", "medium", "low"].includes(response.confidence)
    || !Array.isArray(response.matches) || typeof response.rationale !== "string") {
    throw invalid("atom review response does not match the expected contract", { id: record?.id });
  }
  const targets = new Set(record.existingAtomCandidates.map((target) => `${target.kind}:${target.pya}`));
  const matches = response.matches.map((match) => {
    const targetId = text(match?.targetId);
    if (!targets.has(targetId) || !["base", "marked", "same-sense"].includes(match?.relation)) {
      throw invalid("atom review selected an unprovided target or relation", { id: record?.id, targetId });
    }
    return { targetId, relation: match.relation, rationale: text(match.rationale).slice(0, 300) };
  });
  if (response.verdict !== "select" && matches.length > 0) {
    throw invalid("non-select atom review response must not contain matches", { id: record?.id });
  }
  if (response.verdict === "select" && matches.length === 0) {
    throw invalid("select atom review response must contain a supplied target", { id: record?.id });
  }
  if (record.specificityConflict || record.specificityReviewRequired) {
    const genericTargets = new Set((record.existingMappings ?? [])
      .filter((mapping) => (record.englishCandidates ?? []).some((english) => (
        normalizeEnglish(english) === normalizeEnglish(mapping.english)
      )))
      .flatMap((mapping) => record.existingAtomCandidates
        .filter((target) => target.pya === mapping.pya)
        .map((target) => `${target.kind}:${target.pya}`)));
    if (matches.some((match) => genericTargets.has(match.targetId))) {
      throw invalid("atom review selected a generic mapped target despite an explicit specificity conflict", {
        id: record?.id,
        targets: matches.map((match) => match.targetId).filter((targetId) => genericTargets.has(targetId))
      });
    }
  }
  return {
    verdict: response.verdict,
    confidence: response.confidence,
    matches,
    rationale: text(response.rationale).slice(0, 500)
  };
}

export function highConfidenceChineseCharacterAtomLinks(records = [], existingLinks = []) {
  if (!Array.isArray(records) || !Array.isArray(existingLinks)) {
    throw invalid("automatic character linking requires record and link arrays");
  }
  const existing = new Set(existingLinks
    .filter((link) => link.status === "accepted")
    .map((link) => `${text(link.character)}\u0000${text(link.pya)}`));
  const withdrawn = new Set(existingLinks
    .filter((link) => link.status === "withdrawn")
    .map((link) => `${text(link.character)}\u0000${text(link.pya)}`));
  const linkedCharacters = new Set(existingLinks
    .filter((link) => link.status === "accepted")
    .map((link) => text(link.character)));
  const result = [];
  for (const record of records) {
    const decision = record?.modelMatch;
    const matches = decision?.matches ?? [];
    const modelSelected = decision?.verdict === "select"
      && decision?.confidence === "high"
      && matches.length === 1
      && matches[0]?.relation === "base";
    if (!modelSelected) continue;
    if (record.specificityConflict || record.specificityReviewRequired) continue;
    const frequencySource = Number.isSafeInteger(record.frequency?.subtlexRank)
      ? "subtlexRank"
      : Number.isSafeInteger(record.frequency?.jundaRank) ? "jundaRank" : "";
    const currentRank = frequencySource ? record.frequency[frequencySource] : null;
    const hasMoreFrequentRelatedCharacter = Number.isSafeInteger(currentRank) && currentRank > 0
      && (record.relatedCharacters ?? []).some((related) => {
        const relatedRank = Number(related?.[frequencySource]);
        return Number.isSafeInteger(relatedRank) && relatedRank > 0 && relatedRank < currentRank;
      });
    if (hasMoreFrequentRelatedCharacter) continue;
    const targetId = text(matches[0]?.targetId);
    const exactCandidates = record?.exactAtomCandidates ?? [];
    const target = (record.existingAtomCandidates ?? []).find((candidate) => (
      `${candidate.kind}:${candidate.pya}` === targetId && candidate.kind === "atom"
    ));
    if (!target || !exactCandidates.some((candidate) => (
      candidate.kind === target.kind && candidate.pya === target.pya
    ))) continue;
    if ((record.existingMappings ?? []).some((mapping) => mapping.pya === target.pya)) continue;
    const character = text(record.character);
    const key = `${character}\u0000${text(target.pya)}`;
    if ([...character].length !== 1 || !HAN.test(character)
      || linkedCharacters.has(character) || existing.has(key) || withdrawn.has(key)) continue;
    result.push({
      character,
      english: text(target.english),
      pya: text(target.pya),
      status: "accepted",
      confidence: "high",
      source: "chinese-character-atom-refinery"
    });
    existing.add(key);
    linkedCharacters.add(character);
  }
  return result;
}

export function parseChineseCharacterTranslationResponse(value, record) {
  let response;
  try {
    response = parseProviderJsonResponse(value);
  } catch (error) {
    throw invalid("Chinese character translation response is malformed JSON", { id: record?.id, cause: error.message });
  }
  if (!response || !["complete", "partial", "uncertain"].includes(response.verdict)
    || !Array.isArray(response.translations)) {
    throw invalid("Chinese character translation response does not match the expected contract", { id: record?.id });
  }
  const translations = response.translations.slice(0, 12).map((row) => {
    const english = text(row?.english);
    if (!english || typeof row?.sense !== "string" || typeof row?.register !== "string" || typeof row?.evidence !== "string") {
      throw invalid("Chinese character translation is missing required evidence", { id: record?.id });
    }
    return {
      english: english.slice(0, 100),
      sense: text(row.sense).slice(0, 300),
      register: text(row.register).slice(0, 100),
      evidence: text(row.evidence).slice(0, 300)
    };
  });
  if (response.verdict === "complete" && translations.length === 0) {
    throw invalid("complete translation response must contain at least one translation", { id: record?.id });
  }
  return { verdict: response.verdict, translations };
}

export function parseChineseCharacterPhoneticResponse(value, record) {
  let response;
  try {
    response = parseProviderJsonResponse(value);
  } catch (error) {
    throw invalid("Chinese character phonetic response is malformed JSON", { id: record?.id, cause: error.message });
  }
  if (!response || !Array.isArray(response.entries)) {
    throw invalid("Chinese character phonetic response does not match the expected contract", { id: record?.id });
  }
  const entries = response.entries.slice(0, PHONETIC_LANGUAGE_CODES.length).map((row) => {
    const language = text(row?.language);
    const transcription = text(row?.transcription);
    const source = text(row?.source);
    if (!PHONETIC_LANGUAGE_CODES.includes(language) || !transcription || !source) {
      throw invalid("phonetic evidence requires a supported language, transcription, and source", { id: record?.id, language });
    }
    return { language, transcription: transcription.slice(0, 100), source: source.slice(0, 300) };
  });
  return { entries };
}

export function buildChineseCharacterTranslationPrompt(record) {
  if (!record?.character) throw invalid("translation prompt requires a Chinese character record");
  const cedict = (record.evidence?.cedict ?? []).slice(0, 12).map((row) => ({
    pinyin: row.pinyin,
    definitions: row.definitions.slice(0, 10).map((definition) => definition.slice(0, 300))
  }));
  return [
    "Translate this single Chinese character as a lexical item. Distinguish its standalone meanings from meanings it has only as a component in compounds.",
    "Use the supplied dictionary and classical evidence. Return JSON with translations: an array of {english, sense, register, evidence}, and verdict (complete, partial, or uncertain). Do not infer a meaning from frequency or character components alone.",
    `Character: ${record.character}`,
    `CC-CEDICT: ${JSON.stringify(cedict)}`,
    `Unihan definition: ${(record.evidence?.unihanDefinition ?? "").slice(0, 700)}`,
    `Shuowen definition: ${(record.evidence?.shuowen ?? "").slice(0, 700)}`,
    `Classical contexts: ${JSON.stringify((record.evidence?.classicalContexts ?? []).slice(0, 3))}`
  ].join("\n");
}

export function buildChineseCharacterPhoneticEvidencePrompt(concept, record) {
  const english = text(concept);
  if (!english || !record?.character) throw invalid("phonetic evidence prompt requires an exact concept and character");
  const evidence = {
    cedict: (record.evidence?.cedict ?? []).slice(0, 4).map((row) => ({
      pinyin: row.pinyin,
      definitions: row.definitions.slice(0, 4).map((definition) => definition.slice(0, 180))
    })),
    unihanDefinition: (record.evidence?.unihanDefinition ?? "").slice(0, 300),
    shuowen: (record.evidence?.shuowen ?? "").slice(0, 300)
  };
  return [
    "Gather pronunciation evidence for this exact English concept so the deterministic Pyash atom allocator can use its multilingual phonetic profile.",
    "Do not substitute a synonym. Return JSON with entries: [{language, transcription, source}], using IPA only when you can identify a reliable source; omit unknown languages. These are evidence candidates and require review before use.",
    `Exact English concept: ${english}`,
    `Chinese character and evidence: ${record.character} ${JSON.stringify(evidence)}`,
    "Expected language codes: zh, es, en, hi, ar, pt, bn, ru, pa, de, id, te, ta, vi, ko, fr, mr, ur, tr, it, zhy, gu, fa, pl, kn, ml, my, sw, am, ro, az, nl, ku, ne, si, hu, el, cs, sv, ka"
  ].join("\n");
}

function mergeAtomTargets(...targetGroups) {
  const seen = new Set();
  return targetGroups.flat().filter((target) => {
    const key = `${target.kind}:${target.pya}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function candidatePhonetics(generation, concept, evidenceRows) {
  if (!Array.isArray(evidenceRows) || evidenceRows.length === 0) return generation;
  const normalized = normalizeEnglish(concept).replace(/\s+/gu, " ");
  const entries = { ...(generation.phonetics?.entries ?? {}) };
  const entry = Object.fromEntries(evidenceRows.map((row) => [row.language, row.transcription]));
  for (const key of new Set([
    `X${normalized.replace(/\s+/gu, "-")}`,
    `X${normalized.replace(/\s+/gu, "_")}`,
    `X${normalized}`
  ])) entries[key] = entry;
  return {
    ...generation,
    phonetics: {
      ...generation.phonetics,
      entries,
      sourceHash: hash(JSON.stringify({ sourceHash: generation.phonetics?.sourceHash ?? "", concept: normalized, evidenceRows }))
    }
  };
}

export async function buildChineseCharacterAtomProposals(records, inputs, {
  generationLimit = 128,
  translationsByCharacter = new Map(),
  phoneticsByConcept = new Map(),
  noFitCharacters = new Set(),
  specificityReassignments = new Set()
} = {}) {
  if (!Array.isArray(records)) throw invalid("atom proposal stage requires character records");
  const selected = records.filter((record) => record.status !== "already-mapped")
    .slice(0, Math.max(1, Math.trunc(Number(generationLimit) || 128)));
  const targets = atomTargets(inputs.atomEntries, inputs.grammarTargets ?? []);
  const targetIndex = atomTargetIndex(targets);
  const proposals = [];
  for (const record of selected) {
    const translatedMeanings = translationsByCharacter.get(record.id)?.translations ?? [];
    const translatedEnglish = unique(translatedMeanings.map((row) => row.english));
    const exactTranslatedTargets = candidateEnglishPhrases(translatedEnglish, targetIndex);
    const relatedTranslatedTargets = exactTranslatedTargets.length > 0
      ? []
      : lexicalCandidateTargets(translatedEnglish, targetIndex, exactTranslatedTargets);
    const allowSpecificityReassignment = record.specificityConflict
      && specificityReassignments.has(record.id)
      && translatedMeanings.length > 0;
    const allowNewAtomAfterNoFit = noFitCharacters.has(record.id)
      && (record.specificityConflict ? allowSpecificityReassignment : (record.exactAtomCandidates?.length ?? 0) === 0);
    const existingAtomCandidates = mergeAtomTargets(
      allowNewAtomAfterNoFit ? [] : (record.existingAtomCandidates ?? []),
      exactTranslatedTargets,
      relatedTranslatedTargets
    );
    const enriched = {
      ...record,
      translatedMeanings,
      existingAtomCandidates,
      exactAtomCandidates: mergeAtomTargets(
        allowNewAtomAfterNoFit ? [] : (record.exactAtomCandidates ?? []),
        exactTranslatedTargets
      ),
      specificityReviewRequired: Boolean(record.specificityReviewRequired || record.specificityConflict),
      specificityConflict: record.specificityConflict && !allowSpecificityReassignment,
      englishCandidates: unique([...(record.englishCandidates ?? []), ...translatedEnglish])
    };
    if (existingAtomCandidates.length > 0 || enriched.specificityConflict) {
      proposals.push({ ...enriched, atomWordProposals: [], stageStatus: "review-existing-atom" });
      continue;
    }
    const concepts = allowSpecificityReassignment
      ? translatedEnglish
      : unique([...(record.englishCandidates ?? []), ...translatedEnglish]);
    if (concepts.length === 0) {
      proposals.push({
        ...enriched,
        atomWordProposals: [],
        translationRequest: buildChineseCharacterTranslationPrompt(enriched),
        stageStatus: "translation-pending"
      });
      continue;
    }
    const atomWordProposals = [];
    for (const concept of concepts.slice(0, 4)) {
      const phoneticEvidence = phoneticsByConcept.get(normalizeEnglish(concept)) ?? [];
      const generation = candidatePhonetics(inputs.generation, concept, phoneticEvidence);
      const proposal = buildAtomWordProposal({
        concept,
        ...generation,
        existingEntries: inputs.atomEntries,
        reservedEntries: generation.reservedEntries
      });
      atomWordProposals.push({ concept, proposal });
    }
    const missingPhonetics = atomWordProposals.filter((row) => row.proposal.status === "missing-phonetic-evidence");
    proposals.push({
      ...enriched,
      atomWordProposals,
      phoneticEvidenceRequests: missingPhonetics.map(({ concept }) => ({
        concept,
        prompt: buildChineseCharacterPhoneticEvidencePrompt(concept, enriched)
      })),
      stageStatus: missingPhonetics.length > 0 ? "phonetic-evidence-pending" : "atom-candidates-ready"
    });
  }
  return proposals;
}

export function renderChineseCharacterAtomRefineryPya(records, {
  name = "translation_chinese_character_atom_refinery_review",
  sourceHash = "",
  sourceHashes = {},
  runId = ""
} = {}) {
  const lines = [
    `su name ${name} be map def`,
    `su text "format" ob text ${JSON.stringify(CHINESE_CHARACTER_ATOM_REFINERY_FORMAT)} ya`,
    `su text "run-id" ob text ${JSON.stringify(runId)} ya`,
    `su text "source-hash" ob text ${JSON.stringify(sourceHash)} ya`,
    `su text "source-hashes" ob text ${JSON.stringify(JSON.stringify(sourceHashes))} ya`,
    `su text "record-count" ob num ${records.length} ya`
  ];
  for (const record of records) {
    lines.push(`su text ${JSON.stringify(record.id)} ob text ${JSON.stringify(JSON.stringify(record))} ya`);
  }
  lines.push("prah", "");
  return lines.join("\n");
}

export function renderChineseCharacterAtomLinksPya(links = []) {
  const rows = [
    `su name ${CHINESE_CHARACTER_ATOM_LINKS_NAME} be map def`,
    `su text "meta:format" ob text ${JSON.stringify("chinese-character-atom-links-v1")} ya`
  ];
  for (const link of links) {
    if (link.status !== "accepted" && link.status !== "withdrawn") continue;
    const character = text(link.character);
    const pya = text(link.pya);
    const english = text(link.english);
    if ([...character].length !== 1 || !HAN.test(character) || !pya || !english) {
      throw invalid("promoted Chinese character links require one Han character, English, and Pyash target", { link });
    }
    const key = link.status === "withdrawn"
      ? `withdraw:${character}:${pya}`
      : `link:${character}:${pya}`;
    rows.push(`su text ${JSON.stringify(key)} ob text ${JSON.stringify(JSON.stringify(link))} ya`);
  }
  rows.push("prah", "");
  return rows.join("\n");
}

export function acceptedChineseCharacterAtomRows(kwonRows = [], linkRows = []) {
  const withdrawn = new Set(linkRows.filter((row) => row.status === "withdrawn")
    .map((row) => `${text(row.character)}\u0000${text(row.pya)}`));
  const rows = kwonRows.flatMap((row) => {
    const character = text(row?.zh);
    const pya = text(row?.pya);
    const english = text(row?.en);
    if ([...character].length !== 1 || !HAN.test(character) || !english || pya.split(/\s+/u).length !== 1) return [];
    if (withdrawn.has(`${character}\u0000${pya}`)) return [];
    return [{ character, english, pya, source: "kwon" }];
  });
  for (const row of linkRows) {
    if (row.status !== "accepted") continue;
    const character = text(row.character);
    const english = text(row.english);
    const pya = text(row.pya);
    if ([...character].length !== 1 || !HAN.test(character) || !english || pya.split(/\s+/u).length !== 1) continue;
    if (rows.some((existing) => existing.character === character && existing.pya === pya)) continue;
    rows.push({ character, english, pya, source: "pyash-curated" });
  }
  return rows.sort((left, right) => codePointSort(left.character, right.character)
    || left.english.localeCompare(right.english)
    || left.pya.localeCompare(right.pya));
}

export async function generateChineseCharacterAtomReview({
  inputs,
  generationLimit = 128,
  outputPath = path.join(DEFAULT_CHINESE_CHARACTER_ATOM_ARTIFACT_ROOT, "review.pya")
} = {}) {
  const loaded = inputs ?? await loadChineseCharacterAtomRefineryInputs();
  const worklist = buildChineseCharacterAtomWorklist(loaded);
  const proposals = await buildChineseCharacterAtomProposals(worklist, loaded, { generationLimit });
  const content = renderChineseCharacterAtomRefineryPya(proposals, {
    sourceHash: loaded.sourceHash,
    sourceHashes: loaded.sourceHashes,
    runId: `chinese-character-atom-${loaded.sourceHash.slice(0, 16)}`
  });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, content, "utf8");
  return {
    outputPath,
    sourceHash: loaded.sourceHash,
    standardCharacterCount: loaded.unihan.size,
    worklistCount: worklist.length,
    processedCount: proposals.length,
    statusCounts: proposals.reduce((counts, row) => {
      counts[row.stageStatus] = (counts[row.stageStatus] ?? 0) + 1;
      return counts;
    }, {}),
    proposals
  };
}

export function parseChineseCharacterAtomReviewPya(source) {
  if (typeof source !== "string") throw invalid("Chinese character review artifact must be Pyash text");
  const records = [];
  for (const sentence of buildProgram(source).sentences) {
    if (sentence?.mood !== "ya" || typeof sentence.su?.text !== "string" || typeof sentence.ob?.text !== "string") continue;
    if (!sentence.su.text.startsWith("zh-char-")) continue;
    try {
      records.push(JSON.parse(sentence.ob.text));
    } catch (error) {
      throw invalid("Chinese character review record is malformed", { id: sentence.su.text, cause: error.message });
    }
  }
  return records;
}

export function renderChineseCharacterAtomCheckpointPya({ runId = "", sourceHash = "", tasks = [] } = {}) {
  const lines = [
    "su name translation_chinese_character_atom_refinery_checkpoint be map def",
    `su text "format" ob text ${JSON.stringify("chinese-character-atom-refinery-checkpoint-v1")} ya`,
    `su text "run-id" ob text ${JSON.stringify(runId)} ya`,
    `su text "source-hash" ob text ${JSON.stringify(sourceHash)} ya`
  ];
  for (const task of tasks) {
    if (!text(task?.key) || !["queued", "completed"].includes(task.status)) continue;
    lines.push(`su text ${JSON.stringify(`task:${task.key}`)} ob text ${JSON.stringify(JSON.stringify(task))} ya`);
  }
  lines.push("prah", "");
  return lines.join("\n");
}

export function parseChineseCharacterAtomCheckpointPya(source) {
  if (typeof source !== "string") throw invalid("Chinese character checkpoint must be Pyash text");
  const tasks = new Map();
  let runId = "";
  let sourceHash = "";
  for (const sentence of buildProgram(source).sentences) {
    if (sentence?.mood !== "ya" || typeof sentence.su?.text !== "string" || typeof sentence.ob?.text !== "string") continue;
    if (sentence.su.text === "run-id") runId = sentence.ob.text;
    else if (sentence.su.text === "source-hash") sourceHash = sentence.ob.text;
    else if (sentence.su.text.startsWith("task:")) {
      try {
        const task = JSON.parse(sentence.ob.text);
        if (task?.key && ["queued", "completed"].includes(task.status)) tasks.set(task.key, task);
      } catch (error) {
        throw invalid("Chinese character checkpoint task is malformed", { key: sentence.su.text, cause: error.message });
      }
    }
  }
  return { runId, sourceHash, tasks };
}

export function chineseCharacterAtomSourceHash(sourceHashes) {
  return hash(JSON.stringify(sourceHashes ?? {}));
}

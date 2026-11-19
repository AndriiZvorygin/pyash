import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { JSDOM } from "jsdom";

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
    verdict: { type: "string", enum: ["match", "no-fit", "uncertain"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    matches: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["targetId", "senseId", "relation", "rationale"],
        properties: {
          targetId: { type: "string" },
          senseId: { type: "string" },
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
  cowCharacterSenses: path.join(REPOSITORY_ROOT, "sino-pyash", "sources", "chinese-open-wordnet-1.1", "cow-1.1.tar.xz"),
  analectsWenYen: path.join(REPOSITORY_ROOT, "sino-pyash", "sources", "classical-chinese", "analects", "gutenberg-23839-wen-yen.txt"),
  kwonChinese: path.join(REPOSITORY_ROOT, "caterer", "pyac", "lyac", "kwon_zh.json"),
  acceptedLinks: path.join(REPOSITORY_ROOT, "program", "library", "translation", "chinese_character_atom_links.pya"),
  englishGrammar: path.join(REPOSITORY_ROOT, "program", "library", "translation", "english_grammar.pya")
});

const HAN = /\p{Script=Han}/u;
const WORDNET_PARTS_OF_SPEECH = new Set(["a", "n", "r", "s", "v"]);
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

function normalizeMandarinReading(value) {
  const reading = text(value).toLowerCase().replace(/u:/gu, "v").replace(/ü/gu, "v");
  const numbered = reading.match(/^(.+?)([0-5])$/u);
  const decomposed = (numbered?.[1] ?? reading).normalize("NFD");
  let tone = numbered ? Number(numbered[2]) : 0;
  let base = "";
  for (const character of decomposed) {
    if (character === "\u0304") tone ||= 1;
    else if (character === "\u0301") tone ||= 2;
    else if (character === "\u030c") tone ||= 3;
    else if (character === "\u0300") tone ||= 4;
    else if (!/\p{M}/u.test(character)) base += character;
  }
  return { base, tone };
}

function cedictRowsForPrimaryReadings(rows, mandarinReadings = []) {
  const readings = mandarinReadings.map(normalizeMandarinReading).filter((reading) => reading.base);
  const matching = readings.length === 0 ? [] : rows.filter((row) => {
    const candidate = normalizeMandarinReading(row.pinyin);
    return readings.some((reading) => reading.base === candidate.base
      && (!reading.tone || !candidate.tone || reading.tone === candidate.tone));
  });
  const relevant = matching.length > 0 ? matching : rows;
  return relevant.filter((row) => !row.definitions.some((definition) => (
    /^(?:abbr(?:eviation)?\.?\s+for|(?:old\s+)?variant\s+of)\b/iu.test(definition.trim())
  )));
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

export function parseChineseOpenWordNetCharacterSenses(source) {
  if (typeof source !== "string" || !source.trim()) {
    throw invalid("Chinese Open Wordnet source must be XML text");
  }
  let document;
  try {
    document = new JSDOM(source, { contentType: "text/xml" }).window.document;
  } catch (error) {
    throw invalid("Chinese Open Wordnet XML is malformed", { cause: error.message });
  }
  if (document.querySelector("parsererror")) throw invalid("Chinese Open Wordnet XML is malformed");
  const lexicon = [...document.querySelectorAll("Lexicon")]
    .find((entry) => entry.getAttribute("id") === "cow");
  if (!lexicon || lexicon.getAttribute("version") !== "1.1") {
    throw invalid("Chinese Open Wordnet source must be COW 1.1");
  }
  const synsets = new Map([...lexicon.querySelectorAll("Synset")].map((synset) => [
    synset.getAttribute("id"),
    {
      ili: text(synset.getAttribute("ili")),
      partOfSpeech: text(synset.getAttribute("partOfSpeech"))
    }
  ]).filter(([id]) => id));
  const rows = new Map();
  for (const entry of lexicon.querySelectorAll("LexicalEntry")) {
    const lemma = entry.querySelector("Lemma");
    const character = text(lemma?.getAttribute("writtenForm"));
    if ([...character].length !== 1 || !HAN.test(character)) continue;
    for (const sense of entry.querySelectorAll("Sense")) {
      const cowSynset = text(sense.getAttribute("synset"));
      const synset = synsets.get(cowSynset);
      if (!synset?.ili || !/^i[0-9]+$/u.test(synset.ili)) continue;
      if (!WORDNET_PARTS_OF_SPEECH.has(synset.partOfSpeech)) continue;
      const key = `${character}\u0000${synset.ili}\u0000${synset.partOfSpeech}`;
      const row = rows.get(key) ?? {
        character,
        ili: synset.ili,
        partOfSpeech: synset.partOfSpeech,
        cowSynsets: []
      };
      if (!row.cowSynsets.includes(cowSynset)) row.cowSynsets.push(cowSynset);
      rows.set(key, row);
    }
  }
  return [...rows.values()].map((row) => ({
    ...row,
    cowSynsets: row.cowSynsets.sort(codePointSort)
  })).sort((left, right) => codePointSort(left.character, right.character)
    || left.ili.localeCompare(right.ili)
    || left.partOfSpeech.localeCompare(right.partOfSpeech));
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
    kwonSource, acceptedLinksSource, grammarSource, cowArchive] = await Promise.all([
    fs.readFile(paths.subtlex, "utf8"),
    readUnihanFile(paths.unihanArchive, "Unihan_Readings.txt"),
    readUnihanFile(paths.unihanArchive, "Unihan_OtherMappings.txt"),
    fs.readFile(paths.cedict, "utf8"),
    fs.readFile(paths.shuowen, "utf8"),
    fs.readFile(paths.analectsWenYen, "utf8"),
    fs.readFile(paths.kwonChinese, "utf8"),
    fs.readFile(paths.acceptedLinks, "utf8").catch((error) => error?.code === "ENOENT" ? "" : Promise.reject(error)),
    fs.readFile(paths.englishGrammar, "utf8"),
    fs.readFile(paths.cowCharacterSenses)
  ]);
  const cowXml = await execFileAsync("tar", ["-xOf", paths.cowCharacterSenses, "cow/cow-1.1.xml"], {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024
  });
  const cowCharacterSenses = parseChineseOpenWordNetCharacterSenses(cowXml.stdout);
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
  const grammarCatalog = parseEnglishGrammarCatalog(grammarSource);
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
    cowCharacterSenses: hash(cowArchive),
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
    cowCharacterSenses,
    grammarTargets,
    grammarCharacterLinks: grammarCatalog.chineseCharacterLinks,
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

function atomTargets(atomEntries, grammarTargets, { rootAtomsOnly = false } = {}) {
  const atoms = (atomEntries ?? []).filter((row) => text(row?.en) && text(row?.pya))
    .filter((row) => !rootAtomsOnly || !isUnderscoreMarkedEnglish(row.en))
    .map((row) => ({ id: `atom:${text(row.pya)}`, kind: "atom", english: text(row.en), pya: text(row.pya) }));
  return [...atoms, ...(rootAtomsOnly ? [] : grammarTargets)];
}

function isUnderscoreMarkedEnglish(value) {
  const english = text(value);
  return english.startsWith("_") || english.endsWith("_");
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

function candidateEnglishPhrases(terms, targetIndex, isEligible = () => true) {
  const exact = new Map();
  const normalizedTerms = unique(terms.map(normalizeEnglish));
  for (const term of normalizedTerms) {
    for (const [id, candidate] of targetIndex.exactByAlias.get(term) ?? []) {
      if (!isEligible(candidate.target)) continue;
      if (!exact.has(id) || exact.get(id).index < candidate.index) exact.set(id, candidate);
    }
  }
  return [...exact.entries()]
    .sort(([left], [right]) => targetIndex.firstIndexById.get(left) - targetIndex.firstIndexById.get(right))
    .map(([, candidate]) => candidate.target);
}

function lexicalCandidateTargets(terms, targetIndex, exactTargets, isEligible = () => true) {
  const exactIds = new Set(exactTargets.map((target) => `${target.kind}:${target.pya}`));
  const heads = unique(terms.flatMap((term) => normalizeEnglish(term).split(" ")))
    .filter((token) => token.length >= 4);
  const scores = new Map();
  const addScore = (row, score) => {
    if (!isEligible(row.target) || exactIds.has(`${row.target.kind}:${row.target.pya}`)) return;
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

function compareCharacterFrequency(left, right) {
  const leftHasSubtlex = Number.isSafeInteger(left.frequency?.subtlexRank);
  const rightHasSubtlex = Number.isSafeInteger(right.frequency?.subtlexRank);
  if (leftHasSubtlex !== rightHasSubtlex) return leftHasSubtlex ? -1 : 1;
  if (leftHasSubtlex && left.frequency.subtlexRank !== right.frequency.subtlexRank) {
    return left.frequency.subtlexRank - right.frequency.subtlexRank;
  }
  const leftHasJunda = Number.isSafeInteger(left.frequency?.jundaRank);
  const rightHasJunda = Number.isSafeInteger(right.frequency?.jundaRank);
  if (leftHasJunda !== rightHasJunda) return leftHasJunda ? -1 : 1;
  if (leftHasJunda && left.frequency.jundaRank !== right.frequency.jundaRank) {
    return left.frequency.jundaRank - right.frequency.jundaRank;
  }
  return (left.standardIndex ?? Number.MAX_SAFE_INTEGER) - (right.standardIndex ?? Number.MAX_SAFE_INTEGER)
    || codePointSort(left.character, right.character);
}

export function hasCowDirectAtomCandidate(record) {
  return Number(record?.cowFrequencyCandidateCount) > 0 || (record?.existingAtomCandidates ?? []).some((candidate) => (
    candidate?.kind === "atom" && (candidate.candidateSources ?? []).includes("cow-direct")
  ));
}

function rankedCowCandidates(record) {
  const candidates = (record?.existingAtomCandidates ?? []).filter((candidate) => (
    candidate?.kind === "atom" && (candidate.candidateSources ?? []).includes("cow-direct")
  )).map((candidate) => {
    const senses = (candidate.wordnetSenses ?? []).filter((sense) => sense.cowLinked === true
      && Number.isSafeInteger(sense.frequencyRank) && sense.frequencyRank > 0);
    if (senses.length === 0) return null;
    const frequencyRank = Math.min(...senses.map((sense) => sense.frequencyRank));
    const bestSenses = senses.filter((sense) => sense.frequencyRank === frequencyRank);
    const tagCounts = bestSenses.map((sense) => sense.frequencyTagCount)
      .filter((count) => Number.isSafeInteger(count) && count >= 0);
    const frequencyTagCount = tagCounts.length === bestSenses.length && tagCounts.length > 0
      ? Math.max(...tagCounts)
      : null;
    const rankedSenses = [...bestSenses].sort((left, right) => (
      (Number.isSafeInteger(right.frequencyTagCount) ? right.frequencyTagCount : -1)
        - (Number.isSafeInteger(left.frequencyTagCount) ? left.frequencyTagCount : -1)
      || text(left.senseId).localeCompare(text(right.senseId))
    ));
    return {
      candidate,
      frequencyRank,
      frequencyTagCount,
      frequencyLemma: rankedSenses.find((sense) => text(sense.frequencyLemma))?.frequencyLemma ?? "",
      senseId: text(rankedSenses[0]?.senseId)
    };
  }).filter(Boolean);

  const byRank = new Map();
  for (const row of candidates) {
    const group = byRank.get(row.frequencyRank) ?? [];
    group.push(row);
    byRank.set(row.frequencyRank, group);
  }
  const tiers = [];
  for (const rank of [...byRank.keys()].sort((left, right) => left - right)) {
    const rankGroup = byRank.get(rank);
    // Princeton counts break English30k ties only when every tied target has a count.
    if (rankGroup.length > 1 && rankGroup.every((row) => Number.isSafeInteger(row.frequencyTagCount))) {
      const byTagCount = new Map();
      for (const row of rankGroup) {
        const group = byTagCount.get(row.frequencyTagCount) ?? [];
        group.push(row);
        byTagCount.set(row.frequencyTagCount, group);
      }
      for (const tagCount of [...byTagCount.keys()].sort((left, right) => right - left)) {
        tiers.push(byTagCount.get(tagCount));
      }
    } else {
      tiers.push(rankGroup);
    }
  }
  return { candidates, tiers };
}

export function highFrequencyCowCharacterAtomLinks(records = [], existingLinks = []) {
  if (!Array.isArray(records) || !Array.isArray(existingLinks)) {
    throw invalid("COW frequency allocation requires record and link arrays");
  }
  const accepted = existingLinks.filter((link) => link.status === "accepted");
  const ownersByPya = new Map();
  const linkedCharacters = new Set();
  for (const link of accepted) {
    const character = text(link.character);
    const pya = text(link.pya);
    linkedCharacters.add(character);
    const owners = ownersByPya.get(pya) ?? new Set();
    owners.add(character);
    ownersByPya.set(pya, owners);
  }
  const localAcceptedByCharacter = new Map(accepted
    .filter((link) => ["chinese-character-atom-refinery", "cow-frequency-allocation"].includes(link.source))
    .map((link) => [text(link.character), link]));
  const changes = [];
  const decisions = new Map();

  for (const record of [...records].filter(hasCowDirectAtomCandidate).sort(compareCharacterFrequency)) {
    const character = text(record.character);
    const { candidates, tiers } = rankedCowCandidates(record);
    const currentLink = localAcceptedByCharacter.get(character);
    const canReplaceCurrent = currentLink && record.cowReviewRequired === true;
    if (!canReplaceCurrent && (linkedCharacters.has(character) || (record.existingMappings ?? []).length > 0)) {
      decisions.set(character, { status: "already-linked" });
      continue;
    }
    if (candidates.length === 0) {
      decisions.set(character, {
        status: Number(record.cowFrequencyBlockedCandidateCount) > 0
          ? "all-targets-already-linked"
          : "no-english30k-frequency"
      });
      continue;
    }

    let selected;
    let tied = false;
    // Characters are processed by SUBTLEX/Jun Da order; an owned target allows the next tier.
    for (const tier of tiers) {
      const available = tier.filter(({ candidate }) => {
        const owners = ownersByPya.get(text(candidate.pya));
        return !owners || (owners.size === 1 && owners.has(character));
      });
      if (available.length === 0) continue;
      if (available.length > 1) {
        tied = true;
        break;
      }
      selected = available[0];
      break;
    }
    if (!selected) {
      decisions.set(character, {
        status: tied ? "unresolved-frequency-tie" : "all-targets-already-linked",
        candidateCount: candidates.length
      });
      continue;
    }

    const link = {
      character,
      english: text(selected.candidate.english),
      pya: text(selected.candidate.pya),
      status: "accepted",
      source: "cow-frequency-allocation",
      confidence: "high",
      wordNetSenseId: selected.senseId,
      frequencyRank: selected.frequencyRank,
      frequencyTagCount: selected.frequencyTagCount,
      ...(selected.frequencyLemma ? { frequencyLemma: selected.frequencyLemma } : {})
    };
    if (currentLink && text(currentLink.pya) !== link.pya) {
      const currentOwners = ownersByPya.get(text(currentLink.pya));
      currentOwners?.delete(character);
      if (currentOwners?.size === 0) ownersByPya.delete(text(currentLink.pya));
      changes.push({
        character,
        english: text(currentLink.english),
        pya: text(currentLink.pya),
        status: "withdrawn",
        source: currentLink.source
      });
    } else if (currentLink) {
      decisions.set(character, {
        status: "already-current-frequency-winner",
        pya: link.pya,
        frequencyRank: link.frequencyRank,
        frequencyTagCount: link.frequencyTagCount,
        wordNetSenseId: link.wordNetSenseId
      });
      continue;
    }
    changes.push(link);
    const owners = ownersByPya.get(link.pya) ?? new Set();
    owners.add(character);
    ownersByPya.set(link.pya, owners);
    linkedCharacters.add(character);
    localAcceptedByCharacter.set(character, link);
    decisions.set(character, {
      status: currentLink ? "updated" : "promoted",
      pya: link.pya,
      english: link.english,
      frequencyRank: link.frequencyRank,
      frequencyTagCount: link.frequencyTagCount,
      wordNetSenseId: link.wordNetSenseId
    });
  }
  return { changes, decisions };
}

export function reconcileChineseCharacterAtomLinkConflicts(inputs) {
  if (!Array.isArray(inputs?.acceptedLinks) || !Array.isArray(inputs?.grammarCharacterLinks)) {
    throw invalid("Chinese character link reconciliation requires parsed accepted and grammar links");
  }
  const acceptedLinks = inputs.acceptedLinks.map((link) => ({ ...link }));
  const atomEnglishByPya = new Map((inputs.atomEntries ?? [])
    .filter((row) => text(row?.pya) && text(row?.en))
    .map((row) => [text(row.pya), text(row.en)]));
  const withdrawn = [];
  for (const link of acceptedLinks) {
    if (link.status !== "accepted") continue;
    const english = atomEnglishByPya.get(text(link.pya)) ?? text(link.english);
    if (!isUnderscoreMarkedEnglish(english)) continue;
    link.status = "withdrawn";
    withdrawn.push({ character: text(link.character), pya: text(link.pya) });
  }
  const grammarCharacters = new Set(inputs.grammarCharacterLinks
    .filter((link) => link.source === "chinese-character-grammar-refinery")
    .map((link) => text(link.character)));
  const rootCharacters = new Set(acceptedLinks
    .filter((link) => link.status === "accepted")
    .map((link) => text(link.character)));
  const grammarCharactersToRemove = [...grammarCharacters]
    .filter((character) => rootCharacters.has(character))
    .sort(codePointSort);

  const byPya = new Map();
  for (const link of acceptedLinks) {
    if (link.status !== "accepted") continue;
    const rows = byPya.get(text(link.pya)) ?? [];
    rows.push(link);
    byPya.set(text(link.pya), rows);
  }
  for (const rows of byPya.values()) {
    if (rows.length < 2) continue;
    const ranked = rows.map((link) => ({
      link,
      character: text(link.character),
      standardIndex: inputs.unihan?.get(text(link.character))?.standardIndex,
      frequency: {
        subtlexRank: inputs.subtlex?.get(text(link.character))?.rank ?? null,
        jundaRank: inputs.junda?.get(text(link.character))?.rank ?? null
      }
    })).sort(compareCharacterFrequency);
    for (const row of ranked.slice(1)) {
      row.link.status = "withdrawn";
      withdrawn.push({ character: row.link.character, pya: row.link.pya });
    }
  }
  return { acceptedLinks, grammarCharactersToRemove, withdrawn };
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

export function buildChineseCharacterAtomWorklist(inputs, { includeMapped = true, rootAtomsOnly = false } = {}) {
  if (!inputs?.unihan || !inputs?.subtlex || !Array.isArray(inputs.atomEntries)) {
    throw invalid("Chinese character worklist requires parsed source inputs");
  }
  const mappings = oneCharacterMappings(inputs.kwonRows, inputs.acceptedLinks);
  const grammarLinkedCharacters = new Set((inputs.grammarCharacterLinks ?? [])
    .map((link) => text(link.character))
    .filter(Boolean));
  const atomTargetRows = atomTargets(inputs.atomEntries, [], { rootAtomsOnly });
  const atomByPya = new Map(atomTargetRows.map((target) => [target.pya, target]));
  const sensesByPya = new Map();
  for (const row of inputs.wordnetSenseTargets ?? []) {
    const pya = text(row?.pya ?? row?.pyashSequence?.[0]);
    const senseId = text(row?.senseId ?? row?.source);
    if (!pya || !atomByPya.has(pya) || !senseId || row?.targetKind !== "atom"
      || row?.pyashSequence?.length !== 1 || !text(row?.gloss)) continue;
    const senses = sensesByPya.get(pya) ?? [];
    senses.push({
      senseId,
      ili: text(row.ili),
      partOfSpeech: text(row.partOfSpeech ?? row.targetPartOfSpeech),
      gloss: text(row.gloss),
      lemmas: unique((row.lemmas ?? []).map(text).filter(Boolean)),
      frequencyRank: Number.isSafeInteger(row.frequencyRank) && row.frequencyRank > 0 ? row.frequencyRank : null,
      frequencyTagCount: Number.isSafeInteger(row.frequencyTagCount) && row.frequencyTagCount >= 0
        ? row.frequencyTagCount
        : null,
      frequencyLemma: text(row.frequencyLemma),
      cowSynsets: []
    });
    sensesByPya.set(pya, senses);
  }
  const targets = atomTargetRows.filter((target) => sensesByPya.has(target.pya));
  const targetIndex = atomTargetIndex(targets);
  const pyasByIli = new Map();
  for (const [pya, senses] of sensesByPya) {
    for (const sense of senses) {
      if (!sense.ili) continue;
      const pyas = pyasByIli.get(sense.ili) ?? new Set();
      pyas.add(pya);
      pyasByIli.set(sense.ili, pyas);
    }
  }
  const linkedCharactersByPya = new Map();
  for (const [character, rows] of mappings) {
    for (const row of rows) {
      const owners = linkedCharactersByPya.get(row.pya) ?? new Set();
      owners.add(character);
      linkedCharactersByPya.set(row.pya, owners);
    }
  }
  for (const link of inputs.grammarCharacterLinks ?? []) {
    const pya = text(link.pya);
    const character = text(link.character);
    if (!pya || !character) continue;
    const owners = linkedCharactersByPya.get(pya) ?? new Set();
    owners.add(character);
    linkedCharactersByPya.set(pya, owners);
  }
  const canUseTarget = (character, pya) => {
    const owners = linkedCharactersByPya.get(pya);
    return !owners || (owners.size === 1 && owners.has(character));
  };
  const cowSensesByCharacter = new Map();
  for (const row of inputs.cowCharacterSenses ?? []) {
    const character = text(row.character);
    const rows = cowSensesByCharacter.get(character) ?? [];
    rows.push(row);
    cowSensesByCharacter.set(character, rows);
  }
  const records = [];
  for (const [character, unihan] of inputs.unihan) {
    if (grammarLinkedCharacters.has(character)) continue;
    const cedictRows = cedictRowsForPrimaryReadings(
      inputs.cedict.get(character) ?? [],
      unihan.readings?.Mandarin ?? []
    );
    const existingMappings = mappings.get(character) ?? [];
    const explicitContrast = hasExplicitContrast(cedictRows);
    const relatedCharacters = counterpartRows(character, cedictRows, inputs.subtlex, inputs.junda);
    const english = englishHeads(cedictRows, unihan.unihanDefinition ?? "");
    const isEligibleTarget = (target) => canUseTarget(character, target.pya);
    const exactTargetRows = candidateEnglishPhrases(english, targetIndex, isEligibleTarget);
    const lexicalTargetRows = lexicalCandidateTargets(english, targetIndex, exactTargetRows, isEligibleTarget);
    const cowRows = cowSensesByCharacter.get(character) ?? [];
    const cowTargetRows = [];
    const cowPya = new Set();
    for (const row of cowRows) {
      for (const pya of pyasByIli.get(text(row.ili)) ?? []) cowPya.add(pya);
    }
    let cowFrequencyCandidateCount = 0;
    let cowFrequencyBlockedCandidateCount = 0;
    for (const pya of cowPya) {
      const target = atomByPya.get(pya);
      if (!target) continue;
      cowFrequencyCandidateCount += 1;
      if (!canUseTarget(character, pya)) {
        cowFrequencyBlockedCandidateCount += 1;
        continue;
      }
      cowTargetRows.push({ ...target, candidateSource: "cow-direct" });
    }
    const currentTargetRows = existingMappings.flatMap((mapping) => {
      const target = atomByPya.get(mapping.pya);
      return target && canUseTarget(character, mapping.pya) ? [{ ...target, candidateSource: "current-link" }] : [];
    });
    const cowSuggestedPyas = new Set(cowTargetRows.map((target) => target.pya));
    const currentPyas = new Set(existingMappings.map((mapping) => mapping.pya));
    const cowReviewRequired = existingMappings.some((mapping) => mapping.kind === "pyash-curated")
      && [...cowSuggestedPyas].some((pya) => !currentPyas.has(pya));
    const reviewMapped = cowReviewRequired || (includeMapped && explicitContrast);
    if (existingMappings.length > 0 && !reviewMapped) continue;
    const frequency = inputs.subtlex.get(character) ?? null;
    const currentLinkIsGeneric = explicitContrast
      && relatedCharacters.some((related) => related.rankRelation === "less-frequent")
      && existingMappings.some((mapping) => (
        english.some((term) => normalizeEnglish(term) === normalizeEnglish(mapping.english))
      ));
    const candidateTargets = [...cowTargetRows, ...exactTargetRows, ...lexicalTargetRows, ...currentTargetRows];
    const candidateSourcesByPya = new Map();
    for (const target of candidateTargets) {
      const sources = candidateSourcesByPya.get(target.pya) ?? [];
      const source = target.candidateSource ?? (exactTargetRows.some((row) => row.pya === target.pya)
        ? "dictionary-exact"
        : "dictionary-lexical");
      if (!sources.includes(source)) sources.push(source);
      candidateSourcesByPya.set(target.pya, sources);
    }
    const uniqueCandidates = new Map();
    for (const target of candidateTargets) {
      if (uniqueCandidates.has(target.pya)) continue;
      const candidateMetadata = candidateTargets.find((row) => row.pya === target.pya);
      const senses = (sensesByPya.get(target.pya) ?? []).map((sense) => {
        const cowRowsForSense = cowRows.filter((row) => text(row.ili) && text(row.ili) === sense.ili);
        return {
          ...sense,
          cowLinked: cowRowsForSense.length > 0,
          ...(cowRowsForSense.length > 0
            ? { cowSynsets: unique(cowRowsForSense.flatMap((row) => row.cowSynsets ?? [])) }
            : {})
        };
      }).sort((left, right) => Number(right.cowLinked) - Number(left.cowLinked)
        || left.senseId.localeCompare(right.senseId));
      uniqueCandidates.set(target.pya, {
        ...atomByPya.get(target.pya),
        id: `atom:${target.pya}`,
        ...(Number.isSafeInteger(candidateMetadata?.candidateRank) ? { candidateRank: candidateMetadata.candidateRank } : {}),
        ...(Number.isSafeInteger(candidateMetadata?.lexicalMatchScore) ? { lexicalMatchScore: candidateMetadata.lexicalMatchScore } : {}),
        wordnetSenses: senses,
        candidateSources: candidateSourcesByPya.get(target.pya) ?? []
      });
    }
    const exactCandidates = exactTargetRows
      .filter((target) => uniqueCandidates.has(target.pya))
      .map((target) => uniqueCandidates.get(target.pya));
    const cowReview = cowReviewRequired
      ? {
        status: "reassess-current-link",
        currentMappings: existingMappings.filter((mapping) => mapping.kind === "pyash-curated"),
        cowCandidates: [...cowSuggestedPyas].filter((pya) => !currentPyas.has(pya))
      }
      : null;
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
      existingAtomCandidates: [...uniqueCandidates.values()],
      cowFrequencyCandidateCount,
      cowFrequencyBlockedCandidateCount,
      exactAtomCandidates: exactCandidates,
      relatedCharacters,
      specificityConflict: currentLinkIsGeneric,
      cowReviewRequired,
      ...(cowReview ? { cowReview } : {}),
      reviewPriority: currentLinkIsGeneric || cowReviewRequired ? 0 : 1,
      status: existingMappings.length > 0
        ? (cowReviewRequired ? "cow-link-review" : currentLinkIsGeneric ? "specificity-review" : "already-mapped")
        : exactCandidates.length > 0
          ? "existing-atom-candidates"
          : uniqueCandidates.size > 0
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
    "Compare the character's standalone Chinese meanings with the supplied WordNet sense definitions already linked to each Pyash atom. The atom's English label is only the destination label, not semantic evidence. Do not invent targets, treat a shared broad gloss as identical meaning, or decide which Chinese character is more frequent.",
    "Use the supplied Unihan Mandarin reading and standalone dictionary senses. Do not select a meaning that appears only as an abbreviation or inside another word.",
    "For each atom, choose its best fitting supplied WordNet sense and return that senseId with the atom targetId. Rank atoms by the fit of those linked WordNet definitions. COW direct character-to-synset evidence identifies an exact Chinese lexical sense, but still compare its WordNet definition with the supplied Chinese meanings. Omit atoms whose linked senses do not fit.",
    "Use relation base for the ordinary standalone meaning, same-sense for a direct equivalent, or marked when the Chinese meaning adds a register or semantic qualifier. Return JSON with verdict (match, no-fit, or uncertain), confidence (high, medium, or low), ranked matches (targetId, senseId, relation, rationale), and rationale.",
    "Use high confidence for direct dictionary support and medium for a plausible fit with some ambiguity. The deterministic allocator handles character frequency and one-to-one assignment after this semantic review. Marked meanings are outside this base-link pass.",
    `Character: ${record.character}`,
    `Unihan Mandarin reading(s): ${JSON.stringify(record.readings?.Mandarin ?? [])}`,
    `English glosses: ${JSON.stringify(record.englishCandidates ?? [])}`,
    `CC-CEDICT evidence: ${JSON.stringify(cedict)}`,
    `Unihan definition: ${(record.evidence?.unihanDefinition ?? "").slice(0, 500)}`,
    `Shuowen definition: ${(record.evidence?.shuowen ?? "").slice(0, 500)}`,
    `Classical contexts (attestation only, not a standalone gloss): ${JSON.stringify((record.evidence?.classicalContexts ?? []).slice(0, 3))}`,
    `Existing mappings: ${JSON.stringify(record.existingMappings ?? [])}`,
    "Candidate atoms and linked WordNet sense evidence: " + JSON.stringify(record.existingAtomCandidates.map((target) => ({
      targetId: "atom:" + target.pya,
      atomLabel: target.english,
      pya: target.pya,
      candidateSources: target.candidateSources ?? [],
      wordnetSenses: (target.wordnetSenses ?? []).map((sense) => ({
        senseId: sense.senseId,
        ili: sense.ili,
        partOfSpeech: sense.partOfSpeech,
        gloss: sense.gloss,
        lemmas: sense.lemmas,
        ...(sense.cowLinked ? { cowLinked: true, cowSynsets: sense.cowSynsets ?? [] } : {})
      }))
    })))
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
  if (!response || !["match", "no-fit", "uncertain"].includes(response.verdict)
    || !["high", "medium", "low"].includes(response.confidence)
    || !Array.isArray(response.matches) || typeof response.rationale !== "string") {
    throw invalid("atom review response does not match the expected contract", { id: record?.id });
  }
  const targets = new Map(record.existingAtomCandidates.map((target) => [
    target.kind + ":" + target.pya,
    target
  ]));
  const matches = response.matches.map((match) => {
    const targetId = text(match?.targetId);
    const senseId = text(match?.senseId);
    const target = targets.get(targetId);
    const senseIds = new Set((target?.wordnetSenses ?? []).map((sense) => text(sense.senseId)));
    if (!target || !senseIds.has(senseId) || !["base", "marked", "same-sense"].includes(match?.relation)) {
      throw invalid("atom review selected an unprovided target or relation", { id: record?.id, targetId });
    }
    return { targetId, senseId, relation: match.relation, rationale: text(match.rationale).slice(0, 300) };
  });
  if (new Set(matches.map((match) => match.targetId)).size !== matches.length) {
    throw invalid("atom review must rank each supplied target at most once", { id: record?.id });
  }
  if (response.verdict !== "match" && matches.length > 0) {
    throw invalid("non-match atom review response must not contain matches", { id: record?.id });
  }
  if (response.verdict === "match" && matches.length === 0) {
    throw invalid("match atom review response must contain a supplied target", { id: record?.id });
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
  const accepted = existingLinks.filter((link) => link.status === "accepted");
  const linkedCharacters = new Set(existingLinks
    .filter((link) => link.status === "accepted")
    .map((link) => text(link.character)));
  const linkedAtoms = new Set(accepted.map((link) => text(link.pya)));
  const ownersByPya = new Map();
  for (const link of accepted) {
    const pya = text(link.pya);
    const owners = ownersByPya.get(pya) ?? new Set();
    owners.add(text(link.character));
    ownersByPya.set(pya, owners);
  }
  const localAcceptedByCharacter = new Map(accepted
    .filter((link) => link.source === "chinese-character-atom-refinery")
    .map((link) => [text(link.character), link]));
  const result = [];
  for (const record of [...records].sort(compareCharacterFrequency)) {
    const decision = record?.modelMatch;
    const matches = decision?.matches ?? [];
    const modelSelected = decision?.verdict === "match"
      && ["high", "medium"].includes(decision?.confidence)
      && matches.length > 0;
    if (!modelSelected) continue;
    if ((record.specificityConflict && !record.cowReviewRequired) || record.specificityReviewRequired) continue;
    const character = text(record.character);
    if ([...character].length !== 1 || !HAN.test(character)) continue;
    const candidateById = new Map((record.existingAtomCandidates ?? [])
      .map((candidate) => [`${candidate.kind}:${candidate.pya}`, candidate]));
    const ranked = matches.filter((match) => match.relation !== "marked")
      .map((match) => ({
        candidate: candidateById.get(text(match.targetId)),
        senseId: text(match.senseId)
      }))
      .filter(({ candidate, senseId }) => candidate?.wordnetSenses?.some((sense) => sense.senseId === senseId)
        && candidate.kind === "atom"
        && !isUnderscoreMarkedEnglish(candidate.english));
    const currentLink = localAcceptedByCharacter.get(character);
    if (currentLink && record.cowReviewRequired) {
      const replacement = ranked.find(({ candidate }) => {
        const owners = ownersByPya.get(text(candidate.pya));
        return !owners || (owners.size === 1 && owners.has(character));
      });
      if (!replacement || text(replacement.candidate.pya) === text(currentLink.pya)) continue;
      const priorOwners = ownersByPya.get(text(currentLink.pya));
      priorOwners?.delete(character);
      if (priorOwners?.size === 0) ownersByPya.delete(text(currentLink.pya));
      result.push({
        character,
        english: text(currentLink.english),
        pya: text(currentLink.pya),
        status: "withdrawn",
        confidence: decision.confidence,
        source: currentLink.source
      });
      result.push({
        character,
        english: text(replacement.candidate.english),
        pya: text(replacement.candidate.pya),
        status: "accepted",
        confidence: decision.confidence,
        source: "chinese-character-atom-refinery",
        wordNetSenseId: replacement.senseId
      });
      const nextOwners = ownersByPya.get(text(replacement.candidate.pya)) ?? new Set();
      nextOwners.add(character);
      ownersByPya.set(text(replacement.candidate.pya), nextOwners);
      linkedAtoms.delete(text(currentLink.pya));
      linkedAtoms.add(text(replacement.candidate.pya));
      continue;
    }
    if (linkedCharacters.has(character) || (record.existingMappings ?? []).length > 0) continue;
    const target = ranked.find(({ candidate }) => !linkedAtoms.has(text(candidate.pya)));
    if (!target) continue;
    result.push({
      character,
      english: text(target.candidate.english),
      pya: text(target.candidate.pya),
      status: "accepted",
      confidence: decision.confidence,
      source: "chinese-character-atom-refinery",
      wordNetSenseId: target.senseId
    });
    linkedCharacters.add(character);
    linkedAtoms.add(text(target.candidate.pya));
    const owners = ownersByPya.get(text(target.candidate.pya)) ?? new Set();
    owners.add(character);
    ownersByPya.set(text(target.candidate.pya), owners);
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
    rows.push(`su text ${JSON.stringify(key)} ob text ${JSON.stringify(JSON.stringify({ ...link, key }))} ya`);
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
  const worklist = buildChineseCharacterAtomWorklist(loaded, { includeMapped: false });
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

import { createHash } from "node:crypto";
import fs from "node:fs/promises";

import { buildProgram } from "../../program.mjs";
import {
  CHINESE_CHARACTER_ATOM_SOURCE_PATHS,
  loadChineseCharacterAtomRefineryInputs
} from "./chinese_character_atom_refinery.mjs";
import {
  ENGLISH_GRAMMAR_CHINESE_CHARACTER_LINK_PREFIX,
  parseEnglishGrammarCatalog,
  renderEnglishGrammarChineseCharacterLinks
} from "./english_grammar.mjs";
import { classifyPyacWord, WORD_CODE_TYPES } from "../vliw/word_code.mjs";

export const CHINESE_CHARACTER_GRAMMAR_REFINERY_FORMAT = "chinese-character-grammar-refinery-v1";
export const CHINESE_CLASSICAL_FUNCTION_CHARACTER_CANDIDATES_FORMAT = "classical-chinese-function-character-candidates-v1";
export const CHINESE_CHARACTER_GRAMMAR_REFINERY_NAME = "translation chinese character grammar first pass";
export const CHINESE_CHARACTER_GRAMMAR_REFINERY_CONFIG_URL = new URL("./chinese_character_grammar_refinery.pya", import.meta.url);
export const CHINESE_CLASSICAL_FUNCTION_CHARACTER_CANDIDATES_URL = new URL(
  "../../../sino-pyash/sources/classical-chinese/function-characters-24.pya",
  import.meta.url
);
export const CHINESE_CHARACTER_GRAMMAR_SOURCE_PATHS = Object.freeze({
  legge: new URL("../../../sino-pyash/sources/classical-chinese/analects/gutenberg-4094-legge.txt", import.meta.url),
  wenYen: new URL("../../../sino-pyash/sources/classical-chinese/analects/gutenberg-23839-wen-yen.txt", import.meta.url),
  gsdsimpTrain: new URL("../../../sino-pyash/sources/ud-chinese-gsdsimp-b79a1c2/zh_gsdsimp-ud-train.conllu", import.meta.url),
  gsdsimpDev: new URL("../../../sino-pyash/sources/ud-chinese-gsdsimp-b79a1c2/zh_gsdsimp-ud-dev.conllu", import.meta.url),
  gsdsimpTest: new URL("../../../sino-pyash/sources/ud-chinese-gsdsimp-b79a1c2/zh_gsdsimp-ud-test.conllu", import.meta.url),
  englishGrammar: CHINESE_CHARACTER_ATOM_SOURCE_PATHS.englishGrammar
});

const HAN = /\p{Script=Han}/u;
const GRAMMAR_UPOS = new Set(["ADP", "AUX", "CCONJ", "DET", "PART", "PRON", "SCONJ"]);
const ADV_GRAMMAR_TAG = "Polarity=Neg";
const MAX_CONTEXTS_PER_SOURCE = 4;
const UPOS_GRAMMAR_KINDS = Object.freeze({
  ADP: new Set(["case-marker", "exemplifier"]),
  AUX: new Set(["aspect-marker", "existential-clause", "modal-mood"]),
  CCONJ: new Set(["conjunction", "exemplifier"]),
  DET: new Set(["number-marker", "possessive-determiner", "possessive-pronoun", "pronoun"]),
  PART: new Set(["aspect-marker", "conjunction", "negation", "number-marker", "reflexive-marker"]),
  PRON: new Set(["pronoun", "referential"]),
  SCONJ: new Set(["conjunction", "exemplifier"]),
  ADV: new Set(["aspect-marker", "modal-mood", "negation", "number-marker"])
});

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-chinese-character-grammar-refinery";
  error.details = details;
  return error;
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

function parseJsonResponse(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (typeof value.response === "string") return parseJsonResponse(value.response);
    if (typeof value.message?.content === "string") return parseJsonResponse(value.message.content);
    return value;
  }
  if (typeof value !== "string") return value;
  const parsed = JSON.parse(value);
  if (typeof parsed === "string") return parseJsonResponse(parsed);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    if (typeof parsed.response === "string") return parseJsonResponse(parsed.response);
    if (typeof parsed.message?.content === "string") return parseJsonResponse(parsed.message.content);
  }
  return parsed;
}

export function parseClassicalFunctionCharacterCandidates(source) {
  if (typeof source !== "string") throw invalid("Classical function-character source must be Pyash text");
  const program = buildProgram(source);
  const header = program.sentences.find((sentence) => (
    sentence?.mood === "def" && sentence?.be === "map"
      && sentence?.su?.name === "classical_chinese_function_character_candidates"
  ));
  if (!header) throw invalid("Classical function-character source has no map header");
  const characters = [];
  let sourceId = "";
  let format = "";
  for (const [index, sentence] of program.sentences.entries()) {
    if (sentence?.mood !== "ya" || typeof sentence.su?.text !== "string") continue;
    if (sentence.su.text === "meta:format") {
      format = text(sentence.ob?.text);
      continue;
    }
    if (sentence.su.text === "meta:source") {
      sourceId = text(sentence.ob?.text);
      continue;
    }
    if (!sentence.su.text.startsWith("character:")) continue;
    let payload;
    try {
      payload = JSON.parse(sentence.ob?.text ?? "");
    } catch (error) {
      throw invalid("Classical function-character row is malformed", { index, cause: error.message });
    }
    const character = text(sentence.su.text.slice("character:".length));
    if ([...character].length !== 1 || !HAN.test(character) || payload?.character !== character) {
      throw invalid("Classical function-character row must identify one Han character", { index, character });
    }
    characters.push(character);
  }
  if (format !== CHINESE_CLASSICAL_FUNCTION_CHARACTER_CANDIDATES_FORMAT || !sourceId
    || characters.length === 0 || new Set(characters).size !== characters.length) {
    throw invalid("Classical function-character source requires its format, provenance, and unique rows", { format, sourceId });
  }
  return { sourceId, characters };
}

export function parseEnglishGrammarCharacterTargets(source) {
  const catalog = parseEnglishGrammarCatalog(source);
  const targetsByKey = new Map();
  for (const entry of catalog.entries) {
    if (entry.pyashSequence.length !== 1) continue;
    const pya = entry.pyashSequence[0];
    let wordType;
    try {
      wordType = classifyPyacWord(pya);
    } catch {
      continue;
    }
    if (wordType !== WORD_CODE_TYPES.SHORT_GRAMMAR && wordType !== WORD_CODE_TYPES.LONG_GRAMMAR) continue;
    const key = `${entry.components.join("+")}\u0000${pya}`;
    const target = targetsByKey.get(key) ?? {
      id: `grammar:${entry.components.join("+")}:${pya}`,
      kind: "grammar",
      pya,
      components: [...entry.components],
      english: entry.surface,
      aliases: [],
      kinds: [],
      evidence: []
    };
    if (!target.aliases.includes(entry.surface)) target.aliases.push(entry.surface);
    if (!target.kinds.includes(entry.kind)) target.kinds.push(entry.kind);
    if (!target.evidence.includes(entry.evidence)) target.evidence.push(entry.evidence);
    targetsByKey.set(key, target);
  }
  return {
    targets: [...targetsByKey.values()],
    existingLinks: catalog.chineseCharacterLinks
  };
}

function englishGlossMatchesAliases(character, cedict, aliases) {
  const glosses = (cedict.get(character) ?? [])
    .flatMap((row) => row.definitions)
    .flatMap((definition) => definition.split(/[;,]/u))
    .map((gloss) => normalizeEnglish(gloss
      .replace(/^(?:\([^)]*\)\s*)+/u, "")
      .split(/\s+\(/u)[0]))
    .filter(Boolean);
  for (const headGloss of glosses) {
    for (const alias of aliases) {
      const normalizedAlias = normalizeEnglish(alias);
      if (normalizedAlias && headGloss === normalizedAlias) return true;
    }
  }
  return false;
}

function englishGlossMatchesTarget(character, cedict, targets) {
  return englishGlossMatchesAliases(character, cedict, targets.flatMap((target) => target.aliases));
}

function isGrammarAdverb(character, features, cedict, targets) {
  return features.split("|").includes(ADV_GRAMMAR_TAG) || englishGlossMatchesTarget(character, cedict, targets);
}

export function parseUdChineseGrammarEvidence(sources, {
  cedict = new Map(),
  grammarTargets = []
} = {}) {
  if (!Array.isArray(sources)) throw invalid("GSDSimp sources must be an array");
  const evidence = new Map();
  for (const source of sources) {
    if (typeof source?.text !== "string") throw invalid("GSDSimp source entry requires text", { source: source?.name });
    let sentenceText = "";
    let sentenceTokens = [];
    const flushSentence = () => {
      if (sentenceTokens.length === 0) return;
      const context = sentenceText || sentenceTokens.map((token) => token.form).join("");
      for (const token of sentenceTokens) {
        const row = evidence.get(token.character) ?? { character: token.character, count: 0, uposCounts: {}, contexts: [] };
        row.count += 1;
        row.uposCounts[token.upos] = (row.uposCounts[token.upos] ?? 0) + 1;
        if (context && row.contexts.length < 6 && !row.contexts.some((candidate) => candidate.text === context)) {
          row.contexts.push({ text: context, upos: token.upos, source: source.name ?? "UD Chinese-GSDSimp" });
        }
        evidence.set(token.character, row);
      }
      sentenceText = "";
      sentenceTokens = [];
    };
    for (const line of source.text.split(/\r?\n/u)) {
      if (!line.trim()) {
        flushSentence();
        continue;
      }
      if (line.startsWith("# text = ")) {
        sentenceText = line.slice("# text = ".length).trim();
        continue;
      }
      if (line.startsWith("#")) continue;
      const fields = line.split("\t");
      if (fields.length < 6 || !/^\d+$/u.test(fields[0])) continue;
      const form = text(fields[1]);
      if ([...form].length !== 1 || !HAN.test(form)) continue;
      const upos = fields[3];
      const features = fields[5];
      if (!GRAMMAR_UPOS.has(upos) && !(upos === "ADV" && isGrammarAdverb(form, features, cedict, grammarTargets))) continue;
      sentenceTokens.push({ character: form, upos });
    }
    flushSentence();
  }
  return evidence;
}

function classicalAnalectsLines(source, { startAfter = "" } = {}) {
  if (typeof source !== "string") throw invalid("Classical Analects source must be text");
  let body = source;
  if (startAfter) {
    const start = source.indexOf(startAfter);
    if (start < 0) throw invalid("Classical Analects source is missing its start marker", { startAfter });
    body = source.slice(start + startAfter.length);
  }
  return body.split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => HAN.test(line) && !/\p{Script=Latin}/u.test(line));
}

function characterCount(lines, character) {
  let count = 0;
  for (const line of lines) for (const glyph of line) if (glyph === character) count += 1;
  return count;
}

function classicalContexts(lines, character, source, limit = MAX_CONTEXTS_PER_SOURCE) {
  const contexts = [];
  for (const line of lines) {
    const index = line.indexOf(character);
    if (index < 0) continue;
    const start = Math.max(0, index - 42);
    const end = Math.min(line.length, index + character.length + 42);
    const excerpt = line.slice(start, end);
    if (!contexts.some((context) => context.text === excerpt)) contexts.push({ text: excerpt, source });
    if (contexts.length >= limit) break;
  }
  return contexts;
}

function grammarTargetsForCandidate(character, { modern, cedict, grammarTargets }) {
  const uposTags = Object.keys(modern.uposCounts ?? {});
  const compatibleKinds = new Set(uposTags.flatMap((upos) => [...(UPOS_GRAMMAR_KINDS[upos] ?? [])]));
  const eligibleByPos = grammarTargets.filter((target) => (
    uposTags.length === 0 || target.kinds.some((kind) => compatibleKinds.has(kind))
  ));
  const matching = eligibleByPos.filter((target) => englishGlossMatchesAliases(character, cedict, target.aliases));
  return matching;
}

export function buildChineseCharacterGrammarWorklist({
  unihan,
  subtlex,
  cedict,
  shuowenByCharacter,
  classicalCandidates,
  leggeSource,
  wenYenSource,
  udSources,
  grammarTargets,
  existingLinks = []
} = {}) {
  const candidateCharacters = Array.isArray(classicalCandidates)
    ? classicalCandidates
    : classicalCandidates?.characters;
  if (!(unihan instanceof Map) || !(subtlex instanceof Map) || !(cedict instanceof Map)
    || !Array.isArray(candidateCharacters) || !Array.isArray(grammarTargets)) {
    throw invalid("Grammar worklist requires parsed character sources, candidate rows, and grammar targets");
  }
  const leggeLines = classicalAnalectsLines(leggeSource, { startAfter: "論語" });
  const wenYenLines = classicalAnalectsLines(wenYenSource, { startAfter: "*** START OF THE PROJECT GUTENBERG EBOOK 論語 ***" });
  const modernEvidence = parseUdChineseGrammarEvidence(udSources, { cedict, grammarTargets });
  const classicalSet = new Set(candidateCharacters);
  const linksByCharacter = new Map();
  for (const link of existingLinks) {
    const rows = linksByCharacter.get(link.character) ?? new Set();
    rows.add(link.targetId);
    linksByCharacter.set(link.character, rows);
  }
  const candidateCharacterSet = new Set([...candidateCharacters, ...modernEvidence.keys()]);
  const records = [];
  for (const character of candidateCharacterSet) {
    const unihanRow = unihan.get(character);
    if (!unihanRow) continue;
    const modern = modernEvidence.get(character) ?? { count: 0, uposCounts: {}, contexts: [] };
    const classicalSeed = classicalSet.has(character);
    const existingTargetIds = linksByCharacter.get(character) ?? new Set();
    const targets = grammarTargetsForCandidate(character, { modern, cedict, grammarTargets })
      .filter((target) => !existingTargetIds.has(target.id));
    if (targets.length === 0) continue;
    const leggeCount = characterCount(leggeLines, character);
    const wenYenCount = characterCount(wenYenLines, character);
    const frequency = subtlex.get(character) ?? null;
    const sources = [
      ...(classicalSeed ? ["CCL-2015-112 classical function-character candidate set"] : []),
      ...(leggeCount > 0 ? ["Project Gutenberg eBook 4094 Analects witness"] : []),
      ...(wenYenCount > 0 ? ["Project Gutenberg eBook 23839 Analects witness"] : []),
      ...(modern.count > 0 ? ["UD Chinese-GSDSimp @ b79a1c2f7ba7f9b264808d91c6886a67b7f847a3"] : [])
    ];
    records.push({
      id: `zh-grammar-char-${character.codePointAt(0).toString(16).toLowerCase()}`,
      character,
      classicalSeed,
      sources,
      frequency: {
        classicalLeggeOccurrences: leggeCount,
        classicalWenYenOccurrences: wenYenCount,
        gsdsimpGrammarOccurrences: modern.count,
        gsdsimpUpostagCounts: modern.uposCounts,
        subtlexRank: frequency?.rank ?? null,
        subtlexCount: frequency?.count ?? null
      },
      readings: unihanRow.readings,
      evidence: {
        cedict: (cedict.get(character) ?? []).slice(0, 8),
        unihanDefinition: unihanRow.unihanDefinition ?? "",
        shuowen: shuowenByCharacter?.get(character)?.content ?? "",
        classicalLegge: classicalContexts(leggeLines, character, "Analects / Legge", 3),
        classicalWenYen: classicalContexts(wenYenLines, character, "Analects / Wen Yen", 3),
        gsdsimp: modern.contexts.slice(0, 4)
      },
      existingGrammarLinks: (existingLinks ?? []).filter((link) => link.character === character),
      grammarTargets: targets
    });
  }
  records.sort((left, right) => {
    if (left.classicalSeed !== right.classicalSeed) return left.classicalSeed ? -1 : 1;
    const leftPrimary = left.classicalSeed
      ? left.frequency.classicalLeggeOccurrences
      : left.frequency.gsdsimpGrammarOccurrences;
    const rightPrimary = right.classicalSeed
      ? right.frequency.classicalLeggeOccurrences
      : right.frequency.gsdsimpGrammarOccurrences;
    if (leftPrimary !== rightPrimary) return rightPrimary - leftPrimary;
    const leftSecondary = left.classicalSeed
      ? left.frequency.classicalWenYenOccurrences
      : (Number.isSafeInteger(left.frequency.subtlexRank) ? -left.frequency.subtlexRank : 0);
    const rightSecondary = right.classicalSeed
      ? right.frequency.classicalWenYenOccurrences
      : (Number.isSafeInteger(right.frequency.subtlexRank) ? -right.frequency.subtlexRank : 0);
    if (leftSecondary !== rightSecondary) return rightSecondary - leftSecondary;
    return left.character.codePointAt(0) - right.character.codePointAt(0);
  });
  return records;
}

export function buildChineseCharacterGrammarReviewPrompt(record) {
  if (!record?.character || !Array.isArray(record.grammarTargets) || record.grammarTargets.length === 0) {
    throw invalid("Grammar review prompt requires a character and existing grammar targets", { id: record?.id });
  }
  const targets = record.grammarTargets.map((target) => ({
    targetId: target.id,
    english: target.english,
    aliases: target.aliases,
    components: target.components,
    pyash: target.pya
  }));
  return [
    "Link the Chinese character only to the supplied existing Pyash grammar targets. No lexical root targets or new targets are available in this pass.",
    "A character in the candidate list can also have lexical meanings. Use only evidence for grammatical uses; do not treat candidate membership or character frequency as semantic proof.",
    "Return no-fit or uncertain when the evidence does not support a supplied grammatical sense. A character may map to more than one target only when separate grammatical uses are directly supported by the supplied evidence.",
    "Set confidence high only when every returned match is supported by an attested grammatical sense and the target meaning is specific. Marked/register-specific readings do not qualify for automatic linking.",
    "Return JSON with verdict (select, no-fit, uncertain), confidence (high, medium, low), matches (targetId, relation, rationale), and rationale. relation is base, marked, or same-sense.",
    `Character: ${record.character}`,
    `Classical candidate: ${record.classicalSeed ? "yes" : "no"}`,
    `Independent source counts: ${JSON.stringify({
      analectsLegge: record.frequency.classicalLeggeOccurrences,
      analectsWenYen: record.frequency.classicalWenYenOccurrences,
      udChineseGsdsimp: record.frequency.gsdsimpGrammarOccurrences,
      udUpostagCounts: record.frequency.gsdsimpUpostagCounts
    })}`,
    `Sources: ${JSON.stringify(record.sources)}`,
    `CC-CEDICT senses: ${JSON.stringify(record.evidence.cedict.map((row) => ({ pinyin: row.pinyin, definitions: row.definitions })))}`,
    `Unihan definition: ${record.evidence.unihanDefinition.slice(0, 400)}`,
    `Shuowen historical definition: ${record.evidence.shuowen.slice(0, 350)}`,
    `Analects / Legge contexts (attestation, not a standalone definition): ${JSON.stringify(record.evidence.classicalLegge)}`,
    `Analects / Wen Yen contexts (independent witness): ${JSON.stringify(record.evidence.classicalWenYen)}`,
    `UD Chinese-GSDSimp contexts and POS tags: ${JSON.stringify(record.evidence.gsdsimp)}`,
    `Existing grammar links: ${JSON.stringify(record.existingGrammarLinks)}`,
    `Existing Pyash grammar targets: ${JSON.stringify(targets)}`
  ].join("\n");
}

export function parseChineseCharacterGrammarReviewResponse(value, record) {
  if (!record || !Array.isArray(record.grammarTargets)) {
    throw invalid("Grammar review response requires its candidate record", { id: record?.id });
  }
  let response;
  try {
    response = parseJsonResponse(value);
  } catch (error) {
    throw invalid("Grammar review response is malformed JSON", { id: record.id, cause: error.message });
  }
  if (!response || !["select", "no-fit", "uncertain"].includes(response.verdict)
    || !["high", "medium", "low"].includes(response.confidence)
    || !Array.isArray(response.matches) || response.matches.length > 8
    || typeof response.rationale !== "string") {
    throw invalid("Grammar review response does not match the expected contract", { id: record.id });
  }
  const targets = new Set(record.grammarTargets.map((target) => target.id));
  const matches = response.matches.map((match) => {
    const targetId = text(match?.targetId);
    const rationale = text(match?.rationale).slice(0, 300);
    if (!targets.has(targetId) || !["base", "marked", "same-sense"].includes(match?.relation) || !rationale) {
      throw invalid("Grammar review selected an unprovided target or invalid relation", { id: record.id, targetId });
    }
    return { targetId, relation: match.relation, rationale };
  });
  if (new Set(matches.map((match) => match.targetId)).size !== matches.length) {
    throw invalid("Grammar review response repeats a target", { id: record.id });
  }
  if ((response.verdict !== "select" && matches.length > 0)
    || (response.verdict === "select" && matches.length === 0)) {
    throw invalid("Grammar review verdict and matches disagree", { id: record.id });
  }
  return { verdict: response.verdict, confidence: response.confidence, matches, rationale: text(response.rationale).slice(0, 500) };
}

export function highConfidenceChineseCharacterGrammarLinks(records = [], existingLinks = []) {
  if (!Array.isArray(records) || !Array.isArray(existingLinks)) {
    throw invalid("Grammar linking requires record and link arrays");
  }
  const existing = new Set(existingLinks.filter((link) => link.status === "accepted")
    .map((link) => `${link.character}\u0000${link.targetId}`));
  const links = [];
  for (const record of records) {
    const decision = record.grammarMatch;
    if (decision?.verdict !== "select" || decision?.confidence !== "high") continue;
    const targetById = new Map(record.grammarTargets.map((target) => [target.id, target]));
    for (const match of decision.matches ?? []) {
      if (match.relation === "marked") continue;
      const target = targetById.get(match.targetId);
      if (!target) continue;
      const identity = `${record.character}\u0000${target.id}`;
      if (existing.has(identity)) continue;
      existing.add(identity);
      links.push({
        character: record.character,
        targetId: target.id,
        pya: target.pya,
        components: [...target.components],
        english: target.english,
        relation: match.relation,
        confidence: "high",
        status: "accepted",
        source: "chinese-character-grammar-refinery",
        sources: [...record.sources],
        rationale: match.rationale,
        sourceEvidence: {
          classicalSeed: record.classicalSeed,
          classicalLeggeOccurrences: record.frequency.classicalLeggeOccurrences,
          classicalWenYenOccurrences: record.frequency.classicalWenYenOccurrences,
          gsdsimpGrammarOccurrences: record.frequency.gsdsimpGrammarOccurrences,
          gsdsimpUpostagCounts: { ...record.frequency.gsdsimpUpostagCounts }
        }
      });
    }
  }
  return links;
}

export function renderChineseCharacterGrammarReviewPya(records, {
  sourceHash = "",
  sourceHashes = {},
  runId = ""
} = {}) {
  const rows = [
    "su name translation_chinese_character_grammar_refinery_review be map def",
    `su text "format" ob text ${JSON.stringify(CHINESE_CHARACTER_GRAMMAR_REFINERY_FORMAT)} ya`,
    `su text "run-id" ob text ${JSON.stringify(runId)} ya`,
    `su text "source-hash" ob text ${JSON.stringify(sourceHash)} ya`,
    `su text "source-hashes" ob text ${JSON.stringify(JSON.stringify(sourceHashes))} ya`,
    `su text "record-count" ob num ${records.length} ya`
  ];
  for (const record of records) rows.push(`su text ${JSON.stringify(record.id)} ob text ${JSON.stringify(JSON.stringify(record))} ya`);
  rows.push("prah", "");
  return rows.join("\n");
}

export async function loadChineseCharacterGrammarRefineryInputs() {
  const [base, classicalCandidateSource, leggeSource, wenYenSource, trainSource, devSource, testSource, grammarSource] = await Promise.all([
    loadChineseCharacterAtomRefineryInputs(),
    fs.readFile(CHINESE_CLASSICAL_FUNCTION_CHARACTER_CANDIDATES_URL, "utf8"),
    fs.readFile(CHINESE_CHARACTER_GRAMMAR_SOURCE_PATHS.legge, "utf8"),
    fs.readFile(CHINESE_CHARACTER_GRAMMAR_SOURCE_PATHS.wenYen, "utf8"),
    fs.readFile(CHINESE_CHARACTER_GRAMMAR_SOURCE_PATHS.gsdsimpTrain, "utf8"),
    fs.readFile(CHINESE_CHARACTER_GRAMMAR_SOURCE_PATHS.gsdsimpDev, "utf8"),
    fs.readFile(CHINESE_CHARACTER_GRAMMAR_SOURCE_PATHS.gsdsimpTest, "utf8"),
    fs.readFile(CHINESE_CHARACTER_GRAMMAR_SOURCE_PATHS.englishGrammar, "utf8")
  ]);
  const classicalCandidates = parseClassicalFunctionCharacterCandidates(classicalCandidateSource);
  const grammarCatalog = parseEnglishGrammarCatalog(grammarSource);
  const grammarTargets = parseEnglishGrammarCharacterTargets(grammarSource).targets;
  const udSources = [
    { name: "UD Chinese-GSDSimp train", text: trainSource },
    { name: "UD Chinese-GSDSimp dev", text: devSource },
    { name: "UD Chinese-GSDSimp test", text: testSource }
  ];
  const sourceHashes = {
    subtlex: base.sourceHashes.subtlex,
    unihanReadings: base.sourceHashes.unihanReadings,
    unihanOtherMappings: base.sourceHashes.unihanOtherMappings,
    cedict: base.sourceHashes.cedict,
    shuowen: base.sourceHashes.shuowen,
    analectsWenYen: base.sourceHashes.analects,
    analectsLegge: hash(leggeSource),
    classicalCandidateSet: hash(classicalCandidateSource),
    udChineseGsdsimpTrain: hash(trainSource),
    udChineseGsdsimpDev: hash(devSource),
    udChineseGsdsimpTest: hash(testSource),
    englishGrammar: hash(grammarSource)
  };
  return {
    ...base,
    classicalCandidates,
    classicalCandidateSource,
    leggeSource,
    wenYenSource,
    udSources,
    grammarCatalog,
    grammarTargets,
    existingLinks: grammarCatalog.chineseCharacterLinks,
    sourceHashes,
    sourceHash: hash(JSON.stringify(sourceHashes))
  };
}

export function createChineseCharacterGrammarLinkSource(source, links) {
  return renderEnglishGrammarChineseCharacterLinks(source, links);
}

export { ENGLISH_GRAMMAR_CHINESE_CHARACTER_LINK_PREFIX };

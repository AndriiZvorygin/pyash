#!/usr/bin/env node

import fs from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildProgram } from "../program/program.mjs";
import pyashWords from "../program/library/pyashWords.json" with { type: "json" };
import { loadCoverage } from "./compound_coverage.mjs";
import { loadWordNetVerifiedCompoundMatches } from "../program/library/translation/compound_coverage.mjs";
import { loadAllCompoundAtomLinks } from "../program/library/translation/compound_lexicons.mjs";
import { renderPyacSurface } from "../program/library/translation/pyash_surface.mjs";
import {
  buildEnglishDictionaryAliases,
  parseEnglishDictionaryBlacklist
} from "../program/library/translation/english_dictionary_aliases.mjs";
import {
  buildEnglishLemmaIndex,
  inflectionCandidates,
  loadEnglishLemmaCatalog
} from "../program/library/translation/english_lemmas.mjs";
import { loadAnchorWordForms } from "../program/library/translation/anchor_words.mjs";
import { loadEnglishWordNetBridgeSubset as loadEnglishWordNetBridgeSubsetFromSource } from "../program/library/translation/english_wordnet_bridges.mjs";
import {
  loadEnglishWordNet,
  loadOpenEnglishWordNetSenseRows
} from "../program/library/translation/english_wordnet.mjs";
import { loadEnglishWordNetCompoundGlosses } from "../program/library/translation/english_wordnet_compound_glosses.mjs";
import {
  loadDefaultEnglish30kCoverage,
  loadEnglish30k,
  english30kLookupVariants,
  lookupEnglish30kCoverage
} from "../program/library/translation/english30k_coverage.mjs";
import { buildEnglishGrammarIndex, loadEnglishGrammarCatalog } from "../program/library/translation/english_grammar.mjs";
import { loadVocabQueryData, queryVocabLines } from "./vocab_query.mjs";
import { resolveEnglishAlias } from "../program/library/translation/english_aliases.mjs";
import { takeKwonLookupWarnings } from "../program/library/translation/kwon_lookup_index.mjs";
import { formatSumoEvidence, lookupSumoEvidence } from "../program/library/translation/sumo_lookup.mjs";
import {
  lookupChineseCharacterGlosses,
  lookupChinesePinyin,
  lookupChineseByPyash,
  lookupChineseByWordNetSenses,
  lookupPyashByChinese,
  lookupWordNetSensesByChinese
} from "../program/library/translation/kwon_chinese_lookup.mjs";
import {
  MOODS,
  ROLE_KEYS,
  TYPE_TOKENS,
  COMPOSITIONAL_KEYWORDS,
  VYAH_ASPECT_MODIFIERS,
  VYAH_ASPECT_ALIASES,
  VYAH_TENSE_MODIFIERS,
  VYAH_OUTCOME_MODIFIERS,
  VYAH_ATTITUDINAL_MODIFIERS
} from "../program/library/grammar/keywords.mjs";

function parseArgs(args) {
  const inputs = [];
  const textInputs = [];
  const senseIds = [];
  const sumoIds = [];
  let mapPath = null;
  let targetLanguage = "";
  let sourceLanguage = "";
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "to") {
      const language = String(args[i + 1] ?? "").trim().toLowerCase();
      if (language !== "zh") throw new Error(`unsupported dictionary output language: ${language || "(missing)"}; supported: zh`);
      targetLanguage = language;
      i += 1;
      continue;
    }
    if (arg === "from") {
      const language = String(args[i + 1] ?? "").trim().toLowerCase();
      if (language !== "zh") throw new Error(`unsupported dictionary input language: ${language || "(missing)"}; supported: zh`);
      sourceLanguage = language;
      i += 1;
      continue;
    }
    if (arg === "--map") {
      mapPath = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--text") {
      textInputs.push(args[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (/^([anrvs]):[0-9]{8}-\1$/iu.test(arg)) senseIds.push(arg.toLowerCase());
    else if (/^sumo:[A-Za-z][A-Za-z0-9_]*$/u.test(arg)) sumoIds.push(arg);
    else inputs.push(arg);
  }
  if (sourceLanguage && targetLanguage) throw new Error("dictionary input and output cannot both be zh");
  return {
    inputs,
    textInputs,
    senseIds: [...new Set(senseIds)],
    sumoIds: [...new Set(sumoIds)],
    mapPath,
    sourceLanguage,
    targetLanguage
  };
}

const checked = new Map();
let acceptedCoveragePromise = null;
let curatedAcceptedCoveragePromise = null;
let english30kCoveragePromise = null;
let english30kSourcePromise = null;
let englishGrammarIndexPromise = null;
let englishLemmaIndexPromise = null;
let extendedEnglishResourcesPromise = null;
let anchorWordFormsPromise = null;
let compoundAtomLinksPromise = null;
let englishWordNetIndexPromise = null;
const wordNetCompoundMatchPromises = new Map();
const englishWordNetBridgeSubsetPromises = new Map();
let fastAtomicIndex = null;
let fastRootIndex = null;
let fastAtomicByPyacIndex = null;

const NAME_TOKEN_REGEX = /^[\p{L}][\p{L}\p{N}_-]*$/u;
const PYASH_QUOTED_START = "quoted.pyash.";
const PYASH_QUOTED_END = ".pyash.quoted";
const GRAMMAR_KEYWORDS = new Set(
  [
    ...MOODS,
    ...ROLE_KEYS,
    ...TYPE_TOKENS,
    ...COMPOSITIONAL_KEYWORDS,
    ...VYAH_ASPECT_MODIFIERS,
    ...Object.keys(VYAH_ASPECT_ALIASES),
    ...VYAH_TENSE_MODIFIERS,
    ...VYAH_OUTCOME_MODIFIERS,
    ...VYAH_ATTITUDINAL_MODIFIERS
  ].map(word => String(word).toLowerCase())
);
// Built-in structural verbs are runtime vocabulary, even when the external
// dictionary marks their English gloss as a blocked synonym.
const STRUCTURAL_VERB_TOKENS = new Set(["exists", "export"]);
// These names are stable Pyash contract identifiers rather than prose names.
// Keep them available to artifact/provenance records even when the external
// dictionary has no exact technical entry for them.
const APPROVED_CONTRACT_NAME_TOKENS = new Set(["source", "sha256", "vliw"]);
const APPROVED_CONTRACT_NAME_PATTERNS = [
  /^src-[0-9a-f]{64}(?::[A-Za-z0-9._:-]+)?$/u
];
const ACCEPTED_COMPOUND_STATUSES = new Set([
  "accepted-curated",
  "accepted-delimited",
  "accepted-deterministic",
  "accepted-llm",
  "repaired-llm"
]);
const PACKED_PYAC_ATOMS = new Set(pyashWords
  .map((entry) => String(entry?.pya ?? "").trim().toLowerCase())
  .filter((word) => /^[a-z0-9]+$/u.test(word)));
const COMPOUND_STATUS_RANK = new Map([
  ["accepted-delimited", 1],
  ["accepted-curated", 2],
  ["accepted-deterministic", 3],
  ["accepted-llm", 4],
  ["repaired-llm", 4]
]);
function isApprovedContractNameToken(token) {
  const lower = String(token ?? "").toLowerCase();
  return APPROVED_CONTRACT_NAME_TOKENS.has(lower)
    || APPROVED_CONTRACT_NAME_PATTERNS.some(pattern => pattern.test(lower));
}

function isPlainVocabularyToken(input) {
  const value = String(input ?? "").trim();
  return NAME_TOKEN_REGEX.test(value) && !value.startsWith(".");
}

function isGrammarKeyword(token) {
  return GRAMMAR_KEYWORDS.has(String(token ?? "").toLowerCase());
}

function packedPyacCompoundSequences(value, maximumComponents = 3) {
  const packed = String(value ?? "").trim().toLowerCase();
  if (!/^[a-z0-9]+$/u.test(packed)) return [];
  const sequences = [];
  const visit = (offset, parts) => {
    if (offset === packed.length) {
      if (parts.length >= 2) sequences.push(parts);
      return;
    }
    if (parts.length >= maximumComponents || sequences.length >= 64) return;
    for (let end = offset + 1; end <= packed.length; end += 1) {
      const atom = packed.slice(offset, end);
      if (!PACKED_PYAC_ATOMS.has(atom)) continue;
      visit(end, [...parts, atom]);
      if (sequences.length >= 64) break;
    }
  };
  visit(0, []);
  return sequences;
}

function tokenizeName(name) {
  return String(name)
    .split(/\s+/)
    .map(token => token.trim())
    .filter(Boolean)
    .filter(token => NAME_TOKEN_REGEX.test(token));
}

function normalizeCompoundTarget(value) {
  return typeof value === "string" ? value.normalize("NFC").trim().toLowerCase() : "";
}

function acceptedCompoundRow(payload) {
  const target = normalizeCompoundTarget(payload?.target ?? payload?.surface);
  const components = Array.isArray(payload?.componentGlosses)
    ? payload.componentGlosses.filter((component) => typeof component === "string" && component.trim())
    : [];
  const pyash = Array.isArray(payload?.pyashSequence)
    ? payload.pyashSequence.filter((word) => typeof word === "string" && word.trim())
    : [];
  const status = payload?.verificationStatus ?? payload?.status;
  if (!target || components.length < 2 || pyash.length !== components.length || !ACCEPTED_COMPOUND_STATUSES.has(status)) return null;
  const specificAtom = typeof payload?.specificAtom === "string" && payload.specificAtom.trim()
    ? payload.specificAtom.trim()
    : null;
  const aliases = Array.isArray(payload?.aliases)
    ? payload.aliases
      .filter((alias) => typeof alias === "string" && alias.trim())
      .map((alias) => normalizeCompoundTarget(alias))
      .filter((alias) => alias && alias !== target)
    : [];
  const senseLinks = typeof payload?.senseId === "string" && payload.senseId.trim()
    ? [{
      senseId: payload.senseId.trim(),
      targetPartOfSpeech: typeof payload.targetPartOfSpeech === "string" ? payload.targetPartOfSpeech : "",
      decisionIds: [...new Set([
        ...(Array.isArray(payload.verificationDecisionIds) ? payload.verificationDecisionIds : []),
        payload.verificationDecisionId
      ].filter((id) => typeof id === "string" && id.trim()))]
    }]
    : [];
  return {
    target,
    components,
    pyash,
    status,
    aliases,
    ...(specificAtom ? { specificAtom } : {}),
    senseLinks,
    identity: `${components.join("\u0001")}\u0000${pyash.join("\u0001")}\u0000${specificAtom ?? ""}\u0000${senseLinks.map((link) => link.senseId).join("\u0001")}`
  };
}

function addAcceptedCompoundRow(compounds, payload) {
  const row = acceptedCompoundRow(payload);
  if (!row) return;
  const rows = compounds.get(row.target) ?? [];
  const existingIndex = rows.findIndex((candidate) => candidate.identity === row.identity);
  if (existingIndex === -1) rows.push(row);
  else if ((COMPOUND_STATUS_RANK.get(row.status) ?? 0) > (COMPOUND_STATUS_RANK.get(rows[existingIndex].status) ?? 0)) rows[existingIndex] = row;
  compounds.set(row.target, rows);
  for (const alias of row.aliases) {
    const aliasRows = compounds.get(alias) ?? [];
    const aliasIndex = aliasRows.findIndex((candidate) => candidate.identity === row.identity);
    if (aliasIndex === -1) aliasRows.push(row);
    else if ((COMPOUND_STATUS_RANK.get(row.status) ?? 0) > (COMPOUND_STATUS_RANK.get(aliasRows[aliasIndex].status) ?? 0)) {
      aliasRows[aliasIndex] = row;
    }
    compounds.set(alias, aliasRows);
  }
}

function parseAcceptedCompoundRows(program) {
  const compounds = new Map();
  for (const sentence of program?.sentences ?? []) {
    if (sentence?.mood !== "ya" || typeof sentence.su?.text !== "string" || typeof sentence.ob?.text !== "string") continue;
    let payload;
    try {
      payload = JSON.parse(sentence.ob.text);
    } catch {
      continue;
    }
    addAcceptedCompoundRow(compounds, payload);
  }
  return compounds;
}

function parseAcceptedCompoundRecords(records) {
  const compounds = new Map();
  for (const record of records ?? []) addAcceptedCompoundRow(compounds, record);
  return compounds;
}

async function loadDefaultAcceptedCompounds() {
  if (!acceptedCoveragePromise) {
    acceptedCoveragePromise = loadCoverage().then((coverage) => {
      return parseAcceptedCompoundRecords(coverage.accepted);
    });
  }
  return acceptedCoveragePromise;
}

async function loadDefaultWordNetCompoundMatches(query) {
  const key = query.senseId
    ? `sense:${query.senseId.toLowerCase()}`
    : query.senseIds
      ? `senses:${[...query.senseIds].map((id) => id.toLowerCase()).sort().join(",")}`
    : query.targets
      ? `targets:${[...query.targets].map(normalizeCompoundTarget).sort().join(",")}`
    : query.target
      ? `target:${normalizeCompoundTarget(query.target)}`
      : `pyac:${(query.pyashSequence ?? []).join(" ").toLowerCase()}`;
  if (!wordNetCompoundMatchPromises.has(key)) {
    wordNetCompoundMatchPromises.set(key, loadWordNetVerifiedCompoundMatches(query)
      .then(parseAcceptedCompoundRecords));
  }
  return wordNetCompoundMatchPromises.get(key);
}

async function loadDefaultEnglishWordNetIndex() {
  if (!englishWordNetIndexPromise) {
    englishWordNetIndexPromise = loadEnglishWordNet().then(({ index }) => index);
  }
  return englishWordNetIndexPromise;
}

async function loadDefaultCuratedAcceptedCompounds() {
  if (!curatedAcceptedCoveragePromise) {
    curatedAcceptedCoveragePromise = fs
      .readFile(new URL("../program/library/translation/compound_coverage_curated.pya", import.meta.url), "utf8")
      .then((source) => parseAcceptedCompoundRows(buildProgram(source)))
      .catch((error) => {
        if (error?.code === "ENOENT") return new Map();
        throw error;
      });
  }
  return curatedAcceptedCoveragePromise;
}

async function loadDefaultEnglish30kCoverageSafe() {
  if (!english30kCoveragePromise) {
    english30kCoveragePromise = loadDefaultAcceptedCompounds()
      .then((acceptedCompounds) => loadDefaultEnglish30kCoverage({
        atomicEntries: pyashWords,
        compoundRecords: [...acceptedCompounds.values()].flat()
      }))
      .catch((error) => {
        if (error?.code === "ENOENT") return null;
        throw error;
      });
  }
  return english30kCoveragePromise;
}

async function findEnglish30kCoverage(token) {
  const coverage = await loadDefaultEnglish30kCoverageSafe();
  return coverage ? lookupEnglish30kCoverage(coverage, token) : null;
}

function buildFastAtomicIndex() {
  if (fastAtomicIndex) return fastAtomicIndex;
  fastAtomicIndex = new Map();
  for (const entry of pyashWords) {
    if (typeof entry?.en !== "string" || typeof entry?.pya !== "string") continue;
    for (const variant of english30kLookupVariants(entry.en)) {
      if (!fastAtomicIndex.has(variant)) fastAtomicIndex.set(variant, entry);
    }
  }
  return fastAtomicIndex;
}

function buildFastRootIndex() {
  if (fastRootIndex) return fastRootIndex;
  fastRootIndex = new Map();
  for (const entry of pyashWords) {
    if (typeof entry?.en !== "string" || typeof entry?.pya !== "string") continue;
    if (entry.en.endsWith("_")) continue;
    const key = entry.en.normalize("NFC").trim().toLowerCase();
    if (key && !fastRootIndex.has(key)) fastRootIndex.set(key, entry);
  }
  return fastRootIndex;
}

function buildFastAtomicByPyacIndex() {
  if (fastAtomicByPyacIndex) return fastAtomicByPyacIndex;
  fastAtomicByPyacIndex = new Map();
  for (const entry of pyashWords) {
    if (typeof entry?.en !== "string" || typeof entry?.pya !== "string") continue;
    const key = entry.pya.trim().toLowerCase();
    if (key && !fastAtomicByPyacIndex.has(key)) fastAtomicByPyacIndex.set(key, entry);
  }
  return fastAtomicByPyacIndex;
}

async function loadEnglishWordNetBridgeSubset({ terms = [], senseIds = [], includeCompounds = false } = {}) {
  const normalizedTerms = [...new Set(terms.map(normalizeCompoundTarget).filter(Boolean))].sort();
  const normalizedSenseIds = [...new Set(senseIds.map((senseId) => String(senseId).trim().toLowerCase()).filter(Boolean))].sort();
  const key = `${includeCompounds ? "compound" : "atomic"}\u0000${normalizedTerms.join("\u0001")}\u0000${normalizedSenseIds.join("\u0001")}`;
  if (!englishWordNetBridgeSubsetPromises.has(key)) {
    const compoundTargets = new Map();
    const resolveTargets = async (targets) => {
      const normalizedTargets = [...new Set(targets.map(normalizeCompoundTarget).filter(Boolean))];
      const unresolved = [];
      for (const target of normalizedTargets) {
        if (compoundTargets.has(target)) continue;
        const atomic = findAtomicEntry(target);
        if (atomic) compoundTargets.set(target, { coverageType: "atomic", pyashSequence: [atomic.pya] });
        else if (includeCompounds) unresolved.push(target);
        else compoundTargets.set(target, null);
      }
      if (unresolved.length > 0) {
        const [wordNet, curated] = await Promise.all([
          loadDefaultWordNetCompoundMatches({ targets: unresolved }),
          loadDefaultCuratedAcceptedCompounds()
        ]);
        for (const target of unresolved) {
          const candidate = wordNet.get(target)?.[0] ?? curated.get(target)?.[0];
          compoundTargets.set(target, candidate
            ? { coverageType: "compound", pyashSequence: [...candidate.pyash] }
            : null);
        }
      }
      return normalizedTargets.map((target) => compoundTargets.get(target) ?? null);
    };
    const resolveTarget = async (target) => (await resolveTargets([target]))[0] ?? null;
    englishWordNetBridgeSubsetPromises.set(key, loadEnglishWordNetBridgeSubsetFromSource({
      terms: normalizedTerms,
      senseIds: normalizedSenseIds,
      resolveTarget,
      resolveTargets,
      relatedTargetsForSequence: (sequence) => {
        if (sequence.length !== 1) return [];
        return pyashWords
          .filter((entry) => entry?.pya?.trim().toLowerCase() === sequence[0].toLowerCase())
          .map((entry) => entry.en);
      }
    }));
  }
  return englishWordNetBridgeSubsetPromises.get(key);
}

function english30kSenseRank(entry, source) {
  return Math.min(
    ...(entry.lemmas ?? [])
      .map((lemma) => sourceRowForToken(source, lemma)?.rank)
      .filter((rank) => Number.isFinite(rank) && rank > 0),
    Number.POSITIVE_INFINITY
  );
}

async function reportLinkedWordNetSenses(tokens, report) {
  if (!Array.isArray(tokens) || tokens.length === 0) return [];
  const termsByToken = new Map(tokens.map((token) => {
    const atomic = buildFastAtomicByPyacIndex().get(String(token).trim().toLowerCase());
    const term = atomic?.en ?? token;
    return [token, english30kLookupVariants(term)];
  }));
  const terms = [...new Set([...termsByToken.values()].flat().map(normalizeCompoundTarget))];
  const [bridgeLookup, source] = await Promise.all([
    loadEnglishWordNetBridgeSubset({ terms, includeCompounds: true }),
    loadDefaultEnglish30kSourceSafe()
  ]);
  if (bridgeLookup.entries.length === 0) return [];
  const matchesFor = (token, lookup) => {
    const matches = new Map();
    for (const term of termsByToken.get(token) ?? []) {
      for (const entry of lookup.byTerm.get(normalizeCompoundTarget(term)) ?? []) matches.set(entry.source, entry);
    }
    return matches;
  };
  const rows = [];
  const seen = new Set();
  for (const token of tokens) {
    const matches = matchesFor(token, bridgeLookup);
    const ordered = [...matches.values()].sort((left, right) => (
      english30kSenseRank(left, source) - english30kSenseRank(right, source)
        || left.source.localeCompare(right.source)
    ));
    for (const entry of ordered) {
      const identity = `${token}\u0000${entry.source}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      const pyashSequence = [...entry.pyashSequence];
      const pyac = pyashSequence.length > 0 ? ` (${renderPyacSurface(pyashSequence.join(" "))})` : "";
      const linkStatus = entry.active
        ? "active"
        : entry.pyashSequence.length === 0
          ? "unresolved anchor"
          : "withheld collision";
      const english30kRank = english30kSenseRank(entry, source);
      const rankLabel = Number.isFinite(english30kRank)
        ? `English30k rank ${english30kRank}`
        : "no English30k lemma rank";
      report(`${token}: WordNet ${entry.source} [${entry.lemmas.join(", ")}; ${rankLabel}; ${linkStatus}]: ${entry.gloss} -> ${entry.target}${pyac}`);
      rows.push({ input: token, ...entry, english30kRank: Number.isFinite(english30kRank) ? english30kRank : null, pyashSequence });
    }
  }
  return rows;
}

function chineseCompoundSurface(row) {
  const recorded = String(row?.sourceSurfaces?.chinese ?? "").trim();
  if (recorded) return recorded;
  const morphemes = row?.sourceMorphemesByLanguage?.chinese;
  if (Array.isArray(morphemes) && morphemes.length > 0) return morphemes.join("");
  const surface = String(row?.surface ?? "").trim();
  return /\p{Script=Han}/u.test(surface) ? surface : "";
}

function englishSenseDefinitions(token, english, linkedWordNetSenses) {
  const normalizedEnglish = normalizeCompoundTarget(english);
  return linkedWordNetSenses
    .filter((entry) => entry.input === token
      && (normalizeCompoundTarget(entry.target) === normalizedEnglish
        || (entry.lemmas ?? []).some((lemma) => normalizeCompoundTarget(lemma) === normalizedEnglish)))
    .map((entry) => ({ senseId: entry.source, definition: entry.gloss }))
    .filter((entry) => entry.definition);
}

async function reportPyashChineseLookups(tokens, {
  linkedWordNetSenses = [],
  wordNetCompoundSenses = [],
  foundCompounds = new Map(),
  report = console.log
} = {}) {
  const lookups = [];
  const wordNetSenseEntries = [
    ...linkedWordNetSenses,
    ...wordNetCompoundSenses.map((entry) => ({
      ...entry,
      source: entry.senseId,
      gloss: entry.definition,
      active: true
    }))
  ];
  const activeSenseIds = [...new Set(wordNetSenseEntries
    .filter((entry) => entry.active === true)
    .map((entry) => entry.source))];
  const cowForms = activeSenseIds.length > 0
    ? await lookupChineseByWordNetSenses(activeSenseIds)
    : [];
  for (const token of tokens) {
    let matched = false;
    const linkedRows = await lookupChineseByPyash(token);
    for (const row of linkedRows) {
      const pinyin = await lookupChinesePinyin(row.chinese);
      const characterGlosses = await lookupChineseCharacterGlosses(row.chinese);
      const definitions = englishSenseDefinitions(token, row.english, linkedWordNetSenses);
      const pinyinText = pinyin.length > 0 ? pinyin.join(" / ") : "unavailable in the local pinyin index";
      report(`${token}: Chinese ${row.chinese}; Pinyin ${pinyinText}`);
      const characterBreakdown = characterGlosses
        .filter((entry) => entry.glosses.length > 0)
        .map((entry) => `${entry.character} (${entry.glosses.join("; ")})`);
      if (characterBreakdown.length > 0) {
        report(`${token}: English character glosses ${characterBreakdown.join(" + ")}`);
      }
      for (const definition of definitions) {
        report(`${token}: English breakdown ${row.english} — ${definition.definition} (${definition.senseId})`);
      }
      if (definitions.length === 0) report(`${token}: English breakdown ${row.english}`);
      lookups.push({
        input: token,
        pyash: row.pyash,
        chinese: row.chinese,
        pinyin,
        english: row.english,
        characterGlosses,
        definitions
      });
      matched = true;
    }

    const tokenSenseIds = new Set(wordNetSenseEntries
      .filter((entry) => entry.input === token && entry.active === true)
      .map((entry) => entry.source));
    const tokenCowForms = cowForms.filter((row) => row.matchedWordNetSenseIds
      .some((senseId) => tokenSenseIds.has(senseId)));
    for (const row of tokenCowForms) {
      const pinyin = await lookupChinesePinyin(row.chinese);
      const characterGlosses = await lookupChineseCharacterGlosses(row.chinese);
      const pinyinText = pinyin.length > 0 ? pinyin.join(" / ") : "unavailable in the local pinyin index";
      const frequencyLabel = row.frequencyStatus === "frequency-top"
        ? "frequency-preferred"
        : row.frequencyStatus === "unresolved-frequency-tie"
          ? "unresolved frequency tie"
          : "no English30k rank";
      report(`${token}: COW WordNet Chinese ${row.chinese}; Pinyin ${pinyinText} (${frequencyLabel})`);
      const characterBreakdown = characterGlosses
        .filter((entry) => entry.glosses.length > 0)
        .map((entry) => `${entry.character} (${entry.glosses.join("; ")})`);
      if (characterBreakdown.length > 0) {
        report(`${token}: English character glosses ${characterBreakdown.join(" + ")}`);
      }
      const definitions = wordNetSenseEntries
        .filter((entry) => entry.input === token && entry.active === true
          && row.wordNetSenseIds.includes(entry.source))
        .map((entry) => ({ senseId: entry.source, target: entry.target, definition: entry.gloss }));
      for (const definition of definitions) {
        report(`${token}: English breakdown ${definition.target} — ${definition.definition} (${definition.senseId})`);
      }
      lookups.push({
        input: token,
        source: "cow-wordnet-crosswalk",
        chinese: row.chinese,
        hanCharacterCount: row.hanCharacterCount,
        pinyin,
        characterGlosses,
        frequencyStatus: row.frequencyStatus,
        frequencyRank: row.frequencyRank,
        frequencyTagCount: row.frequencyTagCount,
        wordNetSenseIds: row.wordNetSenseIds,
        matchedWordNetSenseIds: row.matchedWordNetSenseIds,
        cowSynsetIds: row.cowSynsetIds,
        definitions
      });
      matched = true;
    }

    const found = foundCompounds.get(token);
    if (found?.pyacSequenceQuery) {
      for (const row of found.rows ?? [found.row]) {
        const chinese = chineseCompoundSurface(row);
        if (!chinese) continue;
        const pinyin = await lookupChinesePinyin(chinese);
        const componentGlosses = row.componentGlosses
          ?? row.sourceComponentGlossesByLanguage?.chinese
          ?? row.components
          ?? row.morphemes
          ?? [];
        const breakdown = Array.isArray(componentGlosses) ? componentGlosses.filter(Boolean) : [];
        const pinyinText = pinyin.length > 0 ? pinyin.join(" / ") : "unavailable in the local pinyin index";
        report(`${token}: Chinese ${chinese}; Pinyin ${pinyinText}`);
        report(`${token}: English breakdown ${breakdown.length > 0 ? breakdown.join(" + ") : row.target}`);
        const definitions = (found.senseGlosses ?? [])
          .filter((entry) => normalizeCompoundTarget(entry.target) === normalizeCompoundTarget(row.target))
          .map((entry) => ({ senseId: entry.senseId, definition: entry.definition }));
        for (const definition of definitions) {
          report(`${token}: English sense ${definition.definition} (${definition.senseId})`);
        }
        lookups.push({
          input: token,
          pyashSequence: [...row.pyash],
          chinese,
          pinyin,
          english: row.target,
          englishBreakdown: breakdown,
          definitions
        });
        matched = true;
      }
    }
    if (!matched) report(`${token}: no linked Chinese entry for this Pyash form`);
  }
  return lookups;
}

async function reportCowChineseSenseLookups(senseLookups, report) {
  const senseRows = senseLookups.filter((row) => row.status !== "not-found");
  if (senseRows.length === 0) return [];
  const forms = await lookupChineseByWordNetSenses(senseRows.map((row) => row.senseId));
  const lookups = [];
  for (const row of forms) {
    const senseEvidence = senseRows.filter((sense) => row.wordNetSenseIds.includes(sense.senseId));
    const input = row.matchedWordNetSenseIds.join(", ");
    const pinyin = await lookupChinesePinyin(row.chinese);
    const characterGlosses = await lookupChineseCharacterGlosses(row.chinese);
    const pinyinText = pinyin.length > 0 ? pinyin.join(" / ") : "unavailable in the local pinyin index";
    const frequencyLabel = row.frequencyStatus === "frequency-top"
      ? "frequency-preferred"
      : row.frequencyStatus === "unresolved-frequency-tie"
        ? "unresolved frequency tie"
        : "no English30k rank";
    report(`${input}: COW WordNet Chinese ${row.chinese}; Pinyin ${pinyinText} (${frequencyLabel})`);
    const characterBreakdown = characterGlosses
      .filter((entry) => entry.glosses.length > 0)
      .map((entry) => `${entry.character} (${entry.glosses.join("; ")})`);
    if (characterBreakdown.length > 0) {
      report(`${input}: English character glosses ${characterBreakdown.join(" + ")}`);
    }
    const definitions = senseEvidence.map((sense) => ({
      senseId: sense.senseId,
      lemmas: sense.lemmas,
      definition: sense.definition
    }));
    for (const sense of definitions) {
      report(`${sense.senseId}: English breakdown ${sense.lemmas.join(", ")} — ${sense.definition}`);
    }
    lookups.push({
      input,
      source: "cow-wordnet-crosswalk",
      chinese: row.chinese,
      hanCharacterCount: row.hanCharacterCount,
      pinyin,
      characterGlosses,
      frequencyStatus: row.frequencyStatus,
      frequencyRank: row.frequencyRank,
      frequencyTagCount: row.frequencyTagCount,
      wordNetSenseIds: row.wordNetSenseIds,
      matchedWordNetSenseIds: row.matchedWordNetSenseIds,
      cowSynsetIds: row.cowSynsetIds,
      definitions
    });
  }
  return lookups;
}

async function reportWordNetSenseLookups(senseIds, report) {
  if (senseIds.length === 0) return [];
  const [bridgeLookup, compoundIndex] = await Promise.all([
    loadEnglishWordNetBridgeSubset({ senseIds, includeCompounds: true }),
    loadDefaultWordNetCompoundMatches({ senseIds })
  ]);
  const bridgesBySense = new Map(bridgeLookup.entries.map((entry) => [entry.source, entry]));
  const compoundsBySense = new Map();
  for (const rows of compoundIndex.values()) {
    for (const row of rows) {
      for (const link of row.senseLinks ?? []) {
        const key = link.senseId.toLowerCase();
        const links = compoundsBySense.get(key) ?? [];
        links.push({ row, link });
        compoundsBySense.set(key, links);
      }
    }
  }
  const compoundGlosses = compoundIndex.size > 0
    ? (await loadEnglishWordNetCompoundGlosses({ senseIds })).records
    : [];
  const glossesBySense = new Map();
  for (const gloss of compoundGlosses) {
    const rows = glossesBySense.get(gloss.senseId.toLowerCase()) ?? [];
    rows.push(gloss);
    glossesBySense.set(gloss.senseId.toLowerCase(), rows);
  }
  const rawLookupIds = senseIds.filter((senseId) => {
    const bridge = bridgesBySense.get(senseId);
    const senseGlosses = glossesBySense.get(senseId) ?? [];
    return !bridge?.gloss || !bridge?.lemmas?.length ? senseGlosses.length === 0 : false;
  });
  const rawWordNetRowsBySense = new Map();
  let rawWordNetIndexUnavailable = false;
  if (rawLookupIds.length > 0) {
    try {
      const rawRows = await loadOpenEnglishWordNetSenseRows({ senseIds: rawLookupIds });
      for (const row of rawRows) {
        const key = `${row.pos}:${row.synset}`.toLowerCase();
        const rows = rawWordNetRowsBySense.get(key) ?? [];
        rows.push(row);
        rawWordNetRowsBySense.set(key, rows);
      }
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "stale-kwon-lookup-index") throw error;
      rawWordNetIndexUnavailable = true;
    }
  }
  let wordNetIndex = null;
  const results = [];
  for (const senseId of senseIds) {
    const match = senseId.match(/^([anrvs]):([0-9]{8})-\1$/u);
    const bridge = bridgesBySense.get(senseId);
    const senseGlosses = glossesBySense.get(senseId) ?? [];
    const compoundLinks = compoundsBySense.get(senseId) ?? [];
    let rows = [];
    if ((!bridge?.gloss || !bridge?.lemmas?.length) && senseGlosses.length === 0) {
      rows = rawWordNetRowsBySense.get(senseId.toLowerCase()) ?? [];
      if (rows.length === 0 && rawWordNetIndexUnavailable) {
        wordNetIndex ??= await loadDefaultEnglishWordNetIndex();
        rows = match ? wordNetIndex.bySynset.get(match[0]) ?? [] : [];
      }
    }
    if (!match || (!bridge && senseGlosses.length === 0 && compoundLinks.length === 0 && rows.length === 0)) {
      const result = { senseId, status: "not-found", links: [] };
      results.push(result);
      report(`${senseId}: WordNet synset not found`);
      continue;
    }
    const lemmas = [...new Set([
      ...(bridge?.lemmas ?? []),
      ...senseGlosses.flatMap((gloss) => gloss.lemmas ?? []),
      ...rows.map((row) => row.lemma)
    ])].sort((left, right) => left.localeCompare(right));
    const definitions = [...new Set([
      bridge?.gloss,
      ...senseGlosses.map((gloss) => gloss.definition),
      ...rows.map((row) => row.gloss)
    ].filter(Boolean))];
    const links = [];
    if (bridge) {
      const sequence = [...(bridge.pyashSequence ?? [])];
      links.push({
        kind: sequence.length > 1 || bridge.targetKind === "compound" ? "compound" : "atom",
        target: bridge.target,
        targetPartOfSpeech: bridge.targetPartOfSpeech,
        pyashSequence: sequence,
        status: bridge.active ? "active" : sequence.length > 0 ? "withheld-collision" : "unresolved-target",
        certainty: bridge.certainty,
        evidence: bridge.evidence
      });
    }
    for (const { row, link } of compoundLinks) {
      links.push({
        kind: "compound",
        target: row.target,
        targetPartOfSpeech: link.targetPartOfSpeech || senseId[0],
        components: [...row.components],
        pyashSequence: [...row.pyash],
        status: row.status,
        evidence: row.evidence ?? row.provenance
      });
    }
    const uniqueLinks = [...new Map(links.map((link) => [
      `${link.kind}\u0000${link.target}\u0000${link.pyashSequence.join(" ")}\u0000${link.status}`,
      link
    ])).values()];
    const status = uniqueLinks.some((link) => link.status === "active" || link.status.startsWith("accepted-") || link.status === "repaired-llm")
      ? "linked"
      : uniqueLinks.length > 0
        ? "withheld"
        : "unlinked";
    const result = {
      senseId,
      partOfSpeech: match[1],
      lemmas,
      definitions,
      definition: definitions[0] ?? "",
      status,
      links: uniqueLinks
    };
    results.push(result);
    report(`${senseId} [${match[1]}; ${lemmas.join(", ")}]: ${definitions.join(" | ")}`);
    if (uniqueLinks.length === 0) {
      report(`${senseId}: no Pyash sense link recorded`);
      continue;
    }
    for (const link of uniqueLinks) {
      const sequence = link.pyashSequence.length > 0
        ? renderPyacSurface(link.pyashSequence.join(" "))
        : "no Pyac sequence";
      const components = link.components?.length ? ` [${link.components.join(" + ")}]` : "";
      report(`${senseId}: linked ${link.kind} ${link.target}${components} -> ${sequence} (${link.status}${link.certainty ? `; ${link.certainty}` : ""})`);
    }
  }
  return results;
}

async function runChineseSourceLookup(chineseInputs, { mapPath = null, report = console.log } = {}) {
  const inputs = [...new Set(chineseInputs.map((value) => String(value ?? "").trim().normalize("NFC")).filter(Boolean))];
  if (inputs.length === 0) {
    report("from zh requires at least one Chinese form");
    return { exitCode: 2, missing: 0, uncoveredNames: [], chineseLookups: [], wordNetSenseLookups: [] };
  }

  const cowLookups = await lookupWordNetSensesByChinese(inputs);
  const senseIds = [...new Set(cowLookups.flatMap((row) => row.matches.map((match) => match.wordNetSenseId)))];
  const wordNetSenseLookups = await reportWordNetSenseLookups(senseIds, () => {});
  const sensesById = new Map(wordNetSenseLookups.map((row) => [row.senseId, row]));
  const chineseLookups = [];
  const uncoveredNames = [];

  for (const input of inputs) {
    const [pinyin, characterGlosses, pyashMatches] = await Promise.all([
      lookupChinesePinyin(input),
      lookupChineseCharacterGlosses(input),
      lookupPyashByChinese(input)
    ]);
    const cowMatches = cowLookups.find((row) => row.chinese === input)?.matches ?? [];
    const pinyinText = pinyin.length > 0 ? pinyin.join(" / ") : "unavailable in the local pinyin index";
    report(`${input}: Pinyin ${pinyinText}`);
    const characterBreakdown = characterGlosses
      .filter((entry) => entry.glosses.length > 0)
      .map((entry) => `${entry.character} (${entry.glosses.join("; ")})`);
    if (characterBreakdown.length > 0) {
      report(`${input}: English character glosses ${characterBreakdown.join(" + ")}`);
    }

    for (const match of pyashMatches) {
      report(`${input}: Pyash ${match.english} -> ${match.pyash} (${match.source})`);
      chineseLookups.push({
        input,
        source: match.source,
        chinese: input,
        pinyin,
        characterGlosses,
        english: match.english,
        pyash: match.pyash
      });
    }

    for (const match of cowMatches) {
      const sense = sensesById.get(match.wordNetSenseId);
      const frequencyLabel = match.matchedForm.frequencyStatus === "frequency-top"
        ? "frequency-preferred"
        : match.matchedForm.frequencyStatus === "unresolved-frequency-tie"
          ? "unresolved frequency tie"
          : match.matchedForm.frequencyStatus === "lower-frequency"
            ? "lower-frequency sense"
            : "no English30k rank";
      const formLabel = match.matchedForm.preferred ? "shortest COW form" : "longer COW form";
      if (sense) {
        report(`${input}: WordNet ${sense.senseId} [${frequencyLabel}; ${formLabel}; ${sense.lemmas.join(", ")}]: ${sense.definition || "definition unavailable"}`);
        if (sense.links.length === 0) {
          report(`${input}: no Pyash sense link recorded for ${sense.senseId}`);
        }
        for (const link of sense.links) {
          const sequence = link.pyashSequence.length > 0
            ? ` -> ${renderPyacSurface(link.pyashSequence.join(" "))}`
            : "";
          report(`${input}: Pyash sense link ${link.target}${sequence} (${link.status})`);
        }
      } else {
        report(`${input}: WordNet ${match.wordNetSenseId} [${frequencyLabel}; ${formLabel}]`);
      }
      chineseLookups.push({
        input,
        source: "cow-wordnet-crosswalk",
        chinese: input,
        pinyin,
        characterGlosses,
        wordNetSenseId: match.wordNetSenseId,
        frequencyStatus: match.matchedForm.frequencyStatus,
        preferredForm: match.matchedForm.preferred,
        frequencyRank: match.frequencyRank,
        frequencyTagCount: match.frequencyTagCount,
        ...(sense ? {
          lemmas: sense.lemmas,
          definition: sense.definition,
          status: sense.status,
          links: sense.links
        } : {})
      });
    }

    if (pyashMatches.length === 0 && cowMatches.length === 0) {
      uncoveredNames.push(input);
      report(`${input}: no linked Chinese entry`);
    }
  }

  if (mapPath) {
    await fs.writeFile(mapPath, JSON.stringify({
      format: "vocab-suggest-v3",
      records: {},
      chineseLookups,
      wordNetSenseLookups,
      sumoLookups: []
    }, null, 2));
  }

  return {
    exitCode: uncoveredNames.length > 0 ? 1 : 0,
    missing: uncoveredNames.length,
    uncoveredNames: uncoveredNames.sort((left, right) => left.localeCompare(right)),
    chineseLookups,
    wordNetSenseLookups
  };
}

async function reportSumoLookups(keys, report) {
  const result = await lookupSumoEvidence(keys);
  for (const record of result.records) {
    const formatted = formatSumoEvidence(record);
    if (formatted) report(formatted);
  }
  if (result.truncated) report(`SUMO lookup: showing ${result.records.length} of ${result.total} exact matches`);
  if (result.warning) report(result.warning);
  return result.records;
}

function resolveGrammarRootEntries(grammar) {
  if (!grammar || !Array.isArray(grammar.components) || grammar.components.length === 0) return [];
  const roots = grammar.components.map((component) => {
    const rootName = String(component ?? "").trim().replace(/_$/u, "").toLowerCase();
    return rootName ? buildFastRootIndex().get(rootName) ?? null : null;
  });
  return roots.every(Boolean) ? roots : [];
}

async function loadDefaultEnglish30kSourceSafe() {
  if (!english30kSourcePromise) {
    english30kSourcePromise = loadEnglish30k()
      .then((source) => {
        const byVariant = new Map();
        for (const row of source.rows) {
          for (const variant of english30kLookupVariants(row.normalizedWord)) {
            if (!byVariant.has(variant)) byVariant.set(variant, row);
          }
        }
        return { source, byVariant };
      })
      .catch((error) => {
        if (error?.code === "ENOENT") return null;
        throw error;
      });
  }
  return english30kSourcePromise;
}

async function loadDefaultEnglishGrammarIndexSafe() {
  if (!englishGrammarIndexPromise) {
    englishGrammarIndexPromise = loadEnglishGrammarCatalog()
      .then((catalog) => buildEnglishGrammarIndex({ catalogEntries: catalog.entries }))
      .catch((error) => {
        if (error?.code === "ENOENT") return null;
        throw error;
      });
  }
  return englishGrammarIndexPromise;
}

async function loadDefaultEnglishLemmaIndexSafe() {
  if (!englishLemmaIndexPromise) {
    englishLemmaIndexPromise = loadEnglishLemmaCatalog()
      .then((catalog) => buildEnglishLemmaIndex({
        atomicEntries: pyashWords,
        catalogEntries: catalog.entries
      }))
      .catch((error) => {
        if (error?.code === "ENOENT") return null;
        throw error;
      });
  }
  return englishLemmaIndexPromise;
}

async function loadExtendedEnglishResourcesSafe() {
  if (!extendedEnglishResourcesPromise) {
    extendedEnglishResourcesPromise = Promise.all([
      loadDefaultEnglishLemmaIndexSafe(),
      loadVocabQueryData()
    ])
      .then(([lemmaIndex, vocabularyData]) => lemmaIndex ? ({
        lemmaIndex,
        dictionaryAliases: buildEnglishDictionaryAliases({
          dictionary: parseEnglishDictionaryBlacklist({ en: { blacklist: vocabularyData.blacklist } }),
          atomicEntries: pyashWords
        })
      }) : null)
      .catch((error) => {
        if (error?.code === "ENOENT") return null;
        throw error;
      });
  }
  return extendedEnglishResourcesPromise;
}

async function loadDefaultAnchorWordFormsSafe() {
  if (!anchorWordFormsPromise) {
    anchorWordFormsPromise = loadAnchorWordForms()
      .catch((error) => {
        if (error?.code === "ENOENT") return null;
        throw error;
      });
  }
  return anchorWordFormsPromise;
}

async function loadDefaultCompoundAtomLinksSafe() {
  if (!compoundAtomLinksPromise) compoundAtomLinksPromise = loadAllCompoundAtomLinks();
  return compoundAtomLinksPromise;
}

function sourceRowForToken(source, token) {
  if (!source?.byVariant) return null;
  return english30kLookupVariants(token)
    .map((variant) => source.byVariant.get(variant))
    .find(Boolean) ?? null;
}

function hasKnownAtomicSplit(token) {
  const normalized = normalizeCompoundTarget(token);
  if (!/^[a-z0-9]+$/u.test(normalized)) return false;
  const atomic = buildFastAtomicIndex();
  for (let split = 3; split <= normalized.length - 3; split += 1) {
    const left = english30kLookupVariants(normalized.slice(0, split));
    const right = english30kLookupVariants(normalized.slice(split));
    if (left.some((variant) => atomic.has(variant)) && right.some((variant) => atomic.has(variant))) return true;
  }
  return false;
}

function mayNeedCompoundCoverage(token) {
  const normalized = normalizeCompoundTarget(token);
  return /[-_ ]/u.test(normalized) || hasKnownAtomicSplit(normalized);
}

function directDelimitedCompoundRow(token) {
  const target = normalizeCompoundTarget(token);
  const components = target.split(/[-_ ]+/u).filter(Boolean);
  if (components.length < 2) return null;
  const atomic = buildFastAtomicIndex();
  const entries = components.map((component) => (
    english30kLookupVariants(component)
      .map((variant) => atomic.get(variant))
      .find(Boolean) ?? null
  ));
  if (entries.some((entry) => !entry)) return null;
  const pyash = entries.map((entry) => entry.pya);
  return {
    target,
    components,
    pyash,
    status: "accepted-delimited",
    identity: `${components.join("\u0001")}\u0000${pyash.join("\u0001")}`
  };
}

function findAtomicEntry(token) {
  return english30kLookupVariants(token)
    .map((variant) => buildFastAtomicIndex().get(variant))
    .find(Boolean);
}

function findDirectAtomicCoverage(token) {
  const atomic = findAtomicEntry(token);
  if (!atomic) return null;
  return {
    coverageType: "atomic",
    status: "covered-atomic",
    canonicalEnglish: atomic.en,
    lexicalRoot: {
      english: atomic.en,
      pya: atomic.pya,
      hnuc: atomic.hnuc
    },
    pyashSequence: [atomic.pya],
    hnuc: atomic.hnuc,
    direct: true
  };
}

function resolveSpecificAtom(row) {
  if (!row?.specificAtom) return null;
  const atomic = findAtomicEntry(row.specificAtom);
  if (!atomic) return null;
  return {
    english: atomic.en,
    pyash: atomic.pya,
    hnuc: atomic.hnuc
  };
}

function findCompoundProgressiveCoverage(token, acceptedCompounds) {
  const candidates = inflectionCandidates(token)
    .filter(({ rule }) => rule.startsWith("present-participle"))
    .map((candidate) => ({ candidate, rows: acceptedCompounds.get(normalizeCompoundTarget(candidate.lemma)) ?? [] }))
    .filter(({ rows }) => rows.length > 0);
  return candidates.flatMap(({ candidate, rows }) => rows.map((row) => ({
    token,
    lemma: candidate.lemma,
    components: row.components,
    pyash: [...row.pyash, "pfih"],
    specificAtom: row.specificAtom,
    specificAtomPyash: resolveSpecificAtom(row)?.pyash ?? null,
    certainty: "contextual",
    status: row.status
  })));
}

function directRecordId(row) {
  return `english30k-${String(row.rank).padStart(5, "0")}-${row.normalizedWord}`;
}

async function findFastEnglishCoverage(token) {
  const grammarIndex = await loadDefaultEnglishGrammarIndexSafe();
  const grammar = grammarIndex?.resolve(token) ?? null;
  const grammarRootEntries = resolveGrammarRootEntries(grammar);
  const atomic = english30kLookupVariants(token)
    .map((variant) => buildFastAtomicIndex().get(variant))
    .find(Boolean) ?? null;
  if (atomic && !grammar) {
    const [lemmaIndex, source] = await Promise.all([
      loadDefaultEnglishLemmaIndexSafe(),
      loadDefaultEnglish30kSourceSafe()
    ]);
    const resolved = lemmaIndex?.resolve(token);
    if (
      resolved &&
      ["anchor", "irregular", "inflectional", "derivational", "duplicate"].includes(resolved.kind) &&
      resolved.pyashSequence?.length
    ) {
      const row = sourceRowForToken(source, token);
      if (row) {
        return {
          id: directRecordId(row),
          ...row,
          coverageType: "lemma",
          status: "covered-lemma",
          canonicalEnglish: resolved.canonicalEnglish,
          pyashSequence: [...resolved.pyashSequence],
          hnuc: resolved.hnuc,
          lemma: resolved.lemma,
          lemmaKind: resolved.kind,
          lemmaStatus: resolved.status,
          ...(resolved.duplicateOf ? { duplicateOf: resolved.duplicateOf } : {}),
          lemmaRule: resolved.rule,
          lemmaEvidence: resolved.evidence,
          ...(resolved.morphology ? {
            morphology: {
              ...resolved.morphology,
              markerNames: [...resolved.morphology.markerNames],
              markerSequence: [...resolved.morphology.markerSequence]
            }
          } : {})
        };
      }
    }
  }
  if (!grammar && !atomic) return null;

  const source = await loadDefaultEnglish30kSourceSafe();
  const row = sourceRowForToken(source, token);
  if (!row) return null;

  return {
    id: directRecordId(row),
    ...row,
    coverageType: grammar ? "grammar" : "atomic",
    status: grammar ? "covered-grammar" : "covered-atomic",
    ...(atomic ? { canonicalEnglish: atomic.en, hnuc: atomic.hnuc } : {}),
    ...(atomic ? {
      lexicalRoot: {
        english: atomic.en,
        pya: atomic.pya,
        hnuc: atomic.hnuc
      }
    } : {}),
    ...(grammarRootEntries.length > 0 ? {
      lexicalRootSequence: grammarRootEntries.map((entry) => entry.pya),
      lexicalRootEntries: grammarRootEntries.map((entry) => ({
        english: entry.en,
        pya: entry.pya,
        hnuc: entry.hnuc
      }))
    } : {}),
    pyashSequence: grammar ? [...grammar.pyashSequence] : [atomic.pya]
  };
}

async function findExtendedEnglishCoverage(token) {
  const source = await loadDefaultEnglish30kSourceSafe();
  const row = sourceRowForToken(source, token);
  if (!row) return null;

  const resources = await loadExtendedEnglishResourcesSafe();
  if (!resources) return {
    id: directRecordId(row),
    ...row,
    coverageType: "unresolved",
    status: "unresolved"
  };

  const variants = english30kLookupVariants(token);
  const atomicIndex = buildFastAtomicIndex();
  const dictionaryAlias = variants
    .map((variant) => resources.dictionaryAliases.aliases.get(variant))
    .find(Boolean);
  if (dictionaryAlias) {
    const target = english30kLookupVariants(dictionaryAlias)
      .map((variant) => atomicIndex.get(variant))
      .find(Boolean);
    if (target) {
      return {
        id: directRecordId(row),
        ...row,
        coverageType: "dictionary-alias",
        status: "covered-dictionary-alias",
        canonicalEnglish: target.en,
        aliasOf: dictionaryAlias,
        lexicalRoot: {
          english: target.en,
          pya: target.pya,
          hnuc: target.hnuc
        },
        pyashSequence: [target.pya],
        hnuc: target.hnuc
      };
    }
  }

  const resolved = resources.lemmaIndex.resolve(token);
  if (resolved) {
    return {
      id: directRecordId(row),
      ...row,
      coverageType: "lemma",
      status: "covered-lemma",
      canonicalEnglish: resolved.canonicalEnglish,
      pyashSequence: [...resolved.pyashSequence],
      hnuc: resolved.hnuc,
      lemma: resolved.lemma,
      lemmaKind: resolved.kind,
      lemmaStatus: resolved.status,
      ...(resolved.duplicateOf ? { duplicateOf: resolved.duplicateOf } : {}),
      lemmaRule: resolved.rule,
      lemmaEvidence: resolved.evidence,
      ...(resolved.morphology ? {
        morphology: {
          ...resolved.morphology,
          markerNames: [...resolved.morphology.markerNames],
          markerSequence: [...resolved.morphology.markerSequence]
        }
      } : {}),
      ...(resolved.grammaticalNumber ? { grammaticalNumber: resolved.grammaticalNumber } : {})
    };
  }

  const anchors = await loadDefaultAnchorWordFormsSafe();
  const anchor = variants
    .map((variant) => anchors?.formsToAnchor.get(variant))
    .find(Boolean);
  if (anchor) {
    const target = english30kLookupVariants(anchor)
      .map((variant) => atomicIndex.get(variant))
      .find(Boolean);
    if (target) {
      return {
        id: directRecordId(row),
        ...row,
        coverageType: "alias",
        status: "covered-alias",
        canonicalEnglish: target.en,
        aliasOf: anchor,
        lexicalRoot: {
          english: target.en,
          pya: target.pya,
          hnuc: target.hnuc
        },
        pyashSequence: [target.pya],
        hnuc: target.hnuc
      };
    }
  }

  return {
    id: directRecordId(row),
    ...row,
    coverageType: "unresolved",
    status: "unresolved"
  };
}

function isCompoundCatalog(program) {
  return (program?.sentences ?? []).some((sentence) => (
    sentence?.mood === "def" &&
    sentence?.be === "map" &&
    typeof sentence.su?.name === "string" &&
    (sentence.su.name.toLowerCase().includes("compound")
      || sentence.su.name.toLowerCase().includes("english30k")
      || sentence.su.name.toLowerCase().includes("english_grammar"))
  ));
}

function registerFoundCompound(foundCompounds, rows, location, matchedTarget = null) {
  for (const row of rows) {
    const target = matchedTarget || row.target;
    const current = foundCompounds.get(target) ?? { row, rows: [], locations: new Set() };
    if (!current.rows.some((candidate) => candidate.identity === row.identity)) current.rows.push(row);
    if ((COMPOUND_STATUS_RANK.get(row.status) ?? 0) > (COMPOUND_STATUS_RANK.get(current.row.status) ?? 0)) {
      current.row = row;
    }
    if (location) current.locations.add(location);
    foundCompounds.set(target, current);
  }
}

function buildPackedPyacCompoundIndex(compounds) {
  const bySequence = new Map();
  for (const rows of compounds.values()) {
    for (const row of rows) {
      if (!Array.isArray(row.pyash) || row.pyash.length < 2) continue;
      const packed = row.pyash.join("").toLowerCase();
      if (!/^[a-z0-9]+$/u.test(packed)) continue;
      const matches = bySequence.get(packed) ?? new Map();
      matches.set(row.identity, row);
      bySequence.set(packed, matches);
    }
  }
  return new Map([...bySequence].map(([packed, rows]) => [
    packed,
    [...rows.values()].sort((left, right) => left.target.localeCompare(right.target)
      || left.pyash.join("+").localeCompare(right.pyash.join("+")))
  ]));
}

function registerFoundPackedCompound(foundCompounds, rows, token) {
  registerFoundCompound(foundCompounds, rows, "input", token);
  const found = foundCompounds.get(token);
  if (found) found.pyacSequenceQuery = token;
}

function wordNetLinkStatus(rows = []) {
  const linked = rows.filter((row) => row.senseLinks?.length > 0).length;
  if (linked === rows.length) return "linked";
  return linked > 0 ? "partially-linked" : "unlinked";
}

async function addWordNetCompoundSenseGlosses(foundCompounds, report) {
  const rows = [...foundCompounds.values()].flatMap((found) => found.rows ?? [found.row]);
  if (!rows.some((row) => row.senseLinks?.length)) {
    for (const [input, found] of foundCompounds) {
      if (!found.pyacSequenceQuery) continue;
      report(`${input}: no WordNet sense link recorded for ${[...new Set((found.rows ?? [found.row]).map((row) => row.target))].join(", ")}`);
    }
    return [];
  }
  const senseIds = [...new Set(rows.flatMap((row) => (row.senseLinks ?? []).map((link) => link.senseId)))];
  const indexedGlosses = (await loadEnglishWordNetCompoundGlosses({ senseIds })).records;
  const glossesBySenseAndTarget = new Map();
  for (const gloss of indexedGlosses) {
    const key = `${gloss.senseId}\u0000${normalizeCompoundTarget(gloss.target)}`;
    const matches = glossesBySenseAndTarget.get(key) ?? [];
    matches.push(gloss);
    glossesBySenseAndTarget.set(key, matches);
  }
  const reported = [];
  for (const [target, found] of foundCompounds) {
    const senseGlosses = [];
    for (const row of found.rows ?? [found.row]) {
      for (const link of row.senseLinks ?? []) {
        const indexed = glossesBySenseAndTarget.get(`${link.senseId}\u0000${normalizeCompoundTarget(row.target)}`) ?? [];
        for (const gloss of indexed) {
          const senseGloss = { ...gloss, pyashSequence: [...row.pyash] };
          if (senseGlosses.some((candidate) => candidate.senseId === senseGloss.senseId
            && candidate.definition === senseGloss.definition)) continue;
          senseGlosses.push(senseGloss);
        }
      }
    }
    if (senseGlosses.length === 0) {
      if (found.pyacSequenceQuery) {
        const hasRecordedLink = (found.rows ?? [found.row]).some((row) => row.senseLinks?.length > 0);
        if (hasRecordedLink) report(`${target}: WordNet sense link recorded, but no matching gloss row exists`);
      }
      continue;
    }
    found.senseGlosses = senseGlosses;
    for (const senseGloss of senseGlosses) {
      const pyac = renderPyacSurface(senseGloss.pyashSequence.join(" "));
      const lemmas = senseGloss.lemmas.join(", ");
      report(`${target}: WordNet ${senseGloss.senseId} [${lemmas}]: ${senseGloss.definition} -> ${senseGloss.target} (${pyac})`);
      reported.push({ input: target, ...senseGloss, pyac });
    }
  }
  for (const [input, found] of foundCompounds) {
    if (!found.pyacSequenceQuery) continue;
    const unlinkedTargets = [...new Set((found.rows ?? [found.row])
      .filter((row) => !row.senseLinks?.length)
      .map((row) => row.target))];
    if (unlinkedTargets.length > 0) {
      report(`${input}: no WordNet sense link recorded for ${unlinkedTargets.join(", ")}`);
    }
  }
  return reported;
}

function mergeCompoundRows(target, source) {
  for (const [compound, rows] of source.entries()) {
    const current = target.get(compound) ?? [];
    for (const row of rows) {
      const existingIndex = current.findIndex((candidate) => candidate.identity === row.identity);
      if (existingIndex === -1) {
        current.push(row);
      } else if ((COMPOUND_STATUS_RANK.get(row.status) ?? 0) > (COMPOUND_STATUS_RANK.get(current[existingIndex].status) ?? 0)) {
        current[existingIndex] = row;
      }
    }
    target.set(compound, current);
  }
}

// Collects the tokens of a sentence into the two roles that matter for
// coverage. A name names something and does not need a vocabulary entry of its
// own; a word does. Tokens that appear in both roles are treated as words.
function collectTokensFromSentence(sentence, out) {
  if (!sentence || typeof sentence !== "object") return;
  if (typeof sentence.be === "string") {
    for (const token of sentence.be.split(/\s+/).filter(Boolean)) {
      if (NAME_TOKEN_REGEX.test(token) && !STRUCTURAL_VERB_TOKENS.has(token.toLowerCase())) out.words.add(token);
    }
  }
  const skipKeys = new Set(["raw", "text", "filename", "pyash"]);
  const stack = [sentence];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
      continue;
    }
    if (typeof node.name === "string") {
      for (const token of tokenizeName(node.name)) {
        if (!isApprovedContractNameToken(token)) out.names.add(token);
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (skipKeys.has(key)) continue;
      if (value && typeof value === "object") stack.push(value);
    }
  }
}

async function queryRyan(token) {
  if (checked.has(token)) return checked.get(token);
  const lines = [];
  const output = await queryVocabLines(token);
  for (const line of output) {
    const trimmed = line.trim();
    if (trimmed) lines.push(trimmed);
  }
  const sorted = lines.sort((a, b) => {
    const aIsv = /\bisv\b/.test(a);
    const bIsv = /\bisv\b/.test(b);
    if (aIsv === bIsv) return 0;
    return aIsv ? -1 : 1;
  });
  checked.set(token, sorted);
  return sorted;
}

function isFileMarker(line) {
  return /^"?file"?$/i.test(line);
}

function parseBlacklist(line) {
  const trimmed = line.trim();
  if (!(trimmed.startsWith("[") || trimmed.startsWith("\""))) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function normalizeGloss(text) {
  let value = text.trim();
  value = value.replace(/\s+grammar$/, "");
  const phoneticIndex = value.indexOf(" /");
  if (phoneticIndex !== -1 && value.endsWith("/")) {
    value = value.slice(0, phoneticIndex).trim();
  }
  return value;
}

function getGlossFromLine(line) {
  if (!line || line.startsWith("#define")) return null;
  const match = line.match(/^(\S+)\s+(\S+)\s+(.+)$/);
  if (!match) return null;
  return normalizeGloss(match[3]);
}

function getPyashFromLine(line) {
  if (!line || line.startsWith("#define")) return null;
  const match = line.match(/^(\S+)\s+(\S+)\s+(.+)$/);
  if (!match) return null;
  return match[1];
}

function exactVocabMatches(token, lines) {
  const lower = String(token ?? "").toLowerCase();
  if (!lower) return [];
  const matches = [];
  const seen = new Set();
  for (const line of lines) {
    if (!line || isFileMarker(line) || parseBlacklist(line) !== null || line.startsWith("#define")) continue;
    const pyash = getPyashFromLine(line);
    const gloss = getGlossFromLine(line);
    if (!pyash || !gloss) continue;
    if (pyash.toLowerCase() !== lower && gloss.toLowerCase() !== lower) continue;
    const key = `${pyash}\u0000${gloss}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push({ pyash, gloss });
  }
  return matches;
}

function coverageSequence(coverage) {
  if (Array.isArray(coverage?.pyashSequence) && coverage.pyashSequence.length > 0) {
    return coverage.pyashSequence.filter((word) => typeof word === "string" && word.trim());
  }
  if (Array.isArray(coverage?.lexicalRootSequence) && coverage.lexicalRootSequence.length > 0) {
    return coverage.lexicalRootSequence.filter((word) => typeof word === "string" && word.trim());
  }
  if (typeof coverage?.lexicalRoot?.pya === "string" && coverage.lexicalRoot.pya.trim()) {
    return [coverage.lexicalRoot.pya.trim()];
  }
  return [];
}

function structuredCoverageMapping(word, coverage, kind, source = "") {
  const sequence = coverageSequence(coverage);
  if (sequence.length === 0) return null;
  const english = normalizeCompoundTarget(
    coverage?.canonicalEnglish
      || coverage?.aliasOf
      || coverage?.lemma
      || word
  );
  if (!english) return null;
  return {
    word: english,
    pyac: renderPyacSurface(sequence.join(" ")),
    pyacSequence: sequence,
    kind,
    coverageType: coverage?.coverageType || "suggestion",
    status: coverage?.status || "covered",
    ...(Number.isInteger(coverage?.rank) ? { rank: coverage.rank } : {}),
    ...(source ? { source } : {})
  };
}

function uniqueStrings(values) {
  return [...new Set(values
    .filter((value) => typeof value === "string")
    .map((value) => normalizeCompoundTarget(value))
    .filter(Boolean))];
}

function isExactTokenMatch(token, lines) {
  const lower = String(token ?? "").toLowerCase();
  if (!lower) return false;
  const target = resolveEnglishAlias(lower) || lower;
  for (const line of lines) {
    if (!line) continue;
    if (isFileMarker(line)) continue;
    if (parseBlacklist(line) !== null) continue;
    const pyash = getPyashFromLine(line);
    if (pyash && (pyash.toLowerCase() === lower || pyash.toLowerCase() === target)) return true;
    const gloss = getGlossFromLine(line);
    if (gloss && (gloss.toLowerCase() === lower || gloss.toLowerCase() === target)) return true;
  }
  return false;
}

async function findStructuredSuggestionCoverage(word) {
  const fast = await findFastEnglishCoverage(word);
  if (fast) return fast;
  const direct = findDirectAtomicCoverage(word);
  if (direct) return direct;
  const extended = await findExtendedEnglishCoverage(word);
  return extended?.coverageType && extended.coverageType !== "unresolved"
    ? extended
    : null;
}

async function buildStructuredSuggestionRecord(token, {
  occurrences,
  foundCompounds,
  dictionaryMatches,
  lemmaMatches,
  rootMatches,
  grammarMatches,
  morphologyMatches,
  compoundMorphologyMatches,
  pyaGlossMatches,
  okTextTokens,
  rankedCoverage
}) {
  const input = normalizeCompoundTarget(token);
  const mappings = [];
  const mappingKeys = new Set();
  const directMappings = [];
  const addMapping = (mapping, direct = false) => {
    if (!mapping) return;
    const key = `${mapping.word}\u0000${mapping.pyacSequence.join(" ")}`;
    if (mappingKeys.has(key)) return;
    mappingKeys.add(key);
    mappings.push(mapping);
    if (direct) directMappings.push(mapping);
  };
  const addCoverage = (word, coverage, kind, source, direct = false) => {
    addMapping(structuredCoverageMapping(word, coverage, kind, source), direct);
  };

  addCoverage(input, dictionaryMatches.get(token), "dictionary-alias", "vocab-suggest", true);
  addCoverage(input, lemmaMatches.get(token), "lemma", "vocab-suggest", true);
  addCoverage(input, rootMatches.get(token), "root", "vocab-suggest", true);
  addCoverage(input, grammarMatches.get(token), "grammar", "vocab-suggest", true);
  addCoverage(input, morphologyMatches.get(token), "morphology", "vocab-suggest", true);

  for (const candidate of compoundMorphologyMatches.get(token) ?? []) {
    const sequence = Array.isArray(candidate.pyash)
      ? candidate.pyash.filter((word) => typeof word === "string" && word.trim())
      : [];
    if (sequence.length === 0) continue;
    addMapping({
      word: normalizeCompoundTarget(candidate.lemma || input),
      pyac: renderPyacSurface(sequence.join(" ")),
      pyacSequence: sequence,
      kind: "compound-morphology",
      coverageType: "compound",
      status: candidate.status || "covered",
      source: "vocab-suggest"
    }, true);
  }

  const found = foundCompounds.get(token);
  if (found?.row) {
    for (const row of found.rows ?? [found.row]) {
      const sequence = Array.isArray(row.pyash) ? row.pyash : row.pyashSequence;
      if (!Array.isArray(sequence) || sequence.length === 0) continue;
      addMapping({
        word: normalizeCompoundTarget(row.target || row.surface || input),
        pyac: renderPyacSurface(sequence.join(" ")),
        pyacSequence: sequence,
        kind: "compound",
        coverageType: "compound",
        status: row.status || "covered-compound",
        source: "accepted-compound"
      }, true);
    }
  }

  for (const match of pyaGlossMatches.get(token) ?? []) {
    if (!match.pyash || !match.gloss) continue;
    addMapping({
      word: normalizeCompoundTarget(match.gloss),
      pyac: renderPyacSurface(match.pyash),
      pyacSequence: [match.pyash],
      kind: "gloss",
      coverageType: "atomic",
      status: "covered-atomic",
      source: "vocab-suggest"
    }, true);
  }

  const lines = occurrences.has(token) || foundCompounds.has(token)
    ? await queryRyan(token)
    : [];
  const blacklistValue = lines.length === 1 ? parseBlacklist(lines[0]) : null;
  const blacklistWords = Array.isArray(blacklistValue)
    ? blacklistValue
    : typeof blacklistValue === "string"
      ? blacklistValue.split(/\s*,\s*/u)
      : [];
  const lineWords = lines
    .filter((line) => !isFileMarker(line) && parseBlacklist(line) === null && !line.startsWith("#define"))
    .map(getGlossFromLine)
    .filter(Boolean);
  const isKnownUnresolvedEnglishWord = rankedCoverage.get(token)?.coverageType === "unresolved";
  const wordSuggestions = uniqueStrings([
    ...directMappings.map((mapping) => mapping.word),
    ...blacklistWords,
    ...(isKnownUnresolvedEnglishWord ? [] : lineWords)
  ]).filter((word) => word !== input);

  for (const word of wordSuggestions) {
    const coverage = await findStructuredSuggestionCoverage(word);
    addCoverage(word, coverage, "word-suggestion", "vocab-suggest", false);
  }

  const status = directMappings.length > 0
    ? "covered"
    : blacklistWords.length > 0
      ? "blocked"
      : occurrences.has(token)
        ? "unresolved"
        : okTextTokens.has(token)
          ? "ok"
          : "unresolved";
  return {
    input,
    status,
    wordSuggestions,
    mappings,
    ...(blacklistWords.length > 0 ? { suggestionSource: "blacklist" } : {})
  };
}

async function isExactTokenMatchOrAlias(token, lines) {
  if (isGrammarKeyword(token)) return true;
  if (isExactTokenMatch(token, lines)) return true;
  const alias = resolveEnglishAlias(token);
  const lower = String(token ?? "").toLowerCase();
  if (!alias || alias === lower) return false;
  const aliasLines = await queryRyan(alias);
  return isExactTokenMatch(alias, aliasLines);
}

async function collectFiles(input, out) {
  const resolved = resolve(input);
  const stats = await fs.stat(resolved);
  if (stats.isDirectory()) {
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    for (const entry of entries) {
      const next = resolve(resolved, entry.name);
      if (entry.isDirectory()) {
        await collectFiles(next, out);
      } else if (entry.isFile() && entry.name.endsWith(".pya")) {
        out.push(next);
      }
    }
    return;
  }
  if (stats.isFile()) out.push(resolved);
}

function extractQuotedPyashBlocks(text) {
  const blocks = [];
  let index = 0;
  while (index < text.length) {
    const start = text.indexOf(PYASH_QUOTED_START, index);
    if (start === -1) break;
    const contentStart = start + PYASH_QUOTED_START.length;
    const end = text.indexOf(PYASH_QUOTED_END, contentStart);
    if (end === -1) break;
    const raw = text.slice(contentStart, end);
    blocks.push(raw.replaceAll("\\n", "\n"));
    index = end + PYASH_QUOTED_END.length;
  }
  return blocks;
}

async function resolveRootsAndTokens(inputs, textInputs) {
  const roots = [];
  const tokens = [...textInputs];
  if (inputs.length === 0 && tokens.length === 0) {
    return { roots: ["examples/pyash"], tokens };
  }
  for (const input of inputs) {
    if (textInputs.length > 0) {
      roots.push(input);
      continue;
    }
    if (isPlainVocabularyToken(input)) {
      tokens.push(input);
      continue;
    }
    try {
      const stats = await fs.stat(input);
      if (stats.isDirectory() || stats.isFile()) {
        roots.push(input);
      } else {
        tokens.push(input);
      }
    } catch {
      tokens.push(input);
    }
  }
  return { roots, tokens };
}

export async function runVocabSuggest(args = process.argv.slice(2), {
  report = console.log,
  includeStructured = null
} = {}) {
  const { inputs, textInputs, senseIds, sumoIds, mapPath, sourceLanguage, targetLanguage } = parseArgs(args);
  if (sourceLanguage === "zh") {
    if (senseIds.length > 0 || sumoIds.length > 0) {
      throw new Error("WordNet and SUMO identifiers cannot be combined with from zh");
    }
    return runChineseSourceLookup([...inputs, ...textInputs], { mapPath, report });
  }
  const resolved = await resolveRootsAndTokens(inputs, textInputs);
  const shouldBuildStructured = includeStructured ?? (mapPath !== null || !await isMainModule());
  const roots = (senseIds.length > 0 || sumoIds.length > 0) && inputs.length === 0 && textInputs.length === 0
    ? []
    : resolved.roots;
  const resolvedTextInputs = resolved.tokens;
  const occurrences = new Map();
  const acceptedCompounds = new Map();
  const foundCompounds = new Map();
  let packedPyacCompoundIndex = null;
  const rankedCoverage = new Map();
  const compoundMorphologyMatches = new Map();
  const dictionaryMatches = new Map();
  const lemmaMatches = new Map();
  const rootMatches = new Map();
  const compoundAtomMatches = new Map();
  const grammarMatches = new Map();
  const morphologyMatches = new Map();
  const pyaGlossMatches = new Map();
  const okTextTokens = new Set();
  const files = [];
  let curatedAcceptedCompoundsLoaded = false;
  let defaultAcceptedCompoundsLoaded = false;
  const ensureCuratedAcceptedCompounds = async () => {
    if (curatedAcceptedCompoundsLoaded) return;
    mergeCompoundRows(acceptedCompounds, await loadDefaultCuratedAcceptedCompounds());
    curatedAcceptedCompoundsLoaded = true;
  };
  const ensureDefaultAcceptedCompounds = async () => {
    if (defaultAcceptedCompoundsLoaded) return;
    mergeCompoundRows(acceptedCompounds, await loadDefaultAcceptedCompounds());
    mergeCompoundRows(acceptedCompounds, await loadDefaultCuratedAcceptedCompounds());
    defaultAcceptedCompoundsLoaded = true;
  };
  const registerCompoundAtomMatches = async (token, english) => {
    const links = await loadDefaultCompoundAtomLinksSafe();
    const matches = links.atomToCompounds.get(normalizeCompoundTarget(english)) ?? [];
    if (matches.length > 0) compoundAtomMatches.set(token, matches);
  };
  for (const root of roots) {
    await collectFiles(root, files);
  }

  if (roots.length > 0) await ensureDefaultAcceptedCompounds();

  const parsedFiles = [];
  for (const file of files) {
    const text = await fs.readFile(file, "utf8");
    const program = buildProgram(text);
    mergeCompoundRows(acceptedCompounds, parseAcceptedCompoundRows(program));
    parsedFiles.push({ file, text, program });
  }

  // A token that names something anywhere in the program is a name, even where
  // it also stands in the predicate slot: "be android ... do" names the
  // android rather than needing a vocabulary entry of its own.
  const namesAcrossFiles = new Set();
  for (const { text, program } of parsedFiles) {
    if (isCompoundCatalog(program)) continue;
    const roles = { words: new Set(), names: new Set() };
    for (const sentence of program.sentences) {
      collectTokensFromSentence(sentence, roles);
    }
    for (const block of extractQuotedPyashBlocks(text)) {
      const blockProgram = buildProgram(block);
      for (const sentence of blockProgram.sentences) {
        collectTokensFromSentence(sentence, roles);
      }
    }
    for (const token of roles.names) namesAcrossFiles.add(token);
  }

  let missing = 0;
  const uncoveredNames = new Set();
  const textTokens = new Set();
  for (const input of resolvedTextInputs) {
    for (const token of tokenizeName(input)) textTokens.add(token);
  }
  for (const { file, text, program } of parsedFiles) {
    const roles = { words: new Set(), names: new Set() };
    const compoundCatalog = isCompoundCatalog(program);
    if (compoundCatalog) continue;
    for (const sentence of program.sentences) {
      collectTokensFromSentence(sentence, roles);
    }
    for (const block of extractQuotedPyashBlocks(text)) {
      const blockProgram = buildProgram(block);
      for (const sentence of blockProgram.sentences) {
        collectTokensFromSentence(sentence, roles);
      }
    }
    const tokens = new Set([...roles.words, ...roles.names]);
    for (const token of tokens) {
      if (isGrammarKeyword(token)) continue;
      // A token that names something anywhere in the program is a name, even
      // where it also stands in the predicate slot: "be android ... do" names
      // the android, it does not need a vocabulary entry of its own. A token
      // that is only ever a predicate word does.
      const isNameOnly = namesAcrossFiles.has(token);
      let knownCompounds = acceptedCompounds.get(normalizeCompoundTarget(token));
      if (knownCompounds?.length) {
        registerFoundCompound(foundCompounds, knownCompounds, file, token);
        continue;
      }
      await ensureDefaultAcceptedCompounds();
      knownCompounds = acceptedCompounds.get(normalizeCompoundTarget(token));
      if (knownCompounds?.length) {
        registerFoundCompound(foundCompounds, knownCompounds, file, token);
        continue;
      }
      const ranked = await findEnglish30kCoverage(token);
      if (ranked?.coverageType && ranked.coverageType !== "unresolved") {
        if (ranked.morphology?.markerSequence?.length) morphologyMatches.set(token, ranked);
        if (ranked.coverageType === "lemma") lemmaMatches.set(token, ranked);
        else if (ranked.coverageType === "dictionary-alias") dictionaryMatches.set(token, ranked);
        else if (ranked.coverageType === "grammar") grammarMatches.set(token, ranked);
        continue;
      }
      if (ranked) rankedCoverage.set(token, ranked);
      const lines = await queryRyan(token);
      if (lines.length === 0 || (lines.length === 1 && isFileMarker(lines[0]))) {
        if (isNameOnly) {
          uncoveredNames.add(token);
          if (!occurrences.has(token)) occurrences.set(token, new Set());
          occurrences.get(token).add(file);
          continue;
        }
        missing += 1;
        if (!occurrences.has(token)) occurrences.set(token, new Set());
        occurrences.get(token).add(file);
        continue;
      }
      if (!await isExactTokenMatchOrAlias(token, lines)) {
        if (isNameOnly) {
          uncoveredNames.add(token);
          if (!occurrences.has(token)) occurrences.set(token, new Set());
          occurrences.get(token).add(file);
          continue;
        }
        missing += 1;
        if (!occurrences.has(token)) occurrences.set(token, new Set());
        occurrences.get(token).add(file);
      }
    }
  }
  for (const token of textTokens) {
    const fastRanked = await findFastEnglishCoverage(token);
    if (isGrammarKeyword(token) && !fastRanked) {
      okTextTokens.add(token);
      continue;
    }
    // A valid English word can also split into short Pyac atoms (for example,
    // love = lo + ve). Prefer its English reading before loading the full
    // accepted-compound inventory to test a speculative packed reading.
    const packedSequences = !fastRanked ? packedPyacCompoundSequences(token) : [];
    const rankedEnglishWord = packedSequences.length > 0
      ? sourceRowForToken(await loadDefaultEnglish30kSourceSafe(), token)
      : null;
    if (packedSequences.length > 0 && !rankedEnglishWord) {
      for (const pyashSequence of packedSequences) {
        mergeCompoundRows(acceptedCompounds, await loadDefaultWordNetCompoundMatches({ pyashSequence }));
      }
      await ensureCuratedAcceptedCompounds();
      packedPyacCompoundIndex = buildPackedPyacCompoundIndex(acceptedCompounds);
      let packedMatches = packedPyacCompoundIndex.get(token.toLowerCase());
      if (!packedMatches?.length) {
        await ensureDefaultAcceptedCompounds();
        packedPyacCompoundIndex = buildPackedPyacCompoundIndex(acceptedCompounds);
        packedMatches = packedPyacCompoundIndex.get(token.toLowerCase());
      }
      if (packedMatches?.length) {
        registerFoundPackedCompound(foundCompounds, packedMatches, token);
        if (!fastRanked || fastRanked.coverageType === "unresolved") continue;
      }
    }
    mergeCompoundRows(acceptedCompounds, await loadDefaultWordNetCompoundMatches({ target: token }));
    const canonicalCompounds = acceptedCompounds.get(normalizeCompoundTarget(token));
    if (canonicalCompounds?.length) registerFoundCompound(foundCompounds, canonicalCompounds, "input", token);
    let ranked = fastRanked;
    if (!ranked) {
      const directAtomic = findDirectAtomicCoverage(token);
      if (directAtomic) {
        rootMatches.set(token, directAtomic);
        await registerCompoundAtomMatches(token, directAtomic.canonicalEnglish);
        continue;
      }
      await ensureCuratedAcceptedCompounds();
      const compoundProgressive = findCompoundProgressiveCoverage(token, acceptedCompounds);
      if (compoundProgressive.length > 0) {
        compoundMorphologyMatches.set(token, compoundProgressive);
        continue;
      }
      let knownCompounds = acceptedCompounds.get(normalizeCompoundTarget(token));
      if (knownCompounds?.length) {
        registerFoundCompound(foundCompounds, knownCompounds, "input", token);
        if (!knownCompounds.some((row) => row.senseLinks?.length > 0)) continue;
      }
      const directCompound = directDelimitedCompoundRow(token);
      if (directCompound) {
        registerFoundCompound(foundCompounds, [directCompound], "input", token);
        continue;
      }
      ranked = await findExtendedEnglishCoverage(token);
      if ((!ranked || ranked.coverageType === "unresolved") && mayNeedCompoundCoverage(token)) {
        await ensureDefaultAcceptedCompounds();
        knownCompounds = acceptedCompounds.get(normalizeCompoundTarget(token));
        if (knownCompounds?.length) {
          registerFoundCompound(foundCompounds, knownCompounds, "input", token);
          continue;
        }
      }
    }
    if (ranked?.coverageType && ranked.coverageType !== "unresolved") {
      const rootSequence = ranked.lexicalRootSequence?.length
        ? ranked.lexicalRootSequence
        : ranked.lexicalRoot?.pya
          ? [ranked.lexicalRoot.pya]
          : [];
      if (rootSequence.length > 0) {
        rootMatches.set(token, {
          ...ranked,
          coverageType: "root",
          pyashSequence: rootSequence
        });
        if (ranked.lexicalRoot?.english) {
          await registerCompoundAtomMatches(token, ranked.lexicalRoot.english);
        }
      }
      if (ranked.morphology?.markerSequence?.length) morphologyMatches.set(token, ranked);
      if (ranked.coverageType === "lemma") lemmaMatches.set(token, ranked);
      else if (ranked.coverageType === "dictionary-alias") dictionaryMatches.set(token, ranked);
      else if (ranked.coverageType === "grammar") grammarMatches.set(token, ranked);
      else if (rootSequence.length === 0) okTextTokens.add(token);
      continue;
    }
    if (ranked) rankedCoverage.set(token, ranked);
    const lines = await queryRyan(token);
    const blacklistValue = lines.length === 1 ? parseBlacklist(lines[0]) : null;
    const coveredByCanonicalCompound = foundCompounds.has(token);
    if (
      lines.length === 0 ||
      (lines.length === 1 && isFileMarker(lines[0])) ||
      blacklistValue !== null ||
      !await isExactTokenMatchOrAlias(token, lines)
    ) {
      if (!coveredByCanonicalCompound) missing += 1;
      if (!occurrences.has(token)) occurrences.set(token, new Set());
      occurrences.get(token).add("input");
    } else {
      const exactMatches = exactVocabMatches(token, lines)
        .filter((match) => match.pyash.toLowerCase() === token.toLowerCase());
      if (exactMatches.length > 0) pyaGlossMatches.set(token, exactMatches);
      else okTextTokens.add(token);
    }
  }


  const deferredLookupReports = [];
  const lookupReport = targetLanguage === "zh"
    ? (line) => deferredLookupReports.push(line)
    : report;
  const wordNetSenseLookups = await reportWordNetSenseLookups(senseIds, lookupReport);

  const linkedWordNetLines = [];
  const linkedWordNetSenses = await reportLinkedWordNetSenses(resolvedTextInputs, (line) => linkedWordNetLines.push(line));
  const wordNetCompoundLines = [];
  const wordNetCompoundSenses = await addWordNetCompoundSenseGlosses(foundCompounds, (line) => wordNetCompoundLines.push(line));
  const wordNetCompoundSenseLines = new Set(wordNetCompoundSenses.map((entry) => (
    `${entry.input}: WordNet ${entry.senseId} [${entry.lemmas.join(", ")}]: ${entry.definition} -> ${entry.target} (${entry.pyac})`
  )));
  for (const line of wordNetCompoundLines) {
    if (!wordNetCompoundSenseLines.has(line)) lookupReport(line);
  }

  const activeTextSenseIds = new Set([
    ...linkedWordNetSenses.filter((entry) => entry.active === true).map((entry) => entry.source),
    ...wordNetCompoundSenses
      .filter((entry) => resolvedTextInputs.includes(entry.input))
      .map((entry) => entry.senseId)
  ]);
  const directSenseChineseLookups = targetLanguage === "zh"
    ? await reportCowChineseSenseLookups(wordNetSenseLookups
      .filter((entry) => !activeTextSenseIds.has(entry.senseId)), report)
    : [];
  const chineseLookups = targetLanguage === "zh"
    ? await reportPyashChineseLookups(resolvedTextInputs, {
      linkedWordNetSenses,
      wordNetCompoundSenses,
      foundCompounds,
      report
    })
    : [];
  const sumoLookups = await reportSumoLookups([...resolvedTextInputs, ...sumoIds, ...senseIds], lookupReport);


  const foundCompoundLines = [];
  for (const [target, found] of [...foundCompounds.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const locationSuffix = [...found.locations]
      .map(name => name.replace(`${process.cwd()}/`, ""))
      .filter(Boolean)
      .join(", ");
    for (const row of found.rows ?? [found.row]) {
      const specificAtom = resolveSpecificAtom(row);
      const specificSuffix = specificAtom
        ? `; specific atom ${specificAtom.english} -> ${specificAtom.pyash}`
        : "";
      const englishTargetSuffix = found.pyacSequenceQuery ? `; English target ${row.target}` : "";
      foundCompoundLines.push({
        token: target,
        sequence: row.pyash.join(" "),
        line: `${target}: found compound ${row.components.join(" + ")} -> ${row.pyash.join(" ")} (${row.status})${specificSuffix}${englishTargetSuffix}${locationSuffix ? ` (${locationSuffix})` : ""}`
      });
    }
  }

  const wordNetOutputRows = [
    ...linkedWordNetSenses.map((entry, index) => ({
      token: entry.input,
      sequence: entry.pyashSequence.join(" "),
      line: linkedWordNetLines[index]
    })),
    ...wordNetCompoundSenses.map((entry) => ({
      token: entry.input,
      sequence: entry.pyashSequence.join(" "),
      line: `${entry.input}: WordNet ${entry.senseId} [${entry.lemmas.join(", ")}]: ${entry.definition} -> ${entry.target} (${entry.pyac})`
    }))
  ];
  const linkedWordNetGroups = new Map();
  wordNetOutputRows.forEach((entry) => {
    const key = `${entry.token}\u0000${entry.sequence}`;
    const group = linkedWordNetGroups.get(key) ?? { token: entry.token, sequence: entry.sequence, lines: [] };
    group.lines.push(entry.line);
    linkedWordNetGroups.set(key, group);
  });
  const foundCompoundsByTokenAndSequence = new Map();
  for (const found of foundCompoundLines) {
    const key = `${found.token}\u0000${found.sequence}`;
    foundCompoundsByTokenAndSequence.set(key, [...(foundCompoundsByTokenAndSequence.get(key) ?? []), found]);
  }
  const emittedFoundCompounds = new Set();
  for (const [key, group] of linkedWordNetGroups) {
    for (const line of group.lines) lookupReport(line);
    for (const found of foundCompoundsByTokenAndSequence.get(key) ?? []) {
      lookupReport(found.line);
      emittedFoundCompounds.add(found);
    }
  }
  for (const found of foundCompoundLines) {
    if (!emittedFoundCompounds.has(found)) lookupReport(found.line);
  }
  for (const line of deferredLookupReports) report(line);

  if (occurrences.size > 0) {
    for (const [token, filesForToken] of [...occurrences.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const lines = await queryRyan(token);
      const blacklistValue = lines.length === 1 ? parseBlacklist(lines[0]) : null;
      const isKnownUnresolvedEnglishWord = rankedCoverage.get(token)?.coverageType === "unresolved";
      const suggestionList = isKnownUnresolvedEnglishWord
        ? []
        : lines.filter(line => !isFileMarker(line) && parseBlacklist(line) === null && !line.startsWith("#define"));
      const glosses = [];
      const seenGlosses = new Set();
      for (const line of suggestionList) {
        const gloss = getGlossFromLine(line);
        if (!gloss) continue;
        const lower = gloss.toLowerCase();
        if (seenGlosses.has(lower)) continue;
        seenGlosses.add(lower);
        glosses.push(gloss);
      }
      const preview = glosses.slice(0, 4).join(" | ");
      const fileList = [...filesForToken]
        .map(name => name.replace(`${process.cwd()}/`, ""))
        .filter(name => name && name !== "input");
      const locationSuffix = fileList.length > 0 ? ` (${fileList.join(", ")})` : "";
      if (blacklistValue !== null) {
        const alternatives = Array.isArray(blacklistValue) ? blacklistValue : [blacklistValue];
        const pyacAlternatives = alternatives
          .map((alternative) => findAtomicEntry(alternative))
          .filter(Boolean)
          .map((entry) => `${entry.en} -> ${entry.pya}`);
        const pyacSuffix = pyacAlternatives.length > 0
          ? ` Pyac: ${pyacAlternatives.join(" | ")}.`
          : "";
        const suggestionLabel = foundCompounds.has(token)
          ? `${token}: dictionary alternatives: ${blacklistValue}.`
          : `${token} blocked, instead: ${blacklistValue}.`;
        report(`${suggestionLabel}${pyacSuffix}${locationSuffix}`);
      } else {
        const ranked = rankedCoverage.get(token);
        const rankSuffix = ranked
          ? `; English30k rank ${ranked.rank} remains unresolved`
          : "";
        if (uncoveredNames.has(token)) {
          report(`${token}: name without vocabulary coverage${rankSuffix}${locationSuffix}`);
          continue;
        }
        report(`${token}: ${preview || "no suggestions"}${rankSuffix}${locationSuffix}`);
      }
    }
  }

  if (okTextTokens.size > 0) {
    for (const token of [...okTextTokens].sort((a, b) => a.localeCompare(b))) {
      report(`${token}: ok`);
    }
  }

  for (const [token, matches] of [...pyaGlossMatches.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    report(`${token}: ${matches.map((match) => match.gloss).join(" | ")}`);
  }

  for (const [token, ranked] of [...lemmaMatches.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (ranked.lemmaKind === "duplicate") {
      report(`${token}: deprecated duplicate of ${ranked.duplicateOf} -> ${ranked.pyashSequence.join(" ")} (English30k rank ${ranked.rank})`);
    } else {
      report(`${token}: lemma ${ranked.lemma} -> ${ranked.pyashSequence.join(" ")} (English30k rank ${ranked.rank})`);
    }
  }

  for (const [token, ranked] of [...morphologyMatches.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const morphology = ranked.morphology;
    const markers = morphology.markerNames.join(" + ");
    const sequence = [...ranked.pyashSequence, ...morphology.markerSequence].join(" ");
    report(`${token}: morphology ${ranked.lemma} + ${markers} -> ${sequence} (${morphology.certainty}; English30k rank ${ranked.rank})`);
  }

  for (const [token, candidates] of [...compoundMorphologyMatches.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    for (const candidate of candidates) {
      const specificSuffix = candidate.specificAtomPyash
        ? `; specific atom ${candidate.specificAtom} -> ${candidate.specificAtomPyash}`
        : "";
      report(`${token}: morphology ${candidate.lemma} (${candidate.components.join(" + ")}) + progressive_aspect_ -> ${candidate.pyash.join(" ")} (${candidate.certainty})${specificSuffix}`);
    }
  }

  for (const [token, ranked] of [...dictionaryMatches.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    report(`${token}: dictionary alias ${ranked.aliasOf} -> ${ranked.pyashSequence.join(" ")} (English30k rank ${ranked.rank})`);
  }

  for (const [token, ranked] of [...rootMatches.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const source = Number.isInteger(ranked.rank) ? `English30k rank ${ranked.rank}` : "direct Pyash atom";
    const links = compoundAtomMatches.get(token) ?? [];
    const compoundSuffix = links.length > 0
      ? `; compounds: ${links.map(({ compound }) => `${compound.surface ?? compound.target} -> ${(compound.pyashSequence ?? compound.pyash).join(" ")}`).join(" | ")}`
      : "";
    report(`${token}: root -> ${ranked.pyashSequence.join(" ")} (${source})${compoundSuffix}`);
  }

  for (const [token, ranked] of [...grammarMatches.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const pyac = renderPyacSurface(ranked.pyashSequence.join(" "));
    report(`${token}: grammar -> ${pyac} (English30k rank ${ranked.rank})`);
  }

  const suggestionRecords = [];
  if (shouldBuildStructured) {
    const suggestionTokens = new Set([
      ...resolvedTextInputs.flatMap(tokenizeName),
      ...occurrences.keys(),
      ...foundCompounds.keys(),
      ...dictionaryMatches.keys(),
      ...lemmaMatches.keys(),
      ...rootMatches.keys(),
      ...grammarMatches.keys(),
      ...morphologyMatches.keys(),
      ...compoundMorphologyMatches.keys(),
      ...pyaGlossMatches.keys(),
      ...okTextTokens
    ]);
    for (const token of [...suggestionTokens].sort((left, right) => left.localeCompare(right))) {
      suggestionRecords.push(await buildStructuredSuggestionRecord(token, {
        occurrences,
        foundCompounds,
        dictionaryMatches,
        lemmaMatches,
        rootMatches,
        grammarMatches,
        morphologyMatches,
        compoundMorphologyMatches,
        pyaGlossMatches,
        okTextTokens,
        rankedCoverage
      }));
    }
  }

  for (const suggestion of suggestionRecords) {
    if (suggestion.suggestionSource !== "blacklist" || occurrences.has(suggestion.input)) continue;
    report(`${suggestion.input} blocked, instead: ${suggestion.wordSuggestions.join(", ")}`);
  }

  if (mapPath) {
    const records = Object.fromEntries(suggestionRecords.map((record) => [record.input, record]));
    await fs.writeFile(mapPath, JSON.stringify({
      format: "vocab-suggest-v3",
      records,
      wordNetSenseLookups,
      sumoLookups,
      ...([...directSenseChineseLookups, ...chineseLookups].length > 0
        ? { chineseLookups: [...directSenseChineseLookups, ...chineseLookups] }
        : {}),
      foundCompounds: [...foundCompounds.entries()].map(([target, found]) => ({
        target: found.pyacSequenceQuery ? found.row.target : target,
        ...(found.pyacSequenceQuery ? {
          inputSequence: found.pyacSequenceQuery,
          wordNetLinkStatus: wordNetLinkStatus(found.rows ?? [found.row])
        } : {}),
        components: found.row.components,
        pyacSequence: found.row.pyash,
        status: found.row.status,
        ...(found.rows?.length > 1 ? {
          readings: found.rows.map((row) => ({
            ...(found.pyacSequenceQuery ? { target: row.target } : {}),
            components: row.components,
            pyacSequence: row.pyash,
            status: row.status,
            ...(row.senseLinks?.length ? { senseIds: row.senseLinks.map((link) => link.senseId) } : {})
          }))
        } : {}),
        files: [...found.locations],
        ...(found.row.specificAtom ? { specificAtom: found.row.specificAtom } : {}),
        ...(resolveSpecificAtom(found.row)?.pyash
          ? { specificAtomPyac: resolveSpecificAtom(found.row).pyash }
          : {}),
        ...(found.senseGlosses?.length ? { senseGlosses: found.senseGlosses } : {})
      }))
    }, null, 2));
  }

  const exitCode = missing > 0 ? 1 : 0;
  return {
    exitCode,
    missing,
    uncoveredNames: [...uncoveredNames].sort((a, b) => a.localeCompare(b)),
    foundCompounds: [...foundCompounds.entries()].map(([target, found]) => {
      const { row, rows, locations, senseGlosses, pyacSequenceQuery } = found;
      const { identity, aliases, senseLinks, ...publicRow } = row;
      const specificAtom = resolveSpecificAtom(row);
      return {
        ...publicRow,
        ...(pyacSequenceQuery ? {
          target: row.target,
          inputSequence: pyacSequenceQuery,
          wordNetLinkStatus: wordNetLinkStatus(rows ?? [row])
        } : { target }),
        ...(specificAtom ? { specificAtomPyash: specificAtom.pyash } : {}),
        ...(row.senseId ? { senseId: row.senseId } : {}),
        ...(senseGlosses?.length ? { senseGlosses } : {}),
        ...(rows?.length > 1 ? {
          readings: rows.map((reading) => ({
            ...(pyacSequenceQuery ? { target: reading.target } : {}),
            components: reading.components,
            pyashSequence: [...reading.pyash],
            status: reading.status,
            ...(reading.senseLinks?.length ? { senseIds: reading.senseLinks.map((link) => link.senseId) } : {})
          }))
        } : {}),
        locations: [...locations]
      };
    }),
    compoundMorphologies: [...compoundMorphologyMatches.values()].flat(),
    linkedWordNetSenses,
    wordNetCompoundSenses,
    wordNetSenseLookups,
    sumoLookups,
    chineseLookups: [...directSenseChineseLookups, ...chineseLookups],
    compoundAtomLinks: [...compoundAtomMatches.entries()].map(([token, links]) => ({
      token,
      compounds: links.map(({ compound, atom }) => ({
        surface: compound.surface ?? compound.target,
        target: compound.target,
        pyashSequence: [...(compound.pyashSequence ?? compound.pyash)],
        atom: atom.english,
        atomPyash: atom.pya
      }))
    })),
    suggestionRecords
  };
}

async function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return await fs.realpath(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (await isMainModule()) {
  const { exitCode } = await runVocabSuggest(process.argv.slice(2));
  const warnings = takeKwonLookupWarnings();
  if (warnings.length > 0) process.stderr.write(`\n${warnings.join("\n\n")}\n`);
  if (exitCode > 0) process.exitCode = exitCode;
}

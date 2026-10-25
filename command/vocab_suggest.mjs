#!/usr/bin/env node

import fs from "node:fs/promises";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildProgram } from "../program/program.mjs";
import pyashWords from "../program/library/pyashWords.json" with { type: "json" };
import { loadCoverage } from "./compound_coverage.mjs";
import { loadAllCompoundAtomLinks } from "../program/verbs/exchange/translation/compound_lexicons.mjs";
import { renderPyacSurface } from "../program/verbs/exchange/translation/pyash_surface.mjs";
import {
  buildEnglishDictionaryAliases,
  loadEnglishDictionaryBlacklist
} from "../program/verbs/exchange/translation/english_dictionary_aliases.mjs";
import {
  buildEnglishLemmaIndex,
  inflectionCandidates,
  loadEnglishLemmaCatalog
} from "../program/verbs/exchange/translation/english_lemmas.mjs";
import { loadAnchorWordForms } from "../program/verbs/exchange/translation/anchor_words.mjs";
import {
  loadDefaultEnglish30kCoverage,
  loadEnglish30k,
  english30kLookupVariants,
  lookupEnglish30kCoverage
} from "../program/verbs/exchange/translation/english30k_coverage.mjs";
import { buildEnglishGrammarIndex, loadEnglishGrammarCatalog } from "../program/verbs/exchange/translation/english_grammar.mjs";
import { queryVocabLines } from "./vocab_query.mjs";
import { resolveEnglishAlias } from "../program/verbs/exchange/translation/english_aliases.mjs";
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
  let mapPath = null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
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
    inputs.push(arg);
  }
  return { inputs, textInputs, mapPath };
}

const checked = new Map();
let acceptedCoveragePromise = null;
let curatedAcceptedCoveragePromise = null;
let english30kCoveragePromise = null;
let english30kSourcePromise = null;
let englishGrammarIndexPromise = null;
let extendedEnglishResourcesPromise = null;
let anchorWordFormsPromise = null;
let compoundAtomLinksPromise = null;
let fastAtomicIndex = null;

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
const APPROVED_CONTRACT_NAME_TOKENS = new Set(["source", "sha256"]);
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

function isGrammarKeyword(token) {
  return GRAMMAR_KEYWORDS.has(String(token ?? "").toLowerCase());
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
  return {
    target,
    components,
    pyash,
    status,
    ...(specificAtom ? { specificAtom } : {}),
    identity: `${components.join("\u0001")}\u0000${pyash.join("\u0001")}\u0000${specificAtom ?? ""}`
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
    acceptedCoveragePromise = loadCoverage().then((coverage) => parseAcceptedCompoundRecords(coverage.accepted));
  }
  return acceptedCoveragePromise;
}

async function loadDefaultCuratedAcceptedCompounds() {
  if (!curatedAcceptedCoveragePromise) {
    curatedAcceptedCoveragePromise = fs
      .readFile(new URL("../program/verbs/exchange/translation/compound_coverage_curated.pya", import.meta.url), "utf8")
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

async function loadExtendedEnglishResourcesSafe() {
  if (!extendedEnglishResourcesPromise) {
    extendedEnglishResourcesPromise = Promise.all([
      loadEnglishLemmaCatalog(),
      loadEnglishDictionaryBlacklist()
    ])
      .then(([lemmaCatalog, dictionary]) => ({
        lemmaIndex: buildEnglishLemmaIndex({
          atomicEntries: pyashWords,
          catalogEntries: lemmaCatalog.entries
        }),
        dictionaryAliases: buildEnglishDictionaryAliases({
          dictionary,
          atomicEntries: pyashWords
        })
      }))
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
  const atomic = english30kLookupVariants(token)
    .map((variant) => buildFastAtomicIndex().get(variant))
    .find(Boolean) ?? null;
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

function registerFoundCompound(foundCompounds, rows, location) {
  for (const row of rows) {
    const current = foundCompounds.get(row.target) ?? { row, locations: new Set() };
    if ((COMPOUND_STATUS_RANK.get(row.status) ?? 0) > (COMPOUND_STATUS_RANK.get(current.row.status) ?? 0)) {
      current.row = row;
    }
    if (location) current.locations.add(location);
    foundCompounds.set(row.target, current);
  }
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

function collectTokensFromSentence(sentence, out) {
  if (!sentence || typeof sentence !== "object") return;
  if (typeof sentence.be === "string") {
    for (const token of sentence.be.split(/\s+/).filter(Boolean)) {
      if (NAME_TOKEN_REGEX.test(token) && !STRUCTURAL_VERB_TOKENS.has(token.toLowerCase())) out.add(token);
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
        if (!isApprovedContractNameToken(token)) out.add(token);
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

export async function runVocabSuggest(args = process.argv.slice(2), { report = console.log } = {}) {
  const { inputs, textInputs, mapPath } = parseArgs(args);
  const { roots, tokens: resolvedTextInputs } = await resolveRootsAndTokens(inputs, textInputs);
  const occurrences = new Map();
  const acceptedCompounds = new Map();
  const foundCompounds = new Map();
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

  let missing = 0;
  const textTokens = new Set();
  for (const input of resolvedTextInputs) {
    for (const token of tokenizeName(input)) textTokens.add(token);
  }
  for (const { file, text, program } of parsedFiles) {
    const tokens = new Set();
    const compoundCatalog = isCompoundCatalog(program);
    if (compoundCatalog) continue;
    for (const sentence of program.sentences) {
      collectTokensFromSentence(sentence, tokens);
    }
    for (const block of extractQuotedPyashBlocks(text)) {
      const blockProgram = buildProgram(block);
      for (const sentence of blockProgram.sentences) {
        collectTokensFromSentence(sentence, tokens);
      }
    }
    for (const token of tokens) {
      if (isGrammarKeyword(token)) continue;
      let knownCompounds = acceptedCompounds.get(normalizeCompoundTarget(token));
      if (knownCompounds?.length) {
        registerFoundCompound(foundCompounds, knownCompounds, file);
        continue;
      }
      await ensureDefaultAcceptedCompounds();
      knownCompounds = acceptedCompounds.get(normalizeCompoundTarget(token));
      if (knownCompounds?.length) {
        registerFoundCompound(foundCompounds, knownCompounds, file);
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
        missing += 1;
        if (!occurrences.has(token)) occurrences.set(token, new Set());
        occurrences.get(token).add(file);
        continue;
      }
      if (!await isExactTokenMatchOrAlias(token, lines)) {
        missing += 1;
        if (!occurrences.has(token)) occurrences.set(token, new Set());
        occurrences.get(token).add(file);
      }
    }
  }
  for (const token of textTokens) {
    if (isGrammarKeyword(token)) {
      okTextTokens.add(token);
      continue;
    }
    const fastRanked = await findFastEnglishCoverage(token);
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
        registerFoundCompound(foundCompounds, knownCompounds, "input");
        continue;
      }
      const directCompound = directDelimitedCompoundRow(token);
      if (directCompound) {
        registerFoundCompound(foundCompounds, [directCompound], "input");
        continue;
      }
      ranked = await findExtendedEnglishCoverage(token);
      if ((!ranked || ranked.coverageType === "unresolved") && mayNeedCompoundCoverage(token)) {
        await ensureDefaultAcceptedCompounds();
        knownCompounds = acceptedCompounds.get(normalizeCompoundTarget(token));
        if (knownCompounds?.length) {
          registerFoundCompound(foundCompounds, knownCompounds, "input");
          continue;
        }
      }
    }
    if (ranked?.coverageType && ranked.coverageType !== "unresolved") {
      if (ranked.lexicalRoot?.pya) {
        rootMatches.set(token, {
          ...ranked,
          coverageType: "root",
          pyashSequence: [ranked.lexicalRoot.pya]
        });
        await registerCompoundAtomMatches(token, ranked.lexicalRoot.english);
      }
      if (ranked.morphology?.markerSequence?.length) morphologyMatches.set(token, ranked);
      if (ranked.coverageType === "lemma") lemmaMatches.set(token, ranked);
      else if (ranked.coverageType === "dictionary-alias") dictionaryMatches.set(token, ranked);
      else if (ranked.coverageType === "grammar") grammarMatches.set(token, ranked);
      else if (!ranked.lexicalRoot?.pya) okTextTokens.add(token);
      continue;
    }
    if (ranked) rankedCoverage.set(token, ranked);
    const lines = await queryRyan(token);
    const blacklistValue = lines.length === 1 ? parseBlacklist(lines[0]) : null;
    if (
      lines.length === 0 ||
      (lines.length === 1 && isFileMarker(lines[0])) ||
      blacklistValue !== null ||
      !await isExactTokenMatchOrAlias(token, lines)
    ) {
      missing += 1;
      if (!occurrences.has(token)) occurrences.set(token, new Set());
      occurrences.get(token).add("input");
    } else {
      const exactMatches = exactVocabMatches(token, lines)
        .filter((match) => match.pyash.toLowerCase() === token.toLowerCase());
      if (exactMatches.length > 0) pyaGlossMatches.set(token, exactMatches);
      else okTextTokens.add(token);
    }
  }

  for (const [target, found] of [...foundCompounds.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const locationSuffix = [...found.locations]
      .map(name => name.replace(`${process.cwd()}/`, ""))
      .filter(Boolean)
      .join(", ");
    const row = found.row;
    const specificAtom = resolveSpecificAtom(row);
    const specificSuffix = specificAtom
      ? `; specific atom ${specificAtom.english} -> ${specificAtom.pyash}`
      : "";
    report(`${target}: found compound ${row.components.join(" + ")} -> ${row.pyash.join(" ")} (${row.status})${specificSuffix}${locationSuffix ? ` (${locationSuffix})` : ""}`);
  }

  if (occurrences.size > 0) {
    for (const [token, filesForToken] of [...occurrences.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const lines = await queryRyan(token);
      const blacklistValue = lines.length === 1 ? parseBlacklist(lines[0]) : null;
    const suggestionList = lines.filter(
      line => !isFileMarker(line) && parseBlacklist(line) === null && !line.startsWith("#define")
    );
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
        report(`${token} blocked, instead: ${blacklistValue}.${pyacSuffix}${locationSuffix}`);
      } else {
        const ranked = rankedCoverage.get(token);
        const rankSuffix = ranked
          ? `; English30k rank ${ranked.rank} remains unresolved`
          : "";
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
    report(`${token}: lemma ${ranked.lemma} -> ${ranked.pyashSequence.join(" ")} (English30k rank ${ranked.rank})`);
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

  if (mapPath) {
    const map = {};
    for (const [token, filesForToken] of occurrences.entries()) {
      const lines = await queryRyan(token);
      map[token] = {
        suggestions: lines.filter(line => !isFileMarker(line)),
        files: [...filesForToken]
      };
    }
    for (const [target, found] of foundCompounds.entries()) {
      map[target] = {
        foundCompound: {
          components: found.row.components,
          pyash: found.row.pyash,
          status: found.row.status,
          ...(found.row.specificAtom ? { specificAtom: found.row.specificAtom } : {}),
          ...(resolveSpecificAtom(found.row)?.pyash ? { specificAtomPyash: resolveSpecificAtom(found.row).pyash } : {})
        },
        files: [...found.locations]
      };
    }
    await fs.writeFile(mapPath, JSON.stringify(map, null, 2));
  }

  const exitCode = missing > 0 ? 1 : 0;
  return {
    exitCode,
    missing,
    foundCompounds: [...foundCompounds.values()].map(({ row, locations }) => {
      const { identity, ...publicRow } = row;
      const specificAtom = resolveSpecificAtom(row);
      return {
        ...publicRow,
        ...(specificAtom ? { specificAtomPyash: specificAtom.pyash } : {}),
        locations: [...locations]
      };
    }),
    compoundMorphologies: [...compoundMorphologyMatches.values()].flat(),
    compoundAtomLinks: [...compoundAtomMatches.entries()].map(([token, links]) => ({
      token,
      compounds: links.map(({ compound, atom }) => ({
        surface: compound.surface ?? compound.target,
        target: compound.target,
        pyashSequence: [...(compound.pyashSequence ?? compound.pyash)],
        atom: atom.english,
        atomPyash: atom.pya
      }))
    }))
  };
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const { exitCode } = await runVocabSuggest(process.argv.slice(2));
  if (exitCode > 0) process.exitCode = exitCode;
}

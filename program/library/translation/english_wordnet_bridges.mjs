import { readFile } from "node:fs/promises";

import { buildProgram } from "../../program.mjs";
import {
  KWON_LOOKUP_INDEX_PATHS,
  lookupKwonIndex,
  readKwonSourceHead,
  readKwonSourceLocators
} from "./kwon_lookup_index.mjs";

export const ENGLISH_WORDNET_BRIDGE_FORMAT = "english-wordnet-bridge-v1";
export const ENGLISH_WORDNET_BRIDGE_NAME = "translation_english_wordnet_bridges";
export const ENGLISH_WORDNET_BRIDGE_CONFIG_URL = new URL("./english_wordnet_bridges.pya", import.meta.url);

const WORDNET_POS = new Set(["a", "n", "r", "v", "s"]);
const CERTAINTIES = new Set(["deterministic", "contextual"]);
const METADATA_KEYS = new Set(["format", "source", "source-hash", "mode"]);
const SENSE_GLOSS_PREFIX = "sense-gloss:";
const SENSE_LEMMA_PREFIX = "sense-lemma:";
const BRIDGE_SOURCE_ID = "program/library/translation/english_wordnet_bridges.pya";

export function canonicalWordNetTargetPartOfSpeech(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function englishWordNetTargetId(targetKind, pyashSequence, partOfSpeech) {
  const kind = targetKind === "compound" ? "compound" : "atom";
  const sequence = Array.isArray(pyashSequence)
    ? pyashSequence.filter((word) => typeof word === "string" && word.trim()).map((word) => word.trim())
    : [];
  const pos = canonicalWordNetTargetPartOfSpeech(partOfSpeech);
  if (sequence.length === 0 || !WORDNET_POS.has(pos)) return "";
  return `${kind}:${sequence.join("+")}:${pos}`;
}

function hasLexicalTarget(coverage) {
  if (!coverage) {
    return false;
  }
  if (!coverage.coverageType) return Array.isArray(coverage.pyashSequence) && coverage.pyashSequence.length > 0;
  if (!["atomic", "compound", "lemma", "alias", "dictionary-alias"].includes(coverage.coverageType)) return false;
  return !(["alias", "dictionary-alias"].includes(coverage.coverageType)
    && coverage.canonicalCoverageType
    && !["atomic", "compound"].includes(coverage.canonicalCoverageType));
}

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-english-wordnet-bridge";
  error.details = details;
  return error;
}

function textAt(sentence, role) {
  return typeof sentence?.[role]?.text === "string" ? sentence[role].text.trim() : "";
}

function pyaTextKey(line) {
  const prefix = 'su text "';
  if (!line.startsWith(prefix)) return "";
  const end = line.indexOf('"', prefix.length);
  return end > prefix.length ? line.slice(prefix.length, end) : "";
}

function pyaNameValue(line, role) {
  const match = line.match(new RegExp(`\\b${role} ("(?:\\\\.|[^"\\\\])*")`, "u"));
  if (!match) return "";
  try {
    return JSON.parse(match[1]);
  } catch {
    return "";
  }
}

function sourceFromMetadataKey(key) {
  if (key.startsWith(SENSE_GLOSS_PREFIX)) return key.slice(SENSE_GLOSS_PREFIX.length);
  if (!key.startsWith(SENSE_LEMMA_PREFIX)) return "";
  const finalColon = key.lastIndexOf(":");
  return finalColon > SENSE_LEMMA_PREFIX.length ? key.slice(SENSE_LEMMA_PREFIX.length, finalColon) : "";
}

function parsedSentenceLine(line) {
  return buildProgram(line).sentences.find((sentence) => sentence?.mood === "ya") ?? null;
}

function senseIdFromLocatorKey(key) {
  if (/^[anrvs]:[0-9]{8}-[anrvs]$/iu.test(key)) return key.toLowerCase();
  if (key.startsWith(SENSE_GLOSS_PREFIX)) return key.slice(SENSE_GLOSS_PREFIX.length).toLowerCase();
  if (!key.startsWith(SENSE_LEMMA_PREFIX)) return "";
  const finalColon = key.lastIndexOf(":");
  return finalColon > SENSE_LEMMA_PREFIX.length ? key.slice(SENSE_LEMMA_PREFIX.length, finalColon).toLowerCase() : "";
}

async function indexedBridgeSource({
  terms,
  senseIds,
  resolveTarget,
  resolveTargets,
  relatedTargetsForSequence,
  indexPaths = KWON_LOOKUP_INDEX_PATHS,
  indexRoot
}) {
  const rootOptions = indexRoot ? { root: indexRoot } : {};
  const selectedLocators = new Map();
  const selectedSources = new Set();
  const expandedTargets = new Set();
  const queriedTargets = new Set();
  const indexedRows = new Map();

  const addLocators = (locators) => {
    let changed = false;
    for (const locator of locators ?? []) {
      if (locator?.sourceId !== BRIDGE_SOURCE_ID) continue;
      if (!selectedLocators.has(locator.byteOffset)) {
        selectedLocators.set(locator.byteOffset, locator);
        changed = true;
      }
      const source = senseIdFromLocatorKey(locator.recordId);
      if (source && !selectedSources.has(source)) {
        selectedSources.add(source);
        changed = true;
      }
    }
    return changed;
  };

  const [termResults, senseResults] = await Promise.all([
    Promise.all(terms.map((key) => lookupKwonIndex({
      kind: "english", key, indexPath: indexPaths.english, ...rootOptions
    }))),
    Promise.all(senseIds.map((key) => lookupKwonIndex({
      kind: "wordnet", key, indexPath: indexPaths.wordnet, ...rootOptions
    })))
  ]);
  addLocators([...termResults.flat(), ...senseResults.flat()]);

  let changed = true;
  while (changed) {
    changed = false;
    const pendingSources = [...selectedSources].filter((source) => !indexedRows.has(`sense:${source}`));
    if (pendingSources.length > 0) {
      const results = await Promise.all(pendingSources.map((key) => lookupKwonIndex({
        kind: "wordnet", key, indexPath: indexPaths.wordnet, ...rootOptions
      })));
      for (let index = 0; index < pendingSources.length; index += 1) {
        indexedRows.set(`sense:${pendingSources[index]}`, true);
        if (addLocators(results[index])) changed = true;
      }
    }

    const newRows = [...selectedLocators.values()].filter((locator) => !indexedRows.has(`row:${locator.byteOffset}`));
    if (newRows.length > 0) {
      const sourceRows = await readKwonSourceLocators(newRows, rootOptions);
      for (const { locator, line } of sourceRows) {
        indexedRows.set(`row:${locator.byteOffset}`, line);
        const sentence = parsedSentenceLine(line);
        const key = textAt(sentence, "su");
        const directSource = senseIdFromLocatorKey(key);
        if (directSource && !selectedSources.has(directSource)) {
          selectedSources.add(directSource);
          changed = true;
        }
        if (key.startsWith("equivalence:")) {
          for (const source of textAt(sentence, "ob").split(/\s+/u).map((value) => value.toLowerCase())) {
            if (/^[anrvs]:[0-9]{8}-[anrvs]$/u.test(source) && !selectedSources.has(source)) {
              selectedSources.add(source);
              changed = true;
            }
          }
        }
      }
    }

    const targetNames = new Set([...indexedRows.values()]
      .filter((line) => typeof line === "string")
      .map((line) => parsedSentenceLine(line))
      .filter((sentence) => /^[anrvs]:[0-9]{8}-[anrvs]$/iu.test(textAt(sentence, "su")) && typeof sentence?.ob?.name === "string")
      .map((sentence) => sentence.ob.name.trim().toLowerCase())
      .filter(Boolean));
    const pendingTargets = [...targetNames].filter((target) => !expandedTargets.has(target));
    if (pendingTargets.length > 0) {
      pendingTargets.forEach((target) => expandedTargets.add(target));
      let targetCandidates = new Set(pendingTargets);
      if (typeof resolveTarget === "function" && typeof relatedTargetsForSequence === "function") {
        const coverages = typeof resolveTargets === "function"
          ? await resolveTargets(pendingTargets)
          : await Promise.all(pendingTargets.map((target) => resolveTarget(target)));
        for (const coverage of coverages) {
          if (coverage?.pyashSequence?.length !== 1) continue;
          for (const peer of relatedTargetsForSequence(coverage.pyashSequence) ?? []) {
            if (typeof peer === "string" && peer.trim()) targetCandidates.add(peer.trim().toLowerCase());
          }
        }
      }
      const queryTargets = [...targetCandidates].filter((target) => !queriedTargets.has(target));
      queryTargets.forEach((target) => queriedTargets.add(target));
      if (queryTargets.length > 0) {
        const results = await Promise.all(queryTargets.map((key) => lookupKwonIndex({
          kind: "english", key, indexPath: indexPaths.english, ...rootOptions
        })));
        for (const result of results) if (addLocators(result)) changed = true;
      }
    }
  }

  const head = await readKwonSourceHead(BRIDGE_SOURCE_ID, { lineCount: 5, ...rootOptions });
  const rows = [...indexedRows.entries()]
    .filter(([key, value]) => key.startsWith("row:") && typeof value === "string")
    .sort(([left], [right]) => Number(left.slice(4)) - Number(right.slice(4)))
    .map(([, line]) => line);
  return [...head, ...(selectedSources.size > 0 ? rows : []), "prah", ""].join("\n");
}

export async function loadEnglishWordNetBridgeSubset({
  terms = [],
  senseIds = [],
  resolveTarget = null,
  resolveTargets = null,
  relatedTargetsForSequence = null,
  configUrl = ENGLISH_WORDNET_BRIDGE_CONFIG_URL,
  indexPaths = KWON_LOOKUP_INDEX_PATHS,
  indexRoot
} = {}) {
  const normalizedTerms = new Set(terms
    .filter((term) => typeof term === "string" && term.trim())
    .map((term) => term.normalize("NFC").trim().toLowerCase()));
  const selectedSources = new Set(senseIds
    .filter((senseId) => typeof senseId === "string" && senseId.trim())
    .map((senseId) => senseId.trim().toLowerCase()));
  const selectedLines = new Set();
  const targetNames = new Set();
  const addBridgeLine = (line, sentence) => {
    const sourceKey = textAt(sentence, "su").toLowerCase();
    if (!/^[anrvs]:[^\s]+$/u.test(sourceKey)) return false;
    selectedLines.add(line);
    selectedSources.add(sourceKey);
    const target = typeof sentence?.ob?.name === "string" ? sentence.ob.name.trim().toLowerCase() : "";
    if (target) targetNames.add(target);
    return true;
  };

  let lines;
  if (configUrl instanceof URL && configUrl.href === ENGLISH_WORDNET_BRIDGE_CONFIG_URL.href) {
    try {
      const indexedSource = await indexedBridgeSource({
        terms: [...normalizedTerms],
        senseIds: [...selectedSources],
        resolveTarget,
        resolveTargets,
        relatedTargetsForSequence,
        indexPaths,
        indexRoot
      });
      lines = indexedSource.split(/\r?\n/u);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  if (!lines) lines = (await readFile(configUrl, "utf8")).split(/\r?\n/u);

  let prefixEnd = 0;
  for (; prefixEnd < lines.length; prefixEnd += 1) {
    const line = lines[prefixEnd];
    if (!line.trim()) continue;
    const sentence = buildProgram(line).sentences[0];
    const key = textAt(sentence, "su");
    if (sentence?.mood === "def" || METADATA_KEYS.has(key)) {
      selectedLines.add(line);
      continue;
    }
    break;
  }

  const bridgeLinesBySource = new Map();
  const bridgeLinesByTarget = new Map();
  for (const line of lines.slice(prefixEnd)) {
    const source = pyaTextKey(line).toLowerCase();
    if (!/^[anrvs]:[^\s]+$/u.test(source)) continue;
    bridgeLinesBySource.set(source, line);
    const target = pyaNameValue(line, "ob name").trim().toLowerCase();
    if (!target) continue;
    const rows = bridgeLinesByTarget.get(target) ?? [];
    rows.push(line);
    bridgeLinesByTarget.set(target, rows);
  }

  for (const line of lines.slice(prefixEnd)) {
    const key = pyaTextKey(line).toLowerCase();
    if (selectedSources.has(key)) {
      const sentence = parsedSentenceLine(line);
      if (sentence) addBridgeLine(line, sentence);
      continue;
    }
    if (!normalizedTerms.size) continue;
    if (![...normalizedTerms].some((term) => (
      line.includes(`ob name ${JSON.stringify(term)}`)
      || line.includes(`ob text ${JSON.stringify(term)}`)
    ))) continue;
    const sentence = parsedSentenceLine(line);
    if (!sentence) continue;
    const rowKey = textAt(sentence, "su").toLowerCase();
    if (/^[anrvs]:[^\s]+$/u.test(rowKey)
      && typeof sentence.ob?.name === "string"
      && normalizedTerms.has(sentence.ob.name.trim().toLowerCase())) {
      addBridgeLine(line, sentence);
      continue;
    }
    const lemmaSource = sourceFromMetadataKey(rowKey);
    if (lemmaSource && rowKey.startsWith(SENSE_LEMMA_PREFIX)
      && normalizedTerms.has(textAt(sentence, "ob").toLowerCase())) {
      selectedSources.add(lemmaSource);
      selectedLines.add(line);
    }
  }

  // Lemma metadata can follow its bridge row in the catalog. Resolve all
  // selected senses to their bridge rows before expanding same-anchor peers.
  for (const line of lines.slice(prefixEnd)) {
    if (!selectedSources.has(pyaTextKey(line).toLowerCase())) continue;
    const sentence = parsedSentenceLine(line);
    if (sentence) addBridgeLine(line, sentence);
  }

  const scannedTargets = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    const targetCandidates = new Set(targetNames);
    if (typeof resolveTarget === "function" && typeof relatedTargetsForSequence === "function") {
      const targetList = [...targetNames];
      const coverages = typeof resolveTargets === "function"
        ? await resolveTargets(targetList)
        : await Promise.all(targetList.map((target) => resolveTarget(target)));
      for (const coverage of coverages) {
        if (!Array.isArray(coverage?.pyashSequence) || coverage.pyashSequence.length === 0) continue;
        for (const peer of relatedTargetsForSequence(coverage.pyashSequence) ?? []) {
          if (typeof peer === "string" && peer.trim()) targetCandidates.add(peer.trim().toLowerCase());
        }
      }
    }
    for (const target of targetCandidates) {
      if (scannedTargets.has(target)) continue;
      scannedTargets.add(target);
      for (const line of bridgeLinesByTarget.get(target) ?? []) {
        const sentence = parsedSentenceLine(line);
        if (!sentence || typeof sentence.ob?.name !== "string"
          || sentence.ob.name.trim().toLowerCase() !== target) continue;
        const sourceKey = textAt(sentence, "su").toLowerCase();
        if (!/^[anrvs]:[^\s]+$/u.test(sourceKey)) continue;
        if (!selectedSources.has(sourceKey)) changed = true;
        addBridgeLine(line, sentence);
      }
    }

    for (const line of lines.slice(prefixEnd)) {
      const key = pyaTextKey(line).toLowerCase();
      if (!key.startsWith("equivalence:") || !selectedSources.size
        || ![...selectedSources].some((senseId) => line.includes(senseId))) continue;
      const sentence = parsedSentenceLine(line);
      if (!sentence) continue;
      selectedLines.add(line);
      for (const senseId of textAt(sentence, "ob").split(/\s+/u).filter(Boolean).map((item) => item.toLowerCase())) {
        if (!selectedSources.has(senseId)) changed = true;
        selectedSources.add(senseId);
      }
    }

    for (const source of selectedSources) {
      const line = bridgeLinesBySource.get(source);
      if (line && !selectedLines.has(line)) {
        const sentence = parsedSentenceLine(line);
        if (sentence) addBridgeLine(line, sentence);
      }
    }
  }

  for (const line of lines.slice(prefixEnd)) {
    const key = pyaTextKey(line).toLowerCase();
    const sourceKey = sourceFromMetadataKey(key);
    if (sourceKey && selectedSources.has(sourceKey)) selectedLines.add(line);
  }
  if (selectedSources.size === 0) {
    return { entries: [], ambiguousTargets: [], bySense: new Map(), byTerm: new Map() };
  }

  const catalog = parseEnglishWordNetBridgeCatalog([...selectedLines, "prah", ""].join("\n"));
  const targets = [...new Set(catalog.entries.map((entry) => entry.target))];
  const targetCoverages = new Map();
  if (typeof resolveTarget === "function") {
    const coverages = typeof resolveTargets === "function"
      ? await resolveTargets(targets)
      : await Promise.all(targets.map((target) => resolveTarget(target)));
    targets.forEach((target, index) => targetCoverages.set(target, coverages[index] ?? null));
  }
  const bridgeIndex = buildEnglishWordNetBridgeIndex({
    entries: catalog.entries,
    resolveTarget: typeof resolveTarget === "function" ? (target) => targetCoverages.get(target) : null
  });
  const indexedBySense = new Map(bridgeIndex.entries.map((entry) => [entry.source, entry]));
  const byTerm = new Map();
  const entries = catalog.entries.map((entry) => {
    const indexed = indexedBySense.get(entry.source);
    const linked = {
      ...entry,
      pyashSequence: [...(indexed?.pyashSequence ?? [])],
      active: bridgeIndex.bySense.has(entry.source) && (indexed?.pyashSequence ?? []).length > 0,
      targetKind: indexed?.targetKind ?? "atom",
      targetId: indexed?.targetId ?? ""
    };
    for (const term of [...entry.lemmas, entry.target]) {
      const key = term.normalize("NFC").trim().toLowerCase();
      if (!key) continue;
      const rows = byTerm.get(key) ?? [];
      if (!rows.some((row) => row.source === linked.source)) rows.push(linked);
      byTerm.set(key, rows);
    }
    return linked;
  });
  return { entries, ambiguousTargets: bridgeIndex.ambiguousTargets, bySense: bridgeIndex.bySense, byTerm };
}

function senseKey(value, index) {
  const key = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[anrvs]:[^\s]+$/u.test(key)) {
    throw invalid("WordNet bridge source must be a POS-prefixed sense key", { index, source: value });
  }
  return key;
}

function targetName(sentence, index) {
  const target = typeof sentence?.ob?.name === "string" ? sentence.ob.name.trim().toLowerCase() : "";
  if (!target) throw invalid("WordNet bridge row requires an English target anchor", { index });
  return target;
}

export function parseEnglishWordNetBridgeCatalog(source) {
  if (typeof source !== "string") throw invalid("WordNet bridge source must be text");
  const sentences = buildProgram(source).sentences;
  const header = sentences.find((sentence) => (
    sentence?.mood === "def"
      && sentence?.be === "map"
      && sentence?.su?.name === ENGLISH_WORDNET_BRIDGE_NAME
  ));
  if (!header) throw invalid("WordNet bridge source has no canonical map header");

  const metadata = {};
  for (const sentence of sentences) {
    const key = textAt(sentence, "su");
    if (sentence?.mood !== "ya" || !METADATA_KEYS.has(key)) continue;
    const value = textAt(sentence, "ob");
    if (value) metadata[key] = value;
  }
  if (metadata.format !== ENGLISH_WORDNET_BRIDGE_FORMAT) {
    throw invalid("WordNet bridge source has an unsupported format", { format: metadata.format });
  }
  if (!metadata.source) throw invalid("WordNet bridge source requires provenance");

  const senseGlossByKey = new Map();
  const senseLemmasByKey = new Map();
  for (const [index, sentence] of sentences.entries()) {
    if (sentence?.mood !== "ya") continue;
    const key = textAt(sentence, "su");
    if (key.startsWith(SENSE_GLOSS_PREFIX)) {
      const source = senseKey(key.slice(SENSE_GLOSS_PREFIX.length), index);
      const gloss = textAt(sentence, "ob");
      if (!gloss) throw invalid("WordNet sense gloss must be non-empty", { index, source });
      if (senseGlossByKey.has(source)) throw invalid("WordNet sense gloss is duplicated", { index, source });
      senseGlossByKey.set(source, gloss);
      continue;
    }
    if (!key.startsWith(SENSE_LEMMA_PREFIX)) continue;
    const lemmaMatch = key.match(/^sense-lemma:(.+):([1-9][0-9]*)$/u);
    if (!lemmaMatch) throw invalid("WordNet sense lemma key has an invalid sense or sequence index", { index, key });
    const source = senseKey(lemmaMatch[1], index);
    const lemma = textAt(sentence, "ob").toLowerCase();
    if (!lemma) throw invalid("WordNet sense lemma must be non-empty", { index, source });
    const lemmaIndex = Number(lemmaMatch[2]);
    const rows = senseLemmasByKey.get(source) ?? new Map();
    if (rows.has(lemmaIndex)) throw invalid("WordNet sense lemma index is duplicated", { index, source, lemmaIndex });
    if ([...rows.values()].includes(lemma)) throw invalid("WordNet sense lemma is duplicated", { index, source, lemma });
    rows.set(lemmaIndex, lemma);
    senseLemmasByKey.set(source, rows);
  }

  const senseInfoByKey = new Map();
  for (const source of new Set([...senseGlossByKey.keys(), ...senseLemmasByKey.keys()])) {
    const gloss = senseGlossByKey.get(source) ?? "";
    const lemmaRows = [...(senseLemmasByKey.get(source) ?? new Map()).entries()].sort(([left], [right]) => left - right);
    const lemmas = [...new Set(lemmaRows.map(([, lemma]) => lemma))];
    if (!gloss || lemmas.length === 0) {
      throw invalid("WordNet sense metadata requires a gloss and at least one lemma", { source });
    }
    senseInfoByKey.set(source, { gloss, lemmas });
  }

  const equivalenceGroups = new Map();
  for (const [index, sentence] of sentences.entries()) {
    if (sentence?.mood !== "ya") continue;
    const key = textAt(sentence, "su");
    if (!key.startsWith("equivalence:")) continue;
    const group = key.slice("equivalence:".length).trim();
    const sources = textAt(sentence, "ob").split(/\s+/u).filter(Boolean).map((value) => value.toLowerCase());
    const evidence = textAt(sentence, "via");
    if (!group || sources.length < 2 || new Set(sources).size !== sources.length || !evidence) {
      throw invalid("WordNet equivalence group requires an id, distinct senses, and evidence", { index, group });
    }
    if (equivalenceGroups.has(group)) throw invalid("WordNet equivalence group is duplicated", { index, group });
    equivalenceGroups.set(group, { sources, evidence });
  }
  const equivalenceBySense = new Map();
  for (const [group, row] of equivalenceGroups) {
    for (const sourceKey of row.sources) {
      if (equivalenceBySense.has(sourceKey)) {
        throw invalid("WordNet sense belongs to multiple equivalence groups", { source: sourceKey });
      }
      equivalenceBySense.set(sourceKey, { group, evidence: row.evidence });
    }
  }

  const entries = [];
  const seen = new Set();
  for (const [index, sentence] of sentences.entries()) {
    if (sentence?.mood !== "ya") continue;
    const sourceKey = textAt(sentence, "su");
    if (!sourceKey || METADATA_KEYS.has(sourceKey) || sourceKey.startsWith("equivalence:")
      || sourceKey.startsWith(SENSE_GLOSS_PREFIX) || sourceKey.startsWith(SENSE_LEMMA_PREFIX)) continue;
    const key = senseKey(sourceKey, index);
    if (seen.has(key)) throw invalid("WordNet bridge sense is duplicated", { index, source: key });
    seen.add(key);
    const target = targetName(sentence, index);
    const sourceTargetPartOfSpeech = textAt(sentence, "as");
    if (!WORDNET_POS.has(sourceTargetPartOfSpeech)) {
      throw invalid("WordNet bridge target part of speech is unsupported", {
        index,
        source: key,
        targetPartOfSpeech: sourceTargetPartOfSpeech
      });
    }
    const targetPartOfSpeech = canonicalWordNetTargetPartOfSpeech(sourceTargetPartOfSpeech);
    const certainty = textAt(sentence, "with") || "contextual";
    if (!CERTAINTIES.has(certainty)) {
      throw invalid("WordNet bridge certainty is unsupported", { index, source: key, certainty });
    }
    const evidence = textAt(sentence, "via");
    if (!evidence) throw invalid("WordNet bridge row requires provenance evidence", { index, source: key });
    entries.push({
      source: key,
      target,
      targetPartOfSpeech,
      certainty,
      evidence,
      ...(senseInfoByKey.has(key) ? senseInfoByKey.get(key) : {}),
      ...(equivalenceBySense.has(key) ? {
        equivalenceGroup: equivalenceBySense.get(key).group,
        equivalenceEvidence: equivalenceBySense.get(key).evidence
      } : {})
    });
  }
  const entryBySense = new Map(entries.map((entry) => [entry.source, entry]));
  for (const source of senseInfoByKey.keys()) {
    if (!entryBySense.has(source)) throw invalid("WordNet sense info references an unknown bridge sense", { source });
  }
  for (const [group, row] of equivalenceGroups) {
    const members = row.sources.map((sourceKey) => entryBySense.get(sourceKey));
    if (members.some((entry) => !entry)) {
      throw invalid("WordNet equivalence group references an unknown bridge sense", { group });
    }
    if (new Set(members.map((entry) => entry.target)).size !== 1
      || new Set(members.map((entry) => entry.targetPartOfSpeech)).size !== 1) {
      throw invalid("WordNet equivalence group members must share one target and part of speech", { group });
    }
  }
  return {
    format: ENGLISH_WORDNET_BRIDGE_FORMAT,
    source: metadata.source,
    mode: metadata.mode || "sense-level semantic bridge",
    entries
  };
}

export function buildEnglishWordNetBridgeIndex({ entries = [], resolveTarget = null } = {}) {
  const bySense = new Map();
  const allBySense = new Map();
  const identityKeysBySense = new Map();
  const inactiveSenses = new Set();
  for (const entry of entries) {
    if (!entry?.source || !entry?.target) continue;
    if (allBySense.has(entry.source)) {
      throw invalid("WordNet bridge sense is duplicated", { source: entry.source });
    }
    const sourcePartOfSpeech = String(entry.source).slice(0, 1);
    const targetPartOfSpeech = canonicalWordNetTargetPartOfSpeech(entry.targetPartOfSpeech || sourcePartOfSpeech);
    const coverage = typeof resolveTarget === "function"
      ? resolveTarget(entry.target, { partOfSpeech: targetPartOfSpeech })
      : null;
    const resolvedNonLexical = coverage !== null && coverage !== undefined && !hasLexicalTarget(coverage);
    const pyashSequence = resolvedNonLexical
      ? []
      : Array.isArray(entry.pyashSequence)
      ? entry.pyashSequence.filter((word) => typeof word === "string" && word.trim())
      : Array.isArray(coverage?.pyashSequence) ? [...coverage.pyashSequence] : [];
    const targetKind = entry.targetKind
      || (coverage?.coverageType === "compound" || pyashSequence.length > 1 ? "compound" : "atom");
    const targetId = englishWordNetTargetId(targetKind, pyashSequence, targetPartOfSpeech);
    const enriched = {
      ...entry,
      ...(pyashSequence.length > 0 ? { pyashSequence } : {}),
      targetKind,
      targetPartOfSpeech,
      ...(targetId ? { targetId } : {})
    };
    allBySense.set(entry.source, enriched);
    if (resolvedNonLexical) inactiveSenses.add(entry.source);
    const identityKeys = new Set();
    if (!resolvedNonLexical) {
      identityKeys.add(`target:${entry.target.normalize("NFC").trim().toLowerCase()}:${targetPartOfSpeech}`);
    }
    if (pyashSequence.length > 0 && !resolvedNonLexical) {
      if (targetId) identityKeys.add(`identity:${targetId}`);
      identityKeys.add(`sequence:${pyashSequence.join(" ")}:${targetPartOfSpeech}`);
    }
    identityKeysBySense.set(entry.source, identityKeys);
  }
  const entriesByGroup = new Map();
  for (const entry of allBySense.values()) {
    const group = typeof entry.equivalenceGroup === "string" ? entry.equivalenceGroup.trim() : "";
    if (!group) continue;
    entriesByGroup.set(group, [...(entriesByGroup.get(group) ?? []), entry]);
  }
  for (const [group, rows] of entriesByGroup) {
    if (rows.length < 2
      || rows.some((entry) => !textEvidence(entry.equivalenceEvidence))
      || rows.some((entry) => !WORDNET_POS.has(entry.targetPartOfSpeech))
      || new Set(rows.map((entry) => entry.target.normalize("NFC").trim().toLowerCase())).size !== 1
      || new Set(rows.map((entry) => entry.targetKind)).size !== 1
      || new Set(rows.map((entry) => entry.targetId || "")).size !== 1
      || new Set(rows.map((entry) => (entry.pyashSequence ?? []).join(" "))).size !== 1
      || new Set(rows.map((entry) => entry.targetPartOfSpeech)).size !== 1
      || new Set(rows.map((entry) => entry.equivalenceEvidence.trim())).size !== 1) {
      throw invalid("WordNet bridge equivalence group requires shared target, part of speech, and evidence", { group });
    }
  }
  const sourcesByIdentity = new Map();
  for (const [source, entry] of allBySense) {
    if (!identityKeysBySense.get(source)?.size) continue;
    for (const key of identityKeysBySense.get(source) ?? []) {
      sourcesByIdentity.set(key, [...(sourcesByIdentity.get(key) ?? []), source]);
    }
  }
  const ambiguousTargets = [];
  const blocked = new Set();
  for (const [identity, sources] of sourcesByIdentity) {
    if (sources.length < 2) continue;
    const rows = sources.map((source) => allBySense.get(source));
    const groups = new Set(rows.map((entry) => typeof entry.equivalenceGroup === "string"
      ? entry.equivalenceGroup.trim()
      : ""));
    const evidence = new Set(rows.map((entry) => typeof entry.equivalenceEvidence === "string"
      ? entry.equivalenceEvidence.trim()
      : ""));
    const sharesByEvidence = groups.size === 1
      && !groups.has("")
      && evidence.size === 1
      && !evidence.has("");
    if (sharesByEvidence) continue;
    for (const source of sources) blocked.add(source);
    ambiguousTargets.push(...rows.map((entry) => entry.target.normalize("NFC").trim().toLowerCase()));
  }
  for (const [source, entry] of allBySense) {
    if (!blocked.has(source) && !inactiveSenses.has(source)) bySense.set(source, entry);
  }
  return {
    entries: [...allBySense.values()].map((entry) => ({ ...entry })),
    ambiguousTargets: [...new Set(ambiguousTargets)].sort(),
    bySense,
    lookup(source) {
      const entry = bySense.get(typeof source === "string" ? source.trim().toLowerCase() : "");
      return entry ? { ...entry } : null;
    }
  };
}

function textEvidence(value) {
  return typeof value === "string" ? value.trim() : "";
}

export async function loadEnglishWordNetBridges({ configUrl = ENGLISH_WORDNET_BRIDGE_CONFIG_URL } = {}) {
  return parseEnglishWordNetBridgeCatalog(await readFile(configUrl, "utf8"));
}

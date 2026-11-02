import { readFile } from "node:fs/promises";

import { buildProgram } from "../../program.mjs";

export const ENGLISH_WORDNET_BRIDGE_FORMAT = "english-wordnet-bridge-v1";
export const ENGLISH_WORDNET_BRIDGE_NAME = "translation_english_wordnet_bridges";
export const ENGLISH_WORDNET_BRIDGE_CONFIG_URL = new URL("./english_wordnet_bridges.pya", import.meta.url);

const WORDNET_POS = new Set(["a", "n", "r", "v", "s"]);
const CERTAINTIES = new Set(["deterministic", "contextual"]);
const METADATA_KEYS = new Set(["format", "source", "source-hash", "mode"]);
const SENSE_GLOSS_PREFIX = "sense-gloss:";
const SENSE_LEMMA_PREFIX = "sense-lemma:";

export function canonicalWordNetTargetPartOfSpeech(value) {
  const pos = typeof value === "string" ? value.trim().toLowerCase() : "";
  return pos === "s" ? "a" : pos;
}

export function englishWordNetTargetId(targetKind, pyashSequence, partOfSpeech) {
  const kind = targetKind === "compound" ? "compound" : "atom";
  const sequence = Array.isArray(pyashSequence)
    ? pyashSequence.filter((word) => typeof word === "string" && word.trim()).map((word) => word.trim())
    : [];
  const pos = canonicalWordNetTargetPartOfSpeech(partOfSpeech);
  if (sequence.length === 0 || !WORDNET_POS.has(pos) || pos === "s") return "";
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

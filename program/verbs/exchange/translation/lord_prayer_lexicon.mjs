import { readFile } from "node:fs/promises";

import { buildProgram } from "../../../program.mjs";

export const LORD_PRAYER_LEXICON_FORMAT = "lord-prayer-lexicon-v1";
export const LORD_PRAYER_LEXICON_NAME = "translation_lord_prayer_lexicon";

const CANDIDATE_STATUSES = new Set([
  "accepted-existing",
  "review",
  "unresolved"
]);
const CONFIDENCES = new Set(["high", "medium", "low"]);

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-lord-prayer-lexicon";
  error.details = details;
  return error;
}

function text(value) {
  return typeof value === "string" ? value.normalize("NFC").trim() : "";
}

function stringList(value, label, index, { allowEmpty = false } = {}) {
  if (!Array.isArray(value)) throw invalid(`${label} must be an array`, { index });
  const values = value.map((item) => text(item));
  if (!allowEmpty && values.length === 0) throw invalid(`${label} must be non-empty`, { index });
  if (values.some((item) => !item)) throw invalid(`${label} contains an empty item`, { index });
  return values;
}

function parsePayload(sentence, index) {
  if (typeof sentence?.ob?.text !== "string") {
    throw invalid("Lord's Prayer lexicon row requires a JSON text payload", { index });
  }
  try {
    return JSON.parse(sentence.ob.text);
  } catch (error) {
    throw invalid("Lord's Prayer lexicon row JSON payload is malformed", { index, cause: error.message });
  }
}

function normalizeCandidate(payload, term, index, candidateIndex) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw invalid("Lord's Prayer lexicon candidate must be an object", { index, candidateIndex });
  }
  const id = text(payload.id);
  const gloss = text(payload.gloss);
  const status = text(payload.status);
  const confidence = text(payload.confidence);
  const evidence = text(payload.evidence);
  const pyashSequence = stringList(payload.pyashSequence ?? [], "candidate Pyash sequence", index, { allowEmpty: true });
  if (!id || !gloss || !CANDIDATE_STATUSES.has(status) || !CONFIDENCES.has(confidence) || !evidence) {
    throw invalid("Lord's Prayer lexicon candidate has invalid fields", { index, candidateIndex, term });
  }
  return { id, gloss, pyashSequence, status, confidence, evidence };
}

function normalizeEntry(payload, termKey, index) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw invalid("Lord's Prayer lexicon row must be an object", { index });
  }
  const term = text(payload.term ?? termKey);
  const locator = text(payload.locator);
  const greekLemma = text(payload.greekLemma);
  const greekForms = stringList(payload.greekForms, "Greek forms", index);
  const aramaicForms = stringList(
    payload.aramaicForms ?? [],
    "Aramaic forms",
    index,
    { allowEmpty: true }
  );
  const aramaicTransliterations = stringList(
    payload.aramaicTransliterations ?? [],
    "Aramaic transliterations",
    index,
    { allowEmpty: true }
  );
  const yltSurfaces = stringList(payload.yltSurfaces, "YLT surfaces", index);
  const kjvSurfaces = stringList(payload.kjvSurfaces, "KJV surfaces", index);
  const candidates = (payload.semanticCandidates ?? []).map((candidate, candidateIndex) => (
    normalizeCandidate(candidate, term, index, candidateIndex)
  ));
  const selectedCandidateId = payload.selectedCandidateId == null
    ? null
    : text(payload.selectedCandidateId);
  if (!term || !locator || !greekLemma || candidates.length === 0) {
    throw invalid("Lord's Prayer lexicon row is incomplete", { index, term });
  }
  if (selectedCandidateId && !candidates.some((candidate) => candidate.id === selectedCandidateId)) {
    throw invalid("Lord's Prayer lexicon selected candidate is missing", { index, term, selectedCandidateId });
  }
  return {
    term,
    locator,
    greekLemma,
    greekForms,
    aramaicForms,
    aramaicTransliterations,
    yltSurfaces,
    kjvSurfaces,
    semanticCandidates: candidates,
    selectedCandidateId
  };
}

export function parseLordPrayerLexicon(source, {
  name = LORD_PRAYER_LEXICON_NAME
} = {}) {
  if (typeof source !== "string") throw invalid("Lord's Prayer lexicon source must be text");
  const sentences = buildProgram(source).sentences;
  const header = sentences.find((sentence) => (
    sentence?.mood === "def" &&
    sentence?.be === "map" &&
    sentence?.su?.name === name
  ));
  if (!header) throw invalid("Lord's Prayer lexicon has no canonical map header");

  const metadata = new Map();
  for (const sentence of sentences) {
    if (sentence?.mood === "ya" && typeof sentence.su?.text === "string" && typeof sentence.ob?.text === "string") {
      if (sentence.su.text.startsWith("term:")) continue;
      metadata.set(sentence.su.text, sentence.ob.text);
    }
  }
  if (metadata.get("format") !== LORD_PRAYER_LEXICON_FORMAT) {
    throw invalid("Lord's Prayer lexicon has an unsupported format", { format: metadata.get("format") });
  }

  const entries = [];
  const seen = new Set();
  for (const [index, sentence] of sentences.entries()) {
    const key = sentence?.su?.text;
    if (sentence?.mood !== "ya" || typeof key !== "string" || !key.startsWith("term:")) continue;
    const entry = normalizeEntry(parsePayload(sentence, index), key.slice("term:".length), index);
    if (seen.has(entry.term)) throw invalid("Lord's Prayer lexicon term is duplicated", { index, term: entry.term });
    seen.add(entry.term);
    entries.push(entry);
  }
  if (entries.length === 0) throw invalid("Lord's Prayer lexicon has no term rows");
  return {
    format: LORD_PRAYER_LEXICON_FORMAT,
    name,
    metadata: Object.fromEntries(metadata),
    entries
  };
}

export async function loadLordPrayerLexicon({
  url = new URL("./lord_prayer_lexicon.pya", import.meta.url),
  name = LORD_PRAYER_LEXICON_NAME
} = {}) {
  return parseLordPrayerLexicon(await readFile(url, "utf8"), { name });
}

export function buildLordPrayerLexiconIndex({ entries = [] } = {}) {
  const lookup = new Map();
  for (const entry of entries) {
    if (!entry?.term) continue;
    lookup.set(entry.term.toLowerCase(), {
      ...entry,
      greekForms: [...entry.greekForms],
      aramaicForms: [...entry.aramaicForms],
      aramaicTransliterations: [...entry.aramaicTransliterations],
      yltSurfaces: [...entry.yltSurfaces],
      kjvSurfaces: [...entry.kjvSurfaces],
      semanticCandidates: entry.semanticCandidates.map((candidate) => ({
        ...candidate,
        pyashSequence: [...candidate.pyashSequence]
      }))
    });
  }
  return {
    lookup,
    resolve(term) {
      return lookup.get(text(term).toLowerCase()) ?? null;
    }
  };
}

export function renderLordPrayerLexiconPya(lexicon, {
  name = LORD_PRAYER_LEXICON_NAME
} = {}) {
  if (!lexicon || lexicon.format !== LORD_PRAYER_LEXICON_FORMAT || !Array.isArray(lexicon.entries)) {
    throw invalid("Lord's Prayer lexicon renderer requires a parsed lexicon");
  }
  const lines = [
    `su name ${name} be map def`,
    `su text "format" ob text ${JSON.stringify(LORD_PRAYER_LEXICON_FORMAT)} ya`,
    ...Object.entries(lexicon.metadata ?? {})
      .filter(([key]) => key !== "format")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `su text ${JSON.stringify(key)} ob text ${JSON.stringify(value)} ya`),
    ...lexicon.entries
      .map((entry) => `su text ${JSON.stringify(`term:${entry.term}`)} ob text ${JSON.stringify(JSON.stringify(entry))} ya`),
    "prah"
  ];
  return `${lines.join("\n")}\n`;
}

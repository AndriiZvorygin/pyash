import { readFile } from "node:fs/promises";

import { buildProgram } from "../../../program.mjs";

export const ENGLISH_GRAMMAR_FORMAT = "english-grammar-v1";
export const ENGLISH_GRAMMAR_NAME = "translation_english_grammar";

const GRAMMAR_KINDS = new Set([
  "possessive-determiner",
  "possessive-pronoun",
  "case-marker",
  "number-marker"
]);

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-english-grammar";
  error.details = details;
  return error;
}

export function normalizeEnglishGrammarSurface(value) {
  return typeof value === "string"
    ? value.normalize("NFC").trim().toLowerCase().replace(/[ _-]+/gu, " ")
    : "";
}

function parsePayload(sentence, index) {
  if (typeof sentence?.ob?.text !== "string") {
    throw invalid("English grammar row requires a JSON text payload", { index });
  }
  try {
    return JSON.parse(sentence.ob.text);
  } catch (error) {
    throw invalid("English grammar row JSON payload is malformed", { index, cause: error.message });
  }
}

function normalizeEntry(payload, surface, index) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw invalid("English grammar row payload must be an object", { index });
  }
  const normalizedSurface = normalizeEnglishGrammarSurface(payload.surface ?? surface);
  const normalizedKey = normalizeEnglishGrammarSurface(surface);
  if (!normalizedSurface || normalizedSurface !== normalizedKey) {
    throw invalid("English grammar row surface must match its Pyash key", { index, surface });
  }
  if (!GRAMMAR_KINDS.has(payload.kind)) {
    throw invalid("English grammar row kind is unsupported", { index, surface, kind: payload.kind });
  }
  if (!Array.isArray(payload.pyashSequence) || payload.pyashSequence.length === 0) {
    throw invalid("English grammar row requires a non-empty Pyash sequence", { index, surface });
  }
  const pyashSequence = payload.pyashSequence
    .filter((word) => typeof word === "string" && word.trim())
    .map((word) => word.trim());
  if (pyashSequence.length !== payload.pyashSequence.length) {
    throw invalid("English grammar row has an invalid Pyash sequence", { index, surface });
  }
  if (!Array.isArray(payload.components) || payload.components.length === 0) {
    throw invalid("English grammar row requires ordered components", { index, surface });
  }
  const components = payload.components
    .filter((word) => typeof word === "string" && word.trim())
    .map((word) => word.trim());
  if (components.length !== payload.components.length) {
    throw invalid("English grammar row has invalid components", { index, surface });
  }
  if (typeof payload.evidence !== "string" || !payload.evidence.trim()) {
    throw invalid("English grammar row requires evidence", { index, surface });
  }
  const position = payload.position === undefined ? "standalone" : String(payload.position).trim();
  if (!position) throw invalid("English grammar row position is empty", { index, surface });
  return {
    surface: normalizedSurface,
    kind: payload.kind,
    components,
    pyashSequence,
    position,
    evidence: payload.evidence.trim()
  };
}

export function parseEnglishGrammarCatalog(source, {
  name = ENGLISH_GRAMMAR_NAME
} = {}) {
  if (typeof source !== "string") throw invalid("English grammar source must be text");
  const sentences = buildProgram(source).sentences;
  const header = sentences.find((sentence) => (
    sentence?.mood === "def" &&
    sentence?.be === "map" &&
    sentence?.su?.name === name
  ));
  if (!header) throw invalid("English grammar source has no canonical map header");

  const metadata = {};
  for (const sentence of sentences) {
    if (sentence?.mood !== "ya" || typeof sentence.su?.text !== "string") continue;
    if (["format", "source", "source-hash"].includes(sentence.su.text) && typeof sentence.ob?.text === "string") {
      metadata[sentence.su.text] = sentence.ob.text;
    }
  }
  if (metadata.format !== ENGLISH_GRAMMAR_FORMAT) {
    throw invalid("English grammar source has an unsupported format", { format: metadata.format });
  }

  const entries = [];
  const seen = new Set();
  for (const [index, sentence] of sentences.entries()) {
    if (sentence?.mood !== "ya" || typeof sentence.su?.text !== "string") continue;
    if (["format", "source", "source-hash"].includes(sentence.su.text)) continue;
    const entry = normalizeEntry(parsePayload(sentence, index), sentence.su.text, index);
    if (seen.has(entry.surface)) throw invalid("English grammar surface is duplicated", { index, surface: entry.surface });
    seen.add(entry.surface);
    entries.push(entry);
  }
  return {
    format: ENGLISH_GRAMMAR_FORMAT,
    name,
    source: metadata.source ?? "",
    sourceHash: metadata["source-hash"] ?? "",
    entries
  };
}

export async function loadEnglishGrammarCatalog({
  url = new URL("./english_grammar.pya", import.meta.url),
  name = ENGLISH_GRAMMAR_NAME
} = {}) {
  return parseEnglishGrammarCatalog(await readFile(url, "utf8"), { name });
}

export function buildEnglishGrammarIndex({ catalogEntries = [] } = {}) {
  const lookup = new Map();
  for (const entry of catalogEntries ?? []) {
    if (!entry?.surface || !Array.isArray(entry.pyashSequence)) continue;
    lookup.set(normalizeEnglishGrammarSurface(entry.surface), {
      ...entry,
      pyashSequence: [...entry.pyashSequence],
      components: [...entry.components]
    });
  }
  return {
    lookup,
    resolve(surface) {
      return lookup.get(normalizeEnglishGrammarSurface(surface)) ?? null;
    },
    mappings: new Map([...lookup.entries()].map(([surface, entry]) => [surface, [...entry.pyashSequence]]))
  };
}

function resolveHead(head, resolve) {
  if (typeof resolve === "function") return resolve(head);
  if (Array.isArray(head)) return { pyashSequence: [...head] };
  return null;
}

export function composeEnglishNounPhrase({
  possessor = "",
  head,
  plural = false,
  grammarIndex,
  resolve
} = {}) {
  const normalizedPossessor = normalizeEnglishGrammarSurface(possessor);
  const grammar = normalizedPossessor ? grammarIndex?.resolve(normalizedPossessor) : null;
  if (normalizedPossessor && (!grammar || grammar.position !== "prefix")) {
    return { status: "unresolved", possessor: normalizedPossessor, head };
  }

  const resolvedHead = resolveHead(head, resolve);
  if (!resolvedHead?.pyashSequence?.length) {
    return {
      status: "unresolved",
      ...(normalizedPossessor ? { possessor: normalizedPossessor } : {}),
      head: normalizeEnglishGrammarSurface(head)
    };
  }

  const pyashSequence = [
    ...(grammar?.pyashSequence ?? []),
    ...resolvedHead.pyashSequence.map((word) => String(word).trim()).filter(Boolean),
    ...(plural && String(resolvedHead.pyashSequence.at(-1) ?? "").trim() !== "pu" ? ["pu"] : [])
  ];
  return {
    status: "composed",
    ...(normalizedPossessor ? { possessor: normalizedPossessor } : {}),
    head: normalizeEnglishGrammarSurface(head),
    plural: Boolean(plural),
    ...(grammar ? { grammar } : {}),
    pyashSequence
  };
}


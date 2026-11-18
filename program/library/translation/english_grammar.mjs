import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { buildProgram } from "../../program.mjs";

export const ENGLISH_GRAMMAR_FORMAT = "english-grammar-v1";
export const ENGLISH_GRAMMAR_NAME = "translation_english_grammar";
export const ENGLISH_GRAMMAR_CHINESE_CHARACTER_LINK_PREFIX = "chinese-character-link:";

const HAN = /\p{Script=Han}/u;

function sourceHash(value) {
  return createHash("sha256").update(value).digest("hex");
}

const GRAMMAR_KINDS = new Set([
  "pronoun",
  "conjunction",
  "possessive-determiner",
  "possessive-pronoun",
  "negation",
  "case-marker",
  "number-marker",
  "referential",
  "exemplifier",
  "existential-clause",
  "modal-mood",
  "aspect-marker",
  "reflexive-marker"
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

function normalizeChineseCharacterLink(payload, key, index) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw invalid("Chinese grammar character link must be a JSON object", { index, key });
  }
  const character = typeof payload.character === "string" ? payload.character.normalize("NFC").trim() : "";
  const components = Array.isArray(payload.components) ? payload.components.map((word) => String(word).trim()) : [];
  const sources = Array.isArray(payload.sources) ? payload.sources.map((source) => String(source).trim()).filter(Boolean) : [];
  const pya = typeof payload.pya === "string" ? payload.pya.trim() : "";
  const targetId = typeof payload.targetId === "string" ? payload.targetId.trim() : "";
  const english = typeof payload.english === "string" ? normalizeEnglishGrammarSurface(payload.english) : "";
  const rationale = typeof payload.rationale === "string" ? payload.rationale.trim() : "";
  const source = typeof payload.source === "string" ? payload.source.trim() : "";
  if ([...character].length !== 1 || !HAN.test(character) || !pya || !targetId || !english
    || components.length === 0 || components.some((component) => !component)
    || payload.status !== "accepted" || payload.confidence !== "high"
    || !["base", "marked", "same-sense"].includes(payload.relation)
    || !rationale || !source || sources.length === 0) {
    throw invalid("Chinese grammar character link has invalid or incomplete fields", { index, key });
  }
  return {
    character,
    targetId,
    pya,
    components,
    english,
    relation: payload.relation,
    confidence: "high",
    status: "accepted",
    source,
    sources,
    rationale
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
  const chineseCharacterLinks = [];
  const seen = new Set();
  const linkedCharacters = new Map();
  const linkedAtoms = new Map();
  for (const [index, sentence] of sentences.entries()) {
    if (sentence?.mood !== "ya" || typeof sentence.su?.text !== "string") continue;
    if (["format", "source", "source-hash"].includes(sentence.su.text)) continue;
    if (sentence.su.text.startsWith(ENGLISH_GRAMMAR_CHINESE_CHARACTER_LINK_PREFIX)) {
      const link = normalizeChineseCharacterLink(parsePayload(sentence, index), sentence.su.text, index);
      if (linkedCharacters.has(link.character)) {
        throw invalid("Chinese character-to-atom links must be one-to-one: character already linked", {
          index,
          character: link.character,
          existingPya: linkedCharacters.get(link.character),
          pya: link.pya
        });
      }
      if (linkedAtoms.has(link.pya)) {
        throw invalid("Chinese character-to-atom links must be one-to-one: atom already linked", {
          index,
          character: link.character,
          pya: link.pya,
          existingCharacter: linkedAtoms.get(link.pya)
        });
      }
      linkedCharacters.set(link.character, link.pya);
      linkedAtoms.set(link.pya, link.character);
      chineseCharacterLinks.push(link);
      continue;
    }
    const entry = normalizeEntry(parsePayload(sentence, index), sentence.su.text, index);
    if (seen.has(entry.surface)) throw invalid("English grammar surface is duplicated", { index, surface: entry.surface });
    seen.add(entry.surface);
    entries.push(entry);
  }
  return {
    format: ENGLISH_GRAMMAR_FORMAT,
    name,
    source: metadata.source ?? "",
    sourceHash: metadata["source-hash"] ?? sourceHash(source),
    entries,
    chineseCharacterLinks
  };
}

export function renderEnglishGrammarChineseCharacterLinks(source, links = []) {
  if (typeof source !== "string" || !Array.isArray(links)) {
    throw invalid("English grammar link rendering requires source text and link rows");
  }
  const catalog = parseEnglishGrammarCatalog(source);
  const seen = new Set(catalog.chineseCharacterLinks.map((link) => `${link.character}\u0000${link.targetId}`));
  const linkedCharacters = new Map(catalog.chineseCharacterLinks.map((link) => [link.character, link.pya]));
  const linkedAtoms = new Map(catalog.chineseCharacterLinks.map((link) => [link.pya, link.character]));
  const rows = [];
  for (const [index, payload] of links.entries()) {
    const key = `${ENGLISH_GRAMMAR_CHINESE_CHARACTER_LINK_PREFIX}${payload?.character ?? ""}:${payload?.targetId ?? index}`;
    const link = normalizeChineseCharacterLink(payload, key, index);
    const identity = `${link.character}\u0000${link.targetId}`;
    if (seen.has(identity)) continue;
    if (linkedCharacters.has(link.character)) {
      throw invalid("Chinese character-to-atom links must be one-to-one: character already linked", {
        character: link.character,
        existingPya: linkedCharacters.get(link.character),
        pya: link.pya
      });
    }
    if (linkedAtoms.has(link.pya)) {
      throw invalid("Chinese character-to-atom links must be one-to-one: atom already linked", {
        character: link.character,
        pya: link.pya,
        existingCharacter: linkedAtoms.get(link.pya)
      });
    }
    seen.add(identity);
    linkedCharacters.set(link.character, link.pya);
    linkedAtoms.set(link.pya, link.character);
    const id = createHash("sha256").update(identity).digest("hex").slice(0, 12);
    rows.push(`su text ${JSON.stringify(`${ENGLISH_GRAMMAR_CHINESE_CHARACTER_LINK_PREFIX}${id}`)} ob text ${JSON.stringify(JSON.stringify(link))} ya`);
  }
  if (rows.length === 0) return source;
  const lines = source.split(/\r?\n/u);
  let terminator = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (/^\s*prah\s*$/u.test(lines[index])) {
      terminator = index;
      break;
    }
  }
  if (terminator < 0) throw invalid("English grammar source has no closing prah");
  lines.splice(terminator, 0, ...rows);
  return lines.join("\n");
}

export function removeEnglishGrammarChineseCharacterLinks(source, {
  sourceTag = ""
} = {}) {
  if (typeof source !== "string" || !sourceTag) {
    throw invalid("English grammar link removal requires source text and a source tag");
  }
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const rows = source.split(newline);
  const retained = rows.filter((row, index) => {
    if (!row.trim() || /^\s*#/u.test(row)) return true;
    const sentences = buildProgram(row).sentences;
    if (sentences.length !== 1) {
      throw invalid("English grammar link removal expects one parsed sentence per row", { index });
    }
    const sentence = sentences[0];
    if (sentence?.mood !== "ya" || !String(sentence.su?.text ?? "").startsWith(ENGLISH_GRAMMAR_CHINESE_CHARACTER_LINK_PREFIX)) {
      return true;
    }
    return parsePayload(sentence, index).source !== sourceTag;
  });
  return retained.join(newline);
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


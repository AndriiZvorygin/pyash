import fs from "node:fs";
import { createHash } from "node:crypto";

import { buildProgram } from "../../program.mjs";
import { sentenceToPyash } from "../../beautiful.mjs";
import { resolveTranslationSource } from "../../verbs/exchange/translation/registry.mjs";
import {
  decodeCodelet,
  executeCodelets,
  lowerSentence
} from "./index.mjs";

export const PYAC_MAGIC = "PYACVLIW";
export const PYAC_FORMAT_VERSION = 1;
export const PYAC_WORD_BITS = 16;
export const PYAC_WORDS_PER_CODELET = 16;
export const PYAC_HEADER_BYTES = 32;
export const PYAC_CODELET_BYTES = PYAC_WORDS_PER_CODELET * (PYAC_WORD_BITS / 8);

const CATALOG_FORMAT = "pyac-catalog-v1";

export class PyacDatabaseError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "PyacDatabaseError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new PyacDatabaseError(code, message, details);
}

function stableValue(value) {
  if (value instanceof Uint8Array) return { bytesHex: bytesToHex(value) };
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])])
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function cloneSerializable(value) {
  return stableValue(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function bytesToHex(bytes) {
  return Buffer.from(bytes).toString("hex");
}

function copyBytes(input) {
  if (input instanceof ArrayBuffer) return new Uint8Array(input.slice(0));
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength));
  }
  fail("invalid-bytes", "PyAC input must be an ArrayBuffer or byte view");
}

function wordsToBytes(words) {
  if (!words || words.length !== PYAC_WORDS_PER_CODELET) {
    fail("invalid-codelet", `PyAC codelets must contain ${PYAC_WORDS_PER_CODELET} words`, {
      length: words?.length
    });
  }
  const bytes = new Uint8Array(PYAC_CODELET_BYTES);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < words.length; index += 1) {
    const word = Number(words[index]);
    if (!Number.isInteger(word) || word < 0 || word > 0xffff) {
      fail("invalid-word", "PyAC codelet words must be unsigned 16-bit integers", {
        index,
        word
      });
    }
    view.setUint16(index * 2, word, true);
  }
  return bytes;
}

function bytesToWords(bytes) {
  if (bytes.byteLength !== PYAC_CODELET_BYTES) {
    fail("invalid-codelet-bytes", `PyAC codelets must contain ${PYAC_CODELET_BYTES} bytes`, {
      byteLength: bytes.byteLength
    });
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const words = new Uint16Array(PYAC_WORDS_PER_CODELET);
  for (let index = 0; index < words.length; index += 1) {
    words[index] = view.getUint16(index * 2, true);
  }
  return words;
}

function normalizeCodeletWords(codelet) {
  const words = codelet?.words ?? codelet;
  if (!words || typeof words.length !== "number") {
    fail("invalid-codelet", "PyAC database entries require codelet words");
  }
  return Uint16Array.from(words);
}

function serializeError(error) {
  return {
    name: error?.name ?? "Error",
    code: error?.code ?? "error",
    message: String(error?.message ?? error),
    details: cloneSerializable(error?.details ?? {})
  };
}

function sourceForIndex(options, index) {
  if (Array.isArray(options.sources)) return cloneSerializable(options.sources[index] ?? null);
  return cloneSerializable(options.source ?? null);
}

function recordIdentity(canonicalSentence, bytes) {
  return sha256(Buffer.concat([
    Buffer.from(canonicalSentence, "utf8"),
    Buffer.from([0]),
    Buffer.from(bytes)
  ]));
}

function unsupportedIdentity(canonicalSentence, error) {
  return sha256(`${canonicalSentence}\u0000${stableJson(error)}`);
}

function makeExecutableRecord({ sentence, decoded, codelet, inputIndex, partIndex, source, expected }) {
  const words = normalizeCodeletWords(codelet);
  const bytes = wordsToBytes(words);
  const canonicalSentence = sentenceToPyash(decoded.sentence ?? sentence);
  const contentHash = recordIdentity(canonicalSentence, bytes);
  return {
    id: `codelet-${contentHash.slice(0, 24)}`,
    inputIndex,
    partIndex,
    packIndex: null,
    status: "executable",
    semantic: decoded.semantic ?? null,
    mood: decoded.sentence?.mood ?? sentence?.mood ?? null,
    verb: decoded.sentence?.be ?? sentence?.be ?? null,
    cases: Object.keys(decoded.sentence ?? sentence ?? {})
      .filter((key) => !["be", "mood"].includes(key))
      .sort(),
    canonicalSentence,
    sentence: cloneSerializable(decoded.sentence ?? sentence),
    words: Array.from(words),
    wordsHex: bytesToHex(bytes),
    usedWords: codelet?.usedWords ?? decoded.usedWords ?? null,
    codeletHash: sha256(bytes),
    source,
    ...(expected === undefined ? {} : { expected: cloneSerializable(expected) })
  };
}

function makeUnsupportedRecord({ sentence, inputIndex, partIndex, source, error }) {
  const canonicalSentence = sentenceToPyash(sentence);
  const serializedError = serializeError(error);
  const identity = unsupportedIdentity(canonicalSentence, serializedError);
  return {
    id: `unsupported-${identity.slice(0, 24)}`,
    inputIndex,
    partIndex,
    packIndex: null,
    status: "unsupported",
    semantic: null,
    mood: sentence?.mood ?? null,
    verb: sentence?.be ?? null,
    cases: Object.keys(sentence ?? {})
      .filter((key) => !["be", "mood"].includes(key))
      .sort(),
    canonicalSentence,
    sentence: cloneSerializable(sentence),
    words: [],
    wordsHex: "",
    usedWords: null,
    codeletHash: null,
    source,
    error: serializedError
  };
}

function normalizeCatalog(catalog) {
  if (!catalog || typeof catalog !== "object") {
    fail("invalid-catalog", "PyAC catalog must be an object");
  }
  if (catalog.format !== CATALOG_FORMAT) {
    fail("unsupported-catalog", "PyAC catalog format is unsupported", {
      format: catalog.format
    });
  }
  if (!Array.isArray(catalog.records)) {
    fail("invalid-catalog", "PyAC catalog records must be an array");
  }
  return catalog;
}

function buildCatalog(records, pack) {
  const executableCount = records.filter((record) => record.status === "executable").length;
  return {
    format: CATALOG_FORMAT,
    packFormat: `pyac-vliw-${PYAC_FORMAT_VERSION}`,
    packHash: sha256(pack),
    recordCount: records.length,
    executableCount,
    unsupportedCount: records.length - executableCount,
    records
  };
}

export function encodePyacPack(codelets) {
  if (!Array.isArray(codelets)) {
    fail("invalid-codelets", "PyAC pack input must be an array");
  }
  const totalBytes = PYAC_HEADER_BYTES + codelets.length * PYAC_CODELET_BYTES;
  const bytes = new Uint8Array(totalBytes);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < PYAC_MAGIC.length; index += 1) {
    bytes[index] = PYAC_MAGIC.charCodeAt(index);
  }
  view.setUint16(8, PYAC_FORMAT_VERSION, true);
  view.setUint16(10, PYAC_WORD_BITS, true);
  view.setUint16(12, PYAC_WORDS_PER_CODELET, true);
  view.setUint16(14, PYAC_HEADER_BYTES, true);
  view.setUint32(16, codelets.length, true);
  view.setUint32(20, PYAC_CODELET_BYTES, true);
  view.setUint32(24, totalBytes, true);
  view.setUint32(28, 0, true);

  for (let index = 0; index < codelets.length; index += 1) {
    const codeletBytes = wordsToBytes(normalizeCodeletWords(codelets[index]));
    bytes.set(codeletBytes, PYAC_HEADER_BYTES + index * PYAC_CODELET_BYTES);
  }
  return bytes;
}

export function decodePyacPack(input) {
  const bytes = copyBytes(input);
  if (bytes.byteLength < PYAC_HEADER_BYTES) {
    fail("truncated-pack", "PyAC pack is shorter than its header");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(...bytes.slice(0, PYAC_MAGIC.length));
  if (magic !== PYAC_MAGIC) {
    fail("invalid-magic", "PyAC pack has an invalid magic value", { magic });
  }
  const version = view.getUint16(8, true);
  const wordBits = view.getUint16(10, true);
  const wordsPerCodelet = view.getUint16(12, true);
  const headerBytes = view.getUint16(14, true);
  const recordCount = view.getUint32(16, true);
  const recordBytes = view.getUint32(20, true);
  const totalBytes = view.getUint32(24, true);
  const reserved = view.getUint32(28, true);

  if (version !== PYAC_FORMAT_VERSION) {
    fail("unsupported-version", "PyAC pack version is unsupported", { version });
  }
  if (wordBits !== PYAC_WORD_BITS || wordsPerCodelet !== PYAC_WORDS_PER_CODELET) {
    fail("unsupported-word-layout", "PyAC pack word layout is unsupported", {
      wordBits,
      wordsPerCodelet
    });
  }
  if (headerBytes !== PYAC_HEADER_BYTES || recordBytes !== PYAC_CODELET_BYTES || reserved !== 0) {
    fail("invalid-header", "PyAC pack header contains invalid layout fields", {
      headerBytes,
      recordBytes,
      reserved
    });
  }
  const expectedBytes = PYAC_HEADER_BYTES + recordCount * PYAC_CODELET_BYTES;
  if (totalBytes !== expectedBytes || bytes.byteLength !== totalBytes) {
    fail("truncated-pack", "PyAC pack length does not match its header", {
      expectedBytes,
      totalBytes,
      actualBytes: bytes.byteLength
    });
  }

  const codelets = [];
  for (let index = 0; index < recordCount; index += 1) {
    const start = PYAC_HEADER_BYTES + index * PYAC_CODELET_BYTES;
    codelets.push(bytesToWords(bytes.slice(start, start + PYAC_CODELET_BYTES)));
  }
  return {
    format: `pyac-vliw-${version}`,
    version,
    wordBits,
    wordsPerCodelet,
    codeletBytes: recordBytes,
    codelets,
    bytes
  };
}

export function buildVliwDatabase(sentences, options = {}) {
  if (!Array.isArray(sentences)) {
    fail("invalid-sentences", "PyAC database input must be an array of sentences");
  }
  const records = [];
  const executableCodelets = [];

  sentences.forEach((sentence, inputIndex) => {
    const source = sourceForIndex(options, inputIndex);
    const expected = Array.isArray(options.expectedResults)
      ? options.expectedResults[inputIndex]
      : undefined;
    let codelets;
    try {
      codelets = lowerSentence(sentence);
    } catch (error) {
      records.push(makeUnsupportedRecord({
        sentence,
        inputIndex,
        partIndex: 0,
        source,
        error
      }));
      return;
    }

    codelets.forEach((codelet, partIndex) => {
      try {
        const decoded = decodeCodelet(codelet.words ?? codelet);
        const record = makeExecutableRecord({
          sentence,
          decoded,
          codelet,
          inputIndex,
          partIndex,
          source,
          expected
        });
        record.packIndex = executableCodelets.length;
        executableCodelets.push(codelet);
        records.push(record);
      } catch (error) {
        records.push(makeUnsupportedRecord({
          sentence,
          inputIndex,
          partIndex,
          source,
          error
        }));
      }
    });
  });

  const pack = encodePyacPack(executableCodelets);
  return {
    catalog: buildCatalog(records, pack),
    pack,
    records: records.map((record) => ({ ...record }))
  };
}

export function buildVliwDatabaseFromTranslation(lines, options = {}) {
  if (!Array.isArray(lines)) {
    fail("invalid-translation-lines", "translated PyAC input must be an array of source lines");
  }
  const language = String(options.language ?? "").trim().toLowerCase();
  const adapter = resolveTranslationSource(language);
  if (!adapter) {
    fail("translation-adapter", "no Pyash translation adapter is registered for the source language", {
      language
    });
  }

  const sentences = [];
  const sources = [];
  for (const [lineIndex, line] of lines.entries()) {
    if (typeof line !== "string" || !line.trim()) {
      fail("translation-failed", "translation input lines must contain source text", {
        language,
        lineIndex,
        line
      });
    }
    let sentence;
    try {
      sentence = adapter.toPyash(line);
    } catch (error) {
      fail("translation-failed", "translation adapter rejected a source line", {
        language,
        lineIndex,
        line,
        cause: error?.message ?? String(error)
      });
    }
    if (!sentence) {
      fail("translation-failed", "translation adapter produced no canonical sentence", {
        language,
        lineIndex,
        line
      });
    }
    sentences.push(sentence);
    sources.push({
      ...(options.source && typeof options.source === "object" ? cloneSerializable(options.source) : {}),
      language,
      locator: options.locator ?? null,
      lineIndex,
      text: line
    });
  }

  const database = buildVliwDatabase(sentences, {
    sources,
    ...(Array.isArray(options.expectedResults) ? { expectedResults: options.expectedResults } : {})
  });
  return { ...database, sentences, sources };
}

function databasePack(database) {
  const catalog = normalizeCatalog(database?.catalog ?? database);
  const pack = copyBytes(database?.pack);
  const actualHash = sha256(pack);
  if (catalog.packHash !== actualHash) {
    fail("pack-hash-mismatch", "PyAC catalog hash does not match the pack", {
      expected: catalog.packHash,
      actual: actualHash
    });
  }
  return { catalog, pack, decoded: decodePyacPack(pack) };
}

function recordMatches(record, criteria) {
  if (!criteria || typeof criteria !== "object") return true;
  if (criteria.id !== undefined && record.id !== criteria.id) return false;
  if (criteria.status !== undefined && record.status !== criteria.status) return false;
  if (criteria.semantic !== undefined && record.semantic !== criteria.semantic) return false;
  if (criteria.verb !== undefined && record.verb !== criteria.verb) return false;
  if (criteria.mood !== undefined && record.mood !== criteria.mood) return false;
  if (criteria.case !== undefined && !record.cases.includes(criteria.case)) return false;
  if (criteria.hnuc !== undefined && record.hnuc !== criteria.hnuc) return false;
  if (criteria.codeletHash !== undefined && record.codeletHash !== criteria.codeletHash) return false;
  if (criteria.sourceLanguage !== undefined && record.source?.language !== criteria.sourceLanguage) return false;
  if (criteria.canonicalIncludes !== undefined && !record.canonicalSentence.includes(criteria.canonicalIncludes)) {
    return false;
  }
  if (criteria.word !== undefined && !record.words.includes(criteria.word)) return false;
  if (criteria.value !== undefined && !containsValue(record.sentence, criteria.value)) return false;
  return true;
}

function containsValue(value, target) {
  if (stableJson(value) === stableJson(target)) return true;
  if (Array.isArray(value)) return value.some((entry) => containsValue(entry, target));
  if (value && typeof value === "object") {
    return Object.values(value).some((entry) => containsValue(entry, target));
  }
  return false;
}

export function queryVliwCatalog(databaseOrCatalog, criteria = {}) {
  const catalog = normalizeCatalog(databaseOrCatalog?.catalog ?? databaseOrCatalog);
  return catalog.records.filter((record) => recordMatches(record, criteria));
}

export async function replayVliwDatabase(database, options = {}) {
  const { catalog, decoded } = databasePack(database);
  const selected = options.ids
    ? new Set(options.ids)
    : null;
  const records = catalog.records.filter((record) => !selected || selected.has(record.id));
  const outcomes = [];

  for (const record of records) {
    if (record.status !== "executable") {
      outcomes.push({
        id: record.id,
        status: "unsupported",
        error: record.error
      });
      continue;
    }
    const words = decoded.codelets[record.packIndex];
    if (!words) {
      fail("missing-codelet", "PyAC catalog record has no matching pack codelet", {
        id: record.id,
        packIndex: record.packIndex
      });
    }
    const actualHash = sha256(wordsToBytes(words));
    if (actualHash !== record.codeletHash) {
      fail("codelet-hash-mismatch", "PyAC codelet hash does not match the catalog", {
        id: record.id,
        expected: record.codeletHash,
        actual: actualHash
      });
    }
    const [result] = await executeCodelets([words]);
    const expected = record.expected;
    if (expected !== undefined && stableJson(result) !== stableJson(expected)) {
      fail("replay-mismatch", "PyAC replay result differs from the catalog expectation", {
        id: record.id,
        expected,
        actual: result
      });
    }
    outcomes.push({
      id: record.id,
      status: "replayed",
      sentence: decodeCodelet(words).sentence,
      result,
      verified: true
    });
  }
  return outcomes;
}

function catalogRowText(record) {
  return JSON.stringify(JSON.stringify(record));
}

export function renderVliwCatalogPya(database, options = {}) {
  const catalog = normalizeCatalog(database?.catalog ?? database);
  const name = options.name ?? "pyac codelet catalog";
  const packLocator = options.packLocator ?? null;
  const lines = [
    `su name ${name} be series def`,
    `  su name format ob text ${JSON.stringify(catalog.format)} be catalog metadata ya`,
    `  su name pack format ob text ${JSON.stringify(catalog.packFormat)} be catalog metadata ya`,
    `  su name pack hash ob text ${JSON.stringify(catalog.packHash)} be catalog metadata ya`,
    `  su name record count ob num ${catalog.recordCount} be catalog metadata ya`,
    `  su name executable count ob num ${catalog.executableCount} be catalog metadata ya`,
    `  su name unsupported count ob num ${catalog.unsupportedCount} be catalog metadata ya`
  ];
  if (packLocator !== null) {
    lines.push(`  su name pack locator ob text ${JSON.stringify(packLocator)} be catalog metadata ya`);
  }
  for (const record of catalog.records) {
    lines.push(`  su name ${record.id} ob text ${catalogRowText(record)} be codelet ya`);
  }
  lines.push("prah");
  return `${lines.join("\n")}\n`;
}

export function parseVliwCatalogPya(source) {
  if (typeof source !== "string") {
    fail("invalid-catalog-text", "PyAC catalog source must be text");
  }
  const program = buildProgram(source);
  const header = program.sentences.find((sentence) => sentence.mood === "def" && sentence.be === "series");
  if (!header) fail("invalid-catalog-text", "PyAC catalog has no series header");

  const records = [];
  for (const sentence of program.sentences) {
    if (sentence.be !== "codelet" || sentence.mood !== "ya") continue;
    try {
      records.push(JSON.parse(sentence.ob?.text));
    } catch (error) {
      fail("invalid-catalog-row", "PyAC catalog row is not valid JSON text", {
        name: sentence.su?.name,
        cause: error.message
      });
    }
  }
  const metadata = Object.fromEntries(
    program.sentences
      .filter((sentence) => sentence.be === "catalog metadata" && sentence.mood === "ya")
      .map((sentence) => [sentence.su?.name, sentence.ob])
  );
  const catalog = {
    format: metadata.format?.text ?? CATALOG_FORMAT,
    packFormat: metadata["pack format"]?.text ?? null,
    packHash: metadata["pack hash"]?.text ?? null,
    recordCount: metadata["record count"]?.num ?? records.length,
    executableCount: metadata["executable count"]?.num ?? records.filter((record) => record.status === "executable").length,
    unsupportedCount: metadata["unsupported count"]?.num ?? records.filter((record) => record.status !== "executable").length,
    records
  };
  return { catalog, metadata };
}

export function writeVliwDatabaseFiles(database, { catalogPath, packPath, packLocator = packPath } = {}) {
  if (!catalogPath || !packPath) {
    fail("missing-database-path", "PyAC database writes require catalogPath and packPath");
  }
  const { catalog, pack } = databasePack(database);
  fs.writeFileSync(catalogPath, renderVliwCatalogPya({ catalog, pack }, { packLocator }), "utf8");
  fs.writeFileSync(packPath, Buffer.from(pack));
  return { catalogPath, packPath, packHash: catalog.packHash };
}

export function readVliwDatabaseFiles({ catalogPath, packPath } = {}) {
  if (!catalogPath || !packPath) {
    fail("missing-database-path", "PyAC database reads require catalogPath and packPath");
  }
  const catalogText = fs.readFileSync(catalogPath, "utf8");
  const { catalog } = parseVliwCatalogPya(catalogText);
  const pack = new Uint8Array(fs.readFileSync(packPath));
  databasePack({ catalog, pack });
  return { catalog, pack };
}

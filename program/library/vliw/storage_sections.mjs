import fs from "node:fs";
import path from "node:path";

import { encodePyacWord } from "./word_code.mjs";
import { freshQuoteScan, scanQuoteWord } from "./quote_scan.mjs";

const SECTION_VERBS = new Set(["pfun myoc", "partially module"]);
const ELEMENT_WIDTHS = new Map([
  ["paucal_number_", new Set([1])],
  ["number_", new Set([2])],
  ["plural_number_", new Set([4])],
  ["multal_number_", new Set([8])]
]);
const CODELET_BYTES = 32;

function invalid(message, details = {}) {
  const error = new Error(message);
  error.name = "PyacStorageSectionError";
  error.details = details;
  return error;
}

function isStorageSection(sentence) {
  return SECTION_VERBS.has(sentence?.be)
    && sentence?.mood === "ya"
    && sentence?.from?.filename !== undefined;
}

function shapeFor(sentence) {
  const shape = sentence?.with?.ve;
  if (!shape || shape.type !== "num" || !Array.isArray(shape.values) || shape.values.length < 1) {
    throw invalid("storage sections require `with ve num <dimension>...`");
  }
  const dimensions = shape.values.map(Number);
  if (dimensions.length > 8 || dimensions.some((size) => !Number.isSafeInteger(size) || size < 1 || size > 0xffff)) {
    throw invalid("storage section dimensions must be positive uint16 values", { dimensions });
  }
  const elements = dimensions.reduce((total, size) => total * size, 1);
  if (!Number.isSafeInteger(elements)) throw invalid("storage section element count exceeds safe integer range");
  return { dimensions, elements };
}

function byteLengthFor(sentence) {
  const value = sentence?.by?.ve;
  if (value?.type !== "num" || !Array.isArray(value.values) || value.values.length !== 2) {
    throw invalid("storage sections require `by ve num <low-u16> <high-u16>` byte length");
  }
  const [low, high] = value.values.map(Number);
  if (![low, high].every((word) => Number.isInteger(word) && word >= 0 && word <= 0xffff)) {
    throw invalid("storage byte length words must be uint16 values", { values: value.values });
  }
  return low + high * 0x1_0000;
}

function normalizeStorageSentence(sentence, bytes, assetPath) {
  if (!isStorageSection(sentence)) throw invalid("not a file-backed Pyash storage section");
  if (!sentence.exists) throw invalid("storage sections must be declared with `exists`");
  if (!sentence.su?.name) throw invalid("storage sections require a named subject");
  const byteLength = byteLengthFor(sentence);
  if (!Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength !== bytes.byteLength) {
    throw invalid("declared storage byte length must match the source file", {
      declaredBytes: sentence.by?.num,
      actualBytes: bytes.byteLength,
      assetPath
    });
  }
  const type = String(sentence.as?.name ?? "").trim().toLowerCase();
  if (!ELEMENT_WIDTHS.has(type) && type !== "float") {
    throw invalid("storage `as name` must be a Pyash numeric width or float", { type });
  }
  const shape = shapeFor(sentence);
  const bytesPerElement = byteLength / shape.elements;
  const validWidth = ELEMENT_WIDTHS.has(type)
    ? ELEMENT_WIDTHS.get(type).has(bytesPerElement)
    : bytesPerElement === 4 || bytesPerElement === 8;
  if (!Number.isInteger(bytesPerElement) || !validWidth) {
    throw invalid("storage byte length, shape, and element type do not agree", {
      type,
      byteLength,
      dimensions: shape.dimensions,
      bytesPerElement
    });
  }
  return {
    byteLength,
    dimensions: shape.dimensions,
    elementCount: shape.elements,
    elementBytes: bytesPerElement,
    type,
    name: sentence.su.name
  };
}

function metadataSentence(sentence) {
  const { from: _source, ...metadata } = sentence;
  return metadata;
}

function bytesToCodelets(bytes) {
  const codelets = [];
  for (let start = 0; start < bytes.byteLength; start += CODELET_BYTES) {
    const codelet = new Uint16Array(16);
    const end = Math.min(start + CODELET_BYTES, bytes.byteLength);
    for (let offset = start; offset < end; offset += 2) {
      const low = bytes[offset];
      const high = offset + 1 < end ? bytes[offset + 1] : 0;
      codelet[(offset - start) / 2] = low | (high << 8);
    }
    codelets.push(codelet);
  }
  return codelets;
}

function codeletsToBytes(codelets, byteLength) {
  const padded = new Uint8Array(codelets.length * CODELET_BYTES);
  const view = new DataView(padded.buffer);
  codelets.forEach((codelet, codeletIndex) => {
    for (let wordIndex = 0; wordIndex < 16; wordIndex += 1) {
      view.setUint16(codeletIndex * CODELET_BYTES + wordIndex * 2, codelet[wordIndex], true);
    }
  });
  if (byteLength > padded.byteLength) throw invalid("storage payload is truncated");
  if (padded.subarray(byteLength).some((byte) => byte !== 0)) {
    throw invalid("storage payload has non-zero codelet padding");
  }
  return padded.slice(0, byteLength);
}

function completeSentenceEnd(codelets, start) {
  const quoteState = freshQuoteScan();
  for (let index = start; index < codelets.length;) {
    let rawWordCount = null;
    for (let wordIndex = 1; wordIndex < 16; wordIndex += 1) {
      rawWordCount = scanQuoteWord(codelets[index][wordIndex], quoteState, (code, message, details) => {
        return invalid(message, { code, ...details });
      });
      if (rawWordCount !== null) break;
    }
    index += 1;
    if (rawWordCount !== null) {
      const rawCodeletCount = Math.ceil(rawWordCount / 16);
      if (index + rawCodeletCount > codelets.length) throw invalid("PyAC pack has a truncated raw quote block");
      index += rawCodeletCount;
      continue;
    }
    if (codelets[index - 1][0] & 1) return index;
  }
  throw invalid("PyAC pack ends in an incomplete sentence", { codeletStart: start });
}

function decodeSentence(codelets, start, end, decodeProgram) {
  const sentences = decodeProgram(codelets.slice(start, end));
  if (sentences.length !== 1) throw invalid("storage metadata must be one complete Pyash sentence");
  return sentences[0];
}

function containsStorageVerb(codelets, start, end) {
  const [sectionPart, modulePart] = [encodePyacWord("pfun"), encodePyacWord("myoc")];
  const required = new Set([sectionPart, modulePart, 0x414f, 0x287e, 0x490f, 0x217e]);
  const seen = new Set();
  let prior = 0;
  let hasSectionVerb = false;
  for (let codeletIndex = start; codeletIndex < end; codeletIndex += 1) {
    for (let wordIndex = 1; wordIndex < 16; wordIndex += 1) {
      const word = codelets[codeletIndex][wordIndex];
      seen.add(word);
      if (prior === sectionPart && word === modulePart) hasSectionVerb = true;
      prior = word;
    }
  }
  return hasSectionVerb && [...required].every((word) => seen.has(word));
}

export function compilePyacStorageSections(sentences, {
  assetRoot = process.cwd(),
  lowerSentence,
  encodePack
} = {}) {
  if (typeof lowerSentence !== "function" || typeof encodePack !== "function") {
    throw invalid("storage section compiler requires the registered Pyash lowerer and PyAC pack encoder");
  }
  if (!Array.isArray(sentences) || sentences.some((sentence) => !isStorageSection(sentence))) {
    throw invalid("storage section compiler expects file-backed section sentences");
  }
  const root = path.resolve(String(assetRoot));
  const codelets = [];
  const sections = [];
  for (const [index, sentence] of sentences.entries()) {
    const relativeAsset = String(sentence.from.filename).trim();
    if (!relativeAsset) throw invalid("storage source filename must be non-empty", { index });
    const assetPath = path.resolve(root, relativeAsset);
    const bytes = fs.readFileSync(assetPath);
    const section = normalizeStorageSentence(sentence, bytes, relativeAsset);
    const metadata = metadataSentence(sentence);
    const lowered = lowerSentence(metadata);
    codelets.push(...lowered.vectors);
    const payloadStart = codelets.length;
    const payloadCodelets = bytesToCodelets(bytes);
    codelets.push(...payloadCodelets);
    sections.push({
      ...section,
      index,
      assetPath,
      payloadCodeletStart: payloadStart,
      payloadCodeletCount: payloadCodelets.length
    });
  }
  return {
    pack: encodePack(codelets),
    codelets,
    sections,
    byteLength: sections.reduce((sum, section) => sum + section.byteLength, 0)
  };
}

export function decodePyacStorageSections(input, {
  decodePack,
  decodeProgram
} = {}) {
  if (typeof decodePack !== "function" || typeof decodeProgram !== "function") {
    throw invalid("storage decoder requires the registered Pyash program and PyAC pack decoders");
  }
  const pack = decodePack(input);
  const sections = [];
  let cursor = 0;
  while (cursor < pack.codelets.length) {
    const sentenceEnd = completeSentenceEnd(pack.codelets, cursor);
    if (!containsStorageVerb(pack.codelets, cursor, sentenceEnd)) {
      throw invalid("PyAC storage pack contains a non-storage sentence", { codeletStart: cursor });
    }
    const sentence = decodeSentence(pack.codelets, cursor, sentenceEnd, decodeProgram);
    if (!isStorageSection({ ...sentence, from: { filename: "embedded" } })) {
      throw invalid("PyAC storage pack contains a non-storage sentence", { codeletStart: cursor });
    }
    if (sentence.from !== undefined) throw invalid("compiled storage metadata must not retain source filenames");
    const byteLength = byteLengthFor(sentence);
    const shape = shapeFor(sentence);
    const type = String(sentence.as?.name ?? "").trim().toLowerCase();
    const elementBytes = byteLength / shape.elements;
    if (!Number.isSafeInteger(byteLength) || byteLength < 1
      || (!ELEMENT_WIDTHS.has(type) && type !== "float")
      || !Number.isInteger(elementBytes)
      || (ELEMENT_WIDTHS.has(type) && !ELEMENT_WIDTHS.get(type).has(elementBytes))
      || (type === "float" && ![4, 8].includes(elementBytes))) {
      throw invalid("compiled storage metadata has inconsistent type, shape, or length", {
        byteLength,
        type,
        dimensions: shape.dimensions
      });
    }
    const payloadCodeletCount = Math.ceil(byteLength / CODELET_BYTES);
    const payloadStart = sentenceEnd;
    const payloadEnd = payloadStart + payloadCodeletCount;
    if (payloadEnd > pack.codelets.length) throw invalid("compiled storage payload is truncated");
    const data = codeletsToBytes(pack.codelets.slice(payloadStart, payloadEnd), byteLength);
    sections.push({
      name: sentence.su?.name,
      type,
      dimensions: shape.dimensions,
      elementCount: shape.elements,
      elementBytes,
      byteLength,
      data,
      metadataCodeletStart: cursor,
      metadataCodeletCount: sentenceEnd - cursor,
      payloadCodeletStart: payloadStart,
      payloadCodeletCount
    });
    cursor = payloadEnd;
  }
  return sections;
}

export function splitPyacStoragePack(input, {
  decodePack,
  decodeProgram
} = {}) {
  if (typeof decodePack !== "function" || typeof decodeProgram !== "function") {
    throw invalid("storage splitter requires the registered Pyash program and PyAC pack decoders");
  }
  const pack = decodePack(input);
  const executableCodelets = [];
  const sections = [];
  let cursor = 0;
  let storageStarted = false;
  while (cursor < pack.codelets.length) {
    const sentenceEnd = completeSentenceEnd(pack.codelets, cursor);
    const sentence = containsStorageVerb(pack.codelets, cursor, sentenceEnd)
      ? decodeSentence(pack.codelets, cursor, sentenceEnd, decodeProgram)
      : null;
    if (sentence && isStorageSection({ ...sentence, from: { filename: "embedded" } })) {
      storageStarted = true;
    const byteLength = byteLengthFor(sentence);
      const payloadCodeletCount = Math.ceil(byteLength / CODELET_BYTES);
      const payloadStart = sentenceEnd;
      const payloadEnd = payloadStart + payloadCodeletCount;
      if (sentence.from !== undefined || !Number.isSafeInteger(byteLength) || byteLength < 1
        || payloadEnd > pack.codelets.length) {
        throw invalid("compiled storage section has invalid or truncated payload metadata", { byteLength });
      }
      const shape = shapeFor(sentence);
      const type = String(sentence.as?.name ?? "").trim().toLowerCase();
      const data = codeletsToBytes(pack.codelets.slice(payloadStart, payloadEnd), byteLength);
      sections.push({
        name: sentence.su?.name,
        type,
        dimensions: shape.dimensions,
        elementCount: shape.elements,
        elementBytes: byteLength / shape.elements,
        byteLength,
        data
      });
      cursor = payloadEnd;
      continue;
    }
    if (storageStarted) throw invalid("executable sentences must precede storage sections");
    executableCodelets.push(...pack.codelets.slice(cursor, sentenceEnd));
    cursor = sentenceEnd;
  }
  return { executableCodelets, sections };
}

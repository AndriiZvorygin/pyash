import { createHash } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const KWON_LOOKUP_INDEX_FORMAT = "pyash-kwon-lookup-index-v4";
export const KWON_LOOKUP_INDEX_KINDS = Object.freeze(["english", "pyac", "wordnet", "open-wordnet"]);
const INDEX_ENTRY_PREFIX = "kwon-entry:";
const OPEN_WORDNET_JSON_FILE = /^(?:adj|adv|noun|verb)\..+\.json$/u;
const OPEN_WORDNET_CONFIG_PATH = "program/library/translation/english_wordnet.pya";
const OPEN_WORDNET_CONFIG_FORMAT = "open-english-wordnet-2025-json-v1";

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
export const PYASH_REPOSITORY_ROOT = resolve(MODULE_DIRECTORY, "../../..");
export const KWON_LOOKUP_INDEX_PATHS = Object.freeze({
  english: resolve(MODULE_DIRECTORY, "kwon_english_index.pya"),
  pyac: resolve(MODULE_DIRECTORY, "kwon_pyac_index.pya"),
  wordnet: resolve(MODULE_DIRECTORY, "kwon_wordnet_index.pya"),
  "open-wordnet": resolve(MODULE_DIRECTORY, "kwon_open_wordnet_index.pya")
});

const SOURCE_PATHS = Object.freeze([
  "program/library/pyashWords.json",
  "caterer/pyac/lyac/kwon_en.json",
  "caterer/pyac/lyac/pyashWords.json",
  "caterer/pyac/lyac/pyackwon.json",
  "caterer/pyac/lyac/dictionary_en.json",
  "program/library/translation/english_grammar.pya",
  "program/library/translation/english_lemmas.pya",
  "program/library/translation/english_wordnet_bridges.pya",
  "program/library/translation/english_wordnet.pya",
  "program/library/translation/english_wordnet_compound_glosses.pya",
  "program/library/translation/compound_coverage_wordnet_verified.pya",
  "program/library/translation/compound_coverage_curated.pya"
]);

const sourceValidationPromises = new Map();
const postingIdentityIndexes = new WeakMap();
const staleIndexWarnings = new Set();
const sourceScanWarnings = new Set();
const changedSourceIndexPromises = new Map();
const pendingStaleCatalogs = new Set();
const pendingScanFallbacks = new Map();

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeEnglish(value) {
  return typeof value === "string"
    ? value.normalize("NFC").trim().toLowerCase()
    : "";
}

function normalizePyac(value) {
  return typeof value === "string" ? value.normalize("NFC").trim().toLowerCase().replace(/\s+/gu, " ") : "";
}

function hash(source) {
  return createHash("sha256").update(source).digest("hex");
}

function resolveSourcePath(root, sourceId) {
  if (typeof sourceId !== "string" || !sourceId.trim()) {
    throw Object.assign(new Error("kwon index contains an invalid source path"), { code: "invalid-kwon-lookup-index" });
  }
  const absoluteRoot = resolve(root);
  const sourcePath = resolve(absoluteRoot, sourceId);
  const relativePath = relative(absoluteRoot, sourcePath);
  if (!relativePath || relativePath === "." || relativePath.startsWith(`..${sep}`) || relativePath === "..") {
    throw Object.assign(new Error(`kwon index source path escapes its repository root: ${sourceId}`), { code: "invalid-kwon-lookup-index" });
  }
  return sourcePath;
}

function addValue(indexes, kind, key, value) {
  const normalizedKey = kind === "english" ? normalizeEnglish(key) : normalizePyac(key);
  if (!normalizedKey) return;
  const index = indexes[kind];
  if (!index) return;
  const values = index.get(normalizedKey) ?? [];
  let identitiesByKey = postingIdentityIndexes.get(index);
  if (!identitiesByKey) {
    identitiesByKey = new Map();
    postingIdentityIndexes.set(index, identitiesByKey);
  }
  let identities = identitiesByKey.get(normalizedKey);
  if (!identities) {
    identities = new Set();
    identitiesByKey.set(normalizedKey, identities);
  }
  const identity = JSON.stringify(value);
  if (identities.has(identity)) return;
  identities.add(identity);
  values.push(value);
  index.set(normalizedKey, values);
}

function quotedStringAt(text, start) {
  let index = start;
  while (/\s/u.test(text[index] ?? "")) index += 1;
  if (text[index] !== '"') return null;
  const begin = index;
  index += 1;
  let escaped = false;
  for (; index < text.length; index += 1) {
    const character = text[index];
    if (escaped) escaped = false;
    else if (character === "\\") escaped = true;
    else if (character === '"') {
      try {
        return { value: JSON.parse(text.slice(begin, index + 1)), end: index + 1 };
      } catch {
        return null;
      }
    }
  }
  return null;
}

function fieldString(line, marker) {
  const position = line.indexOf(marker);
  return position < 0 ? null : quotedStringAt(line, position + marker.length)?.value ?? null;
}

function parsePayload(text) {
  if (typeof text !== "string") return null;
  try {
    const value = JSON.parse(text);
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  } catch {
    return text;
  }
}

function wordNetIdsFrom(value, output = new Set()) {
  if (typeof value === "string") {
    for (const token of value.trim().split(/\s+/u)) {
      const match = token.match(/^([anrvs]):[0-9]{8}-\1$/iu);
      if (match) output.add(token.toLowerCase());
    }
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) wordNetIdsFrom(item, output);
    return output;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (/^(?:senseid|senseids|source|sources|linked-sense|linked-senses)$/iu.test(key)) {
        wordNetIdsFrom(item, output);
      } else if (item && typeof item === "object") {
        wordNetIdsFrom(item, output);
      }
    }
  }
  return output;
}

function englishTermsFrom(value, output = new Set()) {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    for (const item of value) englishTermsFrom(item, output);
    return output;
  }
  for (const [key, item] of Object.entries(value)) {
    if (["target", "surface", "lemma", "canonicalEnglish", "targetEnglish", "english", "en"].includes(key)
      && typeof item === "string") output.add(item);
    else if (key === "aliases" && Array.isArray(item)) {
      for (const alias of item) if (typeof alias === "string") output.add(alias);
    } else if (key === "sourceSurfaces" && item && typeof item.en === "string") output.add(item.en);
    else if (item && typeof item === "object") englishTermsFrom(item, output);
  }
  return output;
}

function pyacSequencesFrom(value, output = []) {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    for (const item of value) pyacSequencesFrom(item, output);
    return output;
  }
  for (const [key, item] of Object.entries(value)) {
    if (["pyashSequence", "pyacSequence", "sequence"].includes(key)
      && Array.isArray(item)
      && item.every((part) => typeof part === "string")) output.push(item);
    else if (["pyash", "pyac"].includes(key) && typeof item === "string") {
      const parts = item.trim().split(/\s+/u).filter(Boolean);
      if (parts.length > 0) output.push(parts);
    } else if (item && typeof item === "object") pyacSequencesFrom(item, output);
  }
  return output;
}

function indexPyaRow(indexes, locator, line) {
  const key = fieldString(line, "su text ");
  const targetName = fieldString(line, "ob name ");
  const textValue = fieldString(line, "ob text ");
  const payload = parsePayload(textValue);
  const completeValue = {
    ...(key ? { key } : {}),
    ...(targetName ? { target: targetName } : {}),
    ...(payload !== null ? { payload } : {})
  };
  const english = englishTermsFrom(payload ?? {});
  if (targetName) english.add(targetName);
  if (key && key.startsWith("sense-lemma:")) {
    if (typeof payload === "string") english.add(payload);
  }
  for (const term of english) addValue(indexes, "english", term, locator);
  for (const sequence of pyacSequencesFrom(payload ?? {})) {
    const spaced = normalizePyac(sequence.join(" "));
    const packed = normalizePyac(sequence.join(""));
    if (spaced) addValue(indexes, "pyac", spaced, locator);
    if (packed) addValue(indexes, "pyac", packed, locator);
  }
  const ids = wordNetIdsFrom(completeValue);
  if (key && /^([anrvs]):[0-9]{8}-\1$/iu.test(key)) ids.add(key.toLowerCase());
  if (key) {
    const glossId = key.match(/^sense-gloss:([anrvs]):([0-9]{8})-\1$/iu);
    const lemmaId = key.match(/^sense-lemma:([anrvs]):([0-9]{8})-\1:/iu);
    const compoundId = key.match(/^([anrvs]):[0-9]{8}-\1\s*\|/iu);
    const glossSource = glossId ? `${glossId[1]}:${glossId[2]}-${glossId[1]}` : "";
    const lemmaSource = lemmaId ? `${lemmaId[1]}:${lemmaId[2]}-${lemmaId[1]}` : "";
    for (const id of [glossSource, lemmaSource, compoundId?.[0]?.split(/\s/u)[0]]) if (id) ids.add(id.toLowerCase());
  }
  for (const id of ids) addValue(indexes, "wordnet", id, locator);
}

function scanPyaLines(buffer, sourceId, indexes) {
  let start = 0;
  let lineNumber = 1;
  while (start < buffer.length) {
    const newline = buffer.indexOf(0x0a, start);
    const end = newline < 0 ? buffer.length : newline;
    const lineBytes = buffer.subarray(start, end > start && buffer[end - 1] === 0x0d ? end - 1 : end);
    const line = lineBytes.toString("utf8");
    if (line.startsWith("su text ")) {
      const key = fieldString(line, "su text ") ?? "";
      const locator = { sourceId, byteOffset: start, lineNumber, recordId: key };
      indexPyaRow(indexes, locator, line);
    }
    if (newline < 0) break;
    start = newline + 1;
    lineNumber += 1;
  }
}

function scanOpenWordNetJson(buffer, sourceId, indexes) {
  let lineStart = 0;
  let lineNumber = 1;
  while (lineStart < buffer.length) {
    const newline = buffer.indexOf(0x0a, lineStart);
    const lineEnd = newline < 0 ? buffer.length : newline;
    const line = buffer.subarray(lineStart, lineEnd).toString("utf8");
    const match = line.match(/^\s*"([0-9]{8}-[anrsv])"\s*:\s*\{/u);
    if (match) {
      const braceOnLine = Buffer.from(line, "utf8").indexOf(0x7b);
      const recordStart = lineStart + braceOnLine;
      let depth = 0;
      let inString = false;
      let escaped = false;
      let recordEnd = -1;
      for (let cursor = recordStart; cursor < buffer.length; cursor += 1) {
        const byte = buffer[cursor];
        if (inString) {
          if (escaped) escaped = false;
          else if (byte === 0x5c) escaped = true;
          else if (byte === 0x22) inString = false;
          continue;
        }
        if (byte === 0x22) inString = true;
        else if (byte === 0x7b) depth += 1;
        else if (byte === 0x7d) {
          depth -= 1;
          if (depth === 0) {
            recordEnd = cursor;
            break;
          }
        }
      }
      if (recordEnd < recordStart) {
        throw Object.assign(new Error(`Open English WordNet synset is incomplete in ${sourceId}:${lineNumber}`), {
          code: "invalid-kwon-lookup-index"
        });
      }
      const synset = match[1];
      const partOfSpeech = synset.slice(-1);
      const recordLength = recordEnd - recordStart + 1;
      const recordSource = buffer.subarray(recordStart, recordEnd + 1).toString("utf8");
      let record;
      try {
        record = JSON.parse(recordSource);
      } catch (error) {
        throw Object.assign(new Error(`Open English WordNet synset is malformed in ${sourceId}:${lineNumber}`), {
          code: "invalid-kwon-lookup-index",
          cause: error
        });
      }
      if (record?.partOfSpeech === partOfSpeech && Array.isArray(record.members)) {
        const senseId = `${partOfSpeech}:${synset}`;
        addValue(indexes, "open-wordnet", senseId, {
          sourceId,
          byteOffset: recordStart,
          lineNumber,
          recordId: senseId,
          recordLength
        });
      }
    }
    if (newline < 0) break;
    lineStart = newline + 1;
    lineNumber += 1;
  }
}

function scanJsonCatalog(buffer, sourceId, indexes) {
  const parsed = JSON.parse(buffer.toString("utf8"));
  const entries = Array.isArray(parsed) ? parsed : [];
  entries.forEach((entry, rowIndex) => {
    if (typeof entry?.en !== "string" || typeof entry?.pya !== "string") return;
    const inline = {
      sourceId,
      rowIndex,
      recordId: `${entry.pya}:${entry.en}`,
      inline: { pya: entry.pya, en: entry.en, ...(entry.hnuc ? { hnuc: entry.hnuc } : {}) }
    };
    addLocator(indexes, "english", entry.en, inline);
    addLocator(indexes, "pyac", entry.pya, inline);
  });
  if (sourceId.endsWith("dictionary_en.json")) {
    const blacklist = parsed?.en?.blacklist ?? {};
    for (const [blockedKey, value] of Object.entries(blacklist)) {
      const term = blockedKey.startsWith("X") ? blockedKey.slice(1) : blockedKey;
      addValue(indexes, "english", term, { sourceId, recordId: `blacklist:${blockedKey}`, inline: { blacklist: value } });
    }
  }
}

function makeIndexes() {
  return { english: new Map(), pyac: new Map(), wordnet: new Map(), "open-wordnet": new Map() };
}

function scanChangedSource(kind, sourceId, source) {
  const indexes = { [kind]: new Map() };
  if (sourceId.endsWith(".pya")) scanPyaLines(source, sourceId, indexes);
  else if (kind === "open-wordnet" && OPEN_WORDNET_JSON_FILE.test(sourceId.split(/[\\/]/u).at(-1) ?? "")) {
    scanOpenWordNetJson(source, sourceId, indexes);
  } else scanJsonCatalog(source, sourceId, indexes);
  return indexes[kind];
}

async function currentSourceIndex(kind, staleSource, root) {
  const cacheKey = `${resolve(root)}\u0000${kind}\u0000${staleSource.relativePath}`;
  const cached = changedSourceIndexPromises.get(cacheKey);
  if (cached?.validationHash === staleSource.actual) return cached.promise;
  const source = await readFile(resolveSourcePath(root, staleSource.relativePath));
  const pending = Promise.resolve().then(() => scanChangedSource(kind, staleSource.relativePath, source));
  changedSourceIndexPromises.set(cacheKey, { validationHash: staleSource.actual, promise: pending });
  try {
    return await pending;
  } catch (error) {
    if (changedSourceIndexPromises.get(cacheKey)?.promise === pending) changedSourceIndexPromises.delete(cacheKey);
    throw error;
  }
}

function createIndex(kind, entries, sourceHashes) {
  return {
    format: KWON_LOOKUP_INDEX_FORMAT,
    kind,
    sourceHashes: { ...sourceHashes },
    entries: [...entries.entries()]
      .map(([key, values]) => [key, [...values]])
      .sort(([left], [right]) => compareText(left, right))
  };
}

function pyaString(value) {
  return JSON.stringify(value);
}

export function renderKwonLookupIndexPya(index) {
  if (!KWON_LOOKUP_INDEX_KINDS.includes(index?.kind) || !Array.isArray(index?.entries)) {
    throw new TypeError("invalid kwon lookup index");
  }
  const sourceIds = Object.keys(index.sourceHashes ?? {}).sort(compareText);
  const sourceIndexes = new Map(sourceIds.map((sourceId, position) => [sourceId, position]));
  const compactPosting = (posting) => {
    const sourceIndex = sourceIndexes.get(posting?.sourceId);
    if (!Number.isInteger(sourceIndex)) {
      if (typeof posting?.sourceId === "string") {
        throw Object.assign(new Error(`kwon index posting source is not hashed: ${posting.sourceId}`), { code: "invalid-kwon-lookup-index" });
      }
      return posting;
    }
    if (Number.isSafeInteger(posting.recordLength)
      && Number.isSafeInteger(posting.byteOffset)
      && Number.isSafeInteger(posting.lineNumber)) {
      return [3, sourceIndex, posting.byteOffset, posting.lineNumber, posting.recordId ?? "", posting.recordLength];
    }
    if (Number.isSafeInteger(posting.byteOffset) && Number.isSafeInteger(posting.lineNumber)) {
      return [0, sourceIndex, posting.byteOffset, posting.lineNumber, posting.recordId ?? ""];
    }
    if (posting.inline && Object.hasOwn(posting.inline, "blacklist")) {
      return [1, sourceIndex, posting.recordId ?? "", posting.inline.blacklist];
    }
    if (posting.inline?.pya && posting.inline?.en) {
      return [2, sourceIndex, posting.rowIndex, posting.recordId ?? "", posting.inline.pya, posting.inline.en, posting.inline.hnuc ?? null];
    }
    return posting;
  };
  const lines = [
    `su name kwon ${index.kind} lookup index be map def`,
    `su text "format" ob text ${pyaString(KWON_LOOKUP_INDEX_FORMAT)} ya`,
    `su text "kind" ob text ${pyaString(index.kind)} ya`,
    `su text "source hashes" ob text ${pyaString(JSON.stringify(index.sourceHashes ?? {}))} ya`,
    `su text "source ids" ob text ${pyaString(JSON.stringify(sourceIds))} ya`,
    `su text "entry count" ob num ${index.entries.length} ya`,
    `su text "index entries begin" ob text "begin" ya`
  ];
  for (const [key, values] of index.entries) {
    lines.push(`su text ${pyaString(`${INDEX_ENTRY_PREFIX}${key}`)} ob text ${pyaString(JSON.stringify(values.map(compactPosting)))} ya`);
  }
  lines.push("prah", "");
  return lines.join("\n");
}

function readRawString(line, marker) {
  const at = line.indexOf(marker);
  if (at < 0) return null;
  return quotedStringAt(line, at + marker.length);
}

function parseIndexRow(line) {
  const keyField = readRawString(line, "su text ");
  if (!keyField) return null;
  if (line.startsWith(" ob text ", keyField.end)) {
    const valueField = quotedStringAt(line, keyField.end + " ob text ".length);
    if (!valueField) return null;
    try {
      return { key: keyField.value, values: JSON.parse(valueField.value) };
    } catch {
      return { key: keyField.value, values: valueField.value };
    }
  }
  const numberMarker = " ob num ";
  if (line.startsWith(numberMarker, keyField.end)) {
    const number = Number(line.slice(keyField.end + numberMarker.length).split(/\s/u, 1)[0]);
    return Number.isFinite(number) ? { key: keyField.value, values: number } : null;
  }
  return null;
}

async function readAt(handle, position, length) {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead);
}

async function readLineAt(handle, position, fileSize, dataStart) {
  let start = Math.max(position, dataStart);
  if (start > dataStart) {
    const previous = await readAt(handle, start - 1, 1);
    if (previous.length && previous[0] !== 0x0a) {
      let cursor = start;
      for (;;) {
        const chunk = await readAt(handle, cursor, Math.min(4096, fileSize - cursor));
        if (chunk.length === 0) return null;
        const newline = chunk.indexOf(0x0a);
        if (newline >= 0) {
          start = cursor + newline + 1;
          break;
        }
        cursor += chunk.length;
      }
    }
  }
  if (start >= fileSize) return null;
  let cursor = start;
  const chunks = [];
  for (;;) {
    const chunk = await readAt(handle, cursor, Math.min(4096, fileSize - cursor));
    if (chunk.length === 0) break;
    const newline = chunk.indexOf(0x0a);
    if (newline >= 0) {
      chunks.push(chunk.subarray(0, newline));
      return { start, end: cursor + newline + 1, line: Buffer.concat(chunks).toString("utf8") };
    }
    chunks.push(chunk);
    cursor += chunk.length;
    if (cursor - start > 1024 * 1024) throw new Error("kwon index row exceeds one MiB");
  }
  return { start, end: fileSize, line: Buffer.concat(chunks).toString("utf8") };
}

async function previousLineStart(handle, lineStart, dataStart) {
  let cursor = lineStart - 2;
  while (cursor >= dataStart) {
    const chunkStart = Math.max(dataStart, cursor - 4095);
    const chunk = await readAt(handle, chunkStart, cursor - chunkStart + 1);
    const newline = chunk.lastIndexOf(0x0a);
    if (newline >= 0) return chunkStart + newline + 1;
    cursor = chunkStart - 1;
  }
  return dataStart;
}

async function indexHeader(handle, fileSize) {
  let cursor = 0;
  const metadata = {};
  let dataStart = 0;
  for (let count = 0; count < 16 && cursor < fileSize; count += 1) {
    const row = await readLineAt(handle, cursor, fileSize, 0);
    if (!row) break;
    cursor = row.end;
    const parsed = parseIndexRow(row.line);
    if (parsed?.key === "index entries begin") {
      dataStart = cursor;
      break;
    }
    if (!parsed) continue;
    metadata[parsed.key] = parsed.values;
  }
  if (metadata.format !== KWON_LOOKUP_INDEX_FORMAT || !KWON_LOOKUP_INDEX_KINDS.includes(metadata.kind) || dataStart === 0) {
    throw Object.assign(new Error("kwon lookup index has an invalid header"), { code: "invalid-kwon-lookup-index" });
  }
  const sourceHashes = metadata["source hashes"] ?? {};
  if (!sourceHashes || typeof sourceHashes !== "object" || Array.isArray(sourceHashes)) {
    throw Object.assign(new Error("kwon lookup index has malformed source hashes"), { code: "invalid-kwon-lookup-index" });
  }
  const sourceIds = metadata["source ids"] ?? [];
  if (!Array.isArray(sourceIds) || sourceIds.some((sourceId) => typeof sourceId !== "string")) {
    throw Object.assign(new Error("kwon lookup index has malformed source ids"), { code: "invalid-kwon-lookup-index" });
  }
  if (sourceIds.length !== Object.keys(sourceHashes).length
    || sourceIds.some((sourceId) => !Object.hasOwn(sourceHashes, sourceId))) {
    throw Object.assign(new Error("kwon lookup index source ids do not match its source hashes"), { code: "invalid-kwon-lookup-index" });
  }
  return { kind: metadata.kind, sourceHashes, sourceIds, dataStart, entryCount: metadata["entry count"] ?? 0 };
}

function expandIndexPostings(postings, sourceIds) {
  if (!Array.isArray(postings)) return [];
  return postings.map((posting) => {
    if (!Array.isArray(posting)) return posting;
    if (posting[0] === 0 && typeof sourceIds[posting[1]] === "string") {
      return {
        sourceId: sourceIds[posting[1]],
        byteOffset: posting[2],
        lineNumber: posting[3],
        recordId: posting[4]
      };
    }
    if (posting[0] === 1 && typeof sourceIds[posting[1]] === "string") {
      return {
        sourceId: sourceIds[posting[1]],
        recordId: posting[2],
        inline: { blacklist: posting[3] }
      };
    }
    if (posting[0] === 2 && typeof sourceIds[posting[1]] === "string") {
      return {
        sourceId: sourceIds[posting[1]],
        rowIndex: posting[2],
        recordId: posting[3],
        inline: { pya: posting[4], en: posting[5], ...(posting[6] ? { hnuc: posting[6] } : {}) }
      };
    }
    if (posting[0] === 3 && typeof sourceIds[posting[1]] === "string") {
      return {
        sourceId: sourceIds[posting[1]],
        byteOffset: posting[2],
        lineNumber: posting[3],
        recordId: posting[4],
        recordLength: posting[5]
      };
    }
    throw Object.assign(new Error("kwon lookup index contains an unknown compact posting"), { code: "invalid-kwon-lookup-index" });
  });
}

async function validateSourceHashes(sourceHashes, root) {
  const entries = Object.entries(sourceHashes).sort(([left], [right]) => compareText(left, right));
  const cacheKey = `${resolve(root)}\u0000${entries.map(([path, digest]) => `${path}:${digest}`).join("\u0001")}`;
  if (sourceValidationPromises.has(cacheKey)) return sourceValidationPromises.get(cacheKey);
  const pending = Promise.all(entries.map(async ([relativePath, expected]) => {
    let source;
    try {
      source = await readFile(resolveSourcePath(root, relativePath));
    } catch (error) {
      return { relativePath, expected, unavailable: error.code ?? error.message };
    }
    const actual = hash(source);
    return actual === expected ? null : { relativePath, expected, actual };
  })).then((results) => results.filter(Boolean));
  sourceValidationPromises.set(cacheKey, pending);
  try {
    return await pending;
  } catch (error) {
    sourceValidationPromises.delete(cacheKey);
    throw error;
  }
}

function warnStaleIndex({ kind, indexPath, root, staleSources, onWarning }) {
  if (staleSources.length === 0) return;
  const paths = staleSources.map(({ relativePath }) => relativePath);
  for (const path of paths) pendingStaleCatalogs.add(path);
  const warningKey = `${resolve(root)}\u0000${resolve(indexPath)}\u0000${paths.join("\u0001")}`;
  if (staleIndexWarnings.has(warningKey)) return;
  staleIndexWarnings.add(warningKey);
  const unavailable = staleSources.some((source) => source.unavailable);
  const details = paths.join(", ");
  const message = `kwon ${kind} lookup index is stale${details ? ` for ${details}` : ""}; changed catalogs are scanned for this lookup, with indexed entries as fallback if a source is unavailable${unavailable ? " (one or more source files are unavailable)" : ""}. Persist refreshed indexes with: node command/vocab_lookup_index.mjs`;
  if (typeof onWarning === "function") onWarning(message);
}

function warnSourceScanFallback({ kind, indexPath, root, sourceId, error, onWarning }) {
  const warningKey = `${resolve(root)}\u0000${resolve(indexPath)}\u0000${kind}\u0000${sourceId}`;
  if (sourceScanWarnings.has(warningKey)) return;
  sourceScanWarnings.add(warningKey);
  pendingScanFallbacks.set(sourceId, error.message);
  const message = `kwon ${kind} lookup could not scan changed catalog ${sourceId}; using its indexed entries for now (${error.message}). Rebuild with: node command/vocab_lookup_index.mjs`;
  if (typeof onWarning === "function") onWarning(message);
}

export function takeKwonLookupWarnings() {
  if (pendingStaleCatalogs.size === 0 && pendingScanFallbacks.size === 0) return [];
  const warnings = [];
  if (pendingStaleCatalogs.size > 0) {
    warnings.push(
      `Warning: Kwon lookup indexes are stale for ${[...pendingStaleCatalogs].sort(compareText).join(", ")}. `
      + "Changed catalogs are scanned for current results; failed scans retain their indexed entries. "
      + "Persist refreshed indexes with: node command/vocab_lookup_index.mjs"
    );
  }
  if (pendingScanFallbacks.size > 0) {
    warnings[0] = `${warnings[0] ?? "Warning: Kwon used indexed entries for changed catalogs."}\n`
      + `Live scan fallback: ${[...pendingScanFallbacks]
        .sort(([left], [right]) => compareText(left, right))
        .map(([sourceId, reason]) => `${sourceId} (${reason})`)
        .join(", ")}.`;
  }
  pendingStaleCatalogs.clear();
  pendingScanFallbacks.clear();
  return warnings;
}

export async function lookupKwonIndex({
  kind,
  key,
  prefix = false,
  indexPath = KWON_LOOKUP_INDEX_PATHS[kind],
  root = PYASH_REPOSITORY_ROOT,
  onWarning
} = {}) {
  if (!KWON_LOOKUP_INDEX_KINDS.includes(kind)) throw new TypeError(`unsupported kwon index kind: ${kind}`);
  const normalized = kind === "english" ? normalizeEnglish(key) : normalizePyac(key);
  if (!normalized) return [];
  const handle = await open(indexPath, "r");
  try {
    const fileSize = (await handle.stat()).size;
    const header = await indexHeader(handle, fileSize);
    if (header.kind !== kind) throw Object.assign(new Error(`kwon index kind mismatch: expected ${kind}, found ${header.kind}`), { code: "invalid-kwon-lookup-index" });
    const staleSources = await validateSourceHashes(header.sourceHashes, root);
    warnStaleIndex({ kind, indexPath, root, staleSources, onWarning });
    let low = header.dataStart;
    let high = fileSize;
    let searchSteps = 0;
    while (low < high) {
      searchSteps += 1;
      if (searchSteps > 128) throw new Error("kwon index binary search did not converge");
      const middle = Math.floor((low + high) / 2);
      const row = await readLineAt(handle, middle, fileSize, header.dataStart);
      if (!row) break;
      if (row.line.trim() === "prah") {
        if (row.start >= high) {
          const previous = await previousLineStart(handle, high, header.dataStart);
          if (previous >= high) break;
          high = previous;
        } else high = row.start;
        continue;
      }
      if (row.start >= high) {
        const previous = await previousLineStart(handle, high, header.dataStart);
        if (previous >= high) break;
        high = previous;
        continue;
      }
      const parsed = parseIndexRow(row.line);
      if (!parsed?.key?.startsWith(INDEX_ENTRY_PREFIX)) {
        throw Object.assign(new Error("kwon index data row has an invalid key prefix"), { code: "invalid-kwon-lookup-index" });
      }
      const rowKey = parsed.key.slice(INDEX_ENTRY_PREFIX.length);
      if (compareText(rowKey, normalized) < 0) {
        if (row.end <= low) throw new Error("kwon index binary search made no forward progress");
        low = row.end;
      } else {
        if (row.start >= high) throw new Error("kwon index binary search made no backward progress");
        high = row.start;
      }
    }
    const matches = [];
    let cursor = low;
    while (cursor < fileSize) {
      const row = await readLineAt(handle, cursor, fileSize, header.dataStart);
      if (!row) break;
      if (row.line.trim() === "prah") break;
      cursor = row.end;
      const parsed = parseIndexRow(row.line);
      if (!parsed?.key?.startsWith(INDEX_ENTRY_PREFIX)) {
        throw Object.assign(new Error("kwon index data row has an invalid key prefix"), { code: "invalid-kwon-lookup-index" });
      }
      const rowKey = parsed.key.slice(INDEX_ENTRY_PREFIX.length);
      const matchesKey = prefix ? rowKey.startsWith(normalized) : rowKey === normalized;
      if (matchesKey) matches.push(...expandIndexPostings(parsed.values, header.sourceIds));
      else if (compareText(rowKey, normalized) > 0 && (!prefix || !rowKey.startsWith(normalized))) break;
    }
    const changedSources = staleSources.filter((source) => !source.unavailable);
    const changedSourceIds = new Set(changedSources.map((source) => source.relativePath));
    if (changedSourceIds.size === 0) return matches;
    let currentMatches = matches;
    for (const source of changedSources) {
      try {
        const entries = await currentSourceIndex(kind, source, root);
        const replacement = [];
        for (const [entryKey, postings] of entries) {
          const matchesKey = prefix ? entryKey.startsWith(normalized) : entryKey === normalized;
          if (matchesKey) replacement.push(...postings);
        }
        currentMatches = currentMatches.filter((match) => match?.sourceId !== source.relativePath);
        currentMatches.push(...replacement);
      } catch (error) {
        warnSourceScanFallback({ kind, indexPath, root, sourceId: source.relativePath, error, onWarning });
      }
    }
    return currentMatches;
  } finally {
    await handle.close();
  }
}

export async function readKwonSourceLocators(locators, { root = PYASH_REPOSITORY_ROOT } = {}) {
  const grouped = new Map();
  for (const locator of locators ?? []) {
    if (!locator || typeof locator.sourceId !== "string" || !Number.isSafeInteger(locator.byteOffset)) continue;
    const rows = grouped.get(locator.sourceId) ?? [];
    rows.push(locator);
    grouped.set(locator.sourceId, rows);
  }
  const output = [];
  for (const [sourceId, rows] of grouped) {
    const handle = await open(resolveSourcePath(root, sourceId), "r");
    try {
      for (const locator of rows) {
        const parts = [];
        let cursor = locator.byteOffset;
        for (;;) {
          const chunk = await readAt(handle, cursor, 4096);
          if (chunk.length === 0) break;
          const newline = chunk.indexOf(0x0a);
          if (newline >= 0) {
            parts.push(chunk.subarray(0, newline));
            break;
          }
          parts.push(chunk);
          cursor += chunk.length;
          if (cursor - locator.byteOffset > 1024 * 1024) throw new Error("kwon source row exceeds one MiB");
        }
        output.push({ locator, line: Buffer.concat(parts).toString("utf8").replace(/\r$/u, "") });
      }
    } finally {
      await handle.close();
    }
  }
  return output;
}

export async function readKwonSourceSpans(locators, { root = PYASH_REPOSITORY_ROOT } = {}) {
  const grouped = new Map();
  for (const locator of locators ?? []) {
    if (!locator
      || typeof locator.sourceId !== "string"
      || !Number.isSafeInteger(locator.byteOffset)
      || !Number.isSafeInteger(locator.recordLength)
      || locator.recordLength < 2
      || locator.recordLength > 16 * 1024 * 1024) continue;
    const rows = grouped.get(locator.sourceId) ?? [];
    rows.push(locator);
    grouped.set(locator.sourceId, rows);
  }
  const output = [];
  for (const [sourceId, rows] of grouped) {
    const handle = await open(resolveSourcePath(root, sourceId), "r");
    try {
      const fileSize = (await handle.stat()).size;
      for (const locator of rows) {
        if (locator.byteOffset + locator.recordLength > fileSize) {
          throw Object.assign(new Error(`kwon index span is outside its source file: ${sourceId}`), {
            code: "stale-kwon-lookup-index",
            details: { sourceId, recordId: locator.recordId }
          });
        }
        const bytes = await readAt(handle, locator.byteOffset, locator.recordLength);
        if (bytes.length !== locator.recordLength) {
          throw Object.assign(new Error(`kwon index span is truncated: ${sourceId}`), {
            code: "stale-kwon-lookup-index",
            details: { sourceId, recordId: locator.recordId }
          });
        }
        output.push({ locator, text: bytes.toString("utf8") });
      }
    } finally {
      await handle.close();
    }
  }
  return output;
}

export async function readKwonSourceHead(sourceId, { lineCount = 1, root = PYASH_REPOSITORY_ROOT } = {}) {
  if (typeof sourceId !== "string" || !sourceId.trim()) throw new TypeError("sourceId is required");
  if (!Number.isSafeInteger(lineCount) || lineCount < 0) throw new TypeError("lineCount must be a nonnegative integer");
  const handle = await open(resolveSourcePath(root, sourceId), "r");
  try {
    const fileSize = (await handle.stat()).size;
    const lines = [];
    let cursor = 0;
    while (lines.length < lineCount && cursor < fileSize) {
      const row = await readLineAt(handle, cursor, fileSize, 0);
      if (!row) break;
      lines.push(row.line);
      cursor = row.end;
    }
    return lines;
  } finally {
    await handle.close();
  }
}

function addLocator(indexes, kind, key, locator) {
  addValue(indexes, kind, key, locator);
}

async function configuredOpenWordNetFiles(root, configSource) {
  const { buildProgram } = await import("../../program.mjs");
  const sentences = buildProgram(configSource).sentences;
  const header = sentences.find((sentence) => (
    sentence?.mood === "def"
    && sentence?.be === "map"
    && sentence?.su?.name === "translation_english_wordnet"
  ));
  if (!header) {
    throw Object.assign(new Error("Open English WordNet config has no canonical map header"), {
      code: "invalid-kwon-lookup-index"
    });
  }
  const config = {};
  for (const sentence of sentences) {
    if (sentence?.mood !== "ya" || typeof sentence.su?.text !== "string") continue;
    if (typeof sentence.ob?.text === "string") config[sentence.su.text] = sentence.ob.text;
  }
  if (config.format !== OPEN_WORDNET_CONFIG_FORMAT || !config.source) {
    throw Object.assign(new Error("Open English WordNet config has an unsupported format or no source"), {
      code: "invalid-kwon-lookup-index"
    });
  }
  const directory = resolveSourcePath(root, config.source);
  let names;
  try {
    names = (await readdir(directory)).filter((name) => OPEN_WORDNET_JSON_FILE.test(name)).sort(compareText);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw Object.assign(new Error(`configured Open English WordNet source is unavailable: ${config.source}`), {
        code: "missing-english-wordnet-source",
        cause: error
      });
    }
    throw error;
  }
  if (names.length === 0) {
    throw Object.assign(new Error(`configured Open English WordNet source has no synset JSON files: ${config.source}`), {
      code: "missing-english-wordnet-source"
    });
  }
  const files = await Promise.all(names.map(async (name) => ({
    name,
    sourceId: relative(root, resolve(directory, name)).split(sep).join("/"),
    source: await readFile(resolve(directory, name))
  })));
  const datasetHash = hash(Buffer.from(files
    .map((file) => `${file.name}\u0000${file.source.toString("utf8")}`)
    .join("\u0000")));
  if (config["source-hash"] && config["source-hash"] !== datasetHash) {
    throw Object.assign(new Error("Open English WordNet source hash does not match its Pyash configuration"), {
      code: "stale-kwon-lookup-index",
      details: { expected: config["source-hash"], actual: datasetHash }
    });
  }
  return { config, directory, files };
}

export async function buildKwonLookupIndexes({ root = PYASH_REPOSITORY_ROOT, sourcePaths = SOURCE_PATHS } = {}) {
  const indexes = makeIndexes();
  const sourceHashes = {};
  const openWordNetSourceHashes = {};
  const pyaSources = sourcePaths.filter((path) => path.endsWith(".pya"));
  const jsonSources = sourcePaths.filter((path) => path.endsWith(".json"));
  const sourceIds = [...pyaSources, ...jsonSources];
  const sources = await Promise.all(sourceIds.map(async (sourceId) => [sourceId, await readFile(resolve(root, sourceId))]));
  const sourcesById = new Map(sources);
  for (const sourceId of pyaSources) {
    const source = sourcesById.get(sourceId);
    sourceHashes[sourceId] = hash(source);
    scanPyaLines(source, sourceId, indexes);
  }
  for (const sourceId of jsonSources) {
    const source = sourcesById.get(sourceId);
    sourceHashes[sourceId] = hash(source);
    scanJsonCatalog(source, sourceId, indexes);
  }
  if (sourcesById.has(OPEN_WORDNET_CONFIG_PATH)) {
    const configSource = sourcesById.get(OPEN_WORDNET_CONFIG_PATH);
    openWordNetSourceHashes[OPEN_WORDNET_CONFIG_PATH] = hash(configSource);
    const { files } = await configuredOpenWordNetFiles(root, configSource.toString("utf8"));
    for (const file of files) {
      openWordNetSourceHashes[file.sourceId] = hash(file.source);
      scanOpenWordNetJson(file.source, file.sourceId, indexes);
    }
  }
  return {
    english: createIndex("english", indexes.english, sourceHashes),
    pyac: createIndex("pyac", indexes.pyac, sourceHashes),
    wordnet: createIndex("wordnet", indexes.wordnet, sourceHashes),
    "open-wordnet": createIndex("open-wordnet", indexes["open-wordnet"], openWordNetSourceHashes)
  };
}

export async function writeKwonLookupIndexes({ root = PYASH_REPOSITORY_ROOT, paths = KWON_LOOKUP_INDEX_PATHS } = {}) {
  const indexes = await buildKwonLookupIndexes({ root });
  const temporaryPaths = [];
  try {
    for (const kind of KWON_LOOKUP_INDEX_KINDS) {
      const destination = paths[kind];
      await mkdir(dirname(destination), { recursive: true });
      const temporary = `${destination}.${process.pid}.tmp`;
      temporaryPaths.push(temporary);
      await writeFile(temporary, renderKwonLookupIndexPya(indexes[kind]), "utf8");
      await rename(temporary, destination);
    }
  } catch (error) {
    await Promise.all(temporaryPaths.map((path) => rm(path, { force: true })));
    throw error;
  }
  clearKwonLookupIndexValidationCache();
  return Object.fromEntries(KWON_LOOKUP_INDEX_KINDS.map((kind) => [kind, paths[kind]]));
}

export function clearKwonLookupIndexValidationCache() {
  sourceValidationPromises.clear();
  staleIndexWarnings.clear();
  sourceScanWarnings.clear();
  changedSourceIndexPromises.clear();
  pendingStaleCatalogs.clear();
  pendingScanFallbacks.clear();
}

export function createKwonLookupIndexForTest({ kind, sourceHashes = {}, entries = [] } = {}) {
  const indexed = new Map();
  for (const [key, values] of entries) indexed.set(key, values);
  return createIndex(kind, indexed, sourceHashes);
}

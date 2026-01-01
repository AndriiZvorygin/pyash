import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import YAML from "yaml";
import { buildProgram } from "../../program.mjs";
import { splitSentences } from "../../library/sentenceSplitter.mjs";
import { parseYamlToJsonValue } from "./yaml.mjs";
import { doRemember, remember } from "../../remember/index.mjs";
import { deriveSignatureFromDefinition, joinSignatureWords } from "../../bridge/signature.mjs";
import { clearModuleCache, loadModule, setEntryModulePath } from "../../bridge/modules.mjs";
import { vectorFormatHelper } from "./helpers_js.mjs";
import { TEXT_HELPER, VECTOR_PRINT_HELPER, VECTOR_TYPE_DECL, MAP_TYPE_DECL, MAP_HELPER, JSON_PYASH_HELPER, CSV_RUNTIME_HELPER, YAML_STRINGIFY_HELPER, YAML_RUNTIME_HELPER, EXCHANGE_HELPER, MIND_RUNTIME_HELPER, SPEAK_HELPER, COMMAND_HELPER } from "./helpers_c.mjs";
import { sentenceToPyash } from "../../beautiful.mjs";
import { throwErrorSentence } from "../../error.mjs";
import { jsonToPyashText, mapSentenceToPyash } from "./json_map.mjs";
import { parse as parseCsv } from "csv-parse/sync";

const CJSON_HEADER = fsSync.readFileSync(new URL("../../../caterer/cjson/cJSON.h", import.meta.url), "utf8");
const CJSON_SOURCE = fsSync.readFileSync(new URL("../../../caterer/cjson/cJSON.c", import.meta.url), "utf8")
  .replace(/#include\s+\"cJSON\.h\"\s*/g, "");
const CSV_PARSE_RUNTIME_URL = pathToFileURL(
  path.resolve(process.cwd(), "node_modules/csv-parse/dist/esm/sync.js")
).href;
const YAML_RUNTIME_URL = pathToFileURL(
  path.resolve(process.cwd(), "node_modules/yaml/dist/index.js")
).href;

function sanitizeName(name = "") {
  const cleaned = String(name)
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^([0-9])/, "_$1");
  // Avoid JS reserved words and special identifiers like "this"
  if (/^(?:this|function|return|class|default|const|let|var|if|for|while|switch|case|break|continue|do|new|try|catch|finally)$/.test(cleaned)) {
    return `_${cleaned}`;
  }
  return cleaned;
}

function markDeclared(declared, name) {
  if (!declared || !name) return;
  const clean = sanitizeName(name);
  declared.add(name);
  declared.add(clean);
}

function compareUtf8(a, b) {
  if (a === b) return 0;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  const len = Math.min(bufA.length, bufB.length);
  for (let i = 0; i < len; i += 1) {
    if (bufA[i] !== bufB[i]) return bufA[i] < bufB[i] ? -1 : 1;
  }
  return bufA.length < bufB.length ? -1 : 1;
}

function sentenceLineNumbersFromText(sourceText) {
  const sentences = splitSentences(sourceText);
  const lines = [];
  let searchIndex = 0;
  let fallbackLine = 1;
  for (const sentence of sentences) {
    const pos = sourceText.indexOf(sentence, searchIndex);
    if (pos === -1) {
      lines.push(fallbackLine);
      continue;
    }
    const line = sourceText.slice(0, pos).split("\n").length;
    lines.push(line);
    fallbackLine = line;
    searchIndex = pos + sentence.length;
  }
  return lines;
}

const SOURCE_MAP_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function encodeVlq(value) {
  let vlq = value < 0 ? ((-value) << 1) + 1 : (value << 1);
  let out = "";
  do {
    let digit = vlq & 31;
    vlq >>>= 5;
    if (vlq > 0) digit |= 32;
    out += SOURCE_MAP_CHARS[digit];
  } while (vlq > 0);
  return out;
}

function buildSourceMappings(lineMappings = []) {
  let prevSourceLine = 0;
  let mappings = "";
  for (let i = 0; i < lineMappings.length; i += 1) {
    if (i > 0) mappings += ";";
    const sourceLine = lineMappings[i];
    if (sourceLine == null) continue;
    const sourceLineZero = Math.max(0, Number(sourceLine) - 1);
    const seg = encodeVlq(0) + encodeVlq(0) + encodeVlq(sourceLineZero - prevSourceLine) + encodeVlq(0);
    mappings += seg;
    prevSourceLine = sourceLineZero;
  }
  return mappings;
}

function inlineSourceMap(code, { sourceName, sourceText } = {}) {
  const lines = String(code).split("\n");
  const output = [];
  const mappings = [];
  let currentSourceLine = null;
  for (const line of lines) {
    const match = line.match(/^\/\/ @pyash-line (\d+)\s*$/);
    if (match) {
      currentSourceLine = Number(match[1]) || null;
      continue;
    }
    output.push(line);
    mappings.push(currentSourceLine);
  }
  const map = {
    version: 3,
    file: sourceName ?? "",
    sources: [sourceName ?? "<pyash>"],
    sourcesContent: sourceText ? [sourceText] : [],
    names: [],
    mappings: buildSourceMappings(mappings)
  };
  const encoded = Buffer.from(JSON.stringify(map)).toString("base64");
  output.push(`//# sourceMappingURL=data:application/json;base64,${encoded}`);
  return output.join("\n");
}

function exchangeRuntimeHelper() {
  return [
    "const PYA_NEWSPAPER_PREFIX = \"PYA_NEWSPAPER:\";",
    "function pyaNewspaperEnabled() {",
    "  return typeof process !== \"undefined\" && process?.env?.PYA_NEWSPAPER === \"1\";",
    "}",
    "function pyaEmitNewspaper(line) {",
    "  if (!pyaNewspaperEnabled() || !line) return;",
    "  const payload = `${PYA_NEWSPAPER_PREFIX}${line}\\n`;",
    "  if (typeof process !== \"undefined\" && process.stdout && typeof process.stdout.write === \"function\") {",
    "    process.stdout.write(payload);",
    "  } else {",
    "    console.log(payload.trimEnd());",
    "  }",
    "}",
    "let pyaToolCounter = 0;",
    "function pyaNextToolEventId() {",
    "  pyaToolCounter += 1;",
    "  return String(pyaToolCounter).padStart(6, \"0\");",
    "}",
    "let pyaArtifactCounter = 0;",
    "const pyaArtifacts = new Map();",
    "const pyaArtifactHashes = new Map();",
    "function pyaExchangeEnabled() {",
    "  return pyaNewspaperEnabled();",
    "}",
    "function pyaNormalizeNewlines(text) {",
    "  return String(text ?? \"\").replace(/\\r\\n/g, \"\\n\").replace(/\\r/g, \"\\n\");",
    "}",
    "function pyaNormalizeLocator(locator) {",
    "  const text = String(locator ?? \"\");",
    "  if (/^[A-Za-z][A-Za-z0-9+.-]*:\\/\\//.test(text)) return text;",
    "  const runRoot = process.cwd();",
    "  const resolved = path.resolve(runRoot, text);",
    "  const relative = path.relative(runRoot, resolved);",
    "  if (relative.startsWith(\"..\") || path.isAbsolute(relative)) {",
    "    throw new Error(\"exchange defective\");",
    "  }",
    "  return relative.replace(/\\\\/g, \"/\");",
    "}",
    "function pyaEmitExchange(line) {",
    "  pyaEmitNewspaper(line);",
    "}",
    "function pyaRecordArtifact(locator, bytes, op) {",
    "  if (!pyaExchangeEnabled()) return null;",
    "  const normalized = pyaNormalizeLocator(locator);",
    "  const existing = pyaArtifacts.get(normalized);",
    "  const hash = crypto.createHash(\"sha256\").update(bytes).digest(\"hex\");",
    "  if (existing) {",
    "    const priorHash = pyaArtifactHashes.get(existing);",
    "    if (priorHash && priorHash !== hash) {",
    "      pyaEmitExchange(`su name hash inconsistency ob text \"hash inconsistency\" from name exchange be error ya`);",
    "      throw new Error(\"hash inconsistency\");",
    "    }",
    "    if (!priorHash) pyaArtifactHashes.set(existing, hash);",
    "    if (op) pyaEmitExchange(`su name ${existing} as name ${op} from name exchange be exchange ya`);",
    "    return existing;",
    "  }",
    "  const name = `artifact-${pyaArtifactCounter++}`;",
    "  pyaArtifacts.set(normalized, name);",
    "  pyaArtifactHashes.set(name, hash);",
    "  const size = bytes?.length ?? 0;",
    "  const locatorText = JSON.stringify(normalized);",
    "  pyaEmitExchange(`su name ${name} ob text ${locatorText} accordingto name sha256 fromtext text \"${hash}\" by num ${size} from name exchange be artifact ya`);",
    "  if (op) {",
    "    pyaEmitExchange(`su name ${name} as name ${op} from name exchange be exchange ya`);",
    "  }",
    "  return name;",
    "}",
    "function pyaReadTextFile(filename, op) {",
    "  const buf = fs.readFileSync(filename);",
    "  pyaRecordArtifact(filename, buf, op);",
    "  return buf.toString(\"utf8\");",
    "}",
    "function pyaWriteTextFile(filename, text, op) {",
    "  const normalized = pyaNormalizeNewlines(text);",
    "  fs.writeFileSync(filename, normalized);",
    "  const buf = Buffer.from(String(normalized ?? \"\"), \"utf8\");",
    "  pyaRecordArtifact(filename, buf, op);",
    "}"
  ].join("\n");
}

function newspaperRuntimeHelper() {
  return [
    "const PYA_NEWSPAPER_PREFIX = \"PYA_NEWSPAPER:\";",
    "function pyaNewspaperEnabled() {",
    "  return typeof process !== \"undefined\" && process?.env?.PYA_NEWSPAPER === \"1\";",
    "}",
    "function pyaEmitNewspaper(line) {",
    "  if (!pyaNewspaperEnabled() || !line) return;",
    "  const payload = `${PYA_NEWSPAPER_PREFIX}${line}\\n`;",
    "  if (typeof process !== \"undefined\" && process.stdout && typeof process.stdout.write === \"function\") {",
    "    process.stdout.write(payload);",
    "  } else {",
    "    console.log(payload.trimEnd());",
    "  }",
    "}",
    "let pyaToolCounter = 0;",
    "function pyaNextToolEventId() {",
    "  pyaToolCounter += 1;",
    "  return String(pyaToolCounter).padStart(6, \"0\");",
    "}"
  ].join("\n");
}

function jsonRuntimeHelper() {
  return [
    "function sanitizeNamePart(value) {",
    "  const raw = String(value ?? \"\").trim();",
    "  if (!raw) return \"item\";",
    "  const cleaned = raw.replace(/[^A-Za-z0-9_.-]+/g, \" \").replace(/\\s+/g, \" \").trim();",
    "  return cleaned || \"item\";",
    "}",
    "function uniqueName(base, used) {",
    "  if (!used.has(base)) { used.add(base); return base; }",
    "  let i = 2;",
    "  while (used.has(`${base} ${i}`)) i += 1;",
    "  const name = `${base} ${i}`;",
    "  used.add(name);",
    "  return name;",
    "}",
    "function vectorForScalarArray(values, type) {",
    "  if (type === \"bool\") return { ve: { type: \"bool\", values: values.map(v => (v ? \"truth\" : \"lie\")) } };",
    "  return { ve: { type, values } };",
    "}",
    "function jsonArrayToObj(values, { parentName, key, used, emitMap }) {",
    "  if (values.length === 0) return { ve: { type: \"hollow\", values: [] } };",
    "  const typeSet = new Set();",
    "  for (const value of values) {",
    "    if (value === null) typeSet.add(\"hollow\");",
    "    else if (Array.isArray(value)) typeSet.add(\"array\");",
    "    else if (typeof value === \"object\") typeSet.add(\"object\");",
    "    else if (typeof value === \"boolean\") typeSet.add(\"bool\");",
    "    else if (typeof value === \"number\") typeSet.add(\"num\");",
    "    else typeSet.add(\"text\");",
    "  }",
    "  if (typeSet.has(\"array\")) throw new Error(\"json map contents defective: nested arrays are unsupported\");",
    "  if (typeSet.has(\"hollow\")) throw new Error(\"json map contents defective: null elements are unsupported in arrays\");",
    "  if (typeSet.size > 1 && !(typeSet.size === 1 && typeSet.has(\"object\"))) {",
    "    throw new Error(\"json map contents defective: mixed array types are unsupported\");",
    "  }",
    "  if (typeSet.has(\"object\")) {",
    "    const names = values.map((value, idx) => {",
    "      const baseKey = sanitizeNamePart(key);",
    "      const base = `${parentName} ${baseKey} ${idx + 1}`;",
    "      const childName = uniqueName(base, used);",
    "      emitMap(value, childName);",
    "      return childName;",
    "    });",
    "    return { ve: { type: \"name\", values: names } };",
    "  }",
    "  if (typeSet.has(\"bool\")) return vectorForScalarArray(values, \"bool\");",
    "  if (typeSet.has(\"num\")) return vectorForScalarArray(values, \"num\");",
    "  return vectorForScalarArray(values, \"text\");",
    "}",
    "function jsonValueToObj(value, { parentName, key, used, emitMap }) {",
    "  if (value === null) return { hollow: true };",
    "  if (Array.isArray(value)) return jsonArrayToObj(value, { parentName, key, used, emitMap });",
    "  if (typeof value === \"string\") return { text: value };",
    "  if (typeof value === \"number\") return { num: value };",
    "  if (typeof value === \"boolean\") return { boolean: value };",
    "  if (typeof value === \"object\") {",
    "    const baseKey = sanitizeNamePart(key);",
    "    const base = `${parentName} ${baseKey}`;",
    "    const childName = uniqueName(base, used);",
    "    emitMap(value, childName);",
    "    return { name: childName };",
    "  }",
    "  return undefined;",
    "}",
    "function jsonToMapSentencesRuntime(value, rootName) {",
    "  const used = new Set();",
    "  const sentences = [];",
    "  const emitMap = (ob, name) => {",
    "    if (!ob || typeof ob !== \"object\" || Array.isArray(ob)) {",
    "      throw new Error(\"json map contents defective: object expected\");",
    "    }",
    "    const map = {};",
    "    const orderedKeys = Object.keys(ob).sort(compareUtf8);",
    "    for (const key of orderedKeys) {",
    "      const val = ob[key];",
    "      const objValue = jsonValueToObj(val, { parentName: name, key, used, emitMap });",
    "      if (objValue === undefined) continue;",
    "      map[key] = objValue;",
    "    }",
    "    sentences.push({ mood: \"ya\", su: { name }, be: \"json map\", ob: { map } });",
    "  };",
    "  const root = uniqueName(sanitizeNamePart(rootName), used);",
    "  emitMap(value, root);",
    "  return { rootName: root, sentences };",
    "}",
    "function jsonToPyashTextRuntime(value, rootName) {",
    "  const { sentences } = jsonToMapSentencesRuntime(value, rootName);",
    "  const blocks = sentences.map((sentence) => formatMapSentence(sentence.su?.name ?? \"map\", sentence));",
    "  return blocks.join(\"\\n\\n\") + \"\\n\";",
    "}",
    "function tokenizePyashLine(line) {",
    "  const tokens = [];",
    "  let i = 0;",
    "  while (i < line.length) {",
    "    while (i < line.length && /\\s/.test(line[i])) i += 1;",
    "    if (i >= line.length) break;",
    "    if (line[i] === '\"') {",
    "      i += 1;",
    "      let buf = \"\";",
    "      while (i < line.length && line[i] !== '\"') {",
    "        if (line[i] === '\\\\' && i + 1 < line.length) i += 1;",
    "        buf += line[i];",
    "        i += 1;",
    "      }",
    "      if (i < line.length && line[i] === '\"') i += 1;",
    "      tokens.push(buf);",
    "      continue;",
    "    }",
    "    let buf = \"\";",
    "    while (i < line.length && !/\\s/.test(line[i])) {",
    "      buf += line[i];",
    "      i += 1;",
    "    }",
    "    if (buf) tokens.push(buf);",
    "  }",
    "  return tokens;",
    "}",
    "function splitNameVectorTokens(tokens, knownNames) {",
    "  const names = [];",
    "  const maxWords = knownNames.maxWords || 1;",
    "  let i = 0;",
    "  while (i < tokens.length) {",
    "    let matched = null;",
    "    let matchedLen = 0;",
    "    for (let len = Math.min(maxWords, tokens.length - i); len >= 1; len -= 1) {",
    "      const candidate = tokens.slice(i, i + len).join(\" \");",
    "      if (knownNames.set.has(candidate)) {",
    "        matched = candidate;",
    "        matchedLen = len;",
    "        break;",
    "      }",
    "    }",
    "    if (matched) {",
    "      names.push(matched);",
    "      i += matchedLen;",
    "    } else {",
    "      names.push(tokens[i]);",
    "      i += 1;",
    "    }",
    "  }",
    "  return names;",
    "}",
    "function parsePyashValue(tokens, knownNames) {",
    "  if (!tokens.length) return undefined;",
    "  const [head, ...rest] = tokens;",
    "  if (head === \"num\") return { num: Number(rest[0] ?? 0) };",
    "  if (head === \"text\") return { text: rest[0] ?? \"\" };",
    "  if (head === \"bool\") return { boolean: rest[0] === \"truth\" };",
    "  if (head === \"hollow\") return { hollow: true };",
    "  if (head === \"unspecified\") return { unspecified: true };",
    "  if (head === \"name\") return { name: rest[0] ?? \"\" };",
    "  if (head === \"ve\" || head === \"vec\") {",
    "    let idx = 0;",
    "    let type = \"num\";",
    "    if ([\"num\", \"text\", \"bool\", \"name\", \"hollow\"].includes(rest[idx])) { type = rest[idx]; idx += 1; }",
    "    if (type === \"hollow\") return { ve: { type: \"hollow\", values: [] } };",
    "    const valueTokens = rest.slice(idx);",
    "    const values = (type === \"name\" && knownNames)",
    "      ? splitNameVectorTokens(valueTokens, knownNames)",
    "      : valueTokens.map((val) => {",
    "        if (type === \"num\") return Number(val ?? 0);",
    "        if (type === \"text\") return val ?? \"\";",
    "        if (type === \"bool\") return val === \"truth\";",
    "        if (type === \"name\") return val ?? \"\";",
    "        return val;",
    "      });",
    "    return { ve: { type, values } };",
    "  }",
    "  return undefined;",
    "}",
    "function parsePyashMapDefs(text) {",
    "  const maps = new Map();",
    "  const nameSet = new Set();",
    "  let maxWords = 1;",
    "  const lines = String(text ?? \"\").split(/\\n/);",
    "  for (const rawLine of lines) {",
    "    const line = rawLine.trim();",
    "    if (!line) continue;",
    "    const tokens = tokenizePyashLine(line);",
    "    if (!tokens.length) continue;",
    "    const mood = tokens[tokens.length - 1];",
    "    if (mood === \"def\" && tokens[0] === \"su\" && tokens[1] === \"name\") {",
    "      const beIdx = tokens.indexOf(\"be\");",
    "      if (beIdx > 2) {",
    "        const name = tokens.slice(2, beIdx).join(\" \");",
    "      nameSet.add(name);",
    "      const wordCount = name.split(\" \").length;",
    "      if (wordCount > maxWords) maxWords = wordCount;",
    "      }",
    "    }",
    "  }",
    "  const knownNames = { set: nameSet, maxWords };",
    "  let current = null;",
    "  for (const rawLine of lines) {",
    "    const line = rawLine.trim();",
    "    if (!line) continue;",
    "    const tokens = tokenizePyashLine(line);",
    "    if (!tokens.length) continue;",
    "    const mood = tokens[tokens.length - 1];",
    "    if (mood === \"def\" && tokens[0] === \"su\" && tokens[1] === \"name\") {",
    "      const beIdx = tokens.indexOf(\"be\");",
    "      const name = beIdx > 2 ? tokens.slice(2, beIdx).join(\" \") : tokens[2];",
    "      current = maps.get(name) ?? { name, entries: new Map() };",
    "      maps.set(name, current);",
    "      continue;",
    "    }",
    "    if (mood === \"prah\") {",
    "      current = null;",
    "      continue;",
    "    }",
    "    if (mood === \"ya\" && current && tokens[0] === \"su\" && tokens[1] === \"name\" && tokens[3] === \"ob\") {",
    "      const key = tokens[2];",
    "      const value = parsePyashValue(tokens.slice(4, -1), knownNames);",
    "      current.entries.set(key, value);",
    "    }",
    "  }",
    "  return maps;",
    "}",
    "function canonicalizeJsonValue(value) {",
    "  const encoder = typeof TextEncoder !== \"undefined\" ? new TextEncoder() : null;",
    "  const compareUtf8 = (a, b) => {",
    "    if (a === b) return 0;",
    "    const bufA = encoder ? encoder.encode(a) : Array.from(a, ch => ch.charCodeAt(0));",
    "    const bufB = encoder ? encoder.encode(b) : Array.from(b, ch => ch.charCodeAt(0));",
    "    const len = Math.min(bufA.length, bufB.length);",
    "    for (let i = 0; i < len; i += 1) {",
    "      if (bufA[i] !== bufB[i]) return bufA[i] < bufB[i] ? -1 : 1;",
    "    }",
    "    return bufA.length < bufB.length ? -1 : 1;",
    "  };",
    "  if (Array.isArray(value)) return value.map((item) => canonicalizeJsonValue(item));",
    "  if (value && typeof value === \"object\") {",
    "    const out = {};",
    "    const keys = Object.keys(value).sort(compareUtf8);",
    "    for (const key of keys) out[key] = canonicalizeJsonValue(value[key]);",
    "    return out;",
    "  }",
    "  return value;",
    "}",
    "function jsonFromPyashMap(name, maps, seen) {",
    "  if (seen.has(name)) throw new Error(\"json map export self referential\");",
    "  const map = maps.get(name);",
    "  if (!map) throw new Error(`json map referential defective: ${name}`);",
    "  seen.add(name);",
    "  const out = {};",
    "  for (const [key, value] of map.entries.entries()) {",
    "    if (!value || value.unspecified) continue;",
    "    let jsonValue;",
    "    if (value.hollow) jsonValue = null;",
    "    else if (value.text !== undefined) jsonValue = value.text;",
    "    else if (value.num !== undefined) jsonValue = value.num;",
    "    else if (value.boolean !== undefined) jsonValue = value.boolean;",
    "    else if (value.name) jsonValue = jsonFromPyashMap(value.name, maps, seen);",
    "    else if (value.ve) {",
    "      const type = value.ve.type || \"num\";",
    "      if (type === \"hollow\") jsonValue = [];",
    "      else if (type === \"name\") jsonValue = value.ve.values.map((child) => jsonFromPyashMap(child, maps, seen));",
    "      else if (type === \"bool\") jsonValue = value.ve.values.map((v) => v === \"truth\" || v === true || v === 1);",
    "      else jsonValue = value.ve.values;",
    "    } else if (value && Object.keys(value).length > 0) {",
    "      throw new Error(\"json map contents defective: unsupported contents\");",
    "    }",
    "    if (jsonValue !== undefined) out[key] = jsonValue;",
    "  }",
    "  seen.delete(name);",
    "  return out;",
    "}",
    "function pyashToJsonTextRuntime(text, rootName, mode = \"canonical\") {",
    "  const maps = parsePyashMapDefs(text);",
    "  const root = rootName || (maps.keys().next().value ?? \"data\");",
    "  const json = jsonFromPyashMap(root, maps, new Set());",
    "  if (mode === \"pretty\") return JSON.stringify(json, null, 2);",
    "  return JSON.stringify(canonicalizeJsonValue(json));",
    "}"
  ].join("\n");
}

function yamlRuntimeHelper() {
  return [
    "const YAML_JSON_NUMBER_RE = /^-?(?:0|[1-9]\\\\d*)(?:\\\\.\\\\d+)?(?:[eE][+-]?\\\\d+)?$/;",
    "function yamlScalarSource(node) {",
    "  if (!node) return \"\";",
    "  if (typeof node.source === \"string\") return node.source;",
    "  return String(node.value ?? \"\");",
    "}",
    "function yamlClassifyScalar(node) {",
    "  const isPlain = node?.type === \"PLAIN\";",
    "  if (typeof node?.value === \"number\") return { type: \"num\", value: node.value };",
    "  if (typeof node?.value === \"boolean\") return { type: \"bool\", value: node.value };",
    "  if (node?.value === null) return { type: \"hollow\", value: null };",
    "  const raw = String(yamlScalarSource(node) ?? \"\").trim();",
    "  if (!isPlain) return { type: \"text\", value: String(node?.value ?? \"\") };",
    "  if (raw === \"\" || raw === \"~\" || /^null$/i.test(raw)) return { type: \"hollow\", value: null };",
    "  if (/^(true|false)$/i.test(raw)) return { type: \"bool\", value: /^true$/i.test(raw) };",
    "  if (YAML_JSON_NUMBER_RE.test(raw)) return { type: \"num\", value: Number(raw) };",
    "  return { type: \"text\", value: raw };",
    "}",
    "function yamlKeyText(node) {",
    "  if (!YAML.isScalar(node)) throw new Error(\"yaml key defective\");",
    "  const isPlain = node?.type === \"PLAIN\";",
    "  const raw = String(yamlScalarSource(node) ?? \"\").trim();",
    "  let key;",
    "  if (!isPlain) key = String(node?.value ?? \"\");",
    "  else if (raw === \"\" || raw === \"~\" || /^null$/i.test(raw)) key = \"null\";",
    "  else if (/^(true|false)$/i.test(raw)) key = /^true$/i.test(raw) ? \"true\" : \"false\";",
    "  else if (YAML_JSON_NUMBER_RE.test(raw)) key = raw;",
    "  else key = raw;",
    "  if (!String(key ?? \"\").trim()) throw new Error(\"yaml key defective\");",
    "  return key;",
    "}",
    "function yamlClone(value) {",
    "  if (Array.isArray(value)) return value.map((item) => yamlClone(item));",
    "  if (value && typeof value === \"object\") {",
    "    const out = {};",
    "    for (const [key, val] of Object.entries(value)) out[key] = yamlClone(val);",
    "    return out;",
    "  }",
    "  return value;",
    "}",
    "function yamlCollectAnchors(node, anchors) {",
    "  if (!node || typeof node !== \"object\") return;",
    "  if (node.anchor) anchors.set(node.anchor, node);",
    "  if (YAML.isMap(node)) {",
    "    for (const pair of node.items) {",
    "      yamlCollectAnchors(pair.key, anchors);",
    "      yamlCollectAnchors(pair.value, anchors);",
    "    }",
    "    return;",
    "  }",
    "  if (YAML.isSeq(node)) {",
    "    for (const item of node.items) yamlCollectAnchors(item, anchors);",
    "  }",
    "}",
    "function yamlResolveAlias(node, ctx) {",
    "  const aliasName = String(node?.source ?? \"\").trim();",
    "  if (!aliasName) throw new Error(\"yaml referential defective\");",
    "  const target = ctx.anchors.get(aliasName);",
    "  if (!target) throw new Error(\"yaml referential defective\");",
    "  if (ctx.resolving.has(aliasName)) throw new Error(\"yaml referential defective\");",
    "  ctx.resolving.add(aliasName);",
    "  const value = yamlNodeToJson(target, ctx);",
    "  ctx.resolving.delete(aliasName);",
    "  return yamlClone(value);",
    "}",
    "function yamlMergeInto(target, source) {",
    "  if (!source || typeof source !== \"object\" || Array.isArray(source)) {",
    "    throw new Error(\"yaml defective\");",
    "  }",
    "  for (const [key, value] of Object.entries(source)) {",
    "    if (!(key in target)) target[key] = value;",
    "  }",
    "}",
    "function yamlMapToJson(node, ctx) {",
    "  const out = {};",
    "  for (const pair of node.items) {",
    "    const keyText = yamlKeyText(pair.key);",
    "    if (keyText === \"<<\") {",
    "      const mergeValue = yamlNodeToJson(pair.value, ctx);",
    "      if (Array.isArray(mergeValue)) {",
    "        for (const entry of mergeValue) yamlMergeInto(out, entry);",
    "      } else {",
    "        yamlMergeInto(out, mergeValue);",
    "      }",
    "      continue;",
    "    }",
    "    const value = yamlNodeToJson(pair.value, ctx);",
    "    out[keyText] = value;",
    "  }",
    "  return out;",
    "}",
    "function yamlSeqToJson(node, ctx) {",
    "  const out = [];",
    "  for (const item of node.items) out.push(yamlNodeToJson(item, ctx));",
    "  return out;",
    "}",
    "function yamlNodeToJson(node, ctx) {",
    "  if (!node) return null;",
    "  if (node?.tag) throw new Error(\"yaml defective\");",
    "  if (node?.constructor?.name === \"Alias\") return yamlResolveAlias(node, ctx);",
    "  if (YAML.isMap(node)) return yamlMapToJson(node, ctx);",
    "  if (YAML.isSeq(node)) return yamlSeqToJson(node, ctx);",
    "  if (YAML.isScalar(node)) {",
    "    const classified = yamlClassifyScalar(node);",
    "    if (classified.type === \"hollow\") return null;",
    "    if (classified.type === \"bool\") return Boolean(classified.value);",
    "    if (classified.type === \"num\") return Number(classified.value);",
    "    return String(classified.value ?? \"\");",
    "  }",
    "  throw new Error(\"yaml defective\");",
    "}",
    "function yamlToJsonValue(text) {",
    "  const docs = YAML.parseAllDocuments(String(text ?? \"\"), { keepNodeTypes: true });",
    "  if (!docs || docs.length === 0 || docs.length !== 1) throw new Error(\"yaml defective\");",
    "  const doc = docs[0];",
    "  if (doc?.errors?.length) throw new Error(\"yaml defective\");",
    "  const root = doc.contents;",
    "  if (!YAML.isMap(root)) throw new Error(\"yaml root defective\");",
    "  const anchors = new Map();",
    "  yamlCollectAnchors(root, anchors);",
    "  const ctx = { anchors, resolving: new Set() };",
    "  const value = yamlNodeToJson(root, ctx);",
    "  if (!value || typeof value !== \"object\" || Array.isArray(value)) throw new Error(\"yaml root defective\");",
    "  return canonicalizeJsonValue(value);",
    "}",
    "function yamlToPyashTextRuntime(text, rootName) {",
    "  const json = yamlToJsonValue(text);",
    "  return jsonToPyashTextRuntime(json, rootName);",
    "}"
  ].join("\n");
}

function yamlStringifyHelper() {
  return [
    "function yamlCompareUtf8(a, b) {",
    "  if (a === b) return 0;",
    "  const encoder = typeof TextEncoder !== \"undefined\" ? new TextEncoder() : null;",
    "  const bufA = encoder ? encoder.encode(a) : Array.from(a, ch => ch.charCodeAt(0));",
    "  const bufB = encoder ? encoder.encode(b) : Array.from(b, ch => ch.charCodeAt(0));",
    "  const len = Math.min(bufA.length, bufB.length);",
    "  for (let i = 0; i < len; i += 1) {",
    "    if (bufA[i] !== bufB[i]) return bufA[i] < bufB[i] ? -1 : 1;",
    "  }",
    "  return bufA.length < bufB.length ? -1 : 1;",
    "}",
    "function yamlCanonicalize(value) {",
    "  if (Array.isArray(value)) return value.map((item) => yamlCanonicalize(item));",
    "  if (value && typeof value === \"object\") {",
    "    const out = {};",
    "    const keys = Object.keys(value).sort(yamlCompareUtf8);",
    "    for (const key of keys) out[key] = yamlCanonicalize(value[key]);",
    "    return out;",
    "  }",
    "  return value;",
    "}",
    "function yamlEmit(value, indent, out) {",
    "  if (value === null) { out.push(\"null\"); return; }",
    "  if (typeof value === \"boolean\") { out.push(value ? \"true\" : \"false\"); return; }",
    "  if (typeof value === \"number\") { out.push(String(value)); return; }",
    "  if (typeof value === \"string\") { out.push(JSON.stringify(value)); return; }",
    "  if (Array.isArray(value)) {",
    "    if (indent > 0) out.push(\"\\n\");",
    "    for (const item of value) {",
    "      out.push(\" \".repeat(indent));",
    "      out.push(\"- \");",
    "      yamlEmit(item, indent + 2, out);",
    "      out.push(\"\\n\");",
    "    }",
    "    return;",
    "  }",
    "  if (value && typeof value === \"object\") {",
    "    if (indent > 0) out.push(\"\\n\");",
    "    for (const key of Object.keys(value)) {",
    "      out.push(\" \".repeat(indent));",
    "      out.push(JSON.stringify(String(key ?? \"\")));",
    "      out.push(\": \");",
    "      yamlEmit(value[key], indent + 2, out);",
    "      out.push(\"\\n\");",
    "    }",
    "    return;",
    "  }",
    "  out.push(\"null\");",
    "}",
    "function yamlStringifyRuntime(value) {",
    "  const json = yamlCanonicalize(value ?? {});",
    "  const out = [];",
    "  yamlEmit(json, 0, out);",
    "  return out.join(\"\");",
    "}"
  ].join("\n");
}

function csvRuntimeHelper() {
  return [
    "function parseCsvTextRuntime(text) {",
    "  const rows = parseCsv(String(text ?? \"\"), { relax_column_count: true, relax_quotes: false, skip_empty_lines: false });",
    "  const firstCellText = (row) => String(row?.[0] ?? \"\").trim();",
    "  const firstCellLower = (row) => firstCellText(row).toLowerCase();",
    "  const nonEmptyRowIndex = rows.findIndex((row) => Array.isArray(row) && row.some((cell) => String(cell ?? \"\").trim() !== \"\"));",
    "  if (nonEmptyRowIndex < 0) throw new Error(\"csv header defective\");",
    "  const isTemplate = firstCellText(rows[0]) === \"Data Import Template\";",
    "  let headerRowIndex = -1;",
    "  if (isTemplate) {",
    "    headerRowIndex = rows.findIndex((row) => firstCellText(row) === \"Column Name:\");",
    "    if (headerRowIndex < 0) throw new Error(\"csv header defective\");",
    "  } else {",
    "    const nonEmptyRows = rows.filter((row) => Array.isArray(row) && row.some((cell) => String(cell ?? \"\").trim() !== \"\"));",
    "    const tail = nonEmptyRows.slice(-20);",
    "    const counts = new Map();",
    "    for (const row of tail) {",
    "      const width = Array.isArray(row) ? row.length : 0;",
    "      if (width <= 0) continue;",
    "      counts.set(width, (counts.get(width) ?? 0) + 1);",
    "    }",
    "    let widthMode = 0;",
    "    let bestCount = -1;",
    "    for (const [width, count] of counts.entries()) {",
    "      if (count > bestCount || (count === bestCount && width > widthMode)) {",
    "        widthMode = width;",
    "        bestCount = count;",
    "      }",
    "    }",
    "    const headerLike = (row) => {",
    "      const cells = Array.isArray(row) ? row : [];",
    "      if (cells.length !== widthMode) return false;",
    "      let hasAlpha = false;",
    "      for (const cell of cells) {",
    "        const text = String(cell ?? \"\").trim();",
    "        if (!text) return false;",
    "        if (/[A-Za-z]/.test(text)) hasAlpha = true;",
    "        if (/^\\d+(\\.\\d+)?$/.test(text)) return false;",
    "      }",
    "      return hasAlpha;",
    "    };",
    "    headerRowIndex = rows.findIndex((row) => headerLike(row));",
    "    if (headerRowIndex < 0) {",
    "      headerRowIndex = rows.findIndex((row) => Array.isArray(row) && row.length === widthMode);",
    "    }",
    "  }",
    "  if (headerRowIndex < 0) headerRowIndex = nonEmptyRowIndex;",
    "  const headerRow = rows[headerRowIndex] || [];",
    "  const headerRaw = isTemplate ? headerRow.slice(1) : headerRow;",
    "  const dropIndices = new Set();",
    "  if (isTemplate) {",
    "    headerRaw.forEach((cell, idx) => {",
    "      const raw = String(cell ?? \"\").trim();",
    "      if (raw === \"\" || raw === \"~\") dropIndices.add(idx);",
    "    });",
    "  }",
    "  const filteredHeader = headerRaw.filter((_, idx) => !dropIndices.has(idx));",
    "  let canonical = isTemplate",
    "    ? filteredHeader.map((cell) => String(cell ?? \"\"))",
    "    : filteredHeader.map((cell) => String(cell ?? \"\").replace(/\\s+/g, \" \").trim().toLowerCase());",
    "  if (isTemplate) {",
    "    const counts = new Map();",
    "    canonical = canonical.map((key) => {",
    "      const base = String(key ?? \"\");",
    "      if (!base.trim()) return key;",
    "      const count = counts.get(base) ?? 0;",
    "      counts.set(base, count + 1);",
    "      if (count === 0) return base;",
    "      return `${base} ${count + 1}`;",
    "    });",
    "  }",
    "  const seen = new Set();",
    "  for (let i = 0; i < canonical.length; i += 1) {",
    "    const key = canonical[i];",
    "    const trimmedKey = String(key ?? \"\").trim();",
    "    if (!trimmedKey) throw new Error(\"csv header defective\");",
    "    if (!isTemplate && seen.has(key)) throw new Error(`csv header defective: duplicate header key ${key}`);",
    "    seen.add(key);",
    "  }",
    "  const width = canonical.length;",
    "  if (width === 0) throw new Error(\"csv header defective\");",
    "  const columns = canonical.map(() => []);",
    "  const metaLabels = new Set([\"column name:\",\"mandatory:\",\"type:\",\"info:\",\"doctype:\",\"column labels:\",\"start entering data below this line\"]);",
    "  let dataStart = headerRowIndex + 1;",
    "  if (isTemplate) {",
    "    const startIndex = rows.findIndex((row, idx) => idx > headerRowIndex && firstCellLower(row) === \"start entering data below this line\");",
    "    if (startIndex >= 0) dataStart = startIndex + 1;",
    "  }",
    "  for (let r = dataStart; r < rows.length; r += 1) {",
    "    const rowCells = rows[r] || [];",
    "    const firstLower = firstCellLower(rowCells);",
    "    if (isTemplate && metaLabels.has(firstLower)) continue;",
    "    if (isTemplate && rowCells.every((cell) => String(cell ?? \"\").trim() === \"\")) continue;",
    "    const dataCells = (isTemplate ? rowCells.slice(1) : rowCells).filter((_, idx) => !dropIndices.has(idx));",
    "    if (dataCells.length > width) throw new Error(\"csv row defective\");",
    "    while (dataCells.length < width) dataCells.push(\"\");",
    "    for (let c = 0; c < width; c += 1) {",
    "      columns[c].push(String(dataCells[c] ?? \"\"));",
    "    }",
    "  }",
    "  return { headerRaw: filteredHeader, header: canonical, columns };",
    "}",
    "function csvParseAdapter(text) {",
    "  return parseCsvTextRuntime(text);",
    "}",
    "function csvMapFromTextRuntime(text, targetName) {",
    "  const normalized = String(text ?? \"\").replace(/\\\\r\\\\n/g, \"\\r\\n\").replace(/\\\\n/g, \"\\n\").replace(/\\\\r/g, \"\\r\");",
    "  const parsed = csvParseAdapter(normalized);",
    "  const map = {",
    "    \"header raw\": { ve: { type: \"text\", values: parsed.headerRaw } },",
    "    header: { ve: { type: \"text\", values: parsed.header } }",
    "  };",
    "  parsed.header.forEach((key, idx) => {",
    "    map[key] = { ve: { type: \"text\", values: parsed.columns[idx] } };",
    "  });",
    "  return { mood: \"ya\", su: { name: targetName }, be: \"csv map\", ob: { map } };",
    "}"
  ].join("\n");
}

function canonicalizeJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeJsonValue(item));
  }
  if (value && typeof value === "object") {
    const out = {};
    const keys = Object.keys(value).sort(compareUtf8);
    for (const key of keys) {
      out[key] = canonicalizeJsonValue(value[key]);
    }
    return out;
  }
  return value;
}

function canonicalJsonStringify(value) {
  return JSON.stringify(canonicalizeJsonValue(value));
}

function parseCsvText(text, { source }) {
  const rows = parseCsv(text, {
    relax_column_count: true,
    relax_quotes: false,
    skip_empty_lines: false
  });

  const firstCellText = (row) => String(row?.[0] ?? "").trim();
  const firstCellLower = (row) => firstCellText(row).toLowerCase();
  const nonEmptyRowIndex = rows.findIndex((row) =>
    Array.isArray(row) && row.some((cell) => String(cell ?? "").trim() !== "")
  );
  if (nonEmptyRowIndex < 0) {
    throwErrorSentence({
      name: "csv header defective",
      message: "csv header defective",
      from: { name: source },
      raw: { rows: rows.length, line: 1, column: 1 }
    });
  }

  const isTemplate = firstCellText(rows[0]) === "Data Import Template";
  let headerRowIndex = -1;
  if (isTemplate) {
    headerRowIndex = rows.findIndex((row) => firstCellText(row) === "Column Name:");
    if (headerRowIndex < 0) {
      throwErrorSentence({
        name: "csv header defective",
        message: "csv header defective",
        from: { name: source },
        raw: { line: 1, column: 1 }
      });
    }
  } else {
    const nonEmptyRows = rows.filter((row) =>
      Array.isArray(row) && row.some((cell) => String(cell ?? "").trim() !== "")
    );
    const tail = nonEmptyRows.slice(-20);
    const counts = new Map();
    for (const row of tail) {
      const width = Array.isArray(row) ? row.length : 0;
      if (width <= 0) continue;
      counts.set(width, (counts.get(width) ?? 0) + 1);
    }
    let widthMode = 0;
    let bestCount = -1;
    for (const [width, count] of counts.entries()) {
      if (count > bestCount || (count === bestCount && width > widthMode)) {
        widthMode = width;
        bestCount = count;
      }
    }
    const headerLike = (row) => {
      const cells = Array.isArray(row) ? row : [];
      if (cells.length !== widthMode) return false;
      let hasAlpha = false;
      for (const cell of cells) {
        const text = String(cell ?? "").trim();
        if (!text) return false;
        if (/[A-Za-z]/.test(text)) hasAlpha = true;
        if (/^\d+(\.\d+)?$/.test(text)) return false;
      }
      return hasAlpha;
    };
    headerRowIndex = rows.findIndex((row) => headerLike(row));
    if (headerRowIndex < 0) {
      headerRowIndex = rows.findIndex((row) =>
        Array.isArray(row) && row.length === widthMode
      );
    }
  }

  if (headerRowIndex < 0) headerRowIndex = nonEmptyRowIndex;

  const headerRow = rows[headerRowIndex] || [];
  const headerRaw = isTemplate ? headerRow.slice(1) : headerRow;
  const dropIndices = new Set();
  if (isTemplate) {
    headerRaw.forEach((cell, idx) => {
      const raw = String(cell ?? "").trim();
      if (raw === "" || raw === "~") dropIndices.add(idx);
    });
  }
  const filteredHeader = headerRaw.filter((_, idx) => !dropIndices.has(idx));
  let canonical = isTemplate
    ? filteredHeader.map((cell) => String(cell ?? ""))
    : filteredHeader.map((cell) =>
      String(cell ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase()
    );
  if (isTemplate) {
    const counts = new Map();
    canonical = canonical.map((key) => {
      const base = String(key ?? "");
      if (!base.trim()) return key;
      const count = counts.get(base) ?? 0;
      counts.set(base, count + 1);
      if (count === 0) return base;
      return `${base} ${count + 1}`;
    });
  }

  const seen = new Set();
  const headerColumnOffset = isTemplate ? 2 : 1;
  const filteredIndexMap = headerRaw
    .map((_, idx) => idx)
    .filter((idx) => !dropIndices.has(idx));
  for (let i = 0; i < canonical.length; i += 1) {
    const key = canonical[i];
    const trimmedKey = String(key ?? "").trim();
    if (!trimmedKey) {
      throwErrorSentence({
        name: "csv header defective",
        message: "csv header defective",
        from: { name: source },
        raw: { key, line: headerRowIndex + 1, column: filteredIndexMap[i] + headerColumnOffset }
      });
    }
    if (!isTemplate && seen.has(key)) {
      throwErrorSentence({
        name: "csv header defective",
        message: `csv header defective: duplicate header key ${key}`,
        from: { name: source },
        raw: { key, line: headerRowIndex + 1, column: filteredIndexMap[i] + headerColumnOffset }
      });
    }
    seen.add(key);
  }

  const width = canonical.length;
  if (width === 0) {
    throwErrorSentence({
      name: "csv header defective",
      message: "csv header defective",
      from: { name: source },
      raw: { line: headerRowIndex + 1, column: headerColumnOffset }
    });
  }
  const columns = canonical.map(() => []);
  const metaLabels = new Set([
    "column name:",
    "mandatory:",
    "type:",
    "info:",
    "doctype:",
    "column labels:",
    "start entering data below this line"
  ]);
  let dataStart = headerRowIndex + 1;
  if (isTemplate) {
    const startIndex = rows.findIndex(
      (row, idx) => idx > headerRowIndex && firstCellLower(row) === "start entering data below this line"
    );
    if (startIndex >= 0) dataStart = startIndex + 1;
  }
  for (let r = dataStart; r < rows.length; r += 1) {
    const rowCells = rows[r] || [];
    const firstLower = firstCellLower(rowCells);
    if (isTemplate && (metaLabels.has(firstLower))) continue;
    if (isTemplate && rowCells.every((cell) => String(cell ?? "").trim() === "")) continue;
    const dataCells = (isTemplate ? rowCells.slice(1) : rowCells).filter(
      (_, idx) => !dropIndices.has(idx)
    );
    if (dataCells.length > width) {
      throwErrorSentence({
        name: "csv row defective",
        message: "csv row defective",
        from: { name: source },
        raw: { row: r, line: r + 1, column: dataCells.length + (isTemplate ? 1 : 0) }
      });
    }
    while (dataCells.length < width) dataCells.push("");
    for (let c = 0; c < width; c += 1) {
      columns[c].push(String(dataCells[c] ?? ""));
    }
  }

  return { headerRaw: filteredHeader, header: canonical, columns };
}

function csvEscape(value) {
  const str = String(value ?? "");
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, "\"\"")}"`;
  }
  return str;
}

function csvTextFromMapSentence(mapSentence) {
  const entries = mapSentence?.ob?.map ?? {};
  const headerRaw = entries["header raw"]?.ve?.values;
  const header = entries.header?.ve?.values;
  let headers = Array.isArray(headerRaw) ? headerRaw : header;
  if (Array.isArray(headerRaw)) {
    const seen = new Set();
    let defective = false;
    for (const cell of headerRaw) {
      const key = String(cell ?? "").replace(/\\s+/g, " ").trim().toLowerCase();
      if (!key || seen.has(key)) {
        defective = true;
        break;
      }
      seen.add(key);
    }
    if (defective) headers = header;
  }
  if (!Array.isArray(headers) || headers.length === 0 || !Array.isArray(header)) {
    throwErrorSentence({
      name: "csv columns defective",
      message: "csv columns defective",
      from: { name: "compile csv" },
      raw: { name: mapSentence?.su?.name }
    });
  }

  const columns = header.map((key) => {
    const col = entries[key];
    if (!col?.ve?.values || col.ve.type !== "text") {
      throwErrorSentence({
        name: "csv columns defective",
        message: "csv columns defective",
        from: { name: "compile csv" },
        raw: { name: mapSentence?.su?.name, key }
      });
    }
    return col.ve.values.map((v) => String(v ?? ""));
  });

  const length = columns[0]?.length ?? 0;
  for (const col of columns) {
    if (col.length !== length) {
      throwErrorSentence({
        name: "csv columns defective",
        message: "csv columns defective",
        from: { name: "compile csv" },
        raw: { name: mapSentence?.su?.name }
      });
    }
  }

  const lines = [];
  lines.push(headers.map(csvEscape).join(","));
  for (let i = 0; i < length; i += 1) {
    const row = columns.map((col) => csvEscape(col[i] ?? ""));
    lines.push(row.join(","));
  }
  return lines.join("\n") + "\n";
}

function normalizeJsonMapError(err) {
  const message = err?.message ?? String(err ?? "");
  if (message.startsWith("json map contents defective")) {
    return { name: "json map contents defective", message };
  }
  if (message.startsWith("json map referential defective")) {
    return { name: "json map referential defective", message };
  }
  if (message.startsWith("json map export self referential")) {
    return { name: "json map export self referential", message };
  }
  return { name: "json map export failed", message };
}

function mapValueToJson(value, mapDefs, seen) {
  if (!value || typeof value !== "object") return undefined;
  if (Object.keys(value).length === 0) return undefined;
  if (value.unspecified) return undefined;
  if (value.hollow) return null;
  if (value.text !== undefined) return value.text;
  if (value.num !== undefined) return value.num;
  if (value.boolean !== undefined) return value.boolean;
  if (value.ve) {
    const type = value.ve.type || "num";
    if (type === "hollow") return [];
    if (type === "name") {
      return (value.ve.values || []).map((name) => jsonFromMapName(name, mapDefs, seen));
    }
    if (type === "bool" || type === "boolean") {
      return (value.ve.values || []).map((v) => v === "truth" || v === true || v === 1);
    }
    if (type === "num" || type === "number" || type === "text") {
      return value.ve.values || [];
    }
    throw new Error(`json map contents defective: unsupported vector type ${type}`);
  }
  if (value.name) return jsonFromMapName(value.name, mapDefs, seen);
  throw new Error("json map contents defective: unsupported contents");
}

function jsonFromMapName(name, mapDefs, seen) {
  const mapSentence = mapDefs.get(name);
  if (!mapSentence || mapSentence.be !== "json map") {
    throw new Error(`json map referential defective: ${name}`);
  }
  return jsonFromMapSentence(mapSentence, mapDefs, seen);
}

function jsonFromMapSentence(mapSentence, mapDefs, seen) {
  const mapName = mapSentence?.su?.name ?? "<map>";
  if (seen.has(mapName)) {
    throw new Error("json map export self referential");
  }
  seen.add(mapName);
  const entries = mapSentence?.ob?.map ?? {};
  const out = {};
  for (const [key, value] of Object.entries(entries)) {
    const jsonValue = mapValueToJson(value, mapDefs, seen);
    if (jsonValue === undefined) continue;
    out[key] = jsonValue;
  }
  seen.delete(mapName);
  return out;
}

function mapDefChainFromName(name, mapDefs) {
  const visited = new Set();
  const defs = [];

  const visit = (mapName) => {
    if (!mapName || visited.has(mapName)) return;
    visited.add(mapName);
    const fact = mapDefs.get(mapName);
    if (!fact || (fact.be !== "json map" && fact.be !== "map" && fact.be !== "csv map")) return;
    const entries = fact?.ob?.map ?? {};
    for (const value of Object.values(entries)) {
      if (value?.name) visit(value.name);
      if (value?.ve?.type === "name") {
        for (const child of value.ve.values || []) {
          if (typeof child === "string") visit(child);
        }
      }
    }
    defs.push(fact);
  };

  visit(name);
  if (defs.length === 0) return "";
  return defs.map(mapSentenceToPyash).join("\n\n");
}

function exprForSlot(slot = {}, { sentenceArg, locals, declared, defaultExpr, field = "num" } = {}) {
  if (!slot) return defaultExpr ?? null;

  if (slot.genitive) {
    const path = pathFromGenitive(slot.genitive, sentenceArg, { locals, declared, allowCGlobals: true });
    if (path) return path;
  }

  if (slot.thisRef && sentenceArg) {
    return valueForRole(slot.thisRef, sentenceArg, field, slot);
  }

  if (slot.at && slot.name) {
    const baseName = sanitizeName(slot.name);
    const vecRef = locals?.has(baseName) || declared?.has(baseName) ? baseName : JSON.stringify(slot.name);
    const idxVal = Number(slot.at.num ?? slot.at);
    const idxExpr = Number.isNaN(idxVal) ? (slot.at?.num ?? slot.at ?? 0) : idxVal;
    return `${vecRef}.ob?.ve?.values?.[${idxExpr}]`;
  }

  if (field === "text" && typeof slot.wo === "string") {
    return JSON.stringify(slot.wo);
  }

  if (field === "text" && typeof slot.text === "string") {
    return JSON.stringify(slot.text);
  }

  if (slot[field] !== undefined) {
    const n = Number(slot[field]);
    return Number.isNaN(n) ? 0 : n;
  }

  if (typeof slot.text === "string") {
    return JSON.stringify(slot.text);
  }

  if (slot.name) {
    const name = sanitizeName(slot.name);
    if (locals?.has(name)) {
      if (field === "text") return `${name}.ob?.text`;
      if (field === "name") return `${name}.ob?.name`;
      if (field === "num") return `${name}.ob?.num ?? ${name}`;
      return `${name}.ob?.${field} ?? ${name}`;
    }
    if (declared?.has(name)) {
      if (field === "text") return `${name}.ob?.text`;
      if (field === "name") return `${name}.ob?.name`;
      return `${name}.ob?.${field}`;
    }
    return name;
  }

  return defaultExpr ?? null;
}

function lvalueForName(name, { declared, locals, field = "num" } = {}) {
  const clean = sanitizeName(name);
  if (locals?.has(clean)) return clean;
  if (declared?.has(clean)) return `${clean}.ob.${field}`;
  return clean;
}

function vectorValuesExpr(slot = {}, { sentenceArg, locals, declared } = {}) {
  if (!slot) return "[]";
  if (slot.ve?.values) {
    const vals = slot.ve.values.map(v =>
      typeof v === "number" ? v : JSON.stringify(v)
    );
    return `[${vals.join(", ")}]`;
  }
  if (slot.genitive) {
    const path = pathFromGenitive(slot.genitive, sentenceArg, { locals, declared, allowCGlobals: true });
    if (path) return `${path}?.ve?.values ?? []`;
  }
  if (slot.name) {
    const name = sanitizeName(slot.name);
    if (locals?.has(name) || declared?.has(name)) {
      return `${name}?.ob?.ve?.values ?? ${name}?.ve?.values ?? []`;
    }
    return "[]";
  }
  return "[]";
}

function pathFromGenitive(genitive = [], sentenceArg, { locals, declared, localsTypes, declaredTypes, allowCGlobals = false } = {}) {
  const chainArr = Array.isArray(genitive) ? genitive : genitive?.chain;
  if (!chainArr || chainArr.length === 0) return null;
  if (!sentenceArg) {
    if (!allowCGlobals) return null;
    // C ceremonies/loops currently use global loop registers instead of passing a sentence object.
    // Allow the common loop-register genitives (this/fromindex/etc) to resolve to those globals.
    // Supported: `this ti fromindex`, `fromindex num of this`, etc.
    const rootName = typeof chainArr[0] === "string" ? sanitizeName(chainArr[0]) : null;
    if (rootName && (locals?.has(rootName) || declared?.has(rootName))) {
      const rest = chainArr.slice(1);
      if (rest.length === 0) return rootName;
      if (rest.length === 1 && rest[0] === "num") return rootName;
      if (rest.length === 2 && rest[0] === "ob" && (rest[1] === "num" || rest[1] === "text" || rest[1] === "boolean")) return rootName;
      return [rootName, ...rest.map(part => `.${part}`)].join("");
    }
    const isThisPrefix = chainArr[0] === "this";
    const isThisSuffix = chainArr[chainArr.length - 1] === "this";
    const parts = isThisPrefix ? chainArr.slice(1) : (isThisSuffix ? chainArr.slice(0, -1) : null);
    if (parts && parts.length) {
      const head = parts[0];
      if (parts.length === 2 && parts[0] === "ob") {
        if (parts[1] === "text") return "pya_ob_text";
        if (parts[1] === "num") return "pya_ob_num";
        if (parts[1] === "boolean") return "pya_ob_bool";
      }
      if (head === "by") {
        if (parts.length === 1) return "by";
        if (parts.length === 2 && parts[1] === "num") return "by";
        if (parts.length === 3 && parts[1] === "ob" && parts[2] === "num") return "by";
      }
      if (head === "from") {
        if (parts.length === 1) return "pya_from_num";
        if (parts.length === 2 && parts[1] === "num") return "pya_from_num";
        if (parts.length === 3 && parts[1] === "ob" && parts[2] === "num") return "pya_from_num";
      }
      if (parts.length === 1 && ["fromindex", "toindex", "atindex"].includes(head)) return head;
      if (parts.length === 2 && parts[1] === "num" && ["fromindex", "toindex", "atindex"].includes(head)) return head;
    }
    return null;
  }
  const isLocalRoot = chainArr[0] !== "this" && typeof chainArr[0] === "string" && (locals?.has(sanitizeName(chainArr[0])) || declared?.has(sanitizeName(chainArr[0])));
  const chain = chainArr[0] === "this" ? chainArr.slice(1) : chainArr;
  if (chain.length === 0) return sentenceArg;
  if (chain.length === 0) return sentenceArg;
  if (chain.length === 2 && chain[1] === "num" && ["fromindex", "toindex", "atindex", "by"].includes(chain[0])) {
    return `${sentenceArg}.${chain[0]}?.num ?? ${sentenceArg}.${chain[0]}`;
  }
  if (isLocalRoot) {
    const [root, ...rest] = chain;
    if (localsTypes?.get(sanitizeName(root)) === "number") {
      if (rest.length === 1 && rest[0] === "num") return sanitizeName(root);
      if (rest.length === 2 && rest[0] === "ob" && rest[1] === "num") {
        const base = sanitizeName(root);
        return `${base}.ob?.num ?? ${base}`;
      }
    }
    return [sanitizeName(root), ...rest.map(part => `.${part}`)].join("");
  }
  return [sentenceArg, ...chain.map(part => `.${part}`)].join("");
}

function valueForRole(role, sentenceArg, field = "num", slot = {}) {
  if (!sentenceArg) return null;
  if (slot.genitive) {
    const access = pathFromGenitive(slot.genitive, sentenceArg, { allowCGlobals: true });
    return access;
  }
  return `${sentenceArg}.${role}?.${field} ?? ${sentenceArg}.${role}`;
}

function targetPath(role, sentenceArg, field = "num", slot = {}, { locals, declared } = {}) {
  if (!sentenceArg) return null;
  if (slot.genitive) {
    return pathFromGenitive(slot.genitive, sentenceArg, { locals, declared, allowCGlobals: true });
  }
  return `${sentenceArg}.${role}.${field}`;
}

function vectorExprFromGenitive(genitive, sentenceArg, { locals, declared } = {}) {
  const chainArr = Array.isArray(genitive) ? genitive : genitive?.chain;
  if (!chainArr || chainArr.length === 0) return null;
  const [root, tail] = chainArr;
  if (chainArr.length === 2 && tail === "ve") {
    if (root === "this") {
      return sentenceArg ? `${sentenceArg}.ob?.ve ?? ${sentenceArg}.ve` : null;
    }
    const name = sanitizeName(root);
    if (locals?.has(name) || declared?.has(name)) {
      return `${name}.ob?.ve ?? ${name}.ve`;
    }
    return `remember(${JSON.stringify(root)})?.ob?.ve`;
  }
  const path = pathFromGenitive(genitive, sentenceArg, { locals, declared, allowCGlobals: true });
  return path;
}

function cExpr(expr) {
  return String(expr ?? "0")
    .replace(/\?\./g, ".")
    .replace(/\.ob\.(num|text|name|boolean)\b/g, "")
    .replace(/\s*\?\?\s*[^)]+/g, "");
}

function transpileSentence(sentence, { lang, sentenceArg, locals, localsTypes, declared, declaredTypes, declaredVectorTypes, ceremonyFns, loopShim, mindShim, cHelpers, rememberFlag, jsHelpers, cState, mapDefs } = {}) {
  const ob = sentence.ob ?? {};
  const verb = sentence.be || sentence.mood || "";
  const beWords = verb.split(" ").filter(Boolean);
  const isPermanent = beWords[0] === "permanent";
  const baseBe = isPermanent ? beWords.slice(1).join(" ") : verb;
  const effectiveBe = baseBe || sentence.mood;

  if (sentence.mood === "ret") {
    const sourceName = sentence?.ret?.name || sentence?.ob?.name || sentence?.su?.name;
    if (sourceName) {
      return `return ${sanitizeName(sourceName)};`;
    }
    if (sentence.ob?.genitive && sentenceArg) {
      const expr = pathFromGenitive(sentence.ob.genitive, sentenceArg, { locals, declared, allowCGlobals: lang === "c" });
      if (expr) return `return ${expr};`;
    }
    if (sentence.ob?.num !== undefined) return `return ${Number(sentence.ob.num) || 0};`;
    if (typeof sentence.ob?.text === "string") return `return ${JSON.stringify(sentence.ob.text)};`;
    return lang === "c" ? "return;" : "return sentence;";
  }

  if (baseBe === "compile" && (lang === "c" || lang === "javascript")) {
    const sourceState = (sentence?.fromstate?.name || sentence?.fromstate || "").toLowerCase();
    const targetState = (sentence?.tostate?.name || sentence?.become?.name || "").toLowerCase();
    if (sourceState === "json" && targetState === "pyash") {
      const sourceText = sentence?.ob?.text ?? sentence?.from?.text ?? sentence?.fromtext?.text;
      if (typeof sourceText !== "string") {
        throwErrorSentence({
          name: "compile error",
          message: "compile: source text is required (from text or from filename)",
          from: { name: "compile" }
        });
      }
      let parsed;
      try {
        parsed = JSON.parse(sourceText);
      } catch (err) {
        throwErrorSentence({
          name: "compile error",
          message: "compile: invalid json",
          from: { name: "compile" },
          raw: { error: err?.message }
        });
      }
      let text;
      try {
        text = jsonToPyashText(parsed, sentence?.su?.name ?? "data").text;
      } catch (err) {
        throwErrorSentence({
          name: "compile error",
          message: err?.message ?? "compile: json export failed",
          from: { name: "compile" },
          raw: { error: err?.message }
        });
      }
      const wrappedText = `quoted.pyash.\n${text}.pyash.quoted`;
      const targetName = sentence?.to?.name ?? "output";
      const safeName = sanitizeName(targetName);
      markDeclared(declared, targetName);
      if (declaredTypes) declaredTypes.set(targetName, "text");
      if (lang === "c") {
        if (cHelpers) {
          cHelpers.usesTextHelper = true;
          cHelpers.usesString = true;
        }
        return `char ${safeName}[PYA_TEXT_CAP] = ${JSON.stringify(wrappedText)};`;
      }
      const sentenceObject = `{ su: { name: "${targetName}" }, ob: { text: ${JSON.stringify(wrappedText)} }, be: "pyash", mood: "ya" }`;
      return `let ${safeName} = ${sentenceObject};\nglobalThis["${targetName}"] = ${safeName};`;
    }
  }

  if (baseBe === "import") {
    const targetName = sentence?.to?.name ?? sentence?.su?.name;
    if (!targetName) {
      throwErrorSentence({
        name: "import error",
        message: "import: target name is required (to name <map>)",
        from: { name: "compile" },
        raw: sentence
      });
    }
    const sourceFilename = sentence?.from?.filename ?? sentence?.ob?.filename;
    const sourceText = sentence?.ob?.text ?? sentence?.from?.text ?? sentence?.fromtext?.text;
    if (!sourceFilename && typeof sourceText !== "string") return null;
    const safeName = sanitizeName(targetName);
    const alreadyDeclared = declared?.has(targetName);
    markDeclared(declared, targetName);
    if (declaredTypes) declaredTypes.set(targetName, "text");
    if (lang === "c") {
      if (cHelpers) {
        cHelpers.usesJsonRuntime = true;
        cHelpers.usesTextHelper = true;
        cHelpers.usesString = true;
        cHelpers.usesStdlib = true;
        cHelpers.usesPrintf = true;
        cHelpers.usesCtype = true;
      }
      const lines = [];
      const sourceVar = `${safeName}_source`;
      const needsDecl = !locals?.has(safeName) && !alreadyDeclared;
      if (needsDecl) {
        lines.push(`char ${safeName}[PYA_TEXT_CAP] = "";`);
      }
      lines.push(`char ${sourceVar}[PYA_TEXT_CAP] = "";`);
        if (sourceFilename) {
          if (cHelpers) cHelpers.usesExchange = true;
          lines.push(`if (!pya_read_file_text(${JSON.stringify(sourceFilename)}, ${sourceVar})) { fprintf(stderr, "import: json lost\\n"); }`);
          lines.push(`pya_exchange_record_file(${JSON.stringify(sourceFilename)}, "read");`);
        } else {
          lines.push(`snprintf(${sourceVar}, PYA_TEXT_CAP, "%s", ${JSON.stringify(sourceText)});`);
        }
      lines.push(`pya_json_error ${safeName}_err = { "", 0, 0 };`);
      lines.push(`if (!pya_json_to_pyash(${sourceVar}, ${JSON.stringify(targetName)}, ${safeName}, &${safeName}_err)) { fprintf(stderr, "%s\\n", ${safeName}_err.message); }`);
      return lines.join("\n");
    }
      if (jsHelpers) {
        jsHelpers.usesJsonRuntime = true;
        jsHelpers.usesVectorFormat = true;
        if (sourceFilename) {
          jsHelpers.usesFs = true;
          jsHelpers.usesExchange = true;
        }
      }
    const sourceExpr = sourceFilename && jsHelpers?.usesExchange
      ? `pyaReadTextFile(${JSON.stringify(sourceFilename)}, "read")`
      : (sourceFilename
        ? `fs.readFileSync(${JSON.stringify(sourceFilename)}, "utf8")`
        : JSON.stringify(sourceText));
    const parseVar = `${safeName}_json`;
    const assignLine = alreadyDeclared
      ? `${safeName} = { su: { name: "${targetName}" }, ob: { text: jsonToPyashTextRuntime(${parseVar}, ${JSON.stringify(targetName)}) }, be: "pyash", mood: "ya" };`
      : `const ${safeName} = { su: { name: "${targetName}" }, ob: { text: jsonToPyashTextRuntime(${parseVar}, ${JSON.stringify(targetName)}) }, be: "pyash", mood: "ya" };`;
    return [
      `let ${parseVar};`,
      `try { ${parseVar} = JSON.parse(${sourceExpr}); } catch (err) { throw new Error("import: invalid json"); }`,
      assignLine,
      `globalThis[${JSON.stringify(targetName)}] = ${safeName};`
    ].join("\n");
  }

  if (baseBe === "read") {
    const sourceState = (sentence?.fromstate?.name || sentence?.fromstate || "").toLowerCase();
    if (sourceState === "json") {
      const targetName = sentence?.to?.name ?? sentence?.su?.name ?? "result";
      const sourceFilename = sentence?.from?.filename ?? sentence?.ob?.filename;
      const sourceText = sentence?.ob?.text ?? sentence?.from?.text ?? sentence?.fromtext?.text;
      if (!sourceFilename && typeof sourceText !== "string") return null;
      const safeName = sanitizeName(targetName);
      const alreadyDeclared = declared?.has(targetName);
      markDeclared(declared, targetName);
      if (declaredTypes) declaredTypes.set(targetName, "text");
      if (lang === "c") {
        if (cHelpers) {
          cHelpers.usesJsonRuntime = true;
          cHelpers.usesTextHelper = true;
          cHelpers.usesString = true;
          cHelpers.usesStdlib = true;
          cHelpers.usesPrintf = true;
          cHelpers.usesCtype = true;
        }
        const lines = [];
        const sourceVar = `${safeName}_source`;
        const needsDecl = !locals?.has(safeName) && !alreadyDeclared;
        if (needsDecl) {
          lines.push(`char ${safeName}[PYA_TEXT_CAP] = "";`);
        }
        lines.push(`char ${sourceVar}[PYA_TEXT_CAP] = "";`);
        if (sourceFilename) {
          if (cHelpers) cHelpers.usesExchange = true;
          lines.push(`if (!pya_read_file_text(${JSON.stringify(sourceFilename)}, ${sourceVar})) { fprintf(stderr, "read: json lost\\n"); }`);
          lines.push(`pya_exchange_record_file(${JSON.stringify(sourceFilename)}, "read");`);
        } else {
          lines.push(`snprintf(${sourceVar}, PYA_TEXT_CAP, "%s", ${JSON.stringify(sourceText)});`);
        }
        lines.push(`pya_json_error ${safeName}_err = { "", 0, 0 };`);
        lines.push(`if (!pya_json_to_pyash(${sourceVar}, ${JSON.stringify(targetName)}, ${safeName}, &${safeName}_err)) { fprintf(stderr, "%s\\n", ${safeName}_err.message); }`);
        return lines.join("\n");
      }
      if (jsHelpers) {
        jsHelpers.usesJsonRuntime = true;
        jsHelpers.usesVectorFormat = true;
        if (sourceFilename) {
          jsHelpers.usesFs = true;
          jsHelpers.usesExchange = true;
        }
      }
      const sourceExpr = sourceFilename && jsHelpers?.usesExchange
        ? `pyaReadTextFile(${JSON.stringify(sourceFilename)}, "read")`
        : (sourceFilename
          ? `fs.readFileSync(${JSON.stringify(sourceFilename)}, "utf8")`
          : JSON.stringify(sourceText));
      const parseVar = `${safeName}_json`;
      const assignLine = alreadyDeclared
        ? `${safeName} = { su: { name: "${targetName}" }, ob: { text: jsonToPyashTextRuntime(${parseVar}, ${JSON.stringify(targetName)}) }, be: "pyash", mood: "ya" };`
        : `const ${safeName} = { su: { name: "${targetName}" }, ob: { text: jsonToPyashTextRuntime(${parseVar}, ${JSON.stringify(targetName)}) }, be: "pyash", mood: "ya" };`;
      return [
        `let ${parseVar};`,
        `try { ${parseVar} = JSON.parse(${sourceExpr}); } catch (err) { throw new Error("read: invalid json"); }`,
        assignLine,
        `globalThis[${JSON.stringify(targetName)}] = ${safeName};`
      ].join("\n");
    }
    if (sourceState === "yaml") {
      const targetName = sentence?.to?.name ?? sentence?.su?.name ?? "result";
      const sourceFilename = sentence?.from?.filename ?? sentence?.ob?.filename;
      const sourceText = sentence?.ob?.text ?? sentence?.from?.text ?? sentence?.fromtext?.text;
      if (!sourceFilename && typeof sourceText !== "string") return null;
      const safeName = sanitizeName(targetName);
      const alreadyDeclared = declared?.has(targetName);
      markDeclared(declared, targetName);
      if (declaredTypes) declaredTypes.set(targetName, "text");
      if (lang !== "c" && !sourceFilename && typeof sourceText === "string") {
        let parsed;
        try {
          parsed = parseYamlToJsonValue(sourceText, { source: "compile yaml" });
        } catch (err) {
          throw err;
        }
        parsed = canonicalizeJsonValue(parsed);
        let text;
        try {
          text = jsonToPyashText(parsed, targetName).text;
        } catch (err) {
          throwErrorSentence({
            name: "yaml defective",
            message: err?.message ?? "yaml defective",
            from: { name: "compile" },
            raw: { error: err?.message }
          });
        }
        const assignLine = alreadyDeclared
          ? `${safeName} = { su: { name: "${targetName}" }, ob: { text: ${JSON.stringify(text)} }, be: "pyash", mood: "ya" };`
          : `const ${safeName} = { su: { name: "${targetName}" }, ob: { text: ${JSON.stringify(text)} }, be: "pyash", mood: "ya" };`;
        return [
          assignLine,
          `globalThis[${JSON.stringify(targetName)}] = ${safeName};`
        ].join("\n");
      }
      if (lang === "c") {
        if (!sourceFilename && typeof sourceText === "string") {
          let parsed;
          try {
            parsed = parseYamlToJsonValue(sourceText, { source: "compile yaml" });
          } catch (err) {
            throw err;
          }
          parsed = canonicalizeJsonValue(parsed);
          let text;
          try {
            text = jsonToPyashText(parsed, targetName).text;
          } catch (err) {
            throwErrorSentence({
              name: "yaml defective",
              message: err?.message ?? "yaml defective",
              from: { name: "compile" },
              raw: { error: err?.message }
            });
          }
          if (cHelpers) {
            cHelpers.usesPrintf = true;
            cHelpers.usesString = true;
            cHelpers.usesTextHelper = true;
          }
          const lines = [];
          const needsDecl = !locals?.has(safeName) && !alreadyDeclared;
          if (needsDecl) {
            lines.push(`char ${safeName}[PYA_TEXT_CAP] = "";`);
          }
          lines.push(`snprintf(${safeName}, PYA_TEXT_CAP, "%s", ${JSON.stringify(text)});`);
          return lines.join("\n");
        }
        if (cHelpers) {
          cHelpers.usesYamlRuntime = true;
          cHelpers.usesJsonRuntime = true;
          cHelpers.usesTextHelper = true;
          cHelpers.usesString = true;
          cHelpers.usesStdlib = true;
          cHelpers.usesPrintf = true;
          cHelpers.usesCtype = true;
        }
        const lines = [];
        const sourceVar = `${safeName}_source`;
        const needsDecl = !locals?.has(safeName) && !alreadyDeclared;
        if (needsDecl) {
          lines.push(`char ${safeName}[PYA_TEXT_CAP] = "";`);
        }
        lines.push(`char ${sourceVar}[PYA_TEXT_CAP] = "";`);
        if (sourceFilename) {
          if (cHelpers) cHelpers.usesExchange = true;
          lines.push(`if (!pya_read_file_text(${JSON.stringify(sourceFilename)}, ${sourceVar})) { fprintf(stderr, "read: yaml lost\\n"); }`);
          lines.push(`pya_exchange_record_file(${JSON.stringify(sourceFilename)}, "read");`);
        } else {
          lines.push(`snprintf(${sourceVar}, PYA_TEXT_CAP, "%s", ${JSON.stringify(sourceText)});`);
        }
        lines.push(`pya_yaml_error ${safeName}_err = { "", 0, 0 };`);
        lines.push(`if (!pya_yaml_to_pyash(${sourceVar}, ${JSON.stringify(targetName)}, ${safeName}, &${safeName}_err)) { fprintf(stderr, "%s\\n", ${safeName}_err.message); }`);
        return lines.join("\n");
      }
      if (jsHelpers) {
        jsHelpers.usesYamlRuntime = true;
        jsHelpers.usesJsonRuntime = true;
        jsHelpers.usesVectorFormat = true;
        if (sourceFilename) {
          jsHelpers.usesFs = true;
          jsHelpers.usesExchange = true;
        }
      }
      const sourceExpr = sourceFilename && jsHelpers?.usesExchange
        ? `pyaReadTextFile(${JSON.stringify(sourceFilename)}, "read")`
        : (sourceFilename
          ? `fs.readFileSync(${JSON.stringify(sourceFilename)}, "utf8")`
          : JSON.stringify(sourceText));
      const assignLine = alreadyDeclared
        ? `${safeName} = { su: { name: "${targetName}" }, ob: { text: yamlToPyashTextRuntime(${sourceExpr}, ${JSON.stringify(targetName)}) }, be: "pyash", mood: "ya" };`
        : `const ${safeName} = { su: { name: "${targetName}" }, ob: { text: yamlToPyashTextRuntime(${sourceExpr}, ${JSON.stringify(targetName)}) }, be: "pyash", mood: "ya" };`;
      return [
        assignLine,
        `globalThis[${JSON.stringify(targetName)}] = ${safeName};`
      ].join("\n");
    }
    if (sourceState === "csv") {
      const sourceText = sentence?.ob?.text ?? sentence?.from?.text ?? sentence?.fromtext?.text;
      const sourceFilename = sentence?.from?.filename ?? sentence?.ob?.filename;
      if (typeof sourceText !== "string" && !sourceFilename) {
        return null;
      }
      if (typeof sourceText !== "string" && sourceFilename && lang !== "c") {
        const targetName = sentence?.to?.name ?? sentence?.su?.name ?? "result";
        const safeName = sanitizeName(targetName);
        markDeclared(declared, targetName);
        if (declaredTypes) declaredTypes.set(targetName, "csv map");
      if (jsHelpers) {
        jsHelpers.usesCsvRuntime = true;
        jsHelpers.usesCsvMap = true;
        if (sourceFilename) {
          jsHelpers.usesFs = true;
          jsHelpers.usesExchange = true;
        }
      }
        const sourceExpr = jsHelpers?.usesExchange
          ? `pyaReadTextFile(${JSON.stringify(sourceFilename)}, "read")`
          : `fs.readFileSync(${JSON.stringify(sourceFilename)}, "utf8")`;
        return [
          `const ${safeName} = csvMapFromTextRuntime(${sourceExpr}, ${JSON.stringify(targetName)});`,
          `globalThis[${JSON.stringify(targetName)}] = ${safeName};`
        ].join("\n");
      }
      if (typeof sourceText !== "string" && sourceFilename && lang === "c") {
        const targetName = sentence?.to?.name ?? sentence?.su?.name ?? "result";
        if (cHelpers) {
          cHelpers.usesCsvRuntime = true;
          cHelpers.usesStdlib = true;
          cHelpers.usesString = true;
          cHelpers.usesCtype = true;
          cHelpers.usesPrintf = true;
        }
        markDeclared(declared, targetName);
        if (declaredTypes) declaredTypes.set(targetName, "csv map");
        const errName = `csv_err_${cState?.csvCounter ?? 0}`;
        if (cState) cState.csvCounter += 1;
        if (cHelpers) cHelpers.usesExchange = true;
        return `pya_csv_error ${errName} = { \"\", 0, 0 }; if (!pya_csv_read_file(${JSON.stringify(sourceFilename)}, ${JSON.stringify(targetName)}, &${errName})) { fprintf(stderr, \"%s\\n\", ${errName}.message); } pya_exchange_record_file(${JSON.stringify(sourceFilename)}, "read");`;
      }
      const normalizedText = sourceText
        .replace(/\\r\\n/g, "\r\n")
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r");
      const targetName = sentence?.to?.name ?? sentence?.su?.name ?? "result";
      let parsed;
      try {
        parsed = parseCsvText(normalizedText, { source: "compile csv" });
      } catch (err) {
        throw err;
      }
      const map = {
        "header raw": { ve: { type: "text", values: parsed.headerRaw } },
        header: { ve: { type: "text", values: parsed.header } }
      };
      parsed.header.forEach((key, idx) => {
        map[key] = { ve: { type: "text", values: parsed.columns[idx] } };
      });
      const mapSentence = {
        mood: "ya",
        su: { name: targetName },
        be: "csv map",
        ob: { map }
      };
      mapDefs?.set(targetName, mapSentence);
      markDeclared(declared, targetName);
      if (declaredTypes) declaredTypes.set(targetName, "csv map");
      if (lang === "c") {
        try {
          const csvText = csvTextFromMapSentence(mapSentence);
          if (cState?.csvMapStrings) cState.csvMapStrings.set(targetName, csvText);
        } catch (err) {
          throwErrorSentence({
            name: "csv columns defective",
            message: err?.message ?? "csv columns defective",
            from: { name: "compile" },
            raw: { name: targetName, error: err?.message }
          });
        }
        return `/* csv read compile-time */`;
      }
      const safeName = sanitizeName(targetName);
      const payload = JSON.stringify(mapSentence);
      return `const ${safeName} = ${payload};\nglobalThis[${JSON.stringify(targetName)}] = ${safeName};`;
    }
  }

  // Say -> console.log / printf TODO
  const hasWriteIndex =
    baseBe === "write" &&
    (sentence.at?.num != null || sentence.at?.genitive ||
      sentence.ob?.at?.num != null || sentence.ob?.at?.genitive ||
      sentence.to?.at?.num != null || sentence.to?.at?.genitive);

  if (baseBe === "speak" || baseBe === "say" || (baseBe === "write" && !hasWriteIndex)) {
    const isWrite = baseBe === "write";
    const isSpeak = baseBe === "speak";
    const formatParts = [];
    if (sentence?.become?.name) formatParts.push(sentence.become.name);
    if (sentence?.become?.text) formatParts.push(sentence.become.text);
    const formatRaw = formatParts.join(" ").trim().toLowerCase();
    const jsonMode = formatRaw.includes("json")
      ? (formatRaw.includes("beautiful") ? "pretty" : "canonical")
      : null;
    const wantJson = jsonMode !== null;
    const wantYaml = formatRaw.includes("yaml");
    const wantCsv = formatRaw.includes("csv");
    // Special case: write to <mind> -> invoke mind (JS/C)
    if (baseBe === "write" && sentence.to?.name && lang !== "c") {
      if (mindShim) mindShim.used = true;
      const mindName = sentence.to.name;
      const resultName = sentence.su?.name ?? mindName;
      const promptVal = typeof ob.text === "string" ? JSON.stringify(ob.text) : JSON.stringify(ob.name ?? "");
      const explicitModel = ob.model ? JSON.stringify(ob.model) : null;
      const windowVal = sentence.by?.num ?? sentence.by?.quantity?.num ?? ob.window?.num ?? null;
      const lines = ["{"]; // block scope to avoid duplicate const per call
      if (sentence.with?.name) {
        if (jsHelpers) jsHelpers.usesVectorFormat = true;
        if (rememberFlag) rememberFlag.used = true;
      }
      lines.push(`const cfg = mindConfigs.get(${JSON.stringify(mindName)}) || {};`);
      lines.push(`const host = cfg.space || ((typeof process !== "undefined" && process.env?.OLLAMA_HOST) ? process.env.OLLAMA_HOST : undefined) || "http://localhost:11434";`);
      lines.push(`const model = ${explicitModel ?? "cfg.model || \"qwen3-vl:8b-instruct\""};`);
      const dialogue = sentence.from?.text
        ?? sentence.fromtext?.name
        ?? sentence.fromtext?.text
        ?? `${mindName} story`;
      lines.push(`const dialogue = ${JSON.stringify(String(dialogue))};`);
      lines.push(`const historyMessages = buildMindHistory(dialogue, ${windowVal !== null ? Number(windowVal) || 8 : "cfg.window || 8"});`);
      lines.push("const messages = [];");
      lines.push("if (cfg.prompt) messages.push({ role: \"system\", content: cfg.prompt });");
      if (sentence.with?.name) {
        const toolMapName = JSON.stringify(sentence.with.name);
        lines.push(`const toolMap = remember(${toolMapName});`);
        lines.push("const toolEntries = toolMap?.ob?.map ?? {};");
        lines.push("const toolKeys = Object.keys(toolEntries).sort(compareUtf8);");
        lines.push("const toolLines = toolKeys.map(k => { const entry = toolEntries[k]; return (entry?.mood && entry?.be) ? formatSentence(entry) : \"\"; }).filter(Boolean);");
        lines.push("if (toolLines.length) messages.push({ role: \"system\", content: `TOOLS:\\n${toolLines.join(\"\\n\")}` });");
      }
      lines.push("messages.push(...historyMessages);");
      lines.push(`messages.push({ role: "user", content: ${promptVal} });`);
      lines.push("const reply = await callMind({ host, model, messages, numCtx: cfg.numCtx || 8192 });");
      const resVar = sanitizeName(resultName);
    lines.push(`recordMindTurn(dialogue, { role: "user", content: ${promptVal} }, { role: "assistant", content: reply }, ${windowVal !== null ? Number(windowVal) || 8 : "cfg.window || 8"});`);
    lines.push("const __pyaAnswerCount = (mindAnswerCounters.get(dialogue) || 0) + 1;");
    lines.push("mindAnswerCounters.set(dialogue, __pyaAnswerCount);");
    lines.push(`const ${resVar} = { su: { name: ${JSON.stringify(mindName)} + " answer " + __pyaAnswerCount }, from: { name: ${JSON.stringify(mindName)} }, ob: { text: reply }, be: "answer", mood: "ya" };`);
    lines.push(`globalThis[${resVar}.su.name] = ${resVar};`);
    lines.push(`const __pyaQuestionName = ${JSON.stringify(mindName)} + " " + dialogue + " question " + __pyaAnswerCount;`);
    lines.push(`globalThis[__pyaQuestionName] = { su: { name: __pyaQuestionName }, from: { name: "user" }, ob: { text: ${promptVal} }, be: "write", mood: "ya" };`);
    lines.push(`const __pyaDialogueAnswerName = ${JSON.stringify(mindName)} + " " + dialogue + " answer " + __pyaAnswerCount;`);
    lines.push(`globalThis[__pyaDialogueAnswerName] = { su: { name: __pyaDialogueAnswerName }, from: { name: ${JSON.stringify(mindName)} }, ob: { text: reply }, be: "answer", mood: "ya" };`);
    lines.push(`const __pyaToolEvoked = ${JSON.stringify(sentenceToPyash(sentence))};`);
    lines.push(`const __pyaToolResult = "su name " + ${JSON.stringify(mindName)} + " answer " + __pyaAnswerCount + " from name " + ${JSON.stringify(mindName)} + " ob text " + JSON.stringify(reply) + " be answer ya";`);
    lines.push(`pyaEmitNewspaper(\`su name tool event \${pyaNextToolEventId()} ob la \${__pyaToolEvoked} ko to la \${__pyaToolResult} ko be tool ya\`);`);
    lines.push(`console.log(${resVar}.ob?.text ?? ${resVar}.ob?.num);`);
    lines.push("}");
    return lines.join("\n");
    }
    if (baseBe === "write" && sentence.to?.name && lang === "c" && declaredTypes?.get(sentence.to.name) === "mind") {
      const derived = { ...sentence, be: "mind" };
      return transpileSentence(derived, { lang, sentenceArg, locals, localsTypes, declared, declaredTypes, declaredVectorTypes, ceremonyFns, loopShim, mindShim, cHelpers, rememberFlag, jsHelpers, cState, mapDefs });
    }

    if (lang === "c" && ob.name && declaredTypes?.get(ob.name) === "map") {
      cHelpers.usesMap = true;
      cHelpers.usesMapPrinter = true;
      cHelpers.usesMapGlobals = true;
      cHelpers.usesPrintf = true;
      cHelpers.usesString = true;
      cHelpers.usesStdlib = true;
      cHelpers.usesCtype = true;
      return `print_map_sentence(${JSON.stringify(ob.name)}, &${sanitizeName(ob.name)});`;
    }

    const genChain = sentence.ob?.genitive?.chain || [];
    const wantsVector = genChain.at(-1) === "ve" || declaredTypes?.get(sentence.ob?.name) === "vector";

    if (lang === "c" && wantsVector) {
      if (cHelpers) {
        cHelpers.usesPrintf = true;
        cHelpers.usesVectorType = true;
        cHelpers.usesVectorPrinter = true;
        cHelpers.usesString = true;
        cHelpers.usesCtype = true;
      }
      const vecName = sentence.ob?.name;
      if (vecName && declaredTypes?.get(vecName) === "vector") {
        return `print_vec_sentence(${JSON.stringify(vecName)}, &${sanitizeName(vecName)});`;
      }
      if (sentence.ob?.genitive) {
        const chain = sentence.ob.genitive.chain || [];
        if (chain.length === 2 && chain[1] === "ve" && chain[0] !== "this") {
          const root = sanitizeName(chain[0]);
          if (locals?.has(root) || declared?.has(root)) return `print_vec(&${root});`;
        }
        const vecExpr = vectorExprFromGenitive(sentence.ob.genitive, sentenceArg, { locals, declared });
        if (vecExpr && !vecExpr.includes("remember(")) return `print_vec(${vecExpr});`;
      }
    }

    let expr = "undefined";
    let forcedExpr = false;
    if (lang !== "c" && wantJson) {
      const isJsonMap = ob.name && declaredTypes?.get(ob.name) === "json map";
      const isPyashText = typeof ob.text === "string" || (ob.name && (declaredTypes?.get(ob.name) === "pyash" || declaredTypes?.get(ob.name) === "text"));
      if (!isJsonMap && isPyashText) {
        if (jsHelpers) jsHelpers.usesJsonRuntime = true;
        const sourceExpr = typeof ob.text === "string"
          ? JSON.stringify(ob.text)
          : `remember(${JSON.stringify(ob.name ?? "")})?.ob?.text ?? ""`;
        if (rememberFlag) rememberFlag.used = true;
        const rootName = JSON.stringify(sentence?.su?.name ?? "");
        const mode = jsonMode === "pretty" ? "pretty" : "canonical";
        expr = `pyashToJsonTextRuntime(${sourceExpr}, ${rootName}, ${JSON.stringify(mode)})`;
        forcedExpr = true;
      }
    }
    if (lang === "c" && wantJson) {
      const isJsonMap = ob.name && declaredTypes?.get(ob.name) === "json map";
      const isPyashText = typeof ob.text === "string" || (ob.name && (declaredTypes?.get(ob.name) === "pyash" || declaredTypes?.get(ob.name) === "text"));
      if (!isJsonMap && isPyashText) {
        if (cHelpers) {
          cHelpers.usesJsonRuntime = true;
          cHelpers.usesTextHelper = true;
          cHelpers.usesString = true;
          cHelpers.usesStdlib = true;
          cHelpers.usesPrintf = true;
          cHelpers.usesCtype = true;
        }
        const tmpName = sanitizeName(`${sentence?.su?.name ?? ob.name ?? "pyash"}_json`);
        const errName = `${tmpName}_err`;
        const rootName = sentence?.su?.name ? JSON.stringify(sentence.su.name) : "NULL";
        const sourceExpr = typeof ob.text === "string"
          ? JSON.stringify(ob.text)
          : (ob.name ? sanitizeName(ob.name) : "NULL");
        const lines = [];
        lines.push(`char ${tmpName}[PYA_TEXT_CAP] = "";`);
        lines.push(`pya_json_error ${errName} = { "", 0, 0 };`);
        lines.push(`if (!pya_pyash_to_json(${sourceExpr}, ${rootName}, ${tmpName}, &${errName})) { fprintf(stderr, "%s\\n", ${errName}.message); }`);
        const writeFilename = sentence?.to?.filename;
        if (writeFilename) {
          const safePath = JSON.stringify(writeFilename);
          const fileVar = `out_${cState?.fileCounter ?? 0}`;
          if (cState) cState.fileCounter += 1;
          lines.push(`FILE *${fileVar} = fopen(${safePath}, "w");`);
          lines.push(`if (${fileVar}) { fprintf(${fileVar}, "%s", ${tmpName}); fclose(${fileVar}); }`);
          if (!isWrite) lines.push(`printf("%s\\n", ${tmpName});`);
        } else {
          lines.push(`printf("%s\\n", ${tmpName});`);
        }
        return lines.join("\n");
      }
    }
    if (!forcedExpr) {
      if (wantYaml && lang !== "c") {
        const isJsonMap = ob.name && declaredTypes?.get(ob.name) === "json map";
        const isPyashText = typeof ob.text === "string" || (ob.name && (declaredTypes?.get(ob.name) === "pyash" || declaredTypes?.get(ob.name) === "text"));
        if (!isJsonMap && isPyashText) {
          if (jsHelpers) {
            jsHelpers.usesYamlStringify = true;
            jsHelpers.usesJsonRuntime = true;
            jsHelpers.usesVectorFormat = true;
          }
          const sourceExpr = typeof ob.text === "string"
            ? JSON.stringify(ob.text)
            : `remember(${JSON.stringify(ob.name ?? "")})?.ob?.text ?? ""`;
          if (rememberFlag) rememberFlag.used = true;
          const rootName = JSON.stringify(sentence?.su?.name ?? "");
          expr = `yamlStringifyRuntime(JSON.parse(pyashToJsonTextRuntime(${sourceExpr}, ${rootName}, "canonical")))`;
          forcedExpr = true;
        }
      } else if (wantYaml && lang === "c") {
        const isJsonMap = ob.name && declaredTypes?.get(ob.name) === "json map";
        const isPyashText = typeof ob.text === "string" || (ob.name && (declaredTypes?.get(ob.name) === "pyash" || declaredTypes?.get(ob.name) === "text"));
        if (!isJsonMap && isPyashText) {
          if (cHelpers) {
            cHelpers.usesYamlStringify = true;
            cHelpers.usesJsonRuntime = true;
            cHelpers.usesTextHelper = true;
            cHelpers.usesString = true;
            cHelpers.usesStdlib = true;
            cHelpers.usesPrintf = true;
            cHelpers.usesCtype = true;
          }
          const tmpJson = sanitizeName(`${sentence?.su?.name ?? ob.name ?? "pyash"}_json`);
          const tmpYaml = sanitizeName(`${sentence?.su?.name ?? ob.name ?? "pyash"}_yaml`);
          const errName = `${tmpYaml}_err`;
          const rootName = sentence?.su?.name ? JSON.stringify(sentence.su.name) : "NULL";
          const sourceExpr = typeof ob.text === "string"
            ? JSON.stringify(ob.text)
            : (ob.name ? sanitizeName(ob.name) : "NULL");
          const lines = [];
          lines.push(`char ${tmpJson}[PYA_TEXT_CAP] = "";`);
          lines.push(`char ${tmpYaml}[PYA_TEXT_CAP] = "";`);
          lines.push(`pya_json_error ${tmpJson}_err = { "", 0, 0 };`);
          lines.push(`if (!pya_pyash_to_json(${sourceExpr}, ${rootName}, ${tmpJson}, &${tmpJson}_err)) { fprintf(stderr, "%s\\n", ${tmpJson}_err.message); }`);
          lines.push(`pya_yaml_error ${errName} = { "", 0, 0 };`);
          lines.push(`if (!pya_json_to_yaml(${tmpJson}, ${tmpYaml}, &${errName})) { fprintf(stderr, "%s\\n", ${errName}.message); }`);
          const writeFilename = sentence?.to?.filename;
          if (writeFilename) {
            const safePath = JSON.stringify(writeFilename);
            const fileVar = `out_${cState?.fileCounter ?? 0}`;
            if (cState) cState.fileCounter += 1;
            lines.push(`FILE *${fileVar} = fopen(${safePath}, "w");`);
            lines.push(`if (${fileVar}) { fprintf(${fileVar}, "%s", ${tmpYaml}); fclose(${fileVar}); }`);
            if (!isWrite) lines.push(`printf("%s\\n", ${tmpYaml});`);
          } else {
            lines.push(`printf("%s\\n", ${tmpYaml});`);
          }
          return lines.join("\n");
        }
      } else if (typeof ob.text === "string") {
        expr = JSON.stringify(ob.text);
      } else if (ob.genitive) {
        if (wantsVector) {
          if (jsHelpers) jsHelpers.usesVectorFormat = true;
          const vecExpr = vectorExprFromGenitive(ob.genitive, sentenceArg, { locals, declared });
          if (vecExpr) expr = `formatVector((${vecExpr})?.values ?? [], (${vecExpr})?.type ?? "num")`;
        } else {
          expr = pathFromGenitive(ob.genitive, sentenceArg, { allowCGlobals: true }) ?? expr;
        }
      } else if (ob.name) {
	      const name = sanitizeName(ob.name);
        const isMap = declaredTypes?.get(ob.name) === "map";
        const isJsonMap = declaredTypes?.get(ob.name) === "json map";
        const isCsvMap = declaredTypes?.get(ob.name) === "csv map";
        const isSentence = declaredTypes?.get(ob.name) === "sentence";
        if (isMap) {
          const chain = mapDefs?.has(ob.name) ? mapDefChainFromName(ob.name, mapDefs) : "";
          if (lang === "c") {
            expr = JSON.stringify(chain);
          } else {
            if (jsHelpers) jsHelpers.usesVectorFormat = true;
            const mapExpr = (locals?.has(name) || declared?.has(name)) ? name : `remember(${JSON.stringify(ob.name)})`;
            expr = `formatMapSentence(${JSON.stringify(ob.name)}, ${mapExpr})`;
          }
        }
        if (isJsonMap) {
          if (wantJson) {
            if (lang === "c") {
              const suffix = jsonMode === "pretty" ? "json_pretty" : "json";
              expr = sanitizeName(`${ob.name}_${suffix}`);
            } else {
              if (jsHelpers) jsHelpers.usesJsonMap = true;
              expr = `formatJsonMap(${JSON.stringify(ob.name)}, ${JSON.stringify(jsonMode)})`;
            }
          } else if (wantYaml) {
            if (lang === "c") {
              const mapSentence = mapDefs?.get(ob.name);
              if (mapSentence && mapSentence.be === "json map") {
                const yamlText = cState?.yamlMapStrings?.get(ob.name);
                if (yamlText) {
                  expr = JSON.stringify(yamlText);
                }
              }
              if (expr === "undefined") {
                if (cHelpers) {
                  cHelpers.usesYamlStringify = true;
                  cHelpers.usesJsonRuntime = true;
                  cHelpers.usesTextHelper = true;
                  cHelpers.usesString = true;
                  cHelpers.usesStdlib = true;
                  cHelpers.usesPrintf = true;
                  cHelpers.usesCtype = true;
                }
                const tmpYaml = sanitizeName(`${ob.name}_yaml`);
                const errName = `${tmpYaml}_err`;
                const jsonVar = sanitizeName(`${ob.name}_json`);
                expr = tmpYaml;
                const lines = [];
                lines.push(`char ${tmpYaml}[PYA_TEXT_CAP] = "";`);
                lines.push(`pya_yaml_error ${errName} = { "", 0, 0 };`);
                lines.push(`if (!pya_json_to_yaml(${jsonVar}, ${tmpYaml}, &${errName})) { fprintf(stderr, "%s\\n", ${errName}.message); }`);
                const writeFilename = sentence?.to?.filename;
                if (writeFilename) {
                  const safePath = JSON.stringify(writeFilename);
                  const fileVar = `out_${cState?.fileCounter ?? 0}`;
                  if (cState) cState.fileCounter += 1;
                  lines.push(`FILE *${fileVar} = fopen(${safePath}, "w");`);
                  lines.push(`if (${fileVar}) { fprintf(${fileVar}, "%s", ${tmpYaml}); fclose(${fileVar}); }`);
                  if (!isWrite) lines.push(`printf("%s\\n", ${tmpYaml});`);
                } else {
                  lines.push(`printf("%s\\n", ${tmpYaml});`);
                }
                return lines.join("\n");
              }
            } else {
              if (jsHelpers) {
                jsHelpers.usesYamlStringify = true;
                jsHelpers.usesJsonMap = true;
              }
              expr = `yamlStringifyRuntime(jsonFromMap(${JSON.stringify(ob.name)}))`;
            }
          } else if (mapDefs?.has(ob.name)) {
            const chain = mapDefChainFromName(ob.name, mapDefs);
            expr = JSON.stringify(chain);
          }
        }
        if (isCsvMap && !wantCsv) {
          const chain = mapDefs?.has(ob.name) ? mapDefChainFromName(ob.name, mapDefs) : "";
          if (lang === "c") {
            if (mapDefs?.has(ob.name)) {
              expr = JSON.stringify(chain);
            } else {
              if (cHelpers) {
                cHelpers.usesCsvRuntime = true;
                cHelpers.usesStdlib = true;
                cHelpers.usesString = true;
                cHelpers.usesCtype = true;
                cHelpers.usesPrintf = true;
              }
              if (sentence?.to?.filename) {
                const safePath = JSON.stringify(sentence.to.filename);
                if (cHelpers) cHelpers.usesExchange = true;
                return `pya_csv_write_pyash_file(${JSON.stringify(ob.name)}, ${safePath});\npya_exchange_record_file(${safePath}, "write");`;
              }
              return `pya_csv_write_pyash_stdout(${JSON.stringify(ob.name)});`;
            }
          } else {
            if (jsHelpers) jsHelpers.usesVectorFormat = true;
            const mapExpr = (locals?.has(name) || declared?.has(name)) ? name : `remember(${JSON.stringify(ob.name)})`;
            expr = `formatMapSentence(${JSON.stringify(ob.name)}, ${mapExpr})`;
          }
        }
        if (isCsvMap && wantCsv) {
          if (lang === "c") {
            const mapSentence = mapDefs?.get(ob.name);
            if (mapSentence && mapSentence.be === "csv map") {
              expr = JSON.stringify(csvTextFromMapSentence(mapSentence));
            } else {
              if (cHelpers) {
                cHelpers.usesCsvRuntime = true;
                cHelpers.usesStdlib = true;
                cHelpers.usesString = true;
                cHelpers.usesCtype = true;
                cHelpers.usesPrintf = true;
              }
              if (sentence?.to?.filename) {
                const safePath = JSON.stringify(sentence.to.filename);
                if (cHelpers) cHelpers.usesExchange = true;
                return `pya_csv_write_file(${JSON.stringify(ob.name)}, ${safePath});\npya_exchange_record_file(${safePath}, "write");`;
              }
              return `pya_csv_write_stdout(${JSON.stringify(ob.name)});`;
            }
          } else {
            if (jsHelpers) jsHelpers.usesCsvMap = true;
            expr = `formatCsvMap(${JSON.stringify(ob.name)})`;
          }
        }
	      if (!isJsonMap && !isMap && !isCsvMap && lang === "c" && (locals?.has(name) || declared?.has(name) || declared?.has(ob.name))) {
	        expr = name;
      } else if (!isJsonMap && !isMap && !isCsvMap && locals?.has(name)) {
        if (declaredTypes?.get(ob.name) === "vector") {
          if (jsHelpers) jsHelpers.usesVectorFormat = true;
          expr = `formatVectorSentence(${JSON.stringify(ob.name)}, ${name}.ob?.ve ?? ${name}.ve)`;
        } else if (isSentence) {
          if (jsHelpers) jsHelpers.usesVectorFormat = true;
          expr = `formatSentence(${name})`;
        } else {
          expr = `${name}.ob?.ve?.values ?? ${name}.ob?.text ?? ${name}.ob?.num`;
        }
	      } else if (!isJsonMap && !isMap && !isCsvMap && declared?.has(name)) {
	        if (declaredTypes?.get(ob.name) === "vector") {
	          if (jsHelpers) jsHelpers.usesVectorFormat = true;
	          expr = `formatVectorSentence(${JSON.stringify(ob.name)}, ${name}.ob?.ve ?? ${name}.ve)`;
        } else if (isSentence) {
          if (jsHelpers) jsHelpers.usesVectorFormat = true;
          expr = `formatSentence(${name})`;
	        } else {
	          expr = `${name}.ob?.ve?.values ?? ${name}.ob?.text ?? ${name}.ob?.num`;
	        }
	      } else if (!isJsonMap && !isMap && !isCsvMap && isSentence) {
        if (jsHelpers) jsHelpers.usesVectorFormat = true;
        expr = `formatSentence(remember(${JSON.stringify(ob.name)}))`;
        if (rememberFlag) rememberFlag.used = true;
      } else if (!isJsonMap && !isMap && !isCsvMap) {
	        expr = JSON.stringify(ob.name);
	      }
	    } else {
        const fallback = exprForSlot(ob, {
          sentenceArg,
          locals,
          declared,
          defaultExpr: sentenceArg ? `${sentenceArg}.ob?.text ?? ${sentenceArg}.ob?.num` : undefined,
          field: "text"
        });
        if (fallback) expr = fallback;
      }
    }
    if (isSpeak && lang !== "c") {
      if (jsHelpers) jsHelpers.usesSpeak = true;
      return `pyaSpeak(${expr});`;
    }
    const writeFilename = sentence?.to?.filename;
    if (writeFilename && lang !== "c") {
      if (jsHelpers) {
        jsHelpers.usesFs = true;
        jsHelpers.usesExchange = true;
      }
      const writeLine = jsHelpers?.usesExchange
        ? `pyaWriteTextFile(${JSON.stringify(writeFilename)}, ${expr}, "write");`
        : `fs.writeFileSync(${JSON.stringify(writeFilename)}, String(${expr}));`;
      return isWrite ? writeLine : `${writeLine}\nconsole.log(${expr});`;
    }
    if (lang === "c") {
      if (cHelpers) cHelpers.usesPrintf = true;
      const isText = typeof ob.text === "string"
        || wantCsv
        || wantYaml
        || (ob.name && (declaredTypes?.get(ob.name) === "text" || declaredTypes?.get(ob.name) === "sentence" || declaredTypes?.get(ob.name) === "json map" || declaredTypes?.get(ob.name) === "map" || declaredTypes?.get(ob.name) === "csv map"))
        || (ob.name && localsTypes?.get(sanitizeName(ob.name)) === "text");
      const fmt = (wantCsv || wantYaml) ? "%s" : (isText ? "%s" : "%g");
      if (isSpeak) {
        if (cHelpers) {
          cHelpers.usesSpeak = true;
          cHelpers.usesTextHelper = true;
          cHelpers.usesStdlib = true;
          cHelpers.usesString = true;
          cHelpers.usesPrintf = true;
        }
        if (fmt === "%s") return `pya_speak(${expr});`;
        const speakBuf = `speak_${cState?.fileCounter ?? 0}`;
        if (cState) cState.fileCounter += 1;
        return `char ${speakBuf}[PYA_TEXT_CAP];\nsnprintf(${speakBuf}, sizeof(${speakBuf}), "${fmt}", ${expr});\npya_speak(${speakBuf});`;
      }
      if (writeFilename) {
        if (cHelpers) {
          cHelpers.usesStdlib = true;
          cHelpers.usesExchange = true;
          if (fmt === "%s") cHelpers.usesTextHelper = true;
        }
        const safePath = JSON.stringify(writeFilename);
        const fileVar = `out_${cState?.fileCounter ?? 0}`;
        if (cState) cState.fileCounter += 1;
        const writeLine = fmt === "%s"
          ? `pya_write_text_file(${safePath}, ${expr});\npya_exchange_record_file(${safePath}, "write");`
          : `FILE *${fileVar} = fopen(${safePath}, "w");\nif (${fileVar}) { fprintf(${fileVar}, "${fmt}", ${expr}); fclose(${fileVar}); }\npya_exchange_record_file(${safePath}, "write");`;
        if (isWrite) return writeLine;
        return (wantCsv || wantYaml) ? `${writeLine}\nprintf("%s", ${expr});` : `${writeLine}\nprintf("${fmt}\\n", ${expr});`;
      }
      return (wantCsv || wantYaml) ? `printf("%s", ${expr});` : `printf("${fmt}\\n", ${expr});`;
    }
    return `console.log(${expr});`;
  }

  if (baseBe === "command") {
    const inputFilename = sentence.from?.filename;
    const inputText = sentence.fromtext?.text;
    if (lang !== "c") {
      if (jsHelpers) {
        jsHelpers.usesCommand = true;
        if (inputFilename || sentence?.to?.filename) jsHelpers.usesFs = true;
      }
      const cmdExpr = exprForSlot(ob, {
        sentenceArg,
        locals,
        declared,
        defaultExpr: sentenceArg ? `${sentenceArg}.ob?.text ?? ${sentenceArg}.ob?.wo` : undefined,
        field: "text"
      });
      const inputExpr = inputFilename
        ? `fs.readFileSync(${JSON.stringify(inputFilename)}, "utf8")`
        : (inputText != null ? JSON.stringify(inputText) : "undefined");
      const lines = ["{"];
      lines.push(`const __pyaCmd = ${cmdExpr ?? "\"\""};`);
      lines.push(`const __pyaOut = pyaCommand(__pyaCmd, ${inputExpr});`);
      if (sentence?.to?.filename) {
        lines.push(`fs.writeFileSync(${JSON.stringify(sentence.to.filename)}, String(__pyaOut ?? ""));`);
      }
      if (sentence?.to?.name) {
        const target = sanitizeName(sentence.to.name);
        if (declaredTypes) declaredTypes.set(sentence.to.name, "text");
        markDeclared(declared, sentence.to.name);
        lines.push(`const ${target} = { su: { name: ${JSON.stringify(sentence.to.name)} }, ob: { text: String(__pyaOut ?? "") }, be: "text", mood: "ya" };`);
        lines.push(`globalThis[${JSON.stringify(sentence.to.name)}] = ${target};`);
      }
      lines.push("}");
      return lines.join("\n");
    }
    if (lang === "c") {
      if (cHelpers) {
        cHelpers.usesCommand = true;
        cHelpers.usesTextHelper = true;
        cHelpers.usesString = true;
        cHelpers.usesStdlib = true;
        cHelpers.usesPrintf = true;
      }
      if (inputFilename || inputText) {
        throwErrorSentence({
          name: "command defective",
          message: "command defective",
          from: { name: "compile" },
          raw: { reason: "stdin unsupported in c" }
        });
      }
      const cmdExpr = exprForSlot(ob, {
        sentenceArg,
        locals,
        declared,
        defaultExpr: sentenceArg ? `${sentenceArg}.ob?.text` : undefined,
        field: "text"
      });
      const outVar = `cmd_out_${cState?.fileCounter ?? 0}`;
      if (cState) cState.fileCounter += 1;
      const lines = [];
      lines.push(`char *${outVar} = pya_command(${cmdExpr ?? "\"\""});`);
      if (sentence?.to?.filename) {
        const safePath = JSON.stringify(sentence.to.filename);
        const fileVar = `out_${cState?.fileCounter ?? 0}`;
        if (cState) cState.fileCounter += 1;
        lines.push(`FILE *${fileVar} = fopen(${safePath}, "w");`);
        lines.push(`if (${fileVar}) { fprintf(${fileVar}, "%s", ${outVar} ? ${outVar} : ""); fclose(${fileVar}); }`);
      }
      if (sentence?.to?.name) {
        const target = sanitizeName(sentence.to.name);
        if (declaredTypes) declaredTypes.set(sentence.to.name, "text");
        markDeclared(declared, sentence.to.name);
        lines.push(`char ${target}[PYA_TEXT_CAP];`);
        lines.push(`snprintf(${target}, sizeof(${target}), "%s", ${outVar} ? ${outVar} : "");`);
      }
      lines.push(`if (${outVar}) free(${outVar});`);
      return lines.join("\n");
    }
  }

  // Json map enumeration: all su/ob/of <map> be read do
  if (baseBe === "read" && ob?.genitive?.chain?.at(-1) === "all") {
    const chain = ob.genitive.chain;
    const mapName = chain[0];
    const role = chain.length > 2 ? chain[chain.length - 2] : null;
    const mapSentence = mapDefs?.get(mapName);
    if (!mapSentence || mapSentence.be !== "json map") {
      throwErrorSentence({
        name: "json map enumeration defective",
        message: "json map enumeration defective",
        from: { name: "compile" },
        raw: { name: mapName }
      });
    }
    const jsonObj = jsonFromMapSentence(mapSentence, mapDefs, new Set());
    const keys = Object.keys(jsonObj).sort(compareUtf8);
    const values = keys.map((key) => jsonObj[key]);
    const targetName = sentence.to?.name ?? "result";
    const targetVar = sanitizeName(targetName);
    const needsDecl = !locals?.has(targetVar) && !declared?.has(targetName);
    const markDeclared = (vecType) => {
      if (targetName) {
        declared?.add(targetName);
        declaredTypes?.set(targetName, "vector");
        if (vecType) declaredVectorTypes?.set(targetName, vecType);
      }
    };
    if (lang === "c") {
      if (cHelpers) {
        cHelpers.usesVectorType = true;
        cHelpers.usesVectorPrinter = true;
        cHelpers.usesString = true;
        cHelpers.usesCtype = true;
      }
      const suffix = cState ? cState.vectorCounter++ : 0;
      const vecName = targetVar;
      if (role === "su") {
        const literal = keys.map((key) => JSON.stringify(String(key))).join(", ");
        markDeclared("text");
        if (needsDecl) {
          return `const char *${vecName}_values_${suffix}[] = { ${literal} };\npya_vec ${vecName} = { "text", ${keys.length}, NULL, ${vecName}_values_${suffix} };`;
        }
        return `do { const char *${vecName}_values_${suffix}[] = { ${literal} }; ${vecName} = (pya_vec){ "text", ${keys.length}, NULL, ${vecName}_values_${suffix} }; } while(0);`;
      }
      if (role === "ob") {
        const allNum = values.every((v) => typeof v === "number");
        const allText = values.every((v) => typeof v === "string");
        const allBool = values.every((v) => typeof v === "boolean");
        if (allNum) {
          const literal = values.map((v) => (typeof v === "number" ? v : Number(v) || 0)).join(", ");
          markDeclared("num");
          if (needsDecl) {
            return `double ${vecName}_values_${suffix}[] = { ${literal} };\npya_vec ${vecName} = { "num", ${values.length}, ${vecName}_values_${suffix}, NULL };`;
          }
          return `do { double ${vecName}_values_${suffix}[] = { ${literal} }; ${vecName} = (pya_vec){ "num", ${values.length}, ${vecName}_values_${suffix}, NULL }; } while(0);`;
        }
        if (allText) {
          const literal = values.map((v) => JSON.stringify(String(v))).join(", ");
          markDeclared("text");
          if (needsDecl) {
            return `const char *${vecName}_values_${suffix}[] = { ${literal} };\npya_vec ${vecName} = { "text", ${values.length}, NULL, ${vecName}_values_${suffix} };`;
          }
          return `do { const char *${vecName}_values_${suffix}[] = { ${literal} }; ${vecName} = (pya_vec){ "text", ${values.length}, NULL, ${vecName}_values_${suffix} }; } while(0);`;
        }
        if (allBool) {
          const literal = values.map((v) => (v ? 1 : 0)).join(", ");
          markDeclared("bool");
          if (needsDecl) {
            return `double ${vecName}_values_${suffix}[] = { ${literal} };\npya_vec ${vecName} = { "bool", ${values.length}, ${vecName}_values_${suffix}, NULL };`;
          }
          return `do { double ${vecName}_values_${suffix}[] = { ${literal} }; ${vecName} = (pya_vec){ "bool", ${values.length}, ${vecName}_values_${suffix}, NULL }; } while(0);`;
        }
        return `/* TODO: json map enumeration supports scalar values only for C */`;
      }
      return `/* TODO: json map enumeration full entries not yet supported for C */`;
    }
    if (role === "su") {
      markDeclared("text");
      if (needsDecl) {
        return `let ${targetVar} = { su: { name: ${JSON.stringify(targetName)} }, ob: { ve: { type: "text", values: ${JSON.stringify(keys)} } }, be: "vector", mood: "ya" };\nglobalThis[${JSON.stringify(targetName)}] = ${targetVar};`;
      }
      return `${targetVar} = { su: { name: ${JSON.stringify(targetName)} }, ob: { ve: { type: "text", values: ${JSON.stringify(keys)} } }, be: "vector", mood: "ya" };\nglobalThis[${JSON.stringify(targetName)}] = ${targetVar};`;
    }
    if (role === "ob") {
      const type = values.every((v) => typeof v === "number")
        ? "num"
        : values.every((v) => typeof v === "string")
          ? "text"
          : values.every((v) => typeof v === "boolean")
            ? "bool"
            : "raw";
      markDeclared(type === "raw" ? "num" : type);
      if (needsDecl) {
        return `let ${targetVar} = { su: { name: ${JSON.stringify(targetName)} }, ob: { ve: { type: "${type}", values: ${JSON.stringify(values)} } }, be: "vector", mood: "ya" };\nglobalThis[${JSON.stringify(targetName)}] = ${targetVar};`;
      }
      return `${targetVar} = { su: { name: ${JSON.stringify(targetName)} }, ob: { ve: { type: "${type}", values: ${JSON.stringify(values)} } }, be: "vector", mood: "ya" };\nglobalThis[${JSON.stringify(targetName)}] = ${targetVar};`;
    }
    markDeclared("raw");
    const entries = keys.map((key) => ({ ve: { type: "raw", values: [key, jsonObj[key]] } }));
    if (needsDecl) {
      return `let ${targetVar} = { su: { name: ${JSON.stringify(targetName)} }, ob: { ve: { type: "raw", values: ${JSON.stringify(entries)} } }, be: "vector", mood: "ya" };\nglobalThis[${JSON.stringify(targetName)}] = ${targetVar};`;
    }
    return `${targetVar} = { su: { name: ${JSON.stringify(targetName)} }, ob: { ve: { type: "raw", values: ${JSON.stringify(entries)} } }, be: "vector", mood: "ya" };\nglobalThis[${JSON.stringify(targetName)}] = ${targetVar};`;
  }

  // Vector element read: ob name doors at num 2 be read to name picked do
  if (baseBe === "read" && ob?.name && ((ob.at?.num != null || ob.at?.genitive) || (sentence.at?.num != null || sentence.at?.genitive)) && (sentence.to?.name || sentenceArg)) {
    const baseName = sanitizeName(ob.name);
    const atSlot = ob.at ?? sentence.at;
    const idxExpr = (() => {
      if (atSlot?.num != null) {
        const idxVal = Number(atSlot.num);
        return Number.isNaN(idxVal) ? atSlot.num : idxVal;
      }
      if (atSlot?.genitive) {
        return pathFromGenitive(atSlot.genitive, sentenceArg, { locals, declared, localsTypes, declaredTypes, allowCGlobals: lang === "c" });
      }
      return null;
    })();
    if (idxExpr == null) return `// TODO: ${JSON.stringify(sentence)}`;
    const targetName = sentence.to?.name ?? sentence.su?.name ?? "result";
    const targetVar = sanitizeName(targetName);
    const lines = [];
    if (lang === "c") {
      if (cHelpers) {
        cHelpers.usesString = true;
        cHelpers.usesTextHelper = true;
        cHelpers.usesStdlib = true;
        cHelpers.usesPrintf = true;
      }
      const vecType = declaredVectorTypes?.get(ob.name) ?? "num";
      const needsDecl = !locals?.has(targetVar) && !declared?.has(targetVar);
      if (vecType === "num") {
        lines.push(needsDecl ? `double ${targetVar} = 0;` : "");
        if (needsDecl) locals?.add(targetVar);
        if (localsTypes) localsTypes.set(targetVar, "number");
        lines.push(`${targetVar} = ${baseName}.num_values[(int)(${idxExpr})];`);
      } else if (vecType === "text") {
        lines.push(needsDecl ? `char ${targetVar}[PYA_TEXT_CAP] = "";` : "");
        if (needsDecl) locals?.add(targetVar);
        if (localsTypes) localsTypes.set(targetVar, "text");
        lines.push(`snprintf(${targetVar}, PYA_TEXT_CAP, "%s", ${baseName}.text_values[(int)(${idxExpr})]);`);
      } else {
        lines.push(needsDecl ? `char ${targetVar}[PYA_TEXT_CAP] = "";` : "");
        if (needsDecl) locals?.add(targetVar);
        if (localsTypes) localsTypes.set(targetVar, "text");
        lines.push(`snprintf(${targetVar}, PYA_TEXT_CAP, "%s", (${baseName}.num_values[(int)(${idxExpr})] != 0) ? "truth" : "lie");`);
      }
      return lines.filter(Boolean).join("\n");
    }
    if (!locals?.has(baseName) && !declared?.has(baseName)) {
      lines.push(`const ${baseName} = remember(${JSON.stringify(ob.name)});`);
      locals?.add(baseName);
    }
    const vecType = declaredVectorTypes?.get(ob.name) ?? "num";
    if (!locals?.has(targetVar) && !declared?.has(targetVar)) {
      lines.push(`let ${targetVar} = { su: { name: "${targetName}" }, ob: {}, be: "${vecType === "num" ? "number" : "text"}", mood: "ya" };`);
      locals?.add(targetVar);
    }
    if (localsTypes) localsTypes.set(targetVar, vecType === "num" ? "number" : "text");
    const valVar = jsHelpers ? `_val_${jsHelpers.readCounter++}` : "_val";
    lines.push(`const ${valVar} = ${baseName}?.ob?.ve?.values?.[(${idxExpr})];`);
    if (vecType === "num") {
      lines.push(`${targetVar}.ob.num = ${valVar};`);
    } else {
      lines.push(`const _text = (${valVar} === true || ${valVar} === 1) ? "truth" : (${valVar} === false || ${valVar} === 0) ? "lie" : String(${valVar} ?? "");`);
      lines.push(`${targetVar}.ob.text = _text;`);
    }
    return lines.join("\n");
  }

	  // Map/foreach over vector: at all (ceremony or primitive verbs)
	  if (sentence.at?.name === "all" && lang === "c") {
      const fn = ceremonyFns?.get(baseBe);
      const vecName = sentence.ob?.name;
      if (!fn || !vecName) {
        return `/* TODO: ${JSON.stringify(sentence)} */`;
      }
      cHelpers.usesMapGlobals = true;
      const vecVar = sanitizeName(vecName);
      const vecType = declaredVectorTypes?.get(vecName) ?? "num";
      const lines = [];
      lines.push(`for (int i = 0; i < ${vecVar}.length; i++) {`);
      lines.push(`  atindex = i;`);
      if (vecType === "text") {
        lines.push(`  pya_ob_text = ${vecVar}.text_values[i];`);
      } else if (vecType === "bool" || vecType === "boolean") {
        lines.push(`  pya_ob_bool = ${vecVar}.num_values[i] != 0;`);
      } else {
        lines.push(`  pya_ob_num = ${vecVar}.num_values[i];`);
      }
      lines.push(`  ${fn}();`);
      lines.push(`}`);
      return lines.join("\n");
    }
	  if (sentence.at?.name === "all" && lang !== "c") {
	    if (ceremonyFns?.get(baseBe)) {
	      const fn = ceremonyFns.get(baseBe);
	      const inlineSet = new Set([...(declared || []), ...(locals || [])]);
	      const literal = inlineSentenceLiteral(sentence, inlineSet);
	      if (sentenceArg && sentence.by?.genitive?.chain?.[0] === "this") {
	        const byExpr = pathFromGenitive(sentence.by.genitive, sentenceArg, { locals, declared }) ?? "0";
	        return `{\n  const _ev = ${literal};\n  _ev.by = { num: (${byExpr} ?? 0) };\n  runAtAll(_ev, ${fn});\n}`;
	      }
	      return `runAtAll(${literal}, ${fn});`;
	    }
	    if (baseBe === "add" || baseBe === "subtract" || baseBe === "invert") {
	      if (sentenceArg) return `// TODO: ${JSON.stringify(sentence)}`;
	      const vecName = sentence.ob?.name;
	      const toName = sentence.to?.name;
	      const delta = Number(sentence.from?.num ?? sentence.ob?.num ?? 0);
	      const op = baseBe === "invert" ? "invert" : baseBe;
      const opBody =
        baseBe === "invert"
          ? `let val = elem;\n    if (typeof val === "number") return val * -1;\n    if (val === "truth" || val === true) return "lie";\n    if (val === "lie" || val === false) return "truth";\n    return val;`
          : baseBe === "add"
            ? `return (Number(elem) || 0) + ${Number.isNaN(delta) ? 0 : delta};`
            : `return (Number(elem) || 0) - ${Number.isNaN(delta) ? 0 : delta};`;
      const lines = [];
      lines.push(`{`);
      lines.push(`let vecFact = remember(${JSON.stringify(vecName ?? sentence.ob ?? "vec")}) || (typeof ${sanitizeName(vecName ?? "vec")} !== "undefined" ? ${sanitizeName(vecName ?? "vec")} : undefined);`);
      lines.push(`const values = vecFact?.ob?.ve?.values ?? vecFact?.ve?.values ?? [];`);
      lines.push(`const outVals = values.map((elem, i) => {`);
      lines.push(opBody.split("\n").map(l => `  ${l}`).join("\n"));
      lines.push(`});`);
      if (toName) {
        lines.push(`const fact = { su: { name: ${JSON.stringify(toName)} }, ob: { ve: { values: outVals } }, be: "vector", mood: "ya" };`);
        lines.push(`globalThis[${JSON.stringify(toName)}] = fact;`);
        lines.push(`if (typeof ${sanitizeName(toName)} !== "undefined") { ${sanitizeName(toName)} = fact; }`);
        lines.push(`/* end map */`);
      } else if (vecName) {
        lines.push(`if (vecFact?.ob?.ve) { vecFact.ob.ve.values = outVals; }`);
        lines.push(`const fallback = { su: { name: ${JSON.stringify(vecName)} }, ob: { ve: { values: outVals } }, be: "vector", mood: "ya" };`);
        lines.push(`const finalFact = vecFact || fallback;`);
        lines.push(`globalThis[${JSON.stringify(vecName)}] = finalFact;`);
        lines.push(`if (typeof ${sanitizeName(vecName)} !== "undefined") { ${sanitizeName(vecName)} = finalFact; }`);
        lines.push(`/* end map */`);
      } else {
        lines.push(`const fact = { ob: { ve: { values: outVals } }, be: "vector", mood: "ya" };`);
        lines.push(`/* end map */`);
      }
      lines.push(`}`);
      if (rememberFlag) rememberFlag.used = true;
      return lines.join("\n");
    }
  }

  const atSlot = sentence.at ?? ob.at;
  const atNum = atSlot?.num;
  const atGenitive = atSlot?.genitive;

  // Vector element write (JS)
  if (baseBe === "write" && (sentence.to?.name || ob?.name) && (atNum != null || atGenitive) && lang !== "c") {
    const vecNameRaw = sentence.to?.name ?? ob?.name;
    const baseName = sanitizeName(vecNameRaw);
    const genChain = Array.isArray(atGenitive?.chain) ? atGenitive.chain : [];
    const idxExpr =
      atNum != null
        ? (() => {
            const idxVal = Number(atNum);
            return Number.isNaN(idxVal) ? atNum : idxVal;
          })()
        : genChain.length === 3 && genChain[0] === "this" && genChain[2] === "num" && sentenceArg
          ? `${sentenceArg}.${genChain[1]}?.num ?? ${sentenceArg}.${genChain[1]}`
          : (sentenceArg && atGenitive)
            ? pathFromGenitive(atGenitive, sentenceArg, { locals, declared, localsTypes, declaredTypes })
            : null;
    if (idxExpr == null) return `// TODO: ${JSON.stringify(sentence)}`;

    let valueExpr = "undefined";
    if (ob?.num !== undefined) {
      const numVal = Number(ob.num);
      valueExpr = Number.isNaN(numVal) ? ob.num : numVal;
    } else if (ob?.text !== undefined) {
      valueExpr = JSON.stringify(ob.text);
    } else if (ob?.boolean !== undefined) {
      valueExpr = ob.boolean ? "\"truth\"" : "\"lie\"";
    } else if (ob?.genitive) {
      const genExpr = pathFromGenitive(ob.genitive, sentenceArg, { locals, declared, localsTypes, declaredTypes });
      if (genExpr) valueExpr = genExpr;
    } else if (ob?.name) {
      const nameExpr = exprForSlot(ob, { sentenceArg, locals, declared, defaultExpr: null, field: "num" });
      if (nameExpr) valueExpr = nameExpr;
    }

    const lines = [];
    if (!locals?.has(baseName) && !declared?.has(baseName)) {
      lines.push(`const ${baseName} = remember(${JSON.stringify(vecNameRaw)});`);
      locals?.add(baseName);
    }
    lines.push(`${baseName}.ob = ${baseName}.ob ?? {};`);
    lines.push(`${baseName}.ob.ve = ${baseName}.ob.ve ?? {};`);
    lines.push(`${baseName}.ob.ve.values = ${baseName}.ob.ve.values ?? [];`);
    lines.push(`const _idx = (${idxExpr});`);
    lines.push(`${baseName}.ob.ve.values[_idx] = ${valueExpr};`);
    return lines.join("\n");
  }

  // Vector element update in C: add/subtract/invert at index
  if (lang === "c") {
    const vecNameRaw = sentence.to?.name ?? ob?.name;
    if (baseBe === "write" && vecNameRaw && (atNum != null || atGenitive)) {
      if (cHelpers) {
        cHelpers.usesVectorType = true;
        cHelpers.usesString = true;
      }
      const vecName = sanitizeName(vecNameRaw);
      const idxExpr =
        atNum != null
          ? (() => {
              const idxVal = Number(atNum);
              return Number.isNaN(idxVal) ? atNum : idxVal;
            })()
          : atGenitive
            ? pathFromGenitive(atGenitive, sentenceArg, { locals, declared, allowCGlobals: true })
            : null;
      if (idxExpr == null) return `/* TODO: ${JSON.stringify(sentence)} */`;
      const numExpr =
        ob?.genitive
          ? (pathFromGenitive(ob.genitive, sentenceArg, { locals, declared, localsTypes, declaredTypes, allowCGlobals: true }) ?? "0")
          : (ob?.num !== undefined ? String(Number(ob.num) || 0) : (ob?.boolean ? "1" : "0"));
      const boolExpr =
        ob?.boolean !== undefined
          ? (ob.boolean ? "1" : "0")
          : ob?.text === "truth"
            ? "1"
            : ob?.text === "lie"
              ? "0"
              : numExpr;
      const textVal = ob?.text !== undefined ? JSON.stringify(ob.text) : "\"\"";
      const lines = [];
      lines.push(`int _idx = (int)(${idxExpr});`);
      lines.push(`if (_idx >= 0 && _idx < ${vecName}.length) {`);
      lines.push(`  if (!${vecName}.type || strcmp(${vecName}.type, "num") == 0) {`);
      lines.push(`    ${vecName}.num_values[_idx] = ${numExpr};`);
      lines.push(`  } else if (strcmp(${vecName}.type, "bool") == 0) {`);
      lines.push(`    ${vecName}.num_values[_idx] = ${boolExpr};`);
      lines.push(`  } else if (strcmp(${vecName}.type, "text") == 0) {`);
      lines.push(`    ${vecName}.text_values[_idx] = ${textVal};`);
      lines.push("  }");
      lines.push("}");
      return lines.join("\n");
    }
    if ((baseBe === "add" || baseBe === "subtract" || baseBe === "invert") && vecNameRaw && (atNum != null || atGenitive)) {
      if (cHelpers) {
        cHelpers.usesVectorType = true;
        cHelpers.usesString = true;
      }
      const vecName = sanitizeName(vecNameRaw);
      const idxExpr =
        atNum != null
          ? (() => {
              const idxVal = Number(atNum);
              return Number.isNaN(idxVal) ? atNum : idxVal;
            })()
          : atGenitive
            ? pathFromGenitive(atGenitive, sentenceArg, { locals, declared, allowCGlobals: true })
            : null;
      if (idxExpr == null) return `/* TODO: ${JSON.stringify(sentence)} */`;
      const deltaVal = Number(ob?.num ?? sentence.from?.num ?? 0);
      const delta = Number.isNaN(deltaVal) ? 0 : deltaVal;
      const lines = [];
      lines.push(`int _idx = (int)(${idxExpr});`);
      lines.push(`if (_idx >= 0 && _idx < ${vecName}.length) {`);
      lines.push(`  if (!${vecName}.type || strcmp(${vecName}.type, "num") == 0) {`);
      if (baseBe === "invert") {
        lines.push(`    ${vecName}.num_values[_idx] = -${vecName}.num_values[_idx];`);
      } else if (baseBe === "add") {
        lines.push(`    ${vecName}.num_values[_idx] += ${delta};`);
      } else {
        lines.push(`    ${vecName}.num_values[_idx] -= ${delta};`);
      }
      lines.push(`  } else if (strcmp(${vecName}.type, "bool") == 0) {`);
      if (baseBe === "invert") {
        lines.push(`    ${vecName}.num_values[_idx] = ${vecName}.num_values[_idx] != 0 ? 0 : 1;`);
      }
      lines.push("  }");
      lines.push("}");
      return lines.join("\n");
    }
  }

  // Vector element invert (toggle boolean or numeric 0/1): invert ob name doors at num 2 do
  if (baseBe === "invert" && ob?.name && (atNum != null || atGenitive) && lang !== "c") {
    const baseName = sanitizeName(ob.name);
    const genChain = Array.isArray(atGenitive?.chain) ? atGenitive.chain : [];
    const idxExpr =
      atNum != null
        ? (() => {
            const idxVal = Number(atNum);
            return Number.isNaN(idxVal) ? atNum : idxVal;
          })()
        : genChain.length === 3 && genChain[0] === "this" && genChain[2] === "num" && sentenceArg
          ? `${sentenceArg}.${genChain[1]}?.num ?? ${sentenceArg}.${genChain[1]}`
          : (sentenceArg && atGenitive)
            ? pathFromGenitive(atGenitive, sentenceArg)
            : null;
    if (idxExpr == null) return `// TODO: ${JSON.stringify(sentence)}`;
    const lines = [];
    if (!locals?.has(baseName) && !declared?.has(baseName)) {
      lines.push(`const ${baseName} = remember(${JSON.stringify(ob.name)});`);
      locals?.add(baseName);
    }
    lines.push(`${baseName}.ob = ${baseName}.ob ?? {};`);
    lines.push(`${baseName}.ob.ve = ${baseName}.ob.ve ?? {};`);
    lines.push(`${baseName}.ob.ve.values = ${baseName}.ob.ve.values ?? [];`);
    lines.push(`const _idx = (${idxExpr});`);
    lines.push(`const _curr = ${baseName}.ob.ve.values[_idx];`);
    lines.push(`if (${baseName}.ob.ve.type === "num" || typeof _curr === "number") {`);
    lines.push(`  ${baseName}.ob.ve.values[_idx] = (Number(_curr) || 0) * -1;`);
    lines.push(`} else {`);
    lines.push(`  ${baseName}.ob.ve.values[_idx] = (_curr === "truth" || _curr === true || _curr === 1) ? "lie" : "truth";`);
    lines.push(`}`);
    return lines.join("\n");
  }

  // Mind (JS only)
  if (baseBe === "mind") {
    if (lang === "c") {
      if (cHelpers) {
        cHelpers.usesMindRuntime = true;
        cHelpers.usesJsonRuntime = true;
        cHelpers.usesTextHelper = true;
        cHelpers.usesString = true;
        cHelpers.usesStdlib = true;
        cHelpers.usesPrintf = true;
        cHelpers.usesCtype = true;
        cHelpers.usesExchange = true;
        cHelpers.usesMap = true;
      }
      const mindName = sentence.to?.name ?? ob.to?.name ?? sentence.su?.name ?? "mind";
      if (sentence.mood === "ya") {
        if (declaredTypes) declaredTypes.set(mindName, "mind");
        const space = sentence.from?.name ?? ob.space ?? null;
        const model = sentence.as?.name ?? ob.model ?? null;
        const prompt = sentence.accordingto?.name ?? ob.text ?? null;
        const window = sentence.by?.num ?? sentence.by?.quantity?.num ?? sentence.ob?.window?.num ?? ob.window?.num ?? null;
        const lines = [];
        lines.push(`pya_mind_set_config(${JSON.stringify(mindName)}, ${space ? JSON.stringify(space) : "NULL"}, ${model ? JSON.stringify(model) : "NULL"}, ${prompt ? JSON.stringify(prompt) : "NULL"}, ${window ? Number(window) || 8 : 0});`);
        return lines.join("\n");
      }
      const userText = ob.text
        ? JSON.stringify(ob.text)
        : ob.name
          ? JSON.stringify(ob.name)
          : "\"\"";
      const explicitModel = ob.model ? JSON.stringify(ob.model) : "NULL";
      const windowVal = sentence.by?.num ?? sentence.by?.quantity?.num ?? ob.window?.num ?? null;
      const dialogue = sentence.from?.text
        ?? sentence.fromtext?.name
        ?? sentence.fromtext?.text
        ?? `${mindName} story`;
      const toolMapName = sentence.with?.name ?? null;
      const toolVar = toolMapName && (declaredTypes?.get(toolMapName) === "map" || declaredTypes?.get(toolMapName) === "json map" || declaredTypes?.get(toolMapName) === "csv map")
        ? sanitizeName(toolMapName)
        : null;
      const lines = ["{"];
      lines.push(`const char *dialogue = ${JSON.stringify(String(dialogue))};`);
      if (toolVar) {
        lines.push(`char *tool_block = pya_tool_block_from_map(&${toolVar});`);
      } else {
        lines.push("char *tool_block = NULL;");
      }
      lines.push("int __pyaAnswerCount = 0;");
      lines.push(`char *reply = pya_mind_invoke(${JSON.stringify(mindName)}, dialogue, ${userText}, tool_block, ${explicitModel}, ${windowVal !== null ? Number(windowVal) || 8 : 0}, &__pyaAnswerCount);`);
      lines.push("if (!reply) reply = pya_strdup(\"\");");
      lines.push("char __pyaAnswerName[PYA_TEXT_CAP];");
      lines.push(`snprintf(__pyaAnswerName, sizeof(__pyaAnswerName), "%s answer %d", ${JSON.stringify(mindName)}, __pyaAnswerCount);`);
      lines.push("char __pyaQuestionName[PYA_TEXT_CAP];");
      lines.push(`snprintf(__pyaQuestionName, sizeof(__pyaQuestionName), "%s %s question %d", ${JSON.stringify(mindName)}, dialogue, __pyaAnswerCount);`);
      lines.push("char __pyaDialogueAnswerName[PYA_TEXT_CAP];");
      lines.push(`snprintf(__pyaDialogueAnswerName, sizeof(__pyaDialogueAnswerName), "%s %s answer %d", ${JSON.stringify(mindName)}, dialogue, __pyaAnswerCount);`);
      lines.push("char __pyaEscaped[PYA_TEXT_CAP];");
      lines.push("pya_escape_text(reply, __pyaEscaped, sizeof(__pyaEscaped));");
      lines.push("char __pyaToolResult[PYA_TEXT_CAP];");
      lines.push(`snprintf(__pyaToolResult, sizeof(__pyaToolResult), "su name %s from name ${mindName} ob text \\\"%s\\\" be answer ya", __pyaAnswerName, __pyaEscaped);`);
      lines.push(`char __pyaToolEvoked[PYA_TEXT_CAP];`);
      lines.push(`snprintf(__pyaToolEvoked, sizeof(__pyaToolEvoked), "%s", ${JSON.stringify(sentenceToPyash(sentence))});`);
      lines.push("char __pyaToolEvent[PYA_TEXT_CAP];");
      lines.push("snprintf(__pyaToolEvent, sizeof(__pyaToolEvent), \"su name tool event %d ob la %s ko to la %s ko be tool ya\", pya_next_tool_event_id(), __pyaToolEvoked, __pyaToolResult);");
      lines.push("pya_emit_exchange(__pyaToolEvent);");
      lines.push("printf(\"%s\\n\", reply);");
      lines.push("if (tool_block) free(tool_block);");
      lines.push("free(reply);");
      lines.push("}");
      return lines.join("\n");
    }
    if (mindShim) mindShim.used = true;

    const mindName = sentence.to?.name ?? ob.to?.name ?? sentence.su?.name ?? "mind";

    // Configuration sentence (ya mood)
    if (sentence.mood === "ya") {
      if (declaredTypes) declaredTypes.set(mindName, "mind");
      const space = sentence.from?.name ?? ob.space ?? null;
      const model = sentence.as?.name ?? ob.model ?? null;
      const prompt = sentence.accordingto?.name ?? ob.text ?? null;
      const window = sentence.by?.num ?? sentence.by?.quantity?.num ?? sentence.ob?.window?.num ?? ob.window?.num ?? null;
      const lines = [];
      lines.push(`mindConfigs.set(${JSON.stringify(mindName)}, {`);
      if (space) lines.push(`  space: ${JSON.stringify(space)},`);
      if (model) lines.push(`  model: ${JSON.stringify(model)},`);
      if (prompt) lines.push(`  prompt: ${JSON.stringify(prompt)},`);
      if (window) lines.push(`  window: ${Number(window) || 8},`);
      lines.push("});");
      return lines.join("\n");
    }

    // Invocation
    const resultName = sentence.su?.name ?? "mind_result";
    const explicitModel = ob.model ? JSON.stringify(ob.model) : null;
    const userText = ob.text
      ? JSON.stringify(ob.text)
      : ob.name
        ? JSON.stringify(ob.name)
        : "\"\"";
    const lines = ["{"]; // block scope per invocation
    if (sentence.with?.name) {
      if (jsHelpers) jsHelpers.usesVectorFormat = true;
      if (rememberFlag) rememberFlag.used = true;
    }
    lines.push(`const cfg = mindConfigs.get(${JSON.stringify(mindName)}) || {};`);
    lines.push(`const host = cfg.space || ((typeof process !== "undefined" && process.env?.OLLAMA_HOST) ? process.env.OLLAMA_HOST : undefined) || "http://localhost:11434";`);
    lines.push(`const model = ${explicitModel ?? "cfg.model || \"qwen3-vl:8b-instruct\""};`);
    const windowVal = sentence.by?.num ?? sentence.by?.quantity?.num ?? ob.window?.num ?? null;
    const dialogue = sentence.from?.text
      ?? sentence.fromtext?.name
      ?? sentence.fromtext?.text
      ?? `${mindName} story`;
    lines.push(`const dialogue = ${JSON.stringify(String(dialogue))};`);
    lines.push(`const historyMessages = buildMindHistory(dialogue, ${windowVal !== null ? Number(windowVal) || 8 : "cfg.window || 8"});`);
    lines.push("const messages = [];");
    lines.push("if (cfg.prompt) messages.push({ role: \"system\", content: cfg.prompt });");
    if (sentence.with?.name) {
      const toolMapName = JSON.stringify(sentence.with.name);
      lines.push(`const toolMap = remember(${toolMapName});`);
      lines.push("const toolEntries = toolMap?.ob?.map ?? {};");
      lines.push("const toolKeys = Object.keys(toolEntries).sort(compareUtf8);");
      lines.push("const toolLines = toolKeys.map(k => { const entry = toolEntries[k]; return (entry?.mood && entry?.be) ? formatSentence(entry) : \"\"; }).filter(Boolean);");
      lines.push("if (toolLines.length) messages.push({ role: \"system\", content: `TOOLS:\\n${toolLines.join(\"\\n\")}` });");
    }
    lines.push("messages.push(...historyMessages);");
    lines.push(`messages.push({ role: "user", content: ${userText} });`);
    lines.push("const reply = await callMind({ host, model, messages, numCtx: cfg.numCtx || 8192 });");
    const resVar = sanitizeName(resultName);
    lines.push(`recordMindTurn(dialogue, { role: "user", content: ${userText} }, { role: "assistant", content: reply }, ${windowVal !== null ? Number(windowVal) || 8 : "cfg.window || 8"});`);
    lines.push("const __pyaAnswerCount = (mindAnswerCounters.get(dialogue) || 0) + 1;");
    lines.push("mindAnswerCounters.set(dialogue, __pyaAnswerCount);");
    lines.push(`const ${resVar} = { su: { name: ${JSON.stringify(mindName)} + " answer " + __pyaAnswerCount }, from: { name: ${JSON.stringify(mindName)} }, ob: { text: reply }, be: "answer", mood: "ya" };`);
    lines.push(`globalThis[${resVar}.su.name] = ${resVar};`);
    lines.push(`const __pyaQuestionName = ${JSON.stringify(mindName)} + " " + dialogue + " question " + __pyaAnswerCount;`);
    lines.push(`globalThis[__pyaQuestionName] = { su: { name: __pyaQuestionName }, from: { name: "user" }, ob: { text: ${userText} }, be: "write", mood: "ya" };`);
    lines.push(`const __pyaDialogueAnswerName = ${JSON.stringify(mindName)} + " " + dialogue + " answer " + __pyaAnswerCount;`);
    lines.push(`globalThis[__pyaDialogueAnswerName] = { su: { name: __pyaDialogueAnswerName }, from: { name: ${JSON.stringify(mindName)} }, ob: { text: reply }, be: "answer", mood: "ya" };`);
    lines.push(`const __pyaToolEvoked = ${JSON.stringify(sentenceToPyash(sentence))};`);
    lines.push(`const __pyaToolResult = "su name " + ${JSON.stringify(mindName)} + " answer " + __pyaAnswerCount + " from name " + ${JSON.stringify(mindName)} + " ob text " + JSON.stringify(reply) + " be answer ya";`);
    lines.push(`pyaEmitNewspaper(\`su name tool event \${pyaNextToolEventId()} ob la \${__pyaToolEvoked} ko to la \${__pyaToolResult} ko be tool ya\`);`);
    lines.push(`console.log(${resVar}.ob?.text ?? ${resVar}.ob?.num);`);
    lines.push("}");
    return lines.join("\n");
  }

	  // Conditionals (tiny/giant/equally) with then consequence
	  if (sentence.consequence && (baseBe === "tiny" || baseBe === "giant" || baseBe === "equally")) {
	    const lhsSlot =
	      (ob && (ob.name || ob.num !== undefined || ob.text !== undefined || ob.genitive || ob.thisRef))
	        ? ob
	        : (sentence.su?.name ? { name: sentence.su.name } : ob);
	    const comparesText =
	      lhsSlot?.text !== undefined ||
	      sentence.from?.text !== undefined ||
	      (lhsSlot?.name && localsTypes?.get(sanitizeName(lhsSlot.name)) === "text");
	    const lhs = (() => {
	      if (lhsSlot?.name) {
	        const baseName = sanitizeName(lhsSlot.name);
	        if (locals?.has(baseName)) {
	          return comparesText ? `${baseName}.ob?.text` : `${baseName}.ob?.num ?? ${baseName}`;
	        }
	      }
	      return exprForSlot(lhsSlot, {
	        sentenceArg,
	        locals,
	        declared,
	        defaultExpr: sentenceArg ? (comparesText ? `${sentenceArg}.ob?.text` : `${sentenceArg}.ob?.num`) : "lhs",
	        field: comparesText ? "text" : "num"
	      }) ?? "lhs";
	    })();
	    const rhs = exprForSlot(sentence.from, {
	      sentenceArg,
	      locals,
	      declared,
	      defaultExpr: sentenceArg ? (comparesText ? `${sentenceArg}.from?.text` : `${sentenceArg}.from?.num`) : "rhs",
	      field: comparesText ? "text" : "num"
	    }) ?? "rhs";
	    const op = baseBe === "tiny" ? "<" : baseBe === "giant" ? ">" : (lang === "c" ? "==" : "===");
	    const consequence = sentence.consequence;
	    const body = transpileSentence(consequence, { lang, sentenceArg, locals, localsTypes, declared, declaredTypes, declaredVectorTypes }) ?? `// TODO: ${JSON.stringify(consequence)}`;
	    const finalBody = body.split("\n").map(l => (l ? `  ${l}` : l)).join("\n");
    const cLhs = lang === "c"
      ? String(lhs)
          .replace(/\?\./g, ".")
          .replace(/\.ob\.(num|text|name|boolean)\b/g, "")
          .replace(/\s*\?\?\s*[^)]+/g, "")
      : lhs;
    const cRhs = lang === "c"
      ? String(rhs)
          .replace(/\?\./g, ".")
          .replace(/\.ob\.(num|text|name|boolean)\b/g, "")
          .replace(/\s*\?\?\s*[^)]+/g, "")
      : rhs;
	    const jsLhs = `(${lhs})`;
	    const jsRhs = `(${rhs})`;
    const cLhsWrapped = `(${cLhs})`;
    const cRhsWrapped = `(${cRhs})`;
    if (lang === "c" && comparesText && baseBe === "equally") {
      return `if (strcmp(${cLhsWrapped}, ${cRhsWrapped}) == 0) {\n${finalBody}\n}`;
    }
	    return `if (${lang === "c" ? cLhsWrapped : jsLhs} ${op} ${lang === "c" ? cRhsWrapped : jsRhs}) {\n${finalBody}\n}`;
	  }

  // Dot product (produce) for vectors
  if (baseBe === "produce" && (ob?.ve || ob?.name || sentence.by || sentence.from)) {
    const leftSlot = (ob && Object.keys(ob).length) ? ob : sentence.from;
    const leftVec = vectorValuesExpr(leftSlot, { sentenceArg, locals, declared });
    const rightVec = vectorValuesExpr(sentence.by || sentence.from, { sentenceArg, locals, declared });
    const targetName = sentence.to?.name || "result";
    const targetBase = sanitizeName(targetName);
    const targetLval = lvalueForName(targetName, { declared, locals, field: "num" });

    const resultName = targetName === "result" ? targetName : "result";
    const resultBase = sanitizeName(resultName);
    const resultLval = lvalueForName(resultName, { declared, locals, field: "num" });

    const lines = [];
    lines.push(`const _a = ${leftVec};`);
    lines.push(`const _b = ${rightVec};`);
    lines.push(`if (_a.length !== _b.length) throw new Error("produce: vectors must be the same length");`);
    lines.push(`let _sum = 0;`);
    lines.push(`for (let i = 0; i < _a.length; i++) { const x = Number(_a[i]); const y = Number(_b[i]); if (Number.isNaN(x) || Number.isNaN(y)) throw new Error("produce: numeric values required"); _sum += x * y; }`);

    const ensureTargetObject = () => {
      if (!declared?.has(targetBase) && !locals?.has(targetBase)) {
        lines.push(`let ${targetBase} = { su: { name: "${targetName}" }, ob: {}, be: "number", mood: "ya" };`);
        declared?.add(targetBase);
      }
    };
    const ensureResultObject = () => {
      if (!declared?.has(resultBase) && !locals?.has(resultBase)) {
        lines.push(`let ${resultBase} = { su: { name: "${resultName}" }, ob: {}, be: "number", mood: "ya" };`);
        declared?.add(resultBase);
      }
    };

    ensureTargetObject();
    const targetAssign = targetLval.includes(".ob.") ? targetLval : `${targetBase}.ob.num`;
    lines.push(`${targetAssign} = _sum;`);

    ensureResultObject();
    const resultAssign = resultLval.includes(".ob.") ? resultLval : `${resultBase}.ob.num`;
    lines.push(`${resultAssign} = _sum;`);

    return lines.join("\n");
  }

  // Text concatenation via add (numeric source)
  if (baseBe === "add" && (sentence.to?.name || sentence.to?.genitive)) {
    const objExpr = exprForSlot(ob, { sentenceArg, locals, declared, defaultExpr: null, field: "num" });
    const objTextExpr = exprForSlot(ob, { sentenceArg, locals, declared, defaultExpr: null, field: "text" });
    const targetName = sentence.to?.name ? sanitizeName(sentence.to.name) : null;
    const targetIsText =
      targetName &&
      (localsTypes?.get(targetName) === "text" || declaredTypes?.get(targetName) === "text");
    const canUseTextExpr =
      typeof ob.text === "string" ||
      (ob?.name && (localsTypes?.get(sanitizeName(ob.name)) === "text" || declaredTypes?.get(sanitizeName(ob.name)) === "text"));
    const valueExpr =
      (canUseTextExpr && objTextExpr !== null)
        ? (typeof ob.text === "string" ? JSON.stringify(ob.text) : `String(${objTextExpr})`)
        : (objExpr !== null ? `String(${objExpr})` : null);
    if (targetIsText && valueExpr !== null) {
      if (sentenceArg) {
        const target = (() => {
          if (sentence.to?.name) {
            const baseName = sanitizeName(sentence.to.name);
            if (locals?.has(baseName)) return `${baseName}.ob.text`;
            if (declaredTypes?.get(baseName) === "text") return `${baseName}.ob.text`;
          }
          return targetPath("to", sentenceArg, "text", sentence.to, { locals, declared }) ?? sentence.to?.name;
        })();
        const init = `${target} = ${target} ?? "";`;
        const concat = `${target} = ${target} + ${valueExpr};`;
        return `${init}\n${concat}`;
      }
      if (lang === "c") {
        if (cHelpers) {
          cHelpers.usesTextHelper = true;
          cHelpers.usesString = true;
          cHelpers.usesPrintf = true;
        }
        const target = sanitizeName(sentence.to.name);
        if (typeof ob.text === "string") {
          return `pya_concat_buf(${target}, ${JSON.stringify(ob.text)});`;
        }
        const numExpr = exprForSlot(ob, { sentenceArg, locals, declared, defaultExpr: "0", field: "num" }) ?? "0";
        return `pya_concat_num_buf(${target}, ${numExpr});`;
      }
      return `${sentence.to.name}.ob = ${sentence.to.name}.ob ?? {};\n${sentence.to.name}.ob.text = (${sentence.to.name}.ob.text ?? \"\") + ${valueExpr};`;
    }
  }

  // Imperative add
  if (baseBe === "add" && ob.num !== undefined && sentenceArg && !sentence.to) {
    const increment = typeof ob.num === "number" ? ob.num : Number(ob.num);
    const safeInc = Number.isNaN(increment) ? 0 : increment;
    const lines = [];
    lines.push(`${sentenceArg}.ob = ${sentenceArg}.ob ?? {};`);
    lines.push(`const _target = ${sentenceArg}.ob?.ob ?? ${sentenceArg}.ob;`);
    lines.push(`_target.num = (_target.num ?? 0) + ${safeInc};`);
    return lines.join("\n");
  }

	  if (baseBe === "add" && ob.num !== undefined && (sentence.to?.name || sentence.to?.genitive)) {
      const mapName = sentence.to?.name;
      const targetType = mapName ? declaredTypes?.get(mapName) : null;
      if (mapName && (targetType === "map" || targetType === "json map" || mapDefs?.has(mapName))) {
        const safeValue = typeof ob.num === "number" ? ob.num : Number(ob.num);
        if (lang === "c") {
          cHelpers.usesMap = true;
          cHelpers.usesMapGlobals = true;
          cHelpers.usesString = true;
          cHelpers.usesStdlib = true;
          cHelpers.usesPrintf = true;
          cHelpers.usesCtype = true;
          const mapVar = sanitizeName(mapName);
          const keyChain = sentence.su?.genitive?.chain;
          const keyTail = Array.isArray(keyChain) ? keyChain.at(-1) : null;
          const rawKey = (() => {
            if (sentence.su?.genitive) {
              return pathFromGenitive(sentence.su.genitive, sentenceArg, { locals, declared, localsTypes, declaredTypes, allowCGlobals: true }) ?? "0";
            }
            if (sentence.su?.text !== undefined) return JSON.stringify(sentence.su.text);
            if (sentence.su?.num !== undefined) return String(Number.isNaN(Number(sentence.su.num)) ? 0 : Number(sentence.su.num));
            if (sentence.su?.boolean !== undefined) return sentence.su.boolean ? "1" : "0";
            if (sentence.su?.name) return JSON.stringify(sentence.su.name);
            return "0";
          })();
          const lines = [];
          let keyExpr = rawKey;
          if (keyTail === "num" || typeof sentence.su?.num !== "undefined") {
            lines.push(`char _key_buf[64];`);
            lines.push(`snprintf(_key_buf, sizeof(_key_buf), "%g", ${rawKey});`);
            keyExpr = "_key_buf";
          } else if (keyTail === "boolean" || typeof sentence.su?.boolean !== "undefined") {
            lines.push(`char _key_buf[8];`);
            lines.push(`snprintf(_key_buf, sizeof(_key_buf), "%s", (${rawKey}) ? "truth" : "lie");`);
            keyExpr = "_key_buf";
          }
          const addFn = targetType === "map" ? "pya_map_add_sentence_num" : "pya_map_add_num";
          lines.push(`${addFn}(&${mapVar}, ${keyExpr}, ${Number.isNaN(safeValue) ? 0 : safeValue});`);
          return lines.join("\n");
        }
        const mapVar = sanitizeName(mapName);
        const keyExpr = (() => {
          if (sentence.su?.genitive && sentenceArg) {
            return pathFromGenitive(sentence.su.genitive, sentenceArg, { locals, declared, localsTypes, declaredTypes }) ?? "undefined";
          }
          if (sentence.su?.text !== undefined) return JSON.stringify(sentence.su.text);
          if (sentence.su?.num !== undefined) return String(Number.isNaN(Number(sentence.su.num)) ? 0 : Number(sentence.su.num));
          if (sentence.su?.boolean !== undefined) return sentence.su.boolean ? "\"truth\"" : "\"lie\"";
          if (sentence.su?.name) return JSON.stringify(sentence.su.name);
          return "undefined";
        })();
        const lines = [];
        if (!locals?.has(mapVar) && !declared?.has(mapVar)) {
          lines.push(`const ${mapVar} = remember(${JSON.stringify(mapName)});`);
          locals?.add(mapVar);
        }
        lines.push(`${mapVar}.ob = ${mapVar}.ob ?? {};`);
        lines.push(`${mapVar}.ob.map = ${mapVar}.ob.map ?? {};`);
        lines.push(`const _key = String(${keyExpr});`);
        lines.push(`const _curr = ${mapVar}.ob.map[_key];`);
        if (targetType === "map") {
          lines.push(`const _base = (_curr && typeof _curr === "object") ? _curr : { mood: "ya", su: { name: _key } };`);
          lines.push(`_base.ob = _base.ob ?? {};`);
          lines.push(`_base.ob.num = (typeof _base.ob.num === "number" ? _base.ob.num : 0) + ${Number.isNaN(safeValue) ? 0 : safeValue};`);
          lines.push(`${mapVar}.ob.map[_key] = _base;`);
        } else {
          lines.push(`${mapVar}.ob.map[_key] = { num: (typeof _curr?.num === "number" ? _curr.num : 0) + ${Number.isNaN(safeValue) ? 0 : safeValue} };`);
        }
        return lines.join("\n");
      }
	    const safeValue = typeof ob.num === "number" ? ob.num : Number(ob.num);
	    if (sentenceArg) {
	      // Compiler-only sugar: inside ceremonies, `to <localName>` targets the local fact object.
	      if (sentence.to?.name) {
	        const localName = sanitizeName(sentence.to.name);
	        if (locals?.has(localName)) {
	          const inc = Number.isNaN(safeValue) ? 0 : safeValue;
	          const lines = [];
	          lines.push(`${localName}.ob = ${localName}.ob?.ob ?? ${localName}.ob ?? {};`);
	          lines.push(`${localName}.ob.num = (${localName}.ob.num ?? 0) + ${inc};`);
	          return lines.join("\n");
	        }
	      }
	      const genitiveChain = sentence.to?.genitive?.chain || [];
	      const genitiveHint = genitiveChain.find(part => part !== "this");
	      const targetNameLiteral = sentence.to?.name
	        ? `"${sentence.to.name}"`
	        : genitiveHint
          ? `"${genitiveHint}"`
          : sentence.su?.name
            ? `"${sentence.su.name}"`
            : "\"\"";
      const targetVarName = sanitizeName((sentence.to?.name || genitiveHint || sentence.su?.name || "sentence"));
      const isThisGenitive = sentence.to?.genitive?.chain?.[0] === "this";
      const targetVar = isThisGenitive ? sentenceArg : targetVarName || "sentence";
      const targetExpr = sentence.to
        ? isThisGenitive
          ? sentenceArg
          : `${sentenceArg}.to ?? { su: { name: ${targetNameLiteral} }, ob: {} }`
        : sentenceArg;
      const lines = [];
      if (!isThisGenitive && !locals?.has(targetVar) && !declared?.has(targetVar)) {
        lines.push(`const ${targetVar} = remember(${targetExpr});`);
        locals?.add(targetVar);
      }
	      lines.push(`${targetVar}.ob = ${targetVar}.ob?.ob ?? ${targetVar}.ob ?? {};`);
	      const fieldPath = sentence.to?.genitive
	        ? pathFromGenitive(sentence.to.genitive, targetVar, { locals, declared }) || `${targetVar}.ob.num`
	        : `${targetVar}.ob.num`;
      const newVal = `${fieldPath} ?? 0`;
      lines.push(`${fieldPath} = (${newVal}) + ${Number.isNaN(safeValue) ? 0 : safeValue};`);
      return lines.join("\n");
    }
    if (lang === "c") {
      const target = sanitizeName(sentence.to.name);
      return `${target} = ${target} + ${Number.isNaN(safeValue) ? 0 : safeValue};`;
    }
    const lines = [];
    lines.push(`${sentence.to.name}.ob = ${sentence.to.name}.ob ?? {};`);
    lines.push(`${sentence.to.name}.ob.num = (${sentence.to.name}.ob.num ?? 0) + ${Number.isNaN(safeValue) ? 0 : safeValue};`);
    return lines.join("\n");
  }

  // Text concatenation via add
  if (baseBe === "add" && typeof ob.text === "string" && (sentence.to?.name || sentence.to?.genitive)) {
    const literal = JSON.stringify(ob.text);
    if (sentenceArg) {
      const target = (() => {
        if (sentence.to?.name) {
          const baseName = sanitizeName(sentence.to.name);
          if (locals?.has(baseName)) return `${baseName}.ob.text`;
        }
        return targetPath("to", sentenceArg, "text", sentence.to, { locals, declared }) ?? sentence.to?.name;
      })();
      const init = `${target} = ${target} ?? "";`;
      const concat = `${target} = ${target} + ${literal};`;
      return `${init}\n${concat}`;
    }
    if (lang === "c") {
      const target = sentence.to.name;
      return `/* TODO: string concat add for ${target} */`;
    }
    return `${sentence.to.name}.ob = ${sentence.to.name}.ob ?? {};\n${sentence.to.name}.ob.text = (${sentence.to.name}.ob.text ?? "") + ${literal};`;
  }

  if (baseBe === "remember" && sentenceArg) {
    const genitiveChain = sentence.ob?.genitive?.chain || [];
    const genitiveHint = genitiveChain.filter(part => part !== "this").at(-1);
    const rawName = sentence.to?.name?.split(" ")[0] || genitiveHint || "remembered";
    const targetVar = sanitizeName(rawName) || "remembered";
    const source = sentence.ob?.genitive
      ? pathFromGenitive(sentence.ob.genitive, sentenceArg) || `${sentenceArg}.ob`
      : `${sentenceArg}.to`;
    const lines = [];
    if (sentence.exists || sentence.to?.name) {
      lines.push(`let ${targetVar};`);
    }
    lines.push(`${targetVar} = remember(${source});`);
    locals?.add(targetVar);
    return lines.join("\n");
  }

  if (baseBe === "subtract" && ob.num !== undefined && ((sentence.to?.name || sentence.from?.name) || sentenceArg)) {
    const safeValue = typeof ob.num === "number" ? ob.num : Number(ob.num);
    if (sentenceArg) {
      const targetSlot = sentence.to ?? sentence.from;
      const targetRole = sentence.to ? "to" : "from";
      const hasGenitive = Boolean(targetSlot?.genitive);
      if (!hasGenitive && targetSlot?.name) {
        const baseName = sanitizeName(targetSlot.name);
        const lines = [];
        if (!locals?.has(baseName) && !declared?.has(baseName)) {
          lines.push(`let ${baseName};`);
          locals?.add(baseName);
          if (localsTypes) localsTypes.set(baseName, "number");
        }
        if (lang === "c") {
          lines.push(`${baseName} = (${baseName} ?? 0) - ${Number.isNaN(safeValue) ? 0 : safeValue};`);
        } else {
          lines.push(`${baseName}.ob = ${baseName}.ob ?? {};`);
          lines.push(`${baseName}.ob.num = (${baseName}.ob.num ?? 0) - ${Number.isNaN(safeValue) ? 0 : safeValue};`);
        }
        return lines.join("\n");
      }
      const target = targetPath(targetRole, sentenceArg, "num", targetSlot, { locals, declared }) ?? targetSlot?.name;
      return `${target} = (${target} ?? 0) - ${Number.isNaN(safeValue) ? 0 : safeValue};`;
    }
    const targetSlot = sentence.to ?? sentence.from;
    const targetName = targetSlot?.name;
    if (!targetName) return `// TODO: ${JSON.stringify(sentence)}`;
    if (lang === "c") {
      return `${targetName} = ${targetName} - ${Number.isNaN(safeValue) ? 0 : safeValue};`;
    }
    return `${targetName}.ob = ${targetName}.ob ?? {};\n${targetName}.ob.num = (${targetName}.ob.num ?? 0) - ${Number.isNaN(safeValue) ? 0 : safeValue};`;
  }

  if (
    baseBe === "multiply" &&
    sentence.by &&
    (sentence.ob || sentence.from) &&
    (sentence.to?.name || sentenceArg) &&
    (sentence.by?.name || sentence.by?.genitive || sentence.by?.thisRef || sentence.ob?.name || sentence.ob?.genitive || sentence.ob?.thisRef || sentence.from?.name || sentence.from?.genitive || sentence.from?.thisRef)
  ) {
    const lhsSlot = sentence.ob ?? sentence.from;
    const rhsSlot = sentence.by;
    const numericExpr = (slot) => {
      if (!slot) return "0";
      if (slot.num !== undefined) {
        const n = Number(slot.num);
        return Number.isNaN(n) ? "0" : String(n);
      }
      if (slot.name) {
        const base = sanitizeName(slot.name);
        if (lang === "c") {
          if (locals?.has(base) || declared?.has(base)) return base;
          return base;
        }
        if (localsTypes?.get(base) === "number" || declaredTypes?.get(base) === "number") {
          return `${base}.ob?.num ?? ${base}`;
        }
        if (locals?.has(base)) return base;
        if (declared?.has(base)) return `${base}.ob?.num ?? ${base}`;
        return base;
      }
      const direct = exprForSlot(slot, { sentenceArg, locals, declared, defaultExpr: null, field: "num" });
      if (direct) return direct;
      return "0";
    };
    const lhsExpr = numericExpr(lhsSlot);
    const rhsExpr = numericExpr(rhsSlot);
    if (sentenceArg) {
      const hasGenitive = Boolean(sentence.to?.genitive);
      if (!hasGenitive && sentence.to?.name) {
        const baseName = sanitizeName(sentence.to.name);
        const target = lvalueForName(sentence.to.name, { declared, locals });
        const lines = [];
        if (!locals?.has(baseName) && !declared?.has(baseName)) {
          lines.push(`let ${baseName};`);
          locals?.add(baseName);
        }
        if (localsTypes) localsTypes.set(baseName, "number");
        lines.push(`${target} = (${lhsExpr} ?? 0) * (${rhsExpr} ?? 0);`);
        return lines.join("\n");
      }
      const target = targetPath("to", sentenceArg, "num", sentence.to, { locals, declared }) ?? sentence.to?.name;
      return `${target} = (${lhsExpr} ?? 0) * (${rhsExpr} ?? 0);`;
    }
    if (lang === "c") {
      const baseName = sanitizeName(sentence.to.name);
      const needsDecl = !locals?.has(baseName) && !declared?.has(baseName);
      if (needsDecl) locals?.add(baseName);
      return needsDecl
        ? `double ${baseName} = (${lhsExpr}) * (${rhsExpr});`
        : `${baseName} = (${lhsExpr}) * (${rhsExpr});`;
    }
    return `${sentence.to.name}.ob = ${sentence.to.name}.ob ?? {};\n${sentence.to.name}.ob.num = (${lhsExpr} ?? 0) * (${rhsExpr} ?? 0);`;
  }

  if (baseBe === "multiply" && ob.num !== undefined && (sentence.to?.name || sentenceArg)) {
    const safeValue = typeof ob.num === "number" ? ob.num : Number(ob.num);
    if (sentenceArg) {
      const hasGenitive = Boolean(sentence.to?.genitive);
      if (!hasGenitive && sentence.to?.name) {
        const baseName = sanitizeName(sentence.to.name);
        const target = lvalueForName(sentence.to.name, { declared, locals });
        const lines = [];
        if (!locals?.has(baseName) && !declared?.has(baseName)) {
          lines.push(`let ${baseName};`);
          locals?.add(baseName);
        }
        lines.push(`${target} = (${target} ?? 0) * ${Number.isNaN(safeValue) ? 0 : safeValue};`);
        return lines.join("\n");
      }
      const target = targetPath("to", sentenceArg, "num", sentence.to, { locals, declared }) ?? sentence.to?.name;
      return `${target} = (${target} ?? 0) * ${Number.isNaN(safeValue) ? 0 : safeValue};`;
    }
    if (lang === "c") {
      return `${sentence.to.name} = ${sentence.to.name} * ${Number.isNaN(safeValue) ? 0 : safeValue};`;
    }
    return `${sentence.to.name}.ob = ${sentence.to.name}.ob ?? {};\n${sentence.to.name}.ob.num = (${sentence.to.name}.ob.num ?? 0) * ${Number.isNaN(safeValue) ? 0 : safeValue};`;
  }

  if (baseBe === "divide" && ob.num !== undefined && (sentence.to?.name || sentenceArg)) {
    const safeValue = typeof ob.num === "number" ? ob.num : Number(ob.num);
    const divisor = Number.isNaN(safeValue) ? 1 : safeValue;
    if (sentenceArg) {
      const hasGenitive = Boolean(sentence.to?.genitive);
      if (!hasGenitive && sentence.to?.name) {
        const baseName = sanitizeName(sentence.to.name);
        const target = lvalueForName(sentence.to.name, { declared, locals });
        const lines = [];
        if (!locals?.has(baseName) && !declared?.has(baseName)) {
          lines.push(`let ${baseName};`);
          locals?.add(baseName);
        }
        lines.push(`${target} = (${target} ?? 0) / ${divisor};`);
        return lines.join("\n");
      }
      const target = targetPath("to", sentenceArg, "num", sentence.to, { locals, declared }) ?? sentence.to?.name;
      return `${target} = (${target} ?? 0) / ${divisor};`;
    }
    if (lang === "c") {
      return `${sentence.to.name} = ${sentence.to.name} / ${divisor};`;
    }
    return `${sentence.to.name}.ob = ${sentence.to.name}.ob ?? {};\n${sentence.to.name}.ob.num = (${sentence.to.name}.ob.num ?? 0) / ${divisor};`;
  }

	  if (baseBe === "remains" && (ob.num !== undefined || sentence.from?.num !== undefined || ob.name || ob.genitive || ob.thisRef) && (sentence.to?.name || sentenceArg)) {
	    if (sentenceArg) {
	      const targetGenitive = sentence.to?.genitive ? pathFromGenitive(sentence.to.genitive, sentenceArg, { locals, declared }) : null;
	      const targetName = sentence.to?.name ? sanitizeName(sentence.to.name) : null;
	      const source = (() => {
	        if (sentence.ob?.genitive && sentenceArg) return pathFromGenitive(sentence.ob.genitive, sentenceArg, { locals, declared });
	        if (ob?.name) {
	          const baseName = sanitizeName(ob.name);
	          if (locals?.has(baseName)) return `${baseName}.ob?.num`;
	        }
	        return exprForSlot(ob, { sentenceArg, locals, declared, defaultExpr: null, field: "num" });
	      })();
	      const divisorExpr = exprForSlot(sentence.from ?? sentence.by, { sentenceArg, locals, declared, defaultExpr: null, field: "num" }) ??
	        exprForSlot(ob, { sentenceArg, locals, declared, defaultExpr: null, field: "num" });

      const lines = [];
      if (targetName && !locals?.has(targetName) && !declared?.has(targetName)) {
        lines.push(`let ${targetName};`);
        locals?.add(targetName);
      }

      const lhs = targetGenitive
        ? targetGenitive
        : targetName
          ? lvalueForName(targetName, { declared, locals })
	          : targetPath("to", sentenceArg, "num", sentence.to, { locals, declared }) ?? `${sentenceArg}.ob?.num`;
      const numerator = source ?? lhs;
      const div = divisorExpr ?? "0";
      lines.push(`if ((${div} ?? 0) === 0) throw new Error("remains: from cannot be zero");`);
      const expr = `(${numerator} ?? 0) % (${div} ?? 0)`;
      lines.push(`${lhs} = ${expr};`);
      return lines.join("\n");
    }
    if (lang === "c") {
      const targetName = sentence.to?.name ? sanitizeName(sentence.to.name) : null;
      const hasExplicitDivisor = sentence.from != null || sentence.by != null;
      const divisor = hasExplicitDivisor
        ? (exprForSlot(sentence.from ?? sentence.by, { sentenceArg, locals, declared, defaultExpr: null, field: "num" }) ?? "0")
        : (exprForSlot(sentence.ob, { sentenceArg, locals, declared, defaultExpr: null, field: "num" }) ?? "0");
      // If the user wrote `ob num N to name X be remains do`, treat N as the divisor and X as the dividend.
      // Otherwise, treat `ob ... from ...` as dividend/divisor.
      const numerator = (!hasExplicitDivisor && sentence.ob?.num !== undefined)
        ? (targetName ?? "0")
        : (exprForSlot(sentence.ob, { sentenceArg, locals, declared, defaultExpr: targetName, field: "num" }) ?? targetName ?? "0");
      const lhs = targetName ?? "result";
      const lines = [];
      if (targetName && !locals?.has(targetName) && !declared?.has(targetName)) {
        locals?.add(targetName);
        lines.push(`double ${targetName} = 0;`);
      }
      if (cHelpers) cHelpers.usesPrintf = cHelpers.usesPrintf; // no-op; keep helper object alive
      const cDivisor = cExpr(divisor);
      const cNumerator = cExpr(numerator);
      lines.push(`if ((${cDivisor}) == 0) { /* remains: from cannot be zero */ } else { ${lhs} = fmod(${cNumerator}, ${cDivisor}); }`);
      return lines.join("\n");
    }
    const divisorRaw = sentence.from?.num ?? ob.num;
    const divisor = typeof divisorRaw === "number" ? divisorRaw : Number(divisorRaw);
    const safeValue = Number.isNaN(divisor) ? 0 : divisor;
    return `${sentence.to.name}.ob = ${sentence.to.name}.ob ?? {};\n${sentence.to.name}.ob.num = (${sentence.to.name}.ob.num ?? 0) % ${safeValue};`;
  }

  const name = sentence?.su?.name;
  const mood = sentence?.mood;
  if (mood === "do" && sentenceArg) {
    const fn = ceremonyFns?.get(baseBe);
    if (fn && (sentence.fromindex !== undefined || sentence.toindex !== undefined)) {
      const inlineSet = new Set([...(declared || []), ...(locals || [])]);
      const evokerLiteral = inlineSentenceLiteral(sentence, inlineSet);
      if (loopShim) loopShim.used = true;
      const genFromExpr = sentence.fromindex?.genitive
        ? pathFromGenitive(sentence.fromindex.genitive, sentenceArg, { locals, declared, allowCGlobals: true })
        : null;
      const genToExpr = sentence.toindex?.genitive
        ? pathFromGenitive(sentence.toindex.genitive, sentenceArg, { locals, declared, allowCGlobals: true })
        : null;
      if (genFromExpr || genToExpr) {
        const lines = ["{"];
        lines.push(`const _call = ${evokerLiteral};`);
        if (genFromExpr) lines.push(`_call.fromindex = { num: ${genFromExpr} };`);
        if (genToExpr) lines.push(`_call.toindex = { num: ${genToExpr} };`);
        lines.push(`runLoop(_call, ${fn});`);
        lines.push("}");
        return lines.join("\n");
      }
      return `runLoop(${evokerLiteral}, ${fn});`;
    }
    if (fn) {
      const inlineSet = new Set([...(declared || []), ...(locals || [])]);
      const arg = inlineSentenceLiteral(sentence, inlineSet);
      const genObjExpr = sentence.ob?.genitive
        ? pathFromGenitive(sentence.ob.genitive, sentenceArg, { locals, declared, allowCGlobals: true })
        : null;
      const genByExpr = sentence.by?.genitive
        ? pathFromGenitive(sentence.by.genitive, sentenceArg, { locals, declared, allowCGlobals: true })
        : null;
      if (sentence.to?.name) {
        const targetVar = sanitizeName(sentence.to.name);
        const lines = [];
        if (!locals?.has(targetVar) && !declared?.has(targetVar)) {
          lines.push(`let ${targetVar};`);
          locals?.add(targetVar);
        }
        if (genObjExpr || genByExpr) {
          lines.push("{");
          lines.push(`const _call = ${arg};`);
          if (genObjExpr) {
            lines.push(`_call.ob = { num: ${genObjExpr} };`);
          }
          if (genByExpr) {
            lines.push(`_call.by = { num: ${genByExpr} };`);
          }
          lines.push(`${targetVar} = ${fn}(_call);`);
          lines.push("}");
        } else {
          lines.push(`${targetVar} = ${fn}(${arg});`);
        }
        return lines.join("\n");
      }
      if (genObjExpr || genByExpr) {
        const lines = ["{", `  const _call = ${arg};`];
        if (genObjExpr) lines.push(`  _call.ob = { num: ${genObjExpr} };`);
        if (genByExpr) lines.push(`  _call.by = { num: ${genByExpr} };`);
        lines.push(`  ${fn}(_call);`, "}");
        return lines.join("\n");
      }
      return `${fn}(${arg});`;
    }
  }

  if (mood === "do" && !sentenceArg) {
    const fn = ceremonyFns?.get(baseBe);
	    if (fn && (sentence.fromindex !== undefined || sentence.toindex !== undefined)) {
	        if (lang === "c") {
	          const loopId = cState ? cState.vectorCounter++ : 0;
	          const byExpr = (() => {
	            if (sentence.by?.num !== undefined) return Number(sentence.by.num) || 0;
	            if (sentence.by?.name) return sanitizeName(sentence.by.name);
	            if (sentence.by?.genitive) return pathFromGenitive(sentence.by.genitive, undefined, { allowCGlobals: true }) ?? "0";
	            return null;
	          })();
	          const fromGenChain = sentence.fromindex?.genitive?.chain;
	          const fromGenFallback = (Array.isArray(fromGenChain) && typeof fromGenChain[0] === "string")
	            ? sanitizeName(fromGenChain[0])
	            : null;
	          const start = sentence.fromindex?.genitive
	            ? (pathFromGenitive(sentence.fromindex.genitive, undefined, { allowCGlobals: true }) ?? fromGenFallback ?? 0)
	            : (sentence.fromindex?.num ?? sentence.fromindex ?? 0);
	          const hasUntil = sentence.toindex !== undefined;
	          const toGenChain = sentence.toindex?.genitive?.chain;
	          const toGenFallback = (Array.isArray(toGenChain) && typeof toGenChain[0] === "string")
	            ? sanitizeName(toGenChain[0])
	            : null;
	          const untilVal = sentence.toindex?.genitive
	            ? (pathFromGenitive(sentence.toindex.genitive, undefined, { allowCGlobals: true }) ?? toGenFallback ?? 0)
	            : (sentence.toindex?.num ?? sentence.toindex ?? 0);
	          if (hasUntil) {
	            const step = untilVal > start ? 1 : -1;
	            const byAssign = byExpr !== null ? `by = ${byExpr}; ` : "";
	            return `{ double _saved_fromindex_${loopId} = fromindex; double _saved_toindex_${loopId} = toindex; for (fromindex = ${start}; fromindex != ${untilVal}; fromindex += ${step}) { toindex = ${untilVal}; ${byAssign}${fn}(); } fromindex = _saved_fromindex_${loopId}; toindex = _saved_toindex_${loopId}; }`;
	          }
	          const byAssign = byExpr !== null ? `by = ${byExpr}; ` : "";
	          return `{ double _saved_fromindex_${loopId} = fromindex; for (fromindex = ${start}; fromindex > 0; fromindex--) { ${byAssign}${fn}(); } fromindex = _saved_fromindex_${loopId}; }`;
	        }
	        const evokerLiteral = inlineSentenceLiteral(sentence, declared);
	        if (loopShim) loopShim.used = true;
      return `runLoop(${evokerLiteral}, ${fn});`;
    }
    if (fn) {
      if (lang === "c") {
        const obVal = sentence.ob?.num;
        const fromVal = sentence.from?.num;
        const byVal = sentence.by?.num;
        if (obVal !== undefined || fromVal !== undefined || byVal !== undefined) {
          if (cHelpers) cHelpers.usesMapGlobals = true;
          const lines = ["{", "double _saved_ob = pya_ob_num;", "double _saved_from = pya_from_num;", "double _saved_by = by;"];
          if (obVal !== undefined) lines.push(`pya_ob_num = ${Number(obVal) || 0};`);
          if (fromVal !== undefined) lines.push(`pya_from_num = ${Number(fromVal) || 0};`);
          if (byVal !== undefined) lines.push(`by = ${Number(byVal) || 0};`);
          lines.push(`${fn}();`, "pya_ob_num = _saved_ob;", "pya_from_num = _saved_from;", "by = _saved_by;", "}");
          return lines.join("\n");
        }
        return `${fn}();`;
      }
      const arg = inlineSentenceLiteral(sentence, declared);
      if (sentence.to?.name) {
        const targetVar = sanitizeName(sentence.to.name);
        const lines = [];
        if (!declared?.has(targetVar)) {
          lines.push(`let ${targetVar};`);
          markDeclared(declared, sentence.to.name);
        }
        lines.push(`${targetVar} = ${fn}(${arg});`);
        lines.push(`globalThis["${sentence.to.name}"] = ${targetVar};`);
        return lines.join("\n");
      }
      return `${fn}(${arg});`;
    }
  }
  if (!name || mood === "do") return null;

  const shouldDeclare = Boolean(sentence.exists);

  if (effectiveBe === "vector" && ob.ve?.values) {
    const fillCountExpr = (() => {
      if (typeof sentence.by?.num === "number") return String(Math.trunc(sentence.by.num));
      if (sentence.by?.name) {
        const base = sanitizeName(sentence.by.name);
        if (declared?.has(base) || locals?.has(base)) return `(${base}?.ob?.num ?? 0)`;
      }
      if (sentence.by?.genitive && !sentenceArg) {
        const chain = sentence.by.genitive.chain || [];
        const root = chain[0];
        if (typeof root === "string") {
          const base = sanitizeName(root);
          if (declared?.has(base) || locals?.has(base)) {
            const path = pathFromGenitive(sentence.by.genitive, "IGNORED", { locals, declared });
            // pathFromGenitive can't run without a real sentence arg; handle the common "num of ob of X" case.
            if (chain.length === 3 && chain[1] === "ob" && chain[2] === "num") return `(${base}?.ob?.num ?? 0)`;
          }
        }
      }
      return null;
    })();

    const rawType = ob.ve.type || "num";
    const vecType = rawType === "number" ? "num" : rawType;
    if (fillCountExpr && ob.ve.values.length === 1) {
      const elem = ob.ve.values[0];
      const elemLiteral = typeof elem === "number" ? String(elem) : JSON.stringify(elem);
      const vecLiteral = `{ type: "${vecType}", values: Array(${fillCountExpr}).fill(${elemLiteral}) }`;
      if (sentenceArg) {
        const target = valueForRole("su", sentenceArg, "ve", sentence.su) ?? name;
        return `${target} = ${vecLiteral};`;
      }
      const sentenceObject = `{ su: { name: "${name}" }, ob: { ve: ${vecLiteral} }, be: "${effectiveBe}", exists: ${shouldDeclare}, mood: "ya" }`;
      if (lang === "c") {
        const isLiteralCount = /^\d+$/.test(String(fillCountExpr));
        if (!isLiteralCount) return `/* TODO: vector fill with dynamic count in C */`;
        const count = Number(fillCountExpr);
        const suffix = cState ? cState.vectorCounter++ : 0;
        if (cHelpers) {
          cHelpers.usesVectorType = true;
          cHelpers.usesVectorPrinter = true;
          cHelpers.usesString = true;
          cHelpers.usesCtype = true;
        }
        if (vecType === "bool") {
          const val = elem === "truth" || elem === true || elem === 1 ? 1 : 0;
          const values = Array(count).fill(val).join(", ");
          if (shouldDeclare) {
            return `double ${name}_values[] = { ${values} };\npya_vec ${name} = { "bool", ${count}, ${name}_values, NULL };`;
          }
          return `do { double ${name}_values_${suffix}[] = { ${values} }; ${name} = (pya_vec){ "bool", ${count}, ${name}_values_${suffix}, NULL }; } while(0);`;
        }
        if (vecType === "text") {
          const val = JSON.stringify(String(elem));
          const values = Array(count).fill(val).join(", ");
          if (shouldDeclare) {
            return `const char *${name}_values[] = { ${values} };\npya_vec ${name} = { "text", ${count}, NULL, ${name}_values };`;
          }
          return `do { const char *${name}_values_${suffix}[] = { ${values} }; ${name} = (pya_vec){ "text", ${count}, NULL, ${name}_values_${suffix} }; } while(0);`;
        }
        if (vecType !== "num") return `/* TODO: vector support in C for ${vecType} */`;
        const numVal = typeof elem === "number" ? elem : Number(elem) || 0;
        const values = Array(count).fill(numVal).join(", ");
        if (shouldDeclare) {
          return `double ${name}_values[] = { ${values} };\npya_vec ${name} = { "num", ${count}, ${name}_values, NULL };`;
        }
        return `do { double ${name}_values_${suffix}[] = { ${values} }; ${name} = (pya_vec){ "num", ${count}, ${name}_values_${suffix}, NULL }; } while(0);`;
      }
      return shouldDeclare
        ? `${shouldDeclare ? "let" : ""} ${sanitizeName(name)} = ${sentenceObject};\nglobalThis[${JSON.stringify(name)}] = ${sanitizeName(name)};`
        : sentenceObject;
    }

    const values = ob.ve.values
      .map(v => (typeof v === "number" ? v : JSON.stringify(v)))
      .join(", ");
    const vecLiteral = `{ type: "${vecType}", values: [${values}] }`;
    if (sentenceArg) {
      const target = valueForRole("su", sentenceArg, "ve", sentence.su) ?? name;
      return `${target} = ${vecLiteral};`;
    }
    const sentenceObject = `{ su: { name: "${name}" }, ob: { ve: ${vecLiteral} }, be: "${effectiveBe}", exists: ${shouldDeclare}, mood: "ya" }`;
    if (lang === "c") {
      const suffix = cState ? cState.vectorCounter++ : 0;
      if (cHelpers) {
        cHelpers.usesVectorType = true;
        cHelpers.usesVectorPrinter = true;
        cHelpers.usesString = true;
        cHelpers.usesCtype = true;
      }
      const cName = sanitizeName(name);
      const count = ob.ve.values.length;
      if (vecType === "text") {
        const values = ob.ve.values.map(v => JSON.stringify(String(v))).join(", ");
        if (shouldDeclare) {
          return `const char *${cName}_values[] = { ${values} };\npya_vec ${cName} = { "text", ${count}, NULL, ${cName}_values };`;
        }
        return `do { const char *${cName}_values_${suffix}[] = { ${values} }; ${cName} = (pya_vec){ "text", ${count}, NULL, ${cName}_values_${suffix} }; } while(0);`;
      }
      if (vecType === "bool") {
        const values = ob.ve.values
          .map(v => (v === "truth" || v === true || v === 1 ? 1 : 0))
          .join(", ");
        if (shouldDeclare) {
          return `double ${cName}_values[] = { ${values} };\npya_vec ${cName} = { "bool", ${count}, ${cName}_values, NULL };`;
        }
        return `do { double ${cName}_values_${suffix}[] = { ${values} }; ${cName} = (pya_vec){ "bool", ${count}, ${cName}_values_${suffix}, NULL }; } while(0);`;
      }
      if (vecType !== "num") {
        return `/* TODO: vector support in C for ${vecType} */`;
      }
      const values = ob.ve.values
        .map(v => (typeof v === "number" ? v : Number(v) || 0))
        .join(", ");
      if (shouldDeclare) {
        return `double ${cName}_values[] = { ${values} };\npya_vec ${cName} = { "num", ${count}, ${cName}_values, NULL };`;
      }
      return `do { double ${cName}_values_${suffix}[] = { ${values} }; ${cName} = (pya_vec){ "num", ${count}, ${cName}_values_${suffix}, NULL }; } while(0);`;
    }
    const varName = sanitizeName(name);
    if (shouldDeclare) {
      return `let ${varName} = ${sentenceObject};\nglobalThis["${name}"] = ${varName};`;
    }
    return `${varName} = ${sentenceObject};\nglobalThis["${name}"] = ${varName};`;
  }

  if (effectiveBe === "number") {
    const rhsExpr = exprForSlot(ob, { sentenceArg, locals, declared, defaultExpr: null, field: "num" });
    if (sentenceArg && rhsExpr !== null) {
      const baseName = sentence.su?.name ? sanitizeName(sentence.su.name) : null;
      if (baseName) {
        const needsDecl = !locals?.has(baseName) && !declared?.has(baseName);
        if (needsDecl) {
          locals?.add(baseName);
          if (localsTypes) localsTypes.set(baseName, "number");
          if (ob?.thisRef === "ob") {
            return `let ${baseName} = { su: { name: "${sentence.su.name}" }, ob: {}, be: "number", mood: "ya" };\n${baseName}.ob = ${sentenceArg}.ob;`;
          }
          return `let ${baseName} = { su: { name: "${sentence.su.name}" }, ob: {}, be: "number", mood: "ya" };\n${baseName}.ob.num = ${rhsExpr};`;
        }
        if (localsTypes) localsTypes.set(baseName, "number");
        if (ob?.thisRef === "ob") {
          return `${baseName}.ob = ${sentenceArg}.ob;`;
        }
        return `${baseName}.ob = ${baseName}.ob ?? {};\n${baseName}.ob.num = ${rhsExpr};`;
      }
      const target = valueForRole("su", sentenceArg, "num", sentence.su) ?? `${sentenceArg}.ob?.num`;
      return `${target} = ${rhsExpr};`;
    }

    if (lang === "c" && !sentenceArg && sentence.su?.name) {
      const baseName = sanitizeName(sentence.su.name);
      const fromRef = ob?.thisRef ? ob.thisRef : null;
      const rhs = rhsExpr ?? fromRef ?? (typeof ob.num !== "undefined" ? ob.num : null);
      if (rhs !== null) {
        const needsDecl = !locals?.has(baseName) && !declared?.has(baseName);
        if (needsDecl) locals?.add(baseName);
        return needsDecl ? `double ${baseName} = ${rhs};` : `${baseName} = ${rhs};`;
      }
    }

    if (typeof ob.num !== "undefined") {
      const value = typeof ob.num === "number" ? ob.num : Number(ob.num);
      const safeValue = Number.isNaN(value) ? 0 : value;
      const sentenceObject = `{ su: { name: "${name}" }, ob: { num: ${safeValue} }, be: "${effectiveBe}", exists: ${shouldDeclare}, mood: "ya" }`;
      const decl = shouldDeclare ? (lang === "c" ? "/* TODO: sentence object in C */" : (isPermanent ? "const" : "let")) : "";
      if (lang === "c") {
        // Fallback for C for now: keep scalar style
        const cName = sanitizeName(name);
        if (!shouldDeclare) return `${cName} = ${safeValue};`;
        const cdecl = isPermanent ? "const double" : "double";
        return `${cdecl} ${cName} = ${safeValue};`;
      }
      const varName = sanitizeName(name);
      if (shouldDeclare) {
        return `${decl} ${varName} = ${sentenceObject};\nglobalThis["${name}"] = ${varName};`;
      }
      return `${varName} = ${sentenceObject};\nglobalThis["${name}"] = ${varName};`;
    }
  }

  if (effectiveBe === "text" && typeof ob.text === "string") {
    const value = JSON.stringify(ob.text);
    if (sentenceArg) {
      const baseName = sentence.su?.name ? sanitizeName(sentence.su.name) : null;
      if (baseName) {
        const needsDecl = !locals?.has(baseName) && !declared?.has(baseName);
        if (needsDecl) {
          locals?.add(baseName);
          if (localsTypes) localsTypes.set(baseName, "text");
          return `let ${baseName} = { su: { name: "${sentence.su.name}" }, ob: {}, be: "text", mood: "ya" };\n${baseName}.ob.text = ${value};`;
        }
        if (localsTypes) localsTypes.set(baseName, "text");
        return `${baseName}.ob = ${baseName}.ob ?? {};\n${baseName}.ob.text = ${value};`;
      }
      const target = valueForRole("su", sentenceArg, "text") ?? name;
      return `${target} = ${value};`;
    }
    const sentenceObject = `{ su: { name: "${name}" }, ob: { text: ${value} }, be: "${effectiveBe}", exists: ${shouldDeclare}, mood: "ya" }`;
    if (lang === "c") {
      // Fallback for C: keep scalar style
      if (cHelpers) {
        cHelpers.usesTextHelper = true;
        cHelpers.usesString = true;
        cHelpers.usesPrintf = true;
      }
      const cName = sanitizeName(name);
      if (!shouldDeclare) return `snprintf(${cName}, PYA_TEXT_CAP, "%s", ${value});`;
      return `char ${cName}[PYA_TEXT_CAP] = ${value};`;
    }
    const varName = sanitizeName(name);
    if (shouldDeclare) {
      return `let ${varName} = ${sentenceObject};\nglobalThis["${name}"] = ${varName};`;
    }
    return `${varName} = ${sentenceObject};\nglobalThis["${name}"] = ${varName};`;
  }

  if (ob?.la && name) {
    const laLiteral = inlineSentenceLiteral(ob.la, declared);
    const sentenceObject = `{ su: { name: "${name}" }, ob: { la: ${laLiteral} }, be: "${effectiveBe}", exists: ${shouldDeclare}, mood: "ya" }`;
    if (lang === "c") {
      if (cHelpers) {
        cHelpers.usesTextHelper = true;
        cHelpers.usesString = true;
      }
      const cName = sanitizeName(name);
      const pyash = sentenceToPyash(sentence);
      const literal = JSON.stringify(pyash);
      if (!shouldDeclare) return `snprintf(${cName}, PYA_TEXT_CAP, "%s", ${literal});`;
      return `char ${cName}[PYA_TEXT_CAP] = ${literal};`;
    }
    const varName = sanitizeName(name);
    if (shouldDeclare) {
      return `let ${varName} = ${sentenceObject};\nglobalThis["${name}"] = ${varName};`;
    }
    return `${varName} = ${sentenceObject};\nglobalThis["${name}"] = ${varName};`;
  }

  return null;
}

const SEQUENCE_REGISTERS = new Set(["fromindex", "toindex", "atindex"]);

function collectSequenceDeps(sentences) {
  const deps = new Set();
  const scanValue = (value) => {
    if (!value || typeof value !== "object") return;
    if (value.thisRef && SEQUENCE_REGISTERS.has(value.thisRef)) {
      deps.add(value.thisRef);
    }
    if (value.genitive?.chain) {
      const chain = Array.isArray(value.genitive.chain) ? value.genitive.chain : [];
      if (chain.includes("this")) {
        for (const reg of SEQUENCE_REGISTERS) {
          if (chain.includes(reg)) deps.add(reg);
        }
      }
    }
    if (Array.isArray(value)) value.forEach(scanValue);
  };
  const scanSentence = (sentence) => {
    if (!sentence || typeof sentence !== "object") return;
    for (const [key, value] of Object.entries(sentence)) {
      if (key === "consequence") {
        scanSentence(value);
        continue;
      }
      scanValue(value);
    }
  };

  if (Array.isArray(sentences)) {
    sentences.forEach(scanSentence);
  } else {
    scanSentence(sentences);
  }

  return deps;
}

function transpileCeremony(defSentence, bodySentences, { lang, declared, declaredTypes, declaredVectorTypes, ceremonyFns, cHelpers, jsHelpers, cState }) {
  const seqDeps = collectSequenceDeps(bodySentences);
  for (const reg of seqDeps) {
    if (!defSentence?.[reg]) {
      throwErrorSentence({
        name: "sequence register missing",
        message: `ceremony "${defSentence?.su?.name ?? "ceremony"}" reads this ${reg} but definition omits ${reg}`,
        from: { name: "compile" },
        raw: { ceremony: defSentence?.su?.name, missing: reg }
      });
    }
  }

  const signatureWords = deriveSignatureFromDefinition(defSentence);
  const fnBaseName = signatureWords
    ? joinSignatureWords(signatureWords).replace(/\s+/g, "_")
    : (defSentence?.su?.name || "ceremony");
  const fnName = sanitizeName(fnBaseName);

  const bodyLines = [];
  let hasReturn = false;
  const locals = new Set();
  const localsTypes = new Map();
  for (const s of bodySentences) {
    const line = transpileSentence(s, { lang, sentenceArg: lang === "c" ? undefined : "sentence", locals, localsTypes, declared, declaredTypes, declaredVectorTypes, ceremonyFns, cHelpers, jsHelpers, cState });
    if (line) {
      bodyLines.push(line);
      if (line.includes("return")) {
        hasReturn = true;
        break; // stop emitting after first return
      }
    }
  }

  const retLine =
    hasReturn
      ? null
      : lang === "c"
        ? "return;"
        : "return sentence;";

  if (lang === "c") {
    const paramList = "void";
    const body = [...bodyLines, ...(retLine ? [retLine] : [])].map(l => `  ${l}`).join("\n");
    return `void ${fnName}(${paramList}) {\n${body}\n}`;
  }

  const body = [...bodyLines, ...(retLine ? [retLine] : [])].map(l => `  ${l}`).join("\n");
  return `function ${fnName}(sentence) {\n${body}\n}`;
}

function transpileProgram(sentences, { lang, sourceLineNumbers, sourceFilename, collectSourceMap } = {}) {
  const header =
    lang === "c"
      ? "/* Generated by Pyash compile */"
      : "// Generated by Pyash compile";
  let lines = [header];
  const sourceLines = Array.isArray(sourceLineNumbers) ? sourceLineNumbers : [];
  const sourceLineFor = (idx) => sourceLines[idx] ?? null;
  const mainLines = [];
  let usesRememberShim = false;
  let usesMapShim = false;
  const rememberFlag = { used: false };
  const cHelpers = { usesPrintf: false, usesVectorType: false, usesVectorPrinter: false, usesString: false, usesCtype: false, usesStdlib: false, usesTextHelper: false, usesMap: false, usesMapPrinter: false, usesMapGlobals: false, usesJsonRuntime: false, usesYamlRuntime: false, usesYamlStringify: false, usesCsvRuntime: false, usesExchange: false, usesMindRuntime: false, usesSpeak: false, usesCommand: false };
  const loopShim = { used: false };
  const mindShim = { used: false };
    const jsHelpers = { usesVectorFormat: false, usesJsonMap: false, usesCsvMap: false, usesJsonRuntime: false, usesCsvRuntime: false, usesYamlRuntime: false, usesYamlStringify: false, usesFs: false, usesExchange: false, usesSpeak: false, usesCommand: false, readCounter: 0 };
  const cState = { vectorCounter: 0, csvCounter: 0, fileCounter: 0, jsonMapStrings: new Map(), jsonMapPrettyStrings: new Map(), yamlMapStrings: new Map(), csvMapStrings: new Map() };
  const mapDefs = new Map();
  const refineryDefs = new Map();
  const declared = new Set();
  const declaredTypes = new Map();
  const ceremonyFns = new Map();
  const declaredVectorTypes = new Map();
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const name = sentence?.su?.name;

    if (sentence.mood === "def" && sentence.be === "refinery") {
      if (!name) {
        throwErrorSentence({
          name: "refinery defective",
          message: "refinery name required",
          from: { name: "compile" },
          raw: sentence
        });
      }
      const body = [];
      let j = i + 1;
      for (; j < sentences.length; j++) {
        if (sentences[j].mood === "prah") break;
        body.push(sentences[j]);
      }
      const platforms = [];
      const seen = new Set();
      for (const entry of body) {
        if (entry?.mood !== "ya" || entry?.be !== "platform") {
          throwErrorSentence({
            name: "platform defective",
            message: "platform declaration must be be platform ya",
            from: { name: "compile" },
            raw: entry
          });
        }
        const platformName = entry?.su?.name;
        if (!platformName) {
          throwErrorSentence({
            name: "platform defective",
            message: "platform name required",
            from: { name: "compile" },
            raw: entry
          });
        }
        if (seen.has(platformName)) {
          throwErrorSentence({
            name: "platform defective",
            message: `platform name duplicated: ${platformName}`,
            from: { name: "compile" },
            raw: entry
          });
        }
        seen.add(platformName);
        let deps = [];
        if (entry.from) {
          if (!entry.from?.ve || entry.from.ve.type !== "name" || !Array.isArray(entry.from.ve.values)) {
            throwErrorSentence({
              name: "depend defective",
              message: "depend list must be from ve name ...",
              from: { name: "compile" },
              raw: entry.from
            });
          }
          deps = entry.from.ve.values.map((value) => String(value));
        }
        const ob = entry?.ob;
        if (!ob || typeof ob !== "object" || !("la" in ob)) {
          throwErrorSentence({
            name: "platform defective",
            message: "platform activity must be ob la ... ko",
            from: { name: "compile" },
            raw: entry
          });
        }
        const extraKeys = Object.keys(ob).filter((key) => key !== "la");
        if (extraKeys.length > 0) {
          throwErrorSentence({
            name: "platform defective",
            message: "platform activity must contain exactly one embedded sentence",
            from: { name: "compile" },
            raw: { extra: extraKeys }
          });
        }
        const clause = ob.la;
        if (!clause || typeof clause !== "object") {
          throwErrorSentence({
            name: "platform defective",
            message: "platform activity must be ob la ... ko",
            from: { name: "compile" },
            raw: clause
          });
        }
        platforms.push({ name: platformName, deps, action: clause });
      }
      refineryDefs.set(name, { name, platforms });
      i = j;
      continue;
    }

    if (sentence.mood === "def" && sentence.be === "ceremony") {
      if (sentence.su?.name && ceremonyFns.has(sentence.su.name)) {
        console.warn(`ceremony redefined: ${sentence.su.name}`);
      }
      const body = [];
      let j = i + 1;
      for (; j < sentences.length; j++) {
        if (sentences[j].mood === "prah") break;
        body.push(sentences[j]);
      }
      const fn = transpileCeremony(sentence, body, { lang, declared, declaredTypes, declaredVectorTypes, ceremonyFns, cHelpers, jsHelpers, cState });
      const signatureWords = deriveSignatureFromDefinition(sentence);
      const fnBaseName = signatureWords
        ? joinSignatureWords(signatureWords).replace(/\s+/g, "_")
        : (sentence?.su?.name || "ceremony");
      const fnName = sanitizeName(fnBaseName);
      ceremonyFns.set(sentence.su?.name, fnName);
      if (signatureWords) {
        ceremonyFns.set(joinSignatureWords(signatureWords), fnName);
      }
      if (typeof fn === "string" && fn.includes("remember(")) {
        usesRememberShim = true;
      }
      if (typeof fn === "string" && fn.includes("runAtAll(")) {
        usesMapShim = true;
        usesRememberShim = true;
      }
      if (collectSourceMap && sourceLineFor(i)) {
        lines.push(`// @pyash-line ${sourceLineFor(i)}`);
      }
      if (lang === "c" && sourceLineFor(i) && sourceFilename) {
        lines.push(`#line ${sourceLineFor(i)} "${sourceFilename}"`);
      }
      lines.push(fn);
      i = j; // skip to end of block
      continue;
    }

    if (sentence.mood === "def" && (sentence.be === "map" || sentence.be === "json map" || sentence.be === "csv map")) {
      const body = [];
      let j = i + 1;
      for (; j < sentences.length; j++) {
        if (sentences[j].mood === "prah") break;
        body.push(sentences[j]);
      }
      const map = {};
      const seen = new Set();
      for (const entry of body) {
        if (sentence.be === "map") {
          if (!entry?.su?.name) {
            throwErrorSentence({
              name: "pyash map sentence lost su",
              message: "pyash map sentence lost su",
              from: { name: "compile" },
              raw: entry
            });
          }
          if (seen.has(entry.su.name)) {
            throwErrorSentence({
              name: "pyash map switch excess",
              message: "pyash map switch excess",
              from: { name: "compile" },
              raw: { name: entry.su.name }
            });
          }
          seen.add(entry.su.name);
        }
        if (sentence.be === "json map") {
          if (!entry?.su?.name) {
            throwErrorSentence({
              name: "json map sentence lost su",
              message: "json map sentence lost su",
              from: { name: "compile" },
              raw: entry
            });
          }
          if (entry?.ob === undefined) {
            throwErrorSentence({
              name: "json map sentence lost ob",
              message: "json map sentence lost ob",
              from: { name: "compile" },
              raw: entry
            });
          }
        }
        const key = entry?.su?.name;
        if (!key) continue;
        map[key] = sentence.be === "map" ? entry : (entry.ob ?? {});
      }
      const mapSentence = {
        mood: "ya",
        su: { name },
        be: sentence.be,
        ob: { map }
      };
      mapDefs.set(name, mapSentence);

      if (collectSourceMap && sourceLineFor(i)) {
        lines.push(`// @pyash-line ${sourceLineFor(i)}`);
      }
      if (lang === "c" && sourceLineFor(i) && sourceFilename) {
        lines.push(`#line ${sourceLineFor(i)} "${sourceFilename}"`);
      }

      if (sentence.be === "json map") {
        try {
          const jsonObj = jsonFromMapSentence(mapSentence, mapDefs, new Set());
          cState.jsonMapStrings.set(name, canonicalJsonStringify(jsonObj));
          cState.jsonMapPrettyStrings.set(name, JSON.stringify(jsonObj, null, 2));
          cState.yamlMapStrings.set(name, YAML.stringify(canonicalizeJsonValue(jsonObj)));
        } catch (err) {
          const normalized = normalizeJsonMapError(err);
          throwErrorSentence({
            name: normalized.name,
            message: normalized.message,
            from: { name: "compile" },
            raw: { name, error: err?.message }
          });
        }
      }
      if (sentence.be === "csv map") {
        try {
          const csvText = csvTextFromMapSentence(mapSentence);
          cState.csvMapStrings.set(name, csvText);
        } catch (err) {
          throwErrorSentence({
            name: "csv columns defective",
            message: err?.message ?? "csv columns defective",
            from: { name: "compile" },
            raw: { name, error: err?.message }
          });
        }
      }

      if (lang === "c") {
        if (sentence.be !== "csv map") {
          cHelpers.usesMap = true;
          cHelpers.usesMapGlobals = true;
          cHelpers.usesString = true;
          cHelpers.usesStdlib = true;
          cHelpers.usesPrintf = true;
          cHelpers.usesCtype = true;
          const mapVar = sanitizeName(name);
          lines.push(`pya_map ${mapVar} = {0, 0, NULL};`);
          mainLines.push(`pya_map_init(&${mapVar});`);
          for (const [key, value] of Object.entries(map)) {
            if (sentence.be === "map" && value && typeof value === "object" && value.mood) {
              const pyashText = sentenceToPyash(value);
              mainLines.push(`pya_map_set_sentence(&${mapVar}, ${JSON.stringify(key)}, ${JSON.stringify(pyashText)});`);
            } else if (value?.num !== undefined) {
              const numVal = Number(value.num);
              mainLines.push(`pya_map_set_num(&${mapVar}, ${JSON.stringify(key)}, ${Number.isNaN(numVal) ? 0 : numVal});`);
            } else if (value?.text !== undefined) {
              mainLines.push(`pya_map_set_text(&${mapVar}, ${JSON.stringify(key)}, ${JSON.stringify(String(value.text))});`);
            } else if (value?.boolean !== undefined) {
              mainLines.push(`pya_map_set_bool(&${mapVar}, ${JSON.stringify(key)}, ${value.boolean ? 1 : 0});`);
            } else if (value?.hollow) {
              mainLines.push(`pya_map_set_hollow(&${mapVar}, ${JSON.stringify(key)});`);
            }
          }
        }
        if (sentence.be === "json map") {
          const jsonText = cState.jsonMapStrings.get(name);
          if (jsonText) {
            const varName = sanitizeName(`${name}_json`);
            lines.push(`const char *${varName} = ${JSON.stringify(jsonText)};`);
          }
          const prettyText = cState.jsonMapPrettyStrings.get(name);
          if (prettyText) {
            const varName = sanitizeName(`${name}_json_pretty`);
            lines.push(`const char *${varName} = ${JSON.stringify(prettyText)};`);
          }
          const yamlText = cState.yamlMapStrings.get(name);
          if (yamlText) {
            const varName = sanitizeName(`${name}_yaml`);
            lines.push(`const char *${varName} = ${JSON.stringify(yamlText)};`);
          }
        }
        if (sentence.be === "csv map") {
          const csvText = cState.csvMapStrings.get(name);
          if (csvText) {
            const varName = sanitizeName(`${name}_csv`);
            lines.push(`const char *${varName} = ${JSON.stringify(csvText)};`);
          }
        }
      } else {
        const varName = sanitizeName(name);
        const payload = JSON.stringify(mapSentence);
        lines.push(`const ${varName} = ${payload};`);
        lines.push(`globalThis[${JSON.stringify(name)}] = ${varName};`);
      }

      if (name) {
        markDeclared(declared, name);
        declaredTypes.set(name, sentence.be);
      }

      i = j;
      continue;
    }

    if (sentence.mood === "ya" && name && !sentence.exists && !declared.has(name) && sentence.be !== "export") {
      const pyash = sentenceToPyash(sentence);
      throwErrorSentence({
        name: "variable as not exists",
        message: `su quoted.pyash.${pyash}.pyash.quoted be error ob name variable as not exists ya`,
        from: { name: "compile" },
        pyash,
        raw: sentence
      });
    }

    const line = transpileSentence(sentence, { lang, ceremonyFns, declared, declaredTypes, declaredVectorTypes, loopShim, mindShim, cHelpers, rememberFlag, jsHelpers, cState, mapDefs });
    if (typeof line === "string" && line.includes("remember(")) {
      usesRememberShim = true;
    }
    if (rememberFlag.used) {
      usesRememberShim = true;
      rememberFlag.used = false;
    }
    if (typeof line === "string" && line.includes("runAtAll(")) {
      usesMapShim = true;
      usesRememberShim = true;
    }
    const todoPrefix = lang === "c" ? "/* TODO" : "// TODO";
    const todoSuffix = lang === "c" ? " */" : "";
    const target = (() => {
      if (lang === "c" && sentence.mood === "ya") {
        if (typeof line === "string" && (line.startsWith("double ") || line.startsWith("const char") || line.startsWith("char *") || line.startsWith("char ") || line.startsWith("pya_vec "))) {
          return lines; // keep declarations global
        }
      }
      return lang === "c" ? mainLines : lines;
    })();
    const sourceLine = sourceLineFor(i);
    if (collectSourceMap && sourceLine) {
      target.push(`// @pyash-line ${sourceLine}`);
    }
    if (lang === "c" && sourceLine && sourceFilename) {
      target.push(`#line ${sourceLine} "${sourceFilename}"`);
    }
    target.push(line ?? `${todoPrefix}: ${JSON.stringify(sentence)}${todoSuffix}`);
    if (name && sentence.mood === "ya") {
      markDeclared(declared, name);
      if (sentence.be === "text" || sentence.ob?.text !== undefined) {
        declaredTypes.set(name, "text");
      } else if (sentence.be === "number" || sentence.ob?.num !== undefined) {
        declaredTypes.set(name, "number");
      } else if (sentence.ob?.la) {
        declaredTypes.set(name, "sentence");
      } else if (sentence.be === "vector" || sentence.ob?.ve) {
        declaredTypes.set(name, "vector");
        if (sentence.ob?.ve?.type) {
          declaredVectorTypes.set(name, sentence.ob.ve.type);
        }
      }
    }
  }

  if (refineryDefs.size > 0) {
    if (lang === "c") {
      cHelpers.usesStdlib = true;
      cHelpers.usesString = true;
      cHelpers.usesExchange = true;
      const refineryLines = [];
      for (const [refineryName, refinery] of refineryDefs.entries()) {
        const prefix = sanitizeName(`pya_refinery_${refineryName}`);
        const nameVar = `${prefix}_names`;
        const runVar = `${prefix}_runs`;
        const depsVar = `${prefix}_deps`;
        const depCountVar = `${prefix}_dep_counts`;
        const actionVar = `${prefix}_actions`;
        const depLookup = `${prefix}_find`;
        const runFn = `${prefix}_run`;
        const count = refinery.platforms.length;
        const depArrays = [];
        const runFns = [];
        const names = [];
        const actions = [];
        refinery.platforms.forEach((platform) => {
          const fnName = sanitizeName(`${prefix}_${platform.name}`);
          const actionLine = sentenceToPyash(platform.action);
          const actionEvoke = `ob la ${actionLine} ko be evoke ya`;
          const bodyLine = transpileSentence(platform.action, { lang, ceremonyFns, declared, declaredTypes, declaredVectorTypes, loopShim, mindShim, cHelpers, rememberFlag, jsHelpers, cState, mapDefs });
          if (typeof bodyLine === "string" && bodyLine.includes("remember(")) usesRememberShim = true;
          if (rememberFlag.used) {
            usesRememberShim = true;
            rememberFlag.used = false;
          }
          if (typeof bodyLine === "string" && bodyLine.includes("runAtAll(")) {
            usesMapShim = true;
            usesRememberShim = true;
          }
          const linesBody = (bodyLine ?? "/* TODO: platform action */")
            .split("\n")
            .map(line => `  ${line}`);
          refineryLines.push(`static void ${fnName}(void) {`);
          refineryLines.push(...linesBody);
          refineryLines.push("}");
          runFns.push(fnName);
          names.push(platform.name);
          actions.push({ evoke: actionEvoke, result: actionLine });
          const depName = sanitizeName(`${prefix}_${platform.name}_deps`);
          const deps = platform.deps.map(dep => JSON.stringify(dep)).join(", ");
          depArrays.push(`static const char *${depName}[] = { ${deps}${deps ? ", " : ""}NULL };`);
        });
        refineryLines.push(...depArrays);
        refineryLines.push(`static const char *${nameVar}[] = { ${names.map(n => JSON.stringify(n)).join(", ")} };`);
        refineryLines.push(`static void (*${runVar}[])(void) = { ${runFns.join(", ")} };`);
        refineryLines.push(`static const char **${depsVar}[] = { ${refinery.platforms.map(p => sanitizeName(`${prefix}_${p.name}_deps`)).join(", ")} };`);
        refineryLines.push(`static const int ${depCountVar}[] = { ${refinery.platforms.map(p => p.deps.length).join(", ")} };`);
        refineryLines.push(`static const char *${actionVar}[] = { ${actions.map(action => JSON.stringify(action.result)).join(", ")} };`);
        refineryLines.push(`static const char *${actionVar}_evoke[] = { ${actions.map(action => JSON.stringify(action.evoke)).join(", ")} };`);
        refineryLines.push(`static int ${depLookup}(const char *name) {`);
        refineryLines.push(`  for (int i = 0; i < ${count}; i++) { if (strcmp(${nameVar}[i], name) == 0) return i; }`);
        refineryLines.push("  return -1;");
        refineryLines.push("}");
        refineryLines.push(`static int ${runFn}(void) {`);
        refineryLines.push(`  int done[${count}];`);
        refineryLines.push(`  for (int i = 0; i < ${count}; i++) done[i] = 0;`);
        refineryLines.push("  int completed = 0;");
        refineryLines.push(`  while (completed < ${count}) {`);
        refineryLines.push("    int next = -1;");
        refineryLines.push(`    for (int i = 0; i < ${count}; i++) {`);
        refineryLines.push("      if (done[i]) continue;");
        refineryLines.push("      int ready = 1;");
        refineryLines.push(`      for (int d = 0; d < ${depCountVar}[i]; d++) {`);
        refineryLines.push(`        int idx = ${depLookup}(${depsVar}[i][d]);`);
        refineryLines.push("        if (idx < 0 || !done[idx]) { ready = 0; break; }");
        refineryLines.push("      }");
        refineryLines.push("      if (!ready) continue;");
        refineryLines.push("      if (next < 0 || strcmp(" + nameVar + "[i], " + nameVar + "[next]) < 0) next = i;");
        refineryLines.push("    }");
        refineryLines.push("    if (next < 0) return 1;");
        refineryLines.push(`    pya_emit_exchange(${actionVar}_evoke[next]);`);
        refineryLines.push(`    ${runVar}[next]();`);
        refineryLines.push(`    pya_emit_exchange(${actionVar}[next]);`);
        refineryLines.push("    done[next] = 1;");
        refineryLines.push("    completed += 1;");
        refineryLines.push("  }");
        refineryLines.push("  return 0;");
        refineryLines.push("}");
        mainLines.push(`if (getenv("PYA_REFINERY") && strcmp(getenv("PYA_REFINERY"), ${JSON.stringify(refineryName)}) == 0) { if (${runFn}() != 0) return 1; }`);
      }
      lines.push(...refineryLines);
    } else {
      const refineryLines = [];
      refineryLines.push("const __pyaRefineries = {};");
      refineryLines.push("const __pyaCompareUtf8 = (() => {");
      refineryLines.push("  const encoder = typeof TextEncoder !== \"undefined\" ? new TextEncoder() : null;");
      refineryLines.push("  return (a, b) => {");
      refineryLines.push("    if (a === b) return 0;");
      refineryLines.push("    const bufA = encoder ? encoder.encode(a) : Array.from(a, ch => ch.charCodeAt(0));");
      refineryLines.push("    const bufB = encoder ? encoder.encode(b) : Array.from(b, ch => ch.charCodeAt(0));");
      refineryLines.push("    const len = Math.min(bufA.length, bufB.length);");
      refineryLines.push("    for (let i = 0; i < len; i += 1) {");
      refineryLines.push("      if (bufA[i] !== bufB[i]) return bufA[i] < bufB[i] ? -1 : 1;");
      refineryLines.push("    }");
      refineryLines.push("    return bufA.length < bufB.length ? -1 : 1;");
      refineryLines.push("  };");
      refineryLines.push("})();");
      refineryLines.push("const __pyaNewspaper = (typeof process !== \"undefined\" ? process.env?.PYA_NEWSPAPER : undefined) === \"1\";");
      refineryLines.push("const __pyaEmitNewspaper = (line) => { if (__pyaNewspaper && line) console.log(\"PYA_NEWSPAPER:\" + line); };");
      refineryLines.push("function __pyaRunRefinery(name) {");
      refineryLines.push("  const refinery = __pyaRefineries[name];");
      refineryLines.push("  if (!refinery) return null;");
      refineryLines.push("  const completed = new Set();");
      refineryLines.push("  const pending = new Set(Object.keys(refinery.platforms));");
      refineryLines.push("  while (pending.size > 0) {");
      refineryLines.push("    const ready = [];");
      refineryLines.push("    for (const platformName of pending) {");
      refineryLines.push("      const platform = refinery.platforms[platformName];");
      refineryLines.push("      const deps = platform?.deps || [];");
      refineryLines.push("      if (deps.every((dep) => completed.has(dep))) ready.push(platformName);");
      refineryLines.push("    }");
      refineryLines.push("    if (ready.length === 0) return null;");
      refineryLines.push("    ready.sort(__pyaCompareUtf8);");
      refineryLines.push("    const next = ready[0];");
      refineryLines.push("    const platform = refinery.platforms[next];");
      refineryLines.push("    __pyaEmitNewspaper(platform.evoke);");
      refineryLines.push("    let res;");
      refineryLines.push("    try { res = platform.run(); } catch (err) {");
      refineryLines.push("      const msg = err?.message ? String(err.message) : \"refinery failed\";");
      refineryLines.push("      __pyaEmitNewspaper(`su name refinery failure ob text ${msg.replace(/\\\\/g, \"\\\\\\\\\").replace(/\"/g, \"\\\\\\\"\")} from name runtime be error ya`);");
      refineryLines.push("      return { be: \"error\" };");
      refineryLines.push("    }");
      refineryLines.push("    if (res && res.be === \"error\" && res.mood) { __pyaEmitNewspaper(platform.result); return res; }");
      refineryLines.push("    __pyaEmitNewspaper(platform.result);");
      refineryLines.push("    completed.add(next);");
      refineryLines.push("    pending.delete(next);");
      refineryLines.push("  }");
      refineryLines.push("  return null;");
      refineryLines.push("}");
      for (const [refineryName, refinery] of refineryDefs.entries()) {
        refineryLines.push(`__pyaRefineries[${JSON.stringify(refineryName)}] = { platforms: {} };`);
        refinery.platforms.forEach((platform) => {
          const fnName = sanitizeName(`pya_refinery_${refineryName}_${platform.name}`);
          const actionLine = sentenceToPyash(platform.action);
          const evokeLine = `ob la ${actionLine} ko be evoke ya`;
          const bodyLine = transpileSentence(platform.action, { lang, ceremonyFns, declared, declaredTypes, declaredVectorTypes, loopShim, mindShim, cHelpers, rememberFlag, jsHelpers, cState, mapDefs });
          if (typeof bodyLine === "string" && bodyLine.includes("remember(")) usesRememberShim = true;
          if (rememberFlag.used) {
            usesRememberShim = true;
            rememberFlag.used = false;
          }
          if (typeof bodyLine === "string" && bodyLine.includes("runAtAll(")) {
            usesMapShim = true;
            usesRememberShim = true;
          }
          const bodyLines = (bodyLine ?? "// TODO: platform action")
            .split("\n")
            .map(line => `  ${line}`);
          refineryLines.push(`function ${fnName}() {`);
          refineryLines.push(...bodyLines);
          refineryLines.push("}");
          refineryLines.push(`__pyaRefineries[${JSON.stringify(refineryName)}].platforms[${JSON.stringify(platform.name)}] = { deps: ${JSON.stringify(platform.deps)}, run: ${fnName}, evoke: ${JSON.stringify(evokeLine)}, result: ${JSON.stringify(actionLine)} };`);
        });
      }
      refineryLines.push("const __pyaRefineryName = (typeof process !== \"undefined\" ? process.env?.PYA_REFINERY : undefined) || (typeof globalThis !== \"undefined\" ? globalThis.PYA_REFINERY : undefined);");
      refineryLines.push("if (__pyaRefineryName) __pyaRunRefinery(__pyaRefineryName);");
      lines.push(...refineryLines);
    }
  }

  if (lang !== "c") {
    const prelude = [lines[0]];
    if (jsHelpers.usesYamlRuntime) jsHelpers.usesJsonRuntime = true;
    if (mindShim.used) {
      prelude.push(`const mindConfigs = new Map();`);
      prelude.push(`const mindAnswerCounters = new Map();`);
      const mindHelper = `async function callMind({ host, model, messages = [], numCtx = 8192 }) {\n  if (typeof process !== \"undefined\" && process.env?.PYA_MIND_RESPONSE) {\n    return process.env.PYA_MIND_RESPONSE;\n  }\n  const transport = globalThis?.ollamaChat;\n  if (typeof transport === \"function\") {\n    const res = await Promise.resolve(transport({ host, model, messages, numCtx }));\n    if (res && typeof res === \"object\") {\n      return res?.message?.content ?? res?.response ?? res?.output ?? res?.data ?? \"\";\n    }\n    return String(res ?? \"\");\n  }\n  if (typeof fetch !== \"function\") {\n    throw new Error(\"mind: provide globalThis.ollamaChat or fetch\");\n  }\n  const resp = await fetch(String(host).replace(/\\/$/, \"\") + \"/api/chat\", {\n    method: \"POST\",\n    headers: { \"Content-Type\": \"application/json\" },\n    body: JSON.stringify({ model, messages, options: { num_ctx: numCtx }, stream: false })\n  });\n  const data = await (typeof resp.json === \"function\" ? resp.json() : Promise.resolve({ message: { content: String(resp) } }));\n  return data?.message?.content ?? data?.response ?? data?.output ?? data?.data ?? \"\";\n}`;
      const mindHistory = `const mindHistory = new Map();\nfunction buildMindHistory(dialogue, windowSize = 8) {\n  const arr = mindHistory.get(dialogue) || [];\n  const max = windowSize * 2;\n  return arr.slice(-max);\n}\nfunction recordMindTurn(dialogue, userMsg, assistantMsg, windowSize = 8) {\n  const arr = mindHistory.get(dialogue) || [];\n  if (userMsg) arr.push(userMsg);\n  if (assistantMsg) arr.push(assistantMsg);\n  const max = windowSize * 2;\n  const trimmed = arr.slice(-max);\n  mindHistory.set(dialogue, trimmed);\n}`;
      prelude.push(mindHelper);
      prelude.push(mindHistory);
      if (!jsHelpers.usesExchange) {
        prelude.push(newspaperRuntimeHelper());
      }
    }
    if (jsHelpers.usesSpeak) {
      const speakHelper = `function pyaSpeak(value) {\n  const text = value == null ? \"\" : String(value);\n  const res = child_process.spawnSync(\"espeak-ng\", [\"-x\", text], { encoding: \"utf8\" });\n  if (res.error) throw res.error;\n  const out = res.stdout ?? \"\";\n  console.log(String(out).trimEnd());\n  return String(out ?? \"\");\n}`;
      prelude.push(speakHelper);
    }
    if (jsHelpers.usesCommand) {
      const commandHelper = `function pyaCommand(cmd, input) {\n  if (typeof process !== \"undefined\" && process.env?.PYA_COMMAND_RESPONSE !== undefined) {\n    return String(process.env.PYA_COMMAND_RESPONSE ?? \"\");\n  }\n  const res = child_process.spawnSync(String(cmd ?? \"\"), {\n    shell: true,\n    input: input ?? undefined,\n    encoding: \"utf8\",\n    maxBuffer: 1024 * 1024\n  });\n  if (res.error || res.status) {\n    throw new Error(\"command defective\");\n  }\n  return String(res.stdout ?? \"\");\n}`;
      prelude.push(commandHelper);
    }
    if (usesRememberShim) {
      const rememberShim = `const remember = (typeof globalThis.remember === "function" ? globalThis.remember : (ref) => {\n  if (ref && typeof ref === "object") {\n    const name = ref.name || ref.su?.name;\n    if (typeof name === \"string\") {\n      if (globalThis && Object.prototype.hasOwnProperty.call(globalThis, name)) return globalThis[name];\n    }\n    return ref;\n  }\n  if (typeof ref === \"string\") {\n    if (globalThis && Object.prototype.hasOwnProperty.call(globalThis, ref)) return globalThis[ref];\n    return undefined;\n  }\n  return ref;\n});`;
      prelude.push(rememberShim);
    }
    if (usesMapShim) {
      const cloneShim = `const structuredClone = globalThis.structuredClone || ((v) => JSON.parse(JSON.stringify(v)));`;
      prelude.push(cloneShim);
	      const mapHelper = `function runAtAll(sentence, fn) {\n  // Resolve genitive by (like \"by num of fromindex of this\") against the evoker sentence once.\n  if (sentence?.by?.genitive?.chain?.[0] === \"this\") {\n    let curr = sentence;\n    for (const part of sentence.by.genitive.chain.slice(1)) {\n      if (typeof curr === \"number\") {\n        if (part === \"num\") continue;\n        curr = undefined;\n        break;\n      }\n      curr = curr?.[part];\n    }\n    const resolved = (typeof curr === \"number\") ? curr : curr?.num;\n    if (typeof resolved === \"number\") sentence.by = { num: resolved };\n  }\n  const vecFact = remember(sentence.ob?.name ?? sentence.ob);\n  const values = vecFact?.ob?.ve?.values ?? [];\n  const out = values.map((elem, i) => {\n    const elemSentence = structuredClone(sentence);\n    if (typeof elem === \"number\") elemSentence.ob = { num: elem };\n    else if (typeof elem === \"string\") elemSentence.ob = { text: elem };\n    else if (typeof elem === \"boolean\") elemSentence.ob = { boolean: elem };\n    else elemSentence.ob = elem ?? {};\n    elemSentence.atindex = { num: i, register: true };\n    elemSentence.this = { ...(elemSentence.this || {}), atindex: elemSentence.atindex, by: elemSentence.by, fromindex: elemSentence.fromindex, toindex: elemSentence.toindex };\n    const res = fn(elemSentence) ?? elemSentence;\n    const ob = res?.ob ?? elemSentence.ob;\n    if (ob?.num !== undefined) return ob.num;\n    if (ob?.text !== undefined) return ob.text;\n    if (ob?.boolean !== undefined) return ob.boolean;\n    return ob;\n  });\n  if (sentence.to?.name) {\n    const fact = { su: { name: sentence.to.name }, ob: { ve: { values: out } }, be: \"vector\", mood: \"ya\" };\n    globalThis[sentence.to.name] = fact;\n    return fact;\n  }\n  // In-place: mutate the remembered fact and do not replace the binding object.\n  if (vecFact?.ob?.ve) {\n    vecFact.ob.ve.values = out;\n    return vecFact;\n  }\n  const targetName = sentence.ob?.name ?? vecFact?.su?.name;\n  if (targetName) {\n    const fact = { su: { name: targetName }, ob: { ve: { values: out } }, be: \"vector\", mood: \"ya\" };\n    globalThis[targetName] = fact;\n    return fact;\n  }\n  return { ob: { ve: { values: out } }, be: \"vector\", mood: \"ya\" };\n}`;
      prelude.push(mapHelper);
    }
    if (jsHelpers.usesExchange) {
      prelude.push(exchangeRuntimeHelper());
    }
    if (jsHelpers.usesVectorFormat) {
      prelude.push(vectorFormatHelper());
    }
    if (jsHelpers.usesJsonRuntime) {
      prelude.push(jsonRuntimeHelper());
    }
    if (jsHelpers.usesYamlRuntime) {
      prelude.push(yamlRuntimeHelper());
    }
    if (jsHelpers.usesYamlStringify) {
      prelude.push(yamlStringifyHelper());
    }
    if (jsHelpers.usesCsvRuntime) {
      prelude.push(csvRuntimeHelper());
    }
    if (jsHelpers.usesJsonMap) {
      prelude.push(`function jsonFromMap(name, seen = new Set()) {\n  const map = globalThis[name];\n  if (!map || map.be !== \"json map\") throw new Error(\"json map referential defective\");\n  const mapName = map.su?.name ?? name;\n  if (seen.has(mapName)) throw new Error(\"json map export self referential\");\n  seen.add(mapName);\n  const out = {};\n  const entries = map.ob?.map ?? {};\n  for (const key of Object.keys(entries)) {\n    const value = entries[key];\n    let jsonValue;\n    if (value?.unspecified) jsonValue = undefined;\n    else if (value?.hollow) jsonValue = null;\n    else if (value?.text !== undefined) jsonValue = value.text;\n    else if (value?.num !== undefined) jsonValue = value.num;\n    else if (value?.boolean !== undefined) jsonValue = value.boolean;\n    else if (value?.ve) {\n      const type = value.ve.type || \"num\";\n      if (type === \"hollow\") jsonValue = [];\n      else if (type === \"name\") jsonValue = (value.ve.values || []).map((child) => jsonFromMap(child, seen));\n      else if (type === \"bool\" || type === \"boolean\") jsonValue = (value.ve.values || []).map((v) => v === \"truth\" || v === true || v === 1);\n      else if (type === \"num\" || type === \"number\" || type === \"text\") jsonValue = value.ve.values || [];\n      else throw new Error(\"json map contents defective: unsupported vector type \" + type);\n    } else if (value?.name) {\n      jsonValue = jsonFromMap(value.name, seen);\n    } else if (value && Object.keys(value).length > 0) {\n      throw new Error(\"json map contents defective: unsupported contents\");\n    }\n    if (jsonValue !== undefined) out[key] = jsonValue;\n  }\n  seen.delete(mapName);\n  return out;\n}\nfunction canonicalizeJson(value) {\n  const encoder = typeof TextEncoder !== \"undefined\" ? new TextEncoder() : null;\n  const compareUtf8 = (a, b) => {\n    if (a === b) return 0;\n    const bufA = encoder ? encoder.encode(a) : Array.from(a, ch => ch.charCodeAt(0));\n    const bufB = encoder ? encoder.encode(b) : Array.from(b, ch => ch.charCodeAt(0));\n    const len = Math.min(bufA.length, bufB.length);\n    for (let i = 0; i < len; i += 1) {\n      if (bufA[i] !== bufB[i]) return bufA[i] < bufB[i] ? -1 : 1;\n    }\n    return bufA.length < bufB.length ? -1 : 1;\n  };\n  if (Array.isArray(value)) return value.map((item) => canonicalizeJson(item));\n  if (value && typeof value === \"object\") {\n    const out = {};\n    const keys = Object.keys(value).sort(compareUtf8);\n    for (const key of keys) out[key] = canonicalizeJson(value[key]);\n    return out;\n  }\n  return value;\n}\nfunction formatJsonMap(name, mode = \"canonical\") {\n  const json = jsonFromMap(name);\n  if (mode === \"pretty\") return JSON.stringify(json, null, 2);\n  return JSON.stringify(canonicalizeJson(json));\n}`);
    }
    if (jsHelpers.usesCsvMap) {
      prelude.push(`function csvEscape(value) {\n  const str = String(value ?? \"\");\n  if (/[\",\\n\\r]/.test(str)) {\n    return \"\\\"\" + str.replace(/\"/g, \"\\\"\\\"\") + \"\\\"\";\n  }\n  return str;\n}\nfunction formatCsvMap(name) {\n  const fact = globalThis[name];\n  if (fact?.be === \"text\") return String(fact.ob?.text ?? \"\");\n  if (!fact || fact.be !== \"csv map\") throw new Error(\"csv columns defective\");\n  const entries = fact.ob?.map ?? {};\n  const headerRaw = entries[\"header raw\"]?.ve?.values;\n  const header = entries.header?.ve?.values;\n  let headers = Array.isArray(headerRaw) ? headerRaw : header;\n  if (Array.isArray(headerRaw)) {\n    const seen = new Set();\n    let defective = false;\n    for (const cell of headerRaw) {\n      const key = String(cell ?? \"\").replace(/\\s+/g, \" \").trim().toLowerCase();\n      if (!key || seen.has(key)) { defective = true; break; }\n      seen.add(key);\n    }\n    if (defective) headers = header;\n  }\n  if (!Array.isArray(headers) || headers.length === 0 || !Array.isArray(header)) {\n    throw new Error(\"csv columns defective\");\n  }\n  const columns = header.map((key) => {\n    const col = entries[key];\n    if (!col?.ve?.values || col.ve.type !== \"text\") {\n      throw new Error(\"csv columns defective\");\n    }\n    return col.ve.values.map((v) => String(v ?? \"\"));\n  });\n  const length = columns[0]?.length ?? 0;\n  for (const col of columns) {\n    if (col.length !== length) {\n      throw new Error(\"csv columns defective\");\n    }\n  }\n  const lines = [];\n  lines.push(headers.map(csvEscape).join(\",\"));\n  for (let i = 0; i < length; i += 1) {\n    const row = columns.map((col) => csvEscape(col[i] ?? \"\"));\n    lines.push(row.join(\",\"));\n  }\n  return lines.join(\"\\n\") + \"\\n\";\n}`);
    }
    if (jsHelpers.usesFs) {
      prelude.splice(1, 0, `import fs from "node:fs";`);
    }
  if (jsHelpers.usesSpeak) {
      prelude.splice(1, 0, `import child_process from "node:child_process";`);
    }
    if (jsHelpers.usesCommand && !jsHelpers.usesSpeak) {
      prelude.splice(1, 0, `import child_process from "node:child_process";`);
    }
    if (jsHelpers.usesExchange) {
      prelude.splice(1, 0, `import path from "node:path";`);
      prelude.splice(1, 0, `import crypto from "node:crypto";`);
    }
    if (jsHelpers.usesCsvRuntime) {
      prelude.splice(1, 0, `import { parse as parseCsv } from ${JSON.stringify(CSV_PARSE_RUNTIME_URL)};`);
    }
    if (jsHelpers.usesYamlRuntime) {
      prelude.splice(1, 0, `import YAML from ${JSON.stringify(YAML_RUNTIME_URL)};`);
    }
    if (loopShim.used) {
      const loopHelper = `function runLoop(sentence, fn) {\n  for (;;) {\n    const currIdx = sentence?.fromindex?.num ?? sentence?.fromindex ?? 0;\n    const hasUntil = sentence?.toindex !== undefined;\n    const currUntil = sentence?.toindex?.num ?? sentence?.toindex;\n    sentence.fromindex = currIdx;\n    if (hasUntil) sentence.toindex = currUntil;\n    if (hasUntil ? currIdx === currUntil : currIdx === 0) break;\n    const prevIdx = sentence?.fromindex;\n    const prevUntil = sentence?.toindex;\n    const nextSentence = fn(sentence);\n    sentence = { ...sentence, ...(nextSentence || {}) };\n    if (sentence.fromindex === undefined) sentence.fromindex = prevIdx;\n    if (sentence.toindex === undefined) sentence.toindex = prevUntil;\n    let nextIdx;\n    if (hasUntil) {\n      nextIdx = currIdx + (currUntil > currIdx ? 1 : -1);\n    } else {\n      nextIdx = currIdx - 1;\n    }\n    sentence.fromindex = nextIdx;\n  }\n  return sentence;\n}`;
      prelude.push(loopHelper);
    }
    lines = prelude.concat(lines.slice(1));
    if (mindShim.used) {
      const importLines = [];
      const bodyLines = [];
      for (const line of lines) {
        if (line.startsWith("import ")) {
          importLines.push(line);
        } else {
          bodyLines.push(line);
        }
      }
      lines = importLines.concat(["(async () => {", ...bodyLines, "})();"]);
    }
  }

  if (lang === "c") {
    if (cHelpers.usesExchange) {
      cHelpers.usesTextHelper = true;
      cHelpers.usesString = true;
      cHelpers.usesStdlib = true;
      cHelpers.usesPrintf = true;
    }
    const needsCsvRuntime = cHelpers.usesCsvRuntime
      && [...lines, ...mainLines].some((line) => typeof line === "string" && /\bpya_csv_/.test(line));
    const needsYamlRuntime = cHelpers.usesYamlRuntime;
    const needsYamlStringify = cHelpers.usesYamlStringify && !needsYamlRuntime;
    const headers = [];
    if (cHelpers.usesCommand || cHelpers.usesSpeak) {
      headers.push("#define _POSIX_C_SOURCE 200809L");
    }
    if (cHelpers.usesPrintf) headers.push("#include <stdio.h>");
    if (cHelpers.usesString) headers.push("#include <string.h>");
    if (cHelpers.usesStdlib) headers.push("#include <stdlib.h>");
    if (cHelpers.usesCtype) headers.push("#include <ctype.h>");
    if (cHelpers.usesExchange) headers.push("#include <stdint.h>");
    if (cHelpers.usesExchange) headers.push("#include <unistd.h>");
    if (needsYamlRuntime) headers.push("#include <strings.h>");
    if (needsYamlRuntime) headers.push("#include <yaml.h>");
    if (needsCsvRuntime) {
      headers.push("#include <zsv.h>");
    }
    if (cHelpers.usesMindRuntime) {
      headers.push("#include <curl/curl.h>");
    }
    if (cHelpers.usesCommand || cHelpers.usesSpeak) {
      headers.push("#include <unistd.h>");
      headers.push("#include <sys/types.h>");
      headers.push("#include <sys/wait.h>");
    }
    if (lines.some(l => typeof l === "string" && l.includes("fmod(")) || cHelpers.usesJsonRuntime) headers.push("#include <math.h>");
    const needsLoopGlobals =
      [...lines, ...mainLines].some(l => typeof l === "string" && /\b(fromindex|toindex|atindex|by)\b/.test(l));
    if (needsLoopGlobals) {
      headers.push("double fromindex = 0;");
      headers.push("double toindex = 0;");
      headers.push("double atindex = 0;");
      headers.push("double by = 0;");
    }
    if (cHelpers.usesMapGlobals) {
      headers.push("double pya_ob_num = 0;");
      headers.push("double pya_from_num = 0;");
      headers.push("const char *pya_ob_text = 0;");
      headers.push("int pya_ob_bool = 0;");
    }
    if (headers.length) lines.unshift(...headers);
    const cPrelude = [];
    if (cHelpers.usesTextHelper) cPrelude.push(TEXT_HELPER);
    if (cHelpers.usesExchange) cPrelude.push(EXCHANGE_HELPER);
    if (cHelpers.usesJsonRuntime) {
      cPrelude.push(CJSON_HEADER);
      cPrelude.push(CJSON_SOURCE);
      cPrelude.push(JSON_PYASH_HELPER);
    }
    if (cHelpers.usesVectorType) cPrelude.push(VECTOR_TYPE_DECL);
    if (cHelpers.usesVectorPrinter) cPrelude.push(VECTOR_PRINT_HELPER);
    if (cHelpers.usesMap) cPrelude.push(MAP_TYPE_DECL);
    if (cHelpers.usesMap || cHelpers.usesMapPrinter) cPrelude.push(MAP_HELPER);
    if (cHelpers.usesMindRuntime) cPrelude.push(MIND_RUNTIME_HELPER);
    if (cHelpers.usesSpeak) cPrelude.push(SPEAK_HELPER);
    if (cHelpers.usesCommand) cPrelude.push(COMMAND_HELPER);
    if (needsYamlRuntime) cPrelude.push(YAML_RUNTIME_HELPER);
    if (needsYamlStringify) cPrelude.push(YAML_STRINGIFY_HELPER);
    if (needsCsvRuntime) cPrelude.push(CSV_RUNTIME_HELPER);
    if (cPrelude.length) lines.splice(headers.length, 0, ...cPrelude);
    const body = mainLines.map(l => `  ${l}`).join("\n");
    lines.push("int main(void) {");
    lines.push(body || "  return 0;");
    lines.push("  return 0;");
    lines.push("}");
  }

  return lines.join("\n") + "\n";
}

function inlineSentenceLiteral(value, declared = new Set(), { inlineNames = true } = {}) {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(v => inlineSentenceLiteral(v, declared)).join(", ")}]`;
  }
  if (typeof value === "object") {
    const entriesArr = Object.entries(value);
    if (entriesArr.length === 1 && entriesArr[0][0] === "name") {
      const nameVal = entriesArr[0][1];
      if (typeof nameVal === "string" && declared.has(nameVal)) {
        if (inlineNames) {
          return sanitizeName(nameVal);
        }
        return `{ name: ${nameVal} }`;
      }
    }
    const entries = Object.entries(value).map(([key, val]) => {
      if (key === "name" && typeof val === "string" && declared.has(val) && inlineNames) {
        return `${key}: ${val}`;
      }
      return `${key}: ${inlineSentenceLiteral(val, declared, { inlineNames })}`;
    });
    return `{ ${entries.join(", ")} }`;
  }
  return JSON.stringify(value);
}

function findDefinitionBlock(sentences, name) {
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    if (s?.mood === "def" && s?.be === "ceremony" && s?.su?.name === name) {
      const body = [];
      let j = i + 1;
      for (; j < sentences.length; j++) {
        if (sentences[j].mood === "prah") break;
        body.push(sentences[j]);
      }
      return { def: s, body, prah: sentences[j], end: j };
    }
  }
  return null;
}

function collectExportFacts(record, sentences) {
  const exported = new Map();
  for (const name of record.exportNames) {
    if (record.localCeremonies.has(name)) continue;
    const mapped = record.nameMap.get(name);
    if (!mapped) continue;
    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i];
      if (s?.mood === "def" && (s.be === "map" || s.be === "json map") && s?.su?.name === mapped) {
        const entries = [];
        let j = i + 1;
        for (; j < sentences.length; j++) {
          if (sentences[j].mood === "prah") break;
          entries.push(sentences[j]);
        }
        const map = {};
        const internalPrefix = `${record.alias} internal `;
        for (const entry of entries) {
          let key = entry?.su?.name;
          if (!key) continue;
          if (key.startsWith(internalPrefix)) {
            key = key.slice(internalPrefix.length);
          }
          map[key] = entry.ob ?? {};
        }
        exported.set(name, { be: s.be, ob: { map } });
        i = j;
        break;
      }
      if (s?.mood === "ya" && s?.su?.name === mapped) {
        exported.set(name, { be: s.be, ob: s.ob ?? {} });
        break;
      }
    }
  }
  return exported;
}

function mapNamespaceSentences({ alias, exportFacts, nameMap }) {
  const def = { mood: "def", be: "map", su: { name: alias } };
  const entries = [];
  for (const [key, value] of exportFacts.entries()) {
    const mapped = nameMap?.get(key);
    entries.push({ mood: "ya", su: { name: key }, ob: mapped ? { name: mapped } : (value?.ob ?? value ?? {}) });
  }
  const prah = { mood: "prah", be: "map", su: { name: alias } };
  return [def, ...entries, prah];
}

async function expandModulesForCompile(entryPath, sentences) {
  clearModuleCache();
  if (entryPath) setEntryModulePath(entryPath);

  const modules = [];
  const seen = new Set();
  const aliasToId = new Map();

  const includeModule = async (specifier, alias) => {
    const record = await loadModule({ specifier, alias, source: "compile import" });
    const cacheKey = `${record.id}::${record.alias}`;
    if (seen.has(cacheKey)) return record;
    seen.add(cacheKey);

    const local = [];
    for (const s of record.sentences) {
      if (s?.mood === "do" && s?.be === "import" && s?.from?.name) {
        await includeModule(s.from.name, s.to?.name);
        continue;
      }
      local.push(s);
    }

    const exportFacts = collectExportFacts(record, local);
    modules.push({ record, sentences: local, exportFacts });
    return record;
  };

  const entry = [];
  const aliasBlocks = [];

  for (const s of sentences) {
    if (s?.mood === "do" && s?.be === "import" && s?.from?.name) {
      const symbol = s.ob?.name;
      const record = await includeModule(s.from.name, symbol ? null : s.to?.name);
      const aliasName = symbol ? null : (record.alias ?? s.to?.name);
      if (aliasName) {
        const existing = aliasToId.get(aliasName);
        if (existing && existing !== record.id) {
          throwErrorSentence({
            name: "module alias conflict",
            message: `module alias already used: ${aliasName}`,
            from: { name: "compile" },
            raw: { alias: aliasName, existing, current: record.id }
          });
        }
        aliasToId.set(aliasName, record.id);
      }
      if (symbol) {
        if (record.localCeremonies.has(symbol)) {
          const mapped = record.nameMap.get(symbol);
          const block = findDefinitionBlock(record.sentences, mapped);
          if (block?.def) {
            const localName = s.to?.name ?? symbol;
            aliasBlocks.push({ def: { ...block.def, su: { name: localName } }, body: block.body, prah: block.prah });
          }
        } else {
          const exported = collectExportFacts(record, record.sentences);
          if (exported.has(symbol)) {
            const localName = s.to?.name ?? symbol;
            const fact = exported.get(symbol);
            if (fact?.be === "map" || fact?.be === "json map") {
              const entries = fact.ob?.map ?? {};
              const def = { mood: "def", be: fact.be, su: { name: localName } };
              const body = Object.entries(entries).map(([key, ob]) => ({
                mood: "ya",
                su: { name: key },
                ob: ob ?? {}
              }));
              const prah = { mood: "prah", be: fact.be, su: { name: localName } };
              aliasBlocks.push({ def, body, prah });
            } else {
              aliasBlocks.push({ fact: { mood: "ya", su: { name: localName }, be: fact?.be, ob: fact?.ob ?? {} } });
            }
          }
        }
      }
      continue;
    }
    entry.push(s);
  }

  const combined = [];
  for (const mod of modules) {
    combined.push(...mod.sentences);
    if (mod.exportFacts.size && mod.record.alias) {
      combined.push(...mapNamespaceSentences({ alias: mod.record.alias, exportFacts: mod.exportFacts, nameMap: mod.record.nameMap }));
    }
  }

  for (const block of aliasBlocks) {
    if (block.fact) {
      combined.push(block.fact);
      continue;
    }
    combined.push(block.def, ...block.body, block.prah);
  }

  combined.push(...entry);
  return combined;
}

async function compile_from_filename_to_filename(sentence) {
  const sourceFilename =
    sentence?.from?.filename ??
    sentence?.ob?.filename ??
    sentence?.filename;

  let sourceText = sentence?.fromtext?.text ?? sentence?.from?.text ?? sentence?.text ?? sentence?.ob?.text;

  if (!sourceText && sentence?.ob?.name) {
    const recalled = remember(sentence.ob.name);
    sourceText = recalled?.ob?.text;
  }

  if (!sourceText && sourceFilename) {
    sourceText = await fs.readFile(sourceFilename, "utf8");
  }
  if (typeof sourceText !== "string") {
    throwErrorSentence({
      name: "compile error",
      message: "compile: source text is required (from text or from filename)",
      from: { name: "compile" }
    });
  }

  const sourceState = (sentence?.fromstate?.name || sentence?.fromstate || "").toLowerCase();
  if (!sourceState || sourceState === "pyash") {
    sourceText = sourceText.replaceAll("\\n", "\n");
  }
  const targetState = (sentence?.tostate?.name || sentence?.become?.name || "javascript").toLowerCase();
  if (sourceState === "json" && targetState === "pyash") {
    let parsed;
    try {
      parsed = JSON.parse(sourceText);
    } catch (err) {
      throwErrorSentence({
        name: "compile error",
        message: "compile: invalid json",
        from: { name: "compile" },
        raw: { error: err?.message }
      });
    }
    const rootName = sentence?.su?.name ?? "data";
    let text;
    try {
      text = jsonToPyashText(parsed, rootName).text;
    } catch (err) {
      throwErrorSentence({
        name: "compile error",
        message: err?.message ?? "compile: json export failed",
        from: { name: "compile" },
        raw: { error: err?.message }
      });
    }
    const wrappedText = `quoted.pyash.\n${text}.pyash.quoted`;
    const targetFilename = sentence?.to?.filename;
    if (targetFilename) {
      await fs.writeFile(targetFilename, text, "utf8");
    }
    const targetName = sentence?.to?.name ?? sentence?.totext?.name ?? sentence?.su?.name;
    if (targetName) {
      doRemember({
        su: { name: targetName },
        be: "pyash",
        ob: { text: wrappedText },
        mood: "ya",
      });
    }
    return { ob: { text: wrappedText }, be: "pyash" };
  }

  const program = buildProgram(sourceText);
  const expanded = await expandModulesForCompile(sentence?.from?.filename, program.sentences);
  const sourceLines = sentenceLineNumbersFromText(sourceText);
  const sourceName = sourceFilename ? path.basename(sourceFilename) : "<pyash>";
  const canMap = sourceLines.length === expanded.length;
  const skipCsvInline = targetState === "javascript" || targetState === "js" || targetState === "c";
  for (const s of expanded) {
    const isRead = s?.be === "read";
    const sourceState = (s?.fromstate?.name || s?.fromstate || "").toLowerCase();
    if (!isRead || sourceState !== "csv") continue;
    if (skipCsvInline) continue;
    const filename = s?.from?.filename ?? s?.ob?.filename;
    if (!filename) continue;
    const hasInlineText = typeof s?.ob?.text === "string"
      || typeof s?.from?.text === "string"
      || typeof s?.fromtext?.text === "string";
    if (hasInlineText) continue;
    const fileText = await fs.readFile(filename, "utf8");
    s.ob = { ...(s.ob || {}), text: fileText };
  }

  const targetLang = targetState || "javascript";
  const wantsJsMap = (targetLang === "javascript" || targetLang === "js") && canMap;
  const bodyRaw = transpileProgram(expanded, {
    lang: targetLang,
    sourceLineNumbers: canMap ? sourceLines : null,
    sourceFilename: canMap ? (sourceFilename ?? "<pyash>") : null,
    collectSourceMap: wantsJsMap
  });
  const body = wantsJsMap ? inlineSourceMap(bodyRaw, { sourceName, sourceText }) : bodyRaw;
  const wrappedText = `quoted.${targetLang}.\n${body}.${targetLang}.quoted`;

  const targetFilename = sentence?.to?.filename;
  if (targetFilename) {
    await fs.writeFile(targetFilename, body, "utf8");
  }

  const targetName = sentence?.to?.name ?? sentence?.totext?.name ?? sentence?.su?.name;
  if (targetName) {
    doRemember({
      su: { name: targetName },
      be: sentence?.become?.name ?? "javascript",
      ob: { text: wrappedText, sentences: program.sentences },
      mood: "ya",
    });
  }

  return { ob: { text: wrappedText, sentences: program.sentences }, be: sentence?.become?.name ?? "javascript" };
}

export default compile_from_filename_to_filename;
export { transpileSentence, transpileProgram };

export const signatures = [
  {
    signatureWords: ["be", "compile", "become", "name", "num", "from", "filename"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "from", "filename", "fromstate", "name", "num", "to", "filename"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "from", "filename", "to", "filename"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "from", "text", "to", "text"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "from", "text", "to", "text"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "from", "text", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "javascript", "from", "text", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "from", "text", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "fromtext", "text", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "fromtext", "text", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "ob", "num", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "ob", "name", "fromstate", "name", "tostate", "name", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "ob", "name", "fromstate", "name", "become", "name", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "ob", "name", "num", "fromstate", "name", "num", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "fromtext", "text", "tostate", "name", "to", "filename"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "fromtext", "text", "tostate", "name", "to", "filename"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "from", "text", "to", "filename"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "from", "text", "to", "filename"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "from", "filename", "fromstate", "name", "num", "tostate", "name", "to", "text"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "fromstate", "name", "num", "ob", "name", "num", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "fromstate", "name", "num", "ob", "name", "text", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "ob", "name", "num", "fromstate", "name", "num", "tostate", "name", "num", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "from", "text", "fromstate", "name", "num", "tostate", "name", "num", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "fromtext", "text", "fromstate", "name", "num", "tostate", "name", "num", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "from", "text", "fromstate", "name", "num", "tostate", "name", "num", "to", "filename"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "fromtext", "text", "fromstate", "name", "num", "tostate", "name", "num", "to", "filename"],
    handler: compile_from_filename_to_filename
  }
];

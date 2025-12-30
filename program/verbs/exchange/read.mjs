import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { throwErrorSentence } from "../../error.mjs";
import { recordArtifact, recordExchange } from "../../bridge/exchange.mjs";
import { doRemember, remember, allRemember } from "../../remember/index.mjs";
import importFromSentence from "./import.mjs";
import { parse as parseCsv } from "csv-parse/sync";
import { jsonToMapSentences } from "./json_map.mjs";
import { parseYamlToJsonValue, canonicalizeJsonValue } from "./yaml.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// following the dynamic dispatch style used in add.mjs
function detectType(value) {
  if (value?.filename) return "filename";
  if (typeof value === "string") return "text";
  return "unknown";
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

export async function read_from_filename({ from }) {
  const modulePath = path.join(__dirname, "read_from_filename.mjs");
  if (!fs.existsSync(modulePath)) {
    throw new Error("read: no handler for filename");
  }
  const mod = await import(modulePath);
  const result = await mod.default({ from });
  return { ob: result.ob, be: "text" };
}

export async function read_fromstate_csv(sentence, { remember } = {}) {
  const source = "read csv";
  const sourceFilename = sentence?.from?.filename ?? sentence?.ob?.filename;
  let sourceText = sentence?.ob?.text ?? sentence?.from?.text ?? sentence?.fromtext?.text;
  let sourceBuffer = null;

  if (sourceFilename) {
    try {
      sourceBuffer = await fs.promises.readFile(sourceFilename);
      sourceText = sourceBuffer.toString("utf8");
    } catch (err) {
      throwErrorSentence({
        name: "csv lost",
        message: "csv lost",
        from: { name: source },
        raw: { filename: sourceFilename, error: err?.message }
      });
    }
  }

  if (typeof sourceText !== "string") {
    throwErrorSentence({
      name: "csv defective",
      message: "csv defective",
      from: { name: source },
      raw: { filename: sourceFilename }
    });
  }

  if (sourceFilename && sourceBuffer) {
    const artifact = recordArtifact({ locator: sourceFilename, producer: "exchange", bytes: sourceBuffer });
    if (artifact?.su?.name) {
      recordExchange({ artifactName: artifact.su.name, op: "read", producer: "exchange" });
    }
  }

  const targetName = sentence?.to?.name ?? sentence?.su?.name ?? "data";
  const normalizedText = sourceText
    .replace(/\\r\\n/g, "\r\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r");
  const parsed = parseCsvText(normalizedText, { source });
  const map = {
    "header raw": { ve: { type: "text", values: parsed.headerRaw } },
    header: { ve: { type: "text", values: parsed.header } }
  };
  parsed.header.forEach((key, idx) => {
    map[key] = { ve: { type: "text", values: parsed.columns[idx] } };
  });

  const fact = {
    mood: "ya",
    su: targetName ? { name: targetName } : undefined,
    be: "csv map",
    ob: { map }
  };
  if (targetName) {
    doRemember(fact);
  }
  return { ob: { map }, be: "csv map" };
}

export async function read_fromstate_json(sentence, { remember: rememberFn } = {}) {
  const targetName = sentence?.to?.name ?? sentence?.su?.name;
  await importFromSentence({ ...sentence, to: { name: targetName } });
  const fact = (rememberFn || remember)(targetName);
  if (fact?.ob) return { ob: fact.ob, be: fact.be };
  return { be: "json map" };
}

function collectExistingNames() {
  const used = new Set();
  for (const entry of allRemember()) {
    if (entry?.su?.name) used.add(entry.su.name);
  }
  return used;
}

export async function read_fromstate_yaml(sentence) {
  const source = "read yaml";
  const sourceFilename = sentence?.from?.filename ?? sentence?.ob?.filename;
  let sourceText = sentence?.ob?.text ?? sentence?.from?.text;
  let sourceBuffer = null;

  if (sourceFilename) {
    try {
      sourceBuffer = await fs.promises.readFile(sourceFilename);
      sourceText = sourceBuffer.toString("utf8");
    } catch (err) {
      throwErrorSentence({
        name: "yaml lost",
        message: "yaml lost",
        from: { name: source },
        raw: { filename: sourceFilename, error: err?.message }
      });
    }
  }

  if (typeof sourceText !== "string") {
    throwErrorSentence({
      name: "yaml defective",
      message: "yaml defective",
      from: { name: source },
      raw: { filename: sourceFilename }
    });
  }

  if (sourceFilename && sourceBuffer) {
    const artifact = recordArtifact({ locator: sourceFilename, producer: "exchange", bytes: sourceBuffer });
    if (artifact?.su?.name) {
      recordExchange({ artifactName: artifact.su.name, op: "read", producer: "exchange" });
    }
  }

  const targetName = sentence?.to?.name ?? sentence?.su?.name;
  let parsed;
  try {
    parsed = parseYamlToJsonValue(sourceText, { source });
  } catch (err) {
    throw err;
  }
  parsed = canonicalizeJsonValue(parsed);

  const existingNames = collectExistingNames();
  let sentences;
  try {
    ({ sentences } = jsonToMapSentences(parsed, targetName, { existingNames }));
  } catch (err) {
    throwErrorSentence({
      name: "yaml defective",
      message: err?.message ?? "yaml defective",
      from: { name: source },
      raw: { error: err?.message }
    });
  }
  for (const mapSentence of sentences) {
    doRemember(mapSentence);
  }
  const fact = targetName ? remember(targetName) : null;
  if (fact?.ob) return { ob: fact.ob, be: fact.be };
  return { be: "json map" };
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

function jsonValueFromObj(ob, { remember, seen }) {
  if (!ob || (typeof ob === "object" && Object.keys(ob).length === 0)) return undefined;
  if (ob.unspecified) return undefined;
  if (ob.hollow) return null;
  if (ob.text !== undefined) return ob.text;
  if (ob.num !== undefined) return ob.num;
  if (ob.boolean !== undefined) return ob.boolean;
  if (ob.ve) {
    const type = ob.ve.type || "num";
    if (type === "hollow") return [];
    if (type === "name") {
      return ob.ve.values.map((name) => jsonObjectFromMapName(name, { remember, seen }));
    }
    if (type === "bool" || type === "boolean") {
      return ob.ve.values.map((value) => value === "truth" || value === true || value === 1);
    }
    if (type === "num" || type === "number" || type === "text") return ob.ve.values;
    throwErrorSentence({
      name: "json map contents defective",
      message: `json map contents defective: unsupported vector type ${type}`,
      from: { name: "read" },
      raw: { type }
    });
  }
  if (ob.name) return jsonObjectFromMapName(ob.name, { remember, seen });
  throwErrorSentence({
    name: "json map contents defective",
    message: "json map contents defective: unsupported contents",
    from: { name: "read" },
    raw: ob
  });
  return undefined;
}

function jsonObjectFromMapName(name, { remember, seen }) {
  const fact = remember ? remember(name) : null;
  if (!fact || fact.be !== "json map") {
    throwErrorSentence({
      name: "json map referential defective",
      message: `json map referential defective: ${name}`,
      from: { name: "read" },
      raw: { name }
    });
  }
  return jsonObjectFromMapSentence(fact, { remember, seen });
}

function jsonObjectFromMapSentence(mapSentence, { remember, seen }) {
  const mapName = mapSentence?.su?.name ?? "<map>";
  if (seen.has(mapName)) {
    throwErrorSentence({
      name: "json map export self referential",
      message: "json map export self referential",
      from: { name: "read" },
      raw: { name: mapName }
    });
  }
  seen.add(mapName);
  const entries = mapSentence?.ob?.map ?? {};
  const out = {};
  for (const [key, value] of Object.entries(entries)) {
    const jsonValue = jsonValueFromObj(value, { remember, seen });
    if (jsonValue === undefined) continue;
    out[key] = jsonValue;
  }
  seen.delete(mapName);
  return out;
}

function parseAllGenitive(genitive) {
  const chainArr = Array.isArray(genitive?.chain) ? genitive.chain : [];
  if (chainArr.length < 2) return null;
  const tail = chainArr.at(-1);
  if (tail !== "all") return null;
  const mapName = chainArr[0];
  if (typeof mapName !== "string" || !mapName) return null;
  const role = chainArr.length > 2 ? chainArr[chainArr.length - 2] : null;
  return { mapName, role };
}

export async function read_from_json_map_all(sentence, { remember } = {}) {
  const info = parseAllGenitive(sentence?.ob?.genitive);
  if (!info) {
    throw new Error("read: no handler for all");
  }
  const { mapName, role } = info;
  const fact = remember ? remember(mapName) : null;
  if (!fact || fact.be !== "json map") {
    throwErrorSentence({
      name: "json map enumeration defective",
      message: "json map enumeration defective",
      from: { name: "read" },
      raw: { name: mapName }
    });
  }

  const entries = fact?.ob?.map ?? {};
  const keys = Object.keys(entries).sort(compareUtf8);
  const seen = new Set();
  const outKeys = [];
  const outValues = [];
  const outEntries = [];
  for (const key of keys) {
    const value = jsonValueFromObj(entries[key], { remember, seen });
    if (value === undefined) continue;
    outKeys.push(key);
    outValues.push(value);
    outEntries.push({ ve: { type: "raw", values: [key, value] } });
  }

  if (role === "su") {
    return { ob: { ve: { type: "text", values: outKeys } }, be: "vector" };
  }
  if (role === "ob") {
    const type = outValues.every((v) => typeof v === "number")
      ? "num"
      : outValues.every((v) => typeof v === "string")
        ? "text"
        : outValues.every((v) => typeof v === "boolean")
          ? "bool"
          : "raw";
    return { ob: { ve: { type, values: outValues } }, be: "vector" };
  }
  return { ob: { ve: { type: "raw", values: outEntries } }, be: "vector" };
}

export default async function read({ from }) {
  const fromType = detectType(from);
  if (fromType === "filename") {
    return read_from_filename({ from });
  }
  throw new Error(`read: no handler for ${fromType}`);
}

export const signatures = [
  { signatureWords: ["be", "read", "from", "filename"], handler: read_from_filename },
  { signatureWords: ["be", "read", "ob", "all"], handler: read_from_json_map_all },
  { signatureWords: ["be", "read", "from", "filename", "fromstate", "name", "json", "to", "name"], handler: read_fromstate_json },
  { signatureWords: ["be", "read", "from", "filename", "fromstate", "name", "json", "to", "name", "num"], handler: read_fromstate_json },
  { signatureWords: ["be", "read", "fromstate", "name", "json", "ob", "text", "to", "name"], handler: read_fromstate_json },
  { signatureWords: ["be", "read", "fromstate", "name", "json", "ob", "text", "to", "name", "num"], handler: read_fromstate_json },
  { signatureWords: ["be", "read", "from", "filename", "fromstate", "name", "csv", "to", "name"], handler: read_fromstate_csv },
  { signatureWords: ["be", "read", "from", "filename", "fromstate", "name", "csv", "to", "name", "num"], handler: read_fromstate_csv },
  { signatureWords: ["be", "read", "fromstate", "name", "csv", "ob", "text", "to", "name"], handler: read_fromstate_csv },
  { signatureWords: ["be", "read", "fromstate", "name", "csv", "ob", "text", "to", "name", "num"], handler: read_fromstate_csv },
  { signatureWords: ["be", "read", "from", "filename", "fromstate", "name", "yaml", "to", "name"], handler: read_fromstate_yaml },
  { signatureWords: ["be", "read", "from", "filename", "fromstate", "name", "yaml", "to", "name", "num"], handler: read_fromstate_yaml },
  { signatureWords: ["be", "read", "fromstate", "name", "yaml", "ob", "text", "to", "name"], handler: read_fromstate_yaml },
  { signatureWords: ["be", "read", "fromstate", "name", "yaml", "ob", "text", "to", "name", "num"], handler: read_fromstate_yaml },
  { signatureWords: ["be", "read", "from", "text", "fromstate", "name", "yaml", "to", "name"], handler: read_fromstate_yaml },
  { signatureWords: ["be", "read", "from", "text", "fromstate", "name", "yaml", "to", "name", "num"], handler: read_fromstate_yaml },
  { signatureWords: ["be", "read", "fromtext", "text", "fromstate", "name", "yaml", "to", "name"], handler: read_fromstate_yaml },
  { signatureWords: ["be", "read", "fromtext", "text", "fromstate", "name", "yaml", "to", "name", "num"], handler: read_fromstate_yaml }
];

import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { throwErrorSentence } from "../../error.mjs";
import { doRemember, remember } from "../../remember/index.mjs";
import importFromSentence from "./import.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// following the dynamic dispatch style used in add.mjs
function detectType(value) {
  if (value?.filename) return "filename";
  if (typeof value === "string") return "text";
  return "unknown";
}

function parseCsvText(text, { source }) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === "\"") {
        if (text[i + 1] === "\"") {
          field += "\"";
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === "\"") {
      inQuotes = true;
      continue;
    }

    if (ch === ",") {
      pushField();
      continue;
    }

    if (ch === "\n") {
      pushField();
      pushRow();
      continue;
    }

    if (ch === "\r") {
      if (text[i + 1] === "\n") i += 1;
      pushField();
      pushRow();
      continue;
    }

    field += ch;
  }

  if (field.length > 0 || row.length > 0) {
    pushField();
    pushRow();
  }

  if (rows.length === 0 || rows[0].length === 0) {
    throwErrorSentence({
      name: "csv header defective",
      message: "csv header defective",
      from: { name: source },
      raw: { rows: rows.length }
    });
  }

  const headerRaw = rows[0];
  const canonical = headerRaw.map((cell) =>
    String(cell ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
  );

  const seen = new Set();
  for (const key of canonical) {
    if (!key) {
      throwErrorSentence({
        name: "csv header defective",
        message: "csv header defective",
        from: { name: source },
        raw: { key }
      });
    }
    if (seen.has(key)) {
      throwErrorSentence({
        name: "csv header defective",
        message: `csv header defective: duplicate header key ${key}`,
        from: { name: source },
        raw: { key }
      });
    }
    seen.add(key);
  }

  const width = canonical.length;
  const columns = canonical.map(() => []);
  for (let r = 1; r < rows.length; r += 1) {
    const rowCells = rows[r];
    if (rowCells.length > width) {
      throwErrorSentence({
        name: "csv row defective",
        message: "csv row defective",
        from: { name: source },
        raw: { row: r }
      });
    }
    while (rowCells.length < width) rowCells.push("");
    for (let c = 0; c < width; c += 1) {
      columns[c].push(String(rowCells[c] ?? ""));
    }
  }

  return { headerRaw, header: canonical, columns };
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
  let sourceText = sentence?.ob?.text ?? sentence?.from?.text;

  if (sourceFilename) {
    try {
      sourceText = await fs.promises.readFile(sourceFilename, "utf8");
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

  const targetName = sentence?.to?.name ?? sentence?.su?.name;
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
  { signatureWords: ["be", "read", "fromstate", "name", "csv", "ob", "text", "to", "name", "num"], handler: read_fromstate_csv }
];

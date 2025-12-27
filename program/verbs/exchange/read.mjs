import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { throwErrorSentence } from "../../error.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// following the dynamic dispatch style used in add.mjs
function detectType(value) {
  if (value?.filename) return "filename";
  if (typeof value === "string") return "text";
  return "unknown";
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
  { signatureWords: ["be", "read", "ob", "all"], handler: read_from_json_map_all }
];

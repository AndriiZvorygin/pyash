import { throwErrorSentence } from "../../../error.mjs";

function csvEscape(value) {
  const str = String(value ?? "");
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function csvTextFromMapSentence(mapSentence) {
  const entries = mapSentence?.ob?.map ?? {};
  const headerRaw = entries["header raw"]?.ve?.values;
  const header = entries.header?.ve?.values;
  let headers = Array.isArray(headerRaw) ? headerRaw : header;
  if (Array.isArray(headerRaw)) {
    const seen = new Set();
    let defective = false;
    for (const cell of headerRaw) {
      const key = String(cell ?? "").replace(/\s+/g, " ").trim().toLowerCase();
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

export function normalizeJsonMapError(err) {
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

export function jsonFromMapSentence(mapSentence, mapDefs, seen) {
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

export function mapDefChainFromName(name, mapDefs, { formatter }) {
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
  if (typeof formatter === "function") return defs.map(formatter).join("\n\n");
  return defs;
}

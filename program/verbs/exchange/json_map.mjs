import { npToPyash, sentenceToPyash } from "../../beautiful.mjs";

function compareUtf8(a, b) {
  if (a === b) return 0;
  const bufA = Buffer.from(String(a), "utf8");
  const bufB = Buffer.from(String(b), "utf8");
  const len = Math.min(bufA.length, bufB.length);
  for (let i = 0; i < len; i += 1) {
    if (bufA[i] !== bufB[i]) return bufA[i] < bufB[i] ? -1 : 1;
  }
  return bufA.length < bufB.length ? -1 : 1;
}

function sanitizeNamePart(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "item";
  const cleaned = raw.replace(/[^A-Za-z0-9_.-]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || "item";
}

function uniqueName(base, used) {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let i = 2;
  while (used.has(`${base} ${i}`)) i += 1;
  const name = `${base} ${i}`;
  used.add(name);
  return name;
}

function vectorForScalarArray(values, type) {
  if (type === "bool") {
    return { ve: { type: "bool", values: values.map(v => (v ? "truth" : "lie")) } };
  }
  return { ve: { type, values } };
}

function jsonArrayToObj(values, { parentName, key, used, emitMap }) {
  if (values.length === 0) {
    return { ve: { type: "hollow", values: [] } };
  }

  const typeSet = new Set();
  for (const value of values) {
    if (value === null) {
      typeSet.add("hollow");
    } else if (Array.isArray(value)) {
      typeSet.add("array");
    } else if (typeof value === "object") {
      typeSet.add("object");
    } else if (typeof value === "boolean") {
      typeSet.add("bool");
    } else if (typeof value === "number") {
      typeSet.add("num");
    } else {
      typeSet.add("text");
    }
  }

  if (typeSet.has("array")) {
    throw new Error("json map contents defective: nested arrays are unsupported");
  }
  if (typeSet.has("hollow")) {
    throw new Error("json map contents defective: null elements are unsupported in arrays");
  }

  if (typeSet.size > 1 && !(typeSet.size === 1 && typeSet.has("object"))) {
    throw new Error("json map contents defective: mixed array types are unsupported");
  }

  if (typeSet.has("object")) {
    const names = values.map((value, idx) => {
      const baseKey = sanitizeNamePart(key);
      const base = `${parentName} ${baseKey} ${idx + 1}`;
      const childName = uniqueName(base, used);
      emitMap(value, childName);
      return childName;
    });
    return { ve: { type: "name", values: names } };
  }

  if (typeSet.has("bool")) return vectorForScalarArray(values, "bool");
  if (typeSet.has("num")) return vectorForScalarArray(values, "num");
  return vectorForScalarArray(values, "text");
}

function jsonValueToObj(value, { parentName, key, used, emitMap }) {
  if (value === null) return { hollow: true };
  if (Array.isArray(value)) {
    return jsonArrayToObj(value, { parentName, key, used, emitMap });
  }
  if (typeof value === "string") return { text: value };
  if (typeof value === "number") return { num: value };
  if (typeof value === "boolean") return { boolean: value };
  if (typeof value === "object") {
    const baseKey = sanitizeNamePart(key);
    const base = `${parentName} ${baseKey}`;
    const childName = uniqueName(base, used);
    emitMap(value, childName);
    return { name: childName };
  }
  return undefined;
}

export function jsonToMapSentences(value, rootName, { existingNames = [] } = {}) {
  const used = new Set(existingNames);
  const sentences = [];

  const emitMap = (ob, name) => {
    if (!ob || typeof ob !== "object" || Array.isArray(ob)) {
      throw new Error("json map contents defective: object expected");
    }
    const map = {};
    const orderedKeys = Object.keys(ob).sort(compareUtf8);
    for (const key of orderedKeys) {
      const val = ob[key];
      const objValue = jsonValueToObj(val, { parentName: name, key, used, emitMap });
      if (objValue === undefined) continue;
      map[key] = objValue;
    }
    sentences.push({
      mood: "ya",
      su: { name },
      be: "json map",
      ob: { map }
    });
  };

  const root = uniqueName(sanitizeNamePart(rootName), used);
  emitMap(value, root);

  return { rootName: root, sentences };
}

export function mapSentenceToPyash(sentence) {
  const name = sentence?.su?.name ?? "map";
  const kind = sentence?.be === "map"
    ? "map"
    : (sentence?.be === "csv map" ? "csv map" : "json map");
  const headerParts = [`su name ${name}`];
  if (sentence?.ob?.filename) {
    headerParts.push(`ob ${npToPyash({ filename: sentence.ob.filename })}`);
  } else if (sentence?.ob?.text) {
    headerParts.push(`ob ${npToPyash({ text: sentence.ob.text })}`);
  }
  if (sentence?.from?.filename) {
    headerParts.push(`from ${npToPyash({ filename: sentence.from.filename })}`);
  }
  headerParts.push(`be ${kind} def`);
  const lines = [headerParts.join(" ")];
  const entries = sentence?.ob?.map ?? {};
  let orderedKeys = Object.keys(entries).sort(compareUtf8);
  if (kind === "csv map") {
    const headerRaw = entries["header raw"]?.ve?.values;
    const header = entries.header?.ve?.values;
    orderedKeys = [];
    if (headerRaw) orderedKeys.push("header raw");
    if (header) orderedKeys.push("header");
    if (Array.isArray(header)) {
      for (const key of header) {
        if (typeof key === "string") orderedKeys.push(key);
      }
    }
    for (const key of Object.keys(entries).sort(compareUtf8)) {
      if (!orderedKeys.includes(key)) orderedKeys.push(key);
    }
  }
  for (const key of orderedKeys) {
    const ob = entries[key];
    if (kind === "map" && ob && typeof ob === "object" && ob.mood) {
      lines.push(sentenceToPyash(ob));
      continue;
    }
    const objText = npToPyash(ob);
    lines.push(`su name ${key} ob ${objText} ya`);
  }
  lines.push("prah");
  return lines.join("\n");
}

export function jsonToPyashText(value, rootName, { existingNames = [] } = {}) {
  const { rootName: resolvedRoot, sentences } = jsonToMapSentences(value, rootName, { existingNames });
  const blocks = sentences.map(mapSentenceToPyash);
  return { rootName: resolvedRoot, text: blocks.join("\n\n") + "\n" };
}

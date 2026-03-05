import { remember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";

function throwConcatenateFilenameError(message, sentence) {
  throwErrorSentence({
    name: "concatenate filename segment defective",
    message,
    from: { name: "concatenate" },
    raw: { sentence }
  });
}

function resolveFactAlias(name) {
  const raw = String(name ?? "").trim();
  if (!raw) return raw;
  if (remember(raw)) return raw;
  const candidates = [];

  const typed = raw.match(/^(text|filename|num)\s+(.+)$/iu);
  if (typed) candidates.push(String(typed[2] ?? "").trim());

  const thisRef = raw.match(/^(?:text|filename|num)\s+of\s+(.+)\s+of\s+this$/iu);
  if (thisRef) candidates.push(String(thisRef[1] ?? "").trim());

  const plainThisRef = raw.match(/^of\s+(.+)\s+of\s+this$/iu);
  if (plainThisRef) candidates.push(String(plainThisRef[1] ?? "").trim());

  for (const candidate of candidates) {
    if (candidate && remember(candidate)) return candidate;
  }

  return raw;
}

function segmentFromFactName(name, sentence) {
  const resolved = resolveFactAlias(name);
  const fact = remember(resolved);
  if (!fact) {
    throwConcatenateFilenameError("concatenate filename segment defective: missing named segment", sentence);
  }
  if (typeof fact?.ob?.text === "string") return fact.ob.text;
  if (typeof fact?.ob?.filename === "string") return fact.ob.filename;
  if (Number.isFinite(Number(fact?.ob?.num))) return String(Number(fact.ob.num));
  throwConcatenateFilenameError("concatenate filename segment defective: named segment must be text or filename or num", sentence);
}

function segmentFromValue(value, sentence) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "object") {
    throwConcatenateFilenameError("concatenate filename segment defective: unsupported segment value", sentence);
  }
  if (typeof value.text === "string") return value.text;
  if (typeof value.filename === "string") return value.filename;
  if (Number.isFinite(Number(value.num))) return String(Number(value.num));
  if (typeof value.name === "string" && value.name.trim()) {
    return segmentFromFactName(value.name.trim(), sentence);
  }
  throwConcatenateFilenameError("concatenate filename segment defective: unsupported segment value", sentence);
}

function segmentsFromVector(ob, sentence) {
  const type = String(ob?.ve?.type ?? "").trim().toLowerCase();
  const values = Array.isArray(ob?.ve?.values) ? ob.ve.values : [];
  return values.map((value) => {
    if (type === "name") return segmentFromFactName(String(value ?? "").trim(), sentence);
    if (type === "num") {
      const num = Number(value);
      if (!Number.isFinite(num)) {
        throwConcatenateFilenameError("concatenate filename segment defective: num segment invalid", sentence);
      }
      return String(num);
    }
    if (type === "filename" || type === "text" || !type) return String(value ?? "");
    return segmentFromValue({ [type]: value }, sentence);
  });
}

function segmentsFromSeries(name, sentence) {
  const fact = remember(name);
  if (!fact || fact.be !== "series" || !Array.isArray(fact?.ob?.series)) return null;
  return fact.ob.series.map((entry) => segmentFromValue(entry?.ob ?? entry, sentence));
}

function segmentsFromNamedSource(name, sentence) {
  const resolved = resolveFactAlias(name);
  const fact = remember(resolved);
  if (!fact) throwConcatenateFilenameError("concatenate filename segment defective: named source missing", sentence);

  if (fact.be === "vector" && Array.isArray(fact?.ob?.ve?.values)) {
    return segmentsFromVector(fact.ob, sentence);
  }
  const fromSeries = segmentsFromSeries(resolved, sentence);
  if (fromSeries) return fromSeries;
  return [segmentFromValue(fact.ob ?? fact, sentence)];
}

function normalizeJoin(segments) {
  let absolute = false;
  const parts = [];

  for (const raw of segments) {
    let segment = String(raw ?? "");
    if (!segment) continue;
    segment = segment.replace(/\\/gu, "/");
    segment = segment.replace(/^\.\/+/u, "");
    if (!segment || segment === ".") continue;
    if (!absolute && segment.startsWith("/")) absolute = true;
    const units = segment.split("/").filter(part => part !== "" && part !== ".");
    parts.push(...units);
  }

  if (!parts.length) return absolute ? "/" : "";
  return `${absolute ? "/" : ""}${parts.join("/")}`;
}

export async function concatenateBecomeWoFilename(sentence) {
  const ob = sentence?.ob ?? {};
  let segments = [];

  if (ob.ve) {
    segments = segmentsFromVector(ob, sentence);
  } else if (typeof ob.name === "string" && ob.name.trim()) {
    segments = segmentsFromNamedSource(ob.name.trim(), sentence);
  } else if (
    typeof ob.text === "string" ||
    typeof ob.filename === "string" ||
    Number.isFinite(Number(ob.num))
  ) {
    segments = [segmentFromValue(ob, sentence)];
  } else {
    throwConcatenateFilenameError("concatenate filename segment defective: expected vector or scalar segments", sentence);
  }

  const joined = normalizeJoin(segments);
  const asFilename =
    sentence?.to?.filename !== undefined ||
    Array.isArray(sentence?.to?.nameTypeWords) && sentence.to.nameTypeWords.includes("filename");
  if (asFilename) {
    return { ob: { filename: joined }, be: "filename" };
  }
  return { ob: { text: joined }, be: "text" };
}

const OB_TYPES = [
  ["vec", "text"],
  ["vec", "filename"],
  ["vec", "num"],
  ["vec", "name"],
  ["name", "vec"],
  ["name", "vec", "text"],
  ["name", "vec", "filename"],
  ["name", "vec", "num"],
  ["name", "vec", "name"],
  ["name", "series"],
  ["name", "text"],
  ["name", "filename"],
  ["name", "num"],
  ["text"],
  ["filename"],
  ["num"]
];

const TO_TYPES = [
  ["name", "text"],
  ["name", "filename"],
  ["filename"]
];

const signatureEntries = [];
const signatureSet = new Set();

for (const obType of OB_TYPES) {
  for (const toType of TO_TYPES) {
    const words = ["be", "concatenate", "become", "wo", "filename", "ob", ...obType, "to", ...toType];
    const key = words.join(" ");
    if (signatureSet.has(key)) continue;
    signatureSet.add(key);
    signatureEntries.push({ signatureWords: words, handler: concatenateBecomeWoFilename });
  }
}

export const signatures = signatureEntries;

export default concatenateBecomeWoFilename;

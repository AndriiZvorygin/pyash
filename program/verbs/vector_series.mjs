import { remember, doRemember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";

function resolveVectorValues(sentence, { rememberFn = remember } = {}) {
  const fromName = String(sentence?.from?.name ?? "").trim();
  if (!fromName) return null;
  const fact = rememberFn(fromName);
  const values = fact?.ob?.ve?.values;
  if (!Array.isArray(values)) return null;
  return { name: fromName, values };
}

function normalizeEntryValue(value) {
  if (typeof value === "string") return { ob: { text: value }, be: "text" };
  if (typeof value === "number") return { ob: { num: value }, be: "number" };
  if (typeof value === "boolean") return { ob: { boolean: value }, be: "boolean" };

  if (value && typeof value === "object") {
    if (value.map && typeof value.map === "object" && !Array.isArray(value.map)) {
      return { ob: { map: value.map }, be: "map" };
    }
    if (typeof value.text === "string") return { ob: { text: value.text }, be: "text" };
    if (typeof value.num === "number") return { ob: { num: value.num }, be: "number" };
    if (typeof value.boolean === "boolean") return { ob: { boolean: value.boolean }, be: "boolean" };
    if (typeof value.filename === "string") return { ob: { filename: value.filename }, be: "filename" };
    if (typeof value.name === "string") return { ob: { name: value.name }, be: "name" };
    if (value.ve?.values && Array.isArray(value.ve.values)) return { ob: { ve: value.ve }, be: "vector" };
  }

  return { ob: { text: String(value ?? "") }, be: "text" };
}

export async function vectorToSeries(sentence, { remember: rememberFn = remember, doRemember: doRememberFn = doRemember } = {}) {
  const source = resolveVectorValues(sentence, { rememberFn });
  if (!source) {
    throwErrorSentence({
      name: "series defective",
      message: "series defective: missing from name vec",
      from: { name: "series" },
      raw: { sentence }
    });
  }

  const targetName = String(sentence?.to?.name ?? "").trim();
  if (!targetName) {
    throwErrorSentence({
      name: "series defective",
      message: "series defective: missing to name series",
      from: { name: "series" },
      raw: { sentence }
    });
  }

  const entries = source.values.map((value, index) => {
    const normalized = normalizeEntryValue(value);
    return {
      mood: "ya",
      su: { name: `item ${String(index + 1).padStart(3, "0")}` },
      from: { num: index + 1 },
      ...normalized
    };
  });

  const out = {
    mood: "ya",
    su: { name: targetName },
    be: "series",
    ob: { series: entries }
  };
  doRememberFn(out);
  return out;
}

export default vectorToSeries;

export const signatures = [
  { signatureWords: ["be", "series", "from", "name", "vec", "to", "name", "series"], handler: vectorToSeries },
  { signatureWords: ["be", "series", "from", "name", "vec", "to", "name"], handler: vectorToSeries },
  { signatureWords: ["be", "series", "from", "name", "vec", "text", "to", "name", "series"], handler: vectorToSeries },
  { signatureWords: ["be", "series", "from", "name", "vec", "text", "to", "name"], handler: vectorToSeries },
  { signatureWords: ["be", "series", "from", "name", "vector", "to", "name", "series"], handler: vectorToSeries },
  { signatureWords: ["be", "series", "from", "name", "vector", "to", "name"], handler: vectorToSeries },
  { signatureWords: ["be", "series", "from", "name", "vector", "text", "to", "name", "series"], handler: vectorToSeries },
  { signatureWords: ["be", "series", "from", "name", "vector", "text", "to", "name"], handler: vectorToSeries }
];

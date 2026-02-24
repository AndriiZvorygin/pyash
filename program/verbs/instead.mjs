import { remember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";
import { renderSayValue } from "./say.mjs";

function throwInsteadError(message, raw = {}) {
  throwErrorSentence({
    name: "instead defective",
    message,
    from: { name: "instead" },
    raw
  });
}

function scalarToText(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "truth" : "lie";
  return null;
}

function resolveValueText(value, { rememberFn = remember, depth = 0 } = {}) {
  if (depth > 6) return null;
  const scalar = scalarToText(value);
  if (scalar !== null) return scalar;
  if (!value || typeof value !== "object") return null;
  if (value.hollow) return "null";
  if (typeof value.text === "string") return value.text;
  if (typeof value.filename === "string") return value.filename;
  if (typeof value.num === "number") return String(value.num);
  if (typeof value.boolean === "boolean") return value.boolean ? "truth" : "lie";
  if (value.genitive) {
    const rendered = renderSayValue({ genitive: value.genitive }, { rememberFn });
    if (rendered !== undefined && rendered !== null) return String(rendered);
  }
  if (typeof value.name === "string") {
    const fact = rememberFn(value.name);
    if (!fact) return null;
    return resolveValueText(fact?.ob ?? fact, { rememberFn, depth: depth + 1 });
  }
  if (value.ob && typeof value.ob === "object") {
    return resolveValueText(value.ob, { rememberFn, depth: depth + 1 });
  }
  return null;
}

function resolveSourceText(sentence, { rememberFn = remember } = {}) {
  if (typeof sentence?.in?.text === "string") return sentence.in.text;
  if (typeof sentence?.in?.name === "string") {
    const fact = rememberFn(sentence.in.name);
    const text = resolveValueText(fact?.ob ?? fact, { rememberFn });
    if (text !== null) return text;
  }
  throwInsteadError("instead defective: expected in text or in name text", { sentence });
}

function resolveReplacementMap(sentence, { rememberFn = remember } = {}) {
  const mapName = String(sentence?.ob?.name ?? "").trim();
  if (!mapName) {
    throwInsteadError("instead defective: requires replacement map", { sentence });
  }
  const mapFact = rememberFn(mapName);
  const mapEntries = mapFact?.ob?.map;
  if (!mapEntries || typeof mapEntries !== "object" || Array.isArray(mapEntries)) {
    throwInsteadError("instead defective: replacement map invalid", { mapName, mapFact });
  }
  return mapEntries;
}

export async function instead(sentence, { remember: rememberFn = remember } = {}) {
  let output = resolveSourceText(sentence, { rememberFn });
  const replacementMap = resolveReplacementMap(sentence, { rememberFn });
  for (const [rawNeedle, replacementValue] of Object.entries(replacementMap)) {
    const needle = String(rawNeedle ?? "");
    if (!needle) {
      throwInsteadError("instead defective: empty replacement key", { mapName: sentence?.ob?.name });
    }
    const replacementText = resolveValueText(replacementValue, { rememberFn });
    if (replacementText === null) {
      throwInsteadError("instead defective: replacement map invalid", { key: needle, value: replacementValue });
    }
    output = output.split(needle).join(replacementText);
  }
  return { ob: { text: output }, be: "text" };
}

export default instead;

export const signatures = [
  { signatureWords: ["be", "instead", "in", "text"], handler: instead },
  { signatureWords: ["be", "instead", "in", "name", "text"], handler: instead },
  { signatureWords: ["be", "instead", "in", "text", "to", "name", "text"], handler: instead },
  { signatureWords: ["be", "instead", "in", "name", "text", "to", "name", "text"], handler: instead },
  { signatureWords: ["be", "instead", "in", "text", "to", "name", "num"], handler: instead },
  { signatureWords: ["be", "instead", "in", "name", "text", "to", "name", "num"], handler: instead },
  { signatureWords: ["be", "instead", "in", "text", "ob", "name", "map"], handler: instead },
  { signatureWords: ["be", "instead", "in", "name", "text", "ob", "name", "map"], handler: instead },
  { signatureWords: ["be", "instead", "in", "text", "ob", "name", "map", "to", "name", "text"], handler: instead },
  { signatureWords: ["be", "instead", "in", "name", "text", "ob", "name", "map", "to", "name", "text"], handler: instead },
  { signatureWords: ["be", "instead", "in", "text", "ob", "name", "map", "to", "name", "num"], handler: instead },
  { signatureWords: ["be", "instead", "in", "name", "text", "ob", "name", "map", "to", "name", "num"], handler: instead }
];

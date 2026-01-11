import { throwErrorSentence } from "../../error.mjs";
import { getEffectiveVyahAspect } from "../../library/grammar/vyah.mjs";
import { makeSignatureWords, normalizeTypeWords, normalizeWords } from "./normalize.mjs";

const NON_CASE_FIELDS = new Set([
  "mood",
  "be",
  "exists",
  "signatureWords",
  "signature",
  "ret",
  "this",
  "consequence"
]);

const SEQUENCE_REGISTERS = new Set(["fromindex", "toindex", "atindex"]);

function caseTypeWords(value) {
  if (value == null) return [];
  if (value.la) return ["la"];

  if (Array.isArray(value)) {
    // Best-effort: derive from first element.
    return value.length > 0 ? caseTypeWords(value[0]) : [];
  }

  if (typeof value !== "object") {
    const normalized = normalizeWords(String(value));
    return normalized ? [normalized] : [];
  }

  if (value.ve) {
    const inner = normalizeWords(value.ve.type);
    return ["vec", ...(inner ? [inner] : [])].filter(Boolean);
  }

  if (value.genitive) {
    const chainArr = Array.isArray(value.genitive.chain) ? value.genitive.chain : [];
    const tail = normalizeWords(chainArr.at(-1));
    if (tail === "all") return ["all"];
    if (tail === "name") return ["name", "num"];
    if (tail === "text") return ["text"];
    if (tail === "wo") return ["wo"];
    if (tail === "filename") return ["filename"];
    if (tail === "bool") return ["bool"];
    if (tail === "hollow") return ["hollow"];
    if (tail === "num" || tail === "number") return ["num"];
    if (tail === "ve" || tail === "vec") return ["vec"];
    if (tail === "atindex" || tail === "fromindex" || tail === "toindex") return ["num"];
    return tail ? ["name", "num"] : ["num"];
  }

  const words = [];

  if (value.nameTypeWords?.length) {
    return ["name", ...value.nameTypeWords];
  }

  if (value.name) {
    words.push("name");
    const tail = normalizeWords(value.name);
    if (tail && (tail === "num" || tail === "text" || tail === "vec" || tail === "ve" || tail === "filename" || tail === "mind")) {
      words.push(tail);
    } else if (tail && tail !== "num" && tail !== "text" && tail !== "vec" && tail !== "ve") {
      words.push(...tail.split(" ").filter(Boolean));
    }
  }

  if (value.wo !== undefined) {
    const literal = normalizeWords(String(value.wo));
    return literal ? ["wo", literal] : ["wo"];
  }
  if (value.num !== undefined) words.push("num");
  if (value.boolean !== undefined) words.push("bool");
  if (value.hollow) words.push("hollow");
  if (value.text !== undefined) words.push("text");
  if (value.filename !== undefined) words.push("filename");

  return words.filter(Boolean);
}

function caseTypeWordsForDefinition(value, caseKey, verb) {
  if (caseKey === "vyah") {
    const modifiers = Array.isArray(value?.ve?.values) ? value.ve.values : [];
    const aspect = getEffectiveVyahAspect(modifiers, { verb, caseKey });
    return aspect ? [aspect] : ["do"];
  }
  if (caseKey === "ob" && value?.wo !== undefined) {
    return ["wo"];
  }
  return caseTypeWords(value);
}

function normalizeDefinitionTypeWords(typeWords) {
  if (!typeWords || typeWords.length === 0) return [];

  if (typeWords[0] === "name") {
    // Drop concrete variable names in definitions; keep the type
    const withoutTail = ["name", ...typeWords.slice(1).filter(t => t === "num" || t === "text" || t === "wo" || t === "vec" || t === "filename" || t === "bool")];
    if (withoutTail.length === 1) {
      // default to numeric if no explicit type after name
      return ["name", "num"];
    }
    return withoutTail;
  }

  return typeWords;
}

export function deriveSignatureFromDefinition(sentence) {
  if (!sentence || sentence.mood !== "def" || sentence.be !== "ceremony") return null;

  const verb = normalizeWords(sentence.su?.name);
  if (!verb) return null;

  const cases = [];
  for (const [key, value] of Object.entries(sentence)) {
    if (value === undefined) continue;
    if (NON_CASE_FIELDS.has(key)) continue;
    if (key === "su") continue; // ceremony name, not a case
    if (SEQUENCE_REGISTERS.has(key)) continue;
    const typeWords = normalizeDefinitionTypeWords(caseTypeWordsForDefinition(value, key, verb));
    if (typeWords.length === 0) continue;
    cases.push({ case: key, typeWords });
  }

  return makeSignatureWords({ be: verb, cases });
}

function caseTypeWordsWithMemory(value, remember, verb = "", caseKey = "") {
  if (value == null) return [];
  if (value.la) return ["la"];

  if (Array.isArray(value)) {
    return value.length > 0 ? caseTypeWordsWithMemory(value[0], remember) : [];
  }

  if (typeof value !== "object") {
    if (typeof value === "number") return ["num"];
    const normalized = normalizeWords(String(value));
    return normalized ? [normalized] : [];
  }

  if (caseKey === "vyah") {
    const modifiers = Array.isArray(value?.ve?.values) ? value.ve.values : [];
    const aspect = getEffectiveVyahAspect(modifiers, { verb, caseKey });
    return aspect ? [aspect] : ["do"];
  }

  if (value.ve) {
    const inner = normalizeWords(value.ve.type);
    return ["vec", ...(inner ? [inner] : [])].filter(Boolean);
  }

  if (value.nameTypeWords?.length) {
    return ["name", ...value.nameTypeWords];
  }

  if (value.boolean !== undefined) return ["bool"];
  if (value.hollow) return ["hollow"];

  if (value.name) {
    if (caseKey === "fromstate" || caseKey === "tostate" || caseKey === "become") {
      const stateName = normalizeWords(value.name);
      if (stateName) return ["name", stateName];
    }
    const inferred = remember ? remember(value.name) : null;
    const factObj = inferred?.ob;
    const vecType = factObj?.ve?.type;

    if (caseKey === "su") {
      if (factObj?.num !== undefined) return ["num"];
      if (factObj?.boolean !== undefined) return ["bool"];
      if (factObj?.text !== undefined) return ["text"];
      if (factObj?.filename !== undefined) return ["filename"];
      if (factObj?.ve?.values) return ["vec", normalizeWords(vecType) || "num"].filter(Boolean);
      if (inferred?.be === "duty") return ["duty"];
      if (inferred?.be === "stream") return ["stream"];
      if (inferred?.be === "chip") return ["chip"];
      if (inferred?.be === "mind") return ["mind"];
      return ["num"];
    }

    if (inferred?.be === "duty") return ["name", "duty"];
    if (inferred?.be === "stream") return ["name", "stream"];
    if (inferred?.be === "chip") return ["name", "chip"];
    if (inferred?.be === "mind") return ["name", "mind"];
    if (inferred?.be === "map") return ["name", "map"];
    if (inferred?.be === "csv map") return ["name", "csv", "map"];
    if (inferred?.be === "json map") return ["name", "json", "map"];

    if (factObj?.ve?.values) return ["name", "vec", normalizeWords(vecType) || "num"].filter(Boolean);
    if (vecType) return ["name", "vec", normalizeWords(vecType) || "num"].filter(Boolean);
    if (factObj?.num !== undefined) return ["name", "num"];
    if (factObj?.boolean !== undefined) return ["name", "bool"];
    if (factObj?.text !== undefined) return ["name", "text"];
    if (factObj?.filename !== undefined) return ["name", "filename"];
    if (typeof value.name === "string") {
      if (/\s/.test(value.name)) return ["text"];
      if (verb === "mind" || verb === "say" || verb === "write") return ["text"];
    }
    return ["name", "num"];
  }

  if (value.num !== undefined) return ["num"];
  if (value.wo !== undefined) {
    if (caseKey === "ob") return ["wo"];
    const literal = normalizeWords(String(value.wo));
    return literal ? ["wo", literal] : ["wo"];
  }
  if (value.text !== undefined) return ["text"];
  if (value.filename !== undefined) return ["filename"];
  if (value.thisRef) return ["num"];
  if (value.genitive) {
    const chainArr = Array.isArray(value.genitive.chain) ? value.genitive.chain : [];
    const tail = normalizeWords(chainArr.at(-1));
    if (tail === "all") return ["all"];
    if (tail === "name") return ["name", "num"];
    if (tail === "text") return ["text"];
    if (tail === "wo") return ["wo"];
    if (tail === "filename") return ["filename"];
    if (tail === "num" || tail === "number") return ["num"];
    if (tail === "ve" || tail === "vec") return ["vec"];
    if (tail === "atindex" || tail === "fromindex" || tail === "toindex") return ["num"];
    return tail ? ["name", "num"] : ["num"];
  }

  const fallback = caseTypeWords(value);
  if (fallback.length === 0) {
    console.error("caseTypeWords fallback empty", { verb, value });
    const raw = (() => {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    })();
    throw new Error(`Cannot derive type words for case; verb=${verb}; value=${raw}`);
  }
  return fallback;
}

export function deriveSignatureFromCall(sentence, { remember } = {}) {
  if (!sentence) return null;
  const verb = normalizeWords(sentence.be);
  if (!verb) return null;

  const cases = [];
  for (const [key, value] of Object.entries(sentence)) {
    if (value === undefined) continue;
    if (NON_CASE_FIELDS.has(key)) continue;
    if (key === "su" && sentence.mood !== "then") continue;
    if ((key === "by" || key === "atindex") && value?.register) continue; // skip map/loop register helpers
    const typeWords = caseTypeWordsWithMemory(value, remember, verb, key);
    if (typeWords.length === 0) {
      console.error("derive-signature-fail", { key, value, verb });
      throwErrorSentence({
        name: "signature derive",
        message: `Cannot derive signature: missing type words for case "${key}" on verb "${verb}" (value: ${value === undefined ? "undefined" : JSON.stringify(value)})`,
        raw: { case: key, verb, value }
      });
    }
    cases.push({ case: key, typeWords });
  }

  return makeSignatureWords({ be: verb, cases });
}

import { throwErrorSentence } from "../error.mjs";
import { getEffectiveVyahAspect } from "../library/grammar/vyah.mjs";

// Build canonical signature words from a verb and its cases/types.
export function makeSignatureWords({ be, cases }) {
  if (typeof be !== "string" || be.trim() === "") {
    throw new Error("Signature needs a verb string in `be`.");
  }

  const verb = normalizeWords(be);
  const caseEntries = normalizeCases(cases);
  const sortedCases = caseEntries.sort((a, b) => a.case.localeCompare(b.case));

  const words = ["be", verb];
  for (const entry of sortedCases) {
    words.push(entry.case, ...entry.typeWords);
  }
  return words;
}

export function joinSignatureWords(words) {
  if (!Array.isArray(words) || words.length === 0) {
    throw new Error("Signature words must be a non-empty array.");
  }
  const normalized = words.map(w => normalizeWords(w));
  if (normalized.some(w => w === "")) {
    throw new Error("Signature words cannot be empty.");
  }
  return normalized.join(" ");
}

// Registry for signature -> ceremony name lookups
const signatureRegistry = new Map(); // key -> def name
const nameToKeys = new Map(); // def name -> Set<key>

// Registry for signature -> handler (built-in verbs)
const signatureHandlers = new Map(); // key -> fn

export function registerSignature({ name, signatureWords }) {
  if (!name || !signatureWords?.length) return;
  const key = joinSignatureWords(signatureWords);

  // Remove previous registrations for this name
  const prev = nameToKeys.get(name);
  if (prev) {
    for (const k of prev) signatureRegistry.delete(k);
    prev.clear();
  }

  signatureRegistry.set(key, name);
  nameToKeys.set(name, new Set([key]));
}

export function registerSignatureAlias({ name, signatureWords }) {
  if (!name || !signatureWords?.length) return;
  const key = joinSignatureWords(signatureWords);
  signatureRegistry.set(key, name);
  const keys = nameToKeys.get(name) ?? new Set();
  keys.add(key);
  nameToKeys.set(name, keys);
}

export function registerSignatureHandler({ signatureWords, handler }) {
  if (!signatureWords?.length || typeof handler !== "function") return;
  const key = joinSignatureWords(signatureWords);
  signatureHandlers.set(key, handler);
}

export function clearSignatureHandlers() {
  signatureHandlers.clear();
}

export function lookupSignature(key) {
  return signatureRegistry.get(key);
}

export function lookupSignatureHandler(key) {
  return signatureHandlers.get(key);
}

export function clearSignatureDefinitions() {
  signatureRegistry.clear();
  nameToKeys.clear();
}

// Extract a signature from a ceremony definition sentence ("su name X be ceremony def").
export function deriveSignatureFromDefinition(sentence) {
  if (!sentence || sentence.mood !== "def" || sentence.be !== "ceremony") return null;

  const verb = normalizeWords(sentence.su?.name);
  if (!verb) return null;

  const cases = [];
  for (const [key, value] of Object.entries(sentence)) {
    if (NON_CASE_FIELDS.has(key)) continue;
    if (key === "su") continue; // ceremony name, not a case
    if (SEQUENCE_REGISTERS.has(key)) continue;
    const typeWords = normalizeDefinitionTypeWords(caseTypeWordsForDefinition(value, key, verb));
    if (typeWords.length === 0) continue;
    cases.push({ case: key, typeWords });
  }

  return makeSignatureWords({ be: verb, cases });
}

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
  return caseTypeWords(value);
}

function normalizeDefinitionTypeWords(typeWords) {
  if (!typeWords || typeWords.length === 0) return [];

  if (typeWords[0] === "name") {
    // Drop concrete variable names in definitions; keep the type
    const withoutTail = ["name", ...typeWords.slice(1).filter(t => t === "num" || t === "text" || t === "vec" || t === "filename" || t === "bool")];
    if (withoutTail.length === 1) {
      // default to numeric if no explicit type after name
      return ["name", "num"];
    }
    return withoutTail;
  }

  return typeWords;
}

// Build signature from an invocation sentence, using memory to refine type words.
export function deriveSignatureFromCall(sentence, { remember } = {}) {
  if (!sentence) return null;
  const verb = normalizeWords(sentence.be);
  if (!verb) return null;

  const cases = [];
  for (const [key, value] of Object.entries(sentence)) {
    if (NON_CASE_FIELDS.has(key)) continue;
    if (key === "su" && sentence.mood !== "then") continue;
    if ((key === "by" || key === "atindex") && value?.register) continue; // skip map/loop register helpers
    const typeWords = caseTypeWordsWithMemory(value, remember, verb, key);
    if (typeWords.length === 0) {
      console.error("derive-signature-fail", { key, value, verb });
      throwErrorSentence({
        name: "signature derive",
        message: `Cannot derive signature: missing type words for case "${key}" on verb "${verb}"`,
        from: { name: "signature" },
        raw: { case: key, verb, value }
      });
    }
    cases.push({ case: key, typeWords });
  }

  return makeSignatureWords({ be: verb, cases });
}

function caseTypeWordsWithMemory(value, remember, verb = "", caseKey = "") {
  if (value == null) return [];

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
      if (inferred?.be === "mind") return ["mind"];
      return ["num"];
    }

    if (inferred?.be === "mind") return ["name", "mind"];
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
  if (value.text !== undefined) return ["text"];
  if (value.filename !== undefined) return ["filename"];
  if (value.thisRef) return ["num"];
  if (value.genitive) {
    const chainArr = Array.isArray(value.genitive.chain) ? value.genitive.chain : [];
    const tail = normalizeWords(chainArr.at(-1));
    if (tail === "all") return ["all"];
    if (tail === "name") return ["name", "num"];
    if (tail === "text") return ["text"];
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

function normalizeWords(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function normalizeCases(cases) {
  if (!cases) return [];

  if (Array.isArray(cases)) {
    return cases.map(validateCaseEntry);
  }

  if (typeof cases === "object") {
    return Object.entries(cases).map(([caseName, typeWords]) =>
      validateCaseEntry({ case: caseName, typeWords })
    );
  }

  throw new Error("Cases must be an array or object mapping case names to type words.");
}

function validateCaseEntry(entry) {
  const caseName = normalizeWords(entry?.case);
  if (!caseName) {
    throw new Error("Each case needs a non-empty name.");
  }

  const typeWords = normalizeTypeWords(entry.typeWords);
  if (typeWords.length === 0) {
    throw new Error(`Case "${caseName}" needs at least one type word.`);
  }

  return { case: caseName, typeWords };
}

function normalizeTypeWords(typeWords) {
  if (typeof typeWords === "string") {
    return typeWords
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }

  if (!Array.isArray(typeWords)) return [];

  return typeWords.map(t => normalizeWords(t)).filter(Boolean);
}

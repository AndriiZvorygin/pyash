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

// Extract a signature from a ceremony definition sentence ("subj name X be ceremony def").
export function deriveSignatureFromDefinition(sentence) {
  if (!sentence || sentence.mood !== "def" || sentence.be !== "ceremony") return null;

  const verb = normalizeWords(sentence.subj?.name);
  if (!verb) return null;

  const cases = [];
  for (const [key, value] of Object.entries(sentence)) {
    if (NON_CASE_FIELDS.has(key)) continue;
    const typeWords = normalizeDefinitionTypeWords(caseTypeWords(value));
    if (typeWords.length === 0) continue;
    cases.push({ case: key, typeWords });
  }

  return makeSignatureWords({ be: verb, cases });
}

const NON_CASE_FIELDS = new Set([
  "mood",
  "be",
  "subj",
  "su",
  "signatureWords",
  "signature",
  "ret",
  "this",
  "consequence"
]);

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

  const words = [];

  if (value.name) {
    words.push("name");
    const tail = normalizeWords(value.name);
    if (tail && tail !== "num" && tail !== "text" && tail !== "vec") {
      words.push(...tail.split(" ").filter(Boolean));
    }
  }

  if (value.num !== undefined) words.push("num");
  if (value.text !== undefined) words.push("text");
  if (value.filename !== undefined) words.push("filename");

  return words.filter(Boolean);
}

function normalizeDefinitionTypeWords(typeWords) {
  if (!typeWords || typeWords.length === 0) return [];

  if (typeWords[0] === "name") {
    // Drop concrete variable names in definitions; keep the type
    const withoutTail = ["name", ...typeWords.slice(1).filter(t => t === "num" || t === "text" || t === "vec" || t === "filename")];
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
    const typeWords = caseTypeWordsWithMemory(value, remember, verb);
    if (typeWords.length === 0) {
      throw new Error(`Cannot derive signature: missing type words for case "${key}" on verb "${verb}"`);
    }
    cases.push({ case: key, typeWords });
  }

  return makeSignatureWords({ be: verb, cases });
}

function caseTypeWordsWithMemory(value, remember, verb = "") {
  if (value == null) return [];

  if (Array.isArray(value)) {
    return value.length > 0 ? caseTypeWordsWithMemory(value[0], remember) : [];
  }

  if (typeof value !== "object") {
    const normalized = normalizeWords(String(value));
    return normalized ? [normalized] : [];
  }

  if (value.ve) {
    const inner = normalizeWords(value.ve.type);
    return ["vec", ...(inner ? [inner] : [])].filter(Boolean);
  }

  if (value.name) {
    const inferred = remember ? remember(value.name) : null;
    const factObj = inferred?.obj;
    const vecType = factObj?.ve?.type;

    if (inferred?.be === "mind") return ["name", "mind"];

    if (vecType) return ["name", "vec", normalizeWords(vecType) || "num"].filter(Boolean);
    if (factObj?.num !== undefined) return ["name", "num"];
    if (factObj?.text !== undefined) return ["name", "text"];
    if (factObj?.filename !== undefined) return ["name", "filename"];
    if (typeof value.name === "string") {
      if (/\s/.test(value.name)) return ["text"];
      if (verb === "mind" || verb === "say") return ["text"];
    }
    return ["name", "num"];
  }

  if (value.num !== undefined) return ["num"];
  if (value.text !== undefined) return ["text"];
  if (value.filename !== undefined) return ["filename"];

  const fallback = caseTypeWords(value);
  if (fallback.length === 0) throw new Error("Cannot derive type words for case");
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

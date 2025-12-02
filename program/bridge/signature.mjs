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

// Extract a signature from a ceremony definition sentence ("subj name X be ceremony def").
export function deriveSignatureFromDefinition(sentence) {
  if (!sentence || sentence.mood !== "def" || sentence.be !== "ceremony") return null;

  const verb = normalizeWords(sentence.subj?.name);
  if (!verb) return null;

  const cases = [];
  for (const [key, value] of Object.entries(sentence)) {
    if (NON_CASE_FIELDS.has(key)) continue;
    const typeWords = caseTypeWords(value);
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
    if (tail) {
      words.push(...tail.split(" ").filter(Boolean));
    }
  }

  if (value.num !== undefined) words.push("num");
  if (value.text !== undefined) words.push("text");
  if (value.filename !== undefined) words.push("filename");

  return words.filter(Boolean);
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

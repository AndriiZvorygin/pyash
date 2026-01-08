export function normalizeWords(value) {
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

export function normalizeTypeWords(typeWords) {
  if (typeof typeWords === "string") {
    return typeWords
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }

  if (!Array.isArray(typeWords)) return [];

  return typeWords.map(t => normalizeWords(t)).filter(Boolean);
}

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

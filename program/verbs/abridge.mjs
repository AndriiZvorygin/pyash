import { remember, doRemember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";

const DEFAULT_BUDGET_BYTES = 4000;
const REDUNDANCY_THRESHOLD = 0.85;
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have", "in", "is",
  "it", "its", "of", "on", "or", "that", "the", "to", "was", "were", "will", "with"
]);
const CUE_BOOSTS = new Map([
  ["therefore", 0.9],
  ["summary", 0.8],
  ["conclusion", 0.8],
  ["decision", 1.0],
  ["action", 1.0],
  ["recommendation", 0.9],
  ["must", 0.7],
  ["should", 0.6],
  ["important", 0.5]
]);

function resolveSourceText(sentence, { rememberFn = remember } = {}) {
  if (typeof sentence?.ob?.text === "string") return sentence.ob.text;
  if (typeof sentence?.ob?.name === "string") {
    const obFact = rememberFn(sentence.ob.name);
    if (typeof obFact?.ob?.text === "string") return obFact.ob.text;
  }
  if (typeof sentence?.from?.text === "string") return sentence.from.text;
  if (typeof sentence?.from?.name === "string") {
    const fact = rememberFn(sentence.from.name);
    if (typeof fact?.ob?.text === "string") return fact.ob.text;
  }
  return null;
}

function resolveBudgetBytes(sentence) {
  const byteBudget = sentence?.atmost?.byte ?? sentence?.atmost?.bytes ?? null;
  if (Number.isFinite(byteBudget) && byteBudget > 0) return Math.trunc(byteBudget);
  const numBudget = sentence?.atmost?.num ?? null;
  if (Number.isFinite(numBudget) && numBudget > 0) return Math.trunc(numBudget);
  return DEFAULT_BUDGET_BYTES;
}

function splitSentencesWithOffsets(text) {
  const source = String(text ?? "");
  const candidates = [];
  let start = 0;
  const length = source.length;
  for (let i = 0; i < length; i += 1) {
    const ch = source[i];
    const boundary = ch === "." || ch === "!" || ch === "?" || ch === "\n";
    if (!boundary) continue;
    const end = i + 1;
    const segment = source.slice(start, end).trim();
    if (segment) {
      const rawStart = source.indexOf(segment, start);
      candidates.push({ text: segment, start: rawStart, end: rawStart + segment.length });
    }
    start = end;
  }
  const tail = source.slice(start).trim();
  if (tail) {
    const rawStart = source.indexOf(tail, start);
    candidates.push({ text: tail, start: rawStart, end: rawStart + tail.length });
  }
  return candidates;
}

function tokenize(text) {
  const matches = String(text ?? "").toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return matches.filter(token => !STOPWORDS.has(token));
}

function buildDocumentFrequency(candidates) {
  const df = new Map();
  for (const candidate of candidates) {
    const unique = new Set(candidate.tokens);
    for (const token of unique) {
      df.set(token, (df.get(token) ?? 0) + 1);
    }
  }
  return df;
}

function scoreCandidate(candidate, { index, totalCount, df }) {
  const tokenCount = candidate.tokens.length;
  if (tokenCount === 0) return 0;

  let score = 0;
  for (const token of candidate.tokens) {
    const freq = df.get(token) ?? 1;
    score += 1 / freq;
    score += CUE_BOOSTS.get(token) ?? 0;
  }

  if (/\d/.test(candidate.text)) score += 1.2;
  if (index === 0) score += 0.8;
  if (index === totalCount - 1) score += 0.2;
  if (/^#{1,6}\s/.test(candidate.text) || /^[A-Z][A-Z0-9\s\-:]{6,}$/.test(candidate.text)) score += 0.9;

  return score / Math.sqrt(tokenCount);
}

function buildNgrams(tokens, n = 3) {
  if (tokens.length === 0) return new Set();
  if (tokens.length < n) return new Set(tokens);
  const grams = new Set();
  for (let i = 0; i <= tokens.length - n; i += 1) {
    grams.add(tokens.slice(i, i + n).join(" "));
  }
  return grams;
}

function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function selectByBudget(candidates, budgetBytes) {
  const ranked = [...candidates].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.start - b.start;
  });
  const selected = [];
  let used = 0;
  for (const candidate of ranked) {
    const similarity = selected.reduce((max, item) => {
      const sim = jaccard(candidate.ngrams, item.ngrams);
      return sim > max ? sim : max;
    }, 0);
    if (similarity >= REDUNDANCY_THRESHOLD) continue;
    const bytes = Buffer.byteLength(candidate.text, "utf8");
    const sepBytes = selected.length === 0 ? 0 : 1;
    if (used + sepBytes + bytes > budgetBytes) continue;
    selected.push(candidate);
    used += sepBytes + bytes;
  }
  selected.sort((a, b) => a.start - b.start);
  return selected.map(candidate => candidate.text).join("\n");
}

function abridgeText(source, budgetBytes) {
  const candidates = splitSentencesWithOffsets(source).map((candidate, index, all) => {
    const tokens = tokenize(candidate.text);
    return { ...candidate, index, totalCount: all.length, tokens };
  });
  const df = buildDocumentFrequency(candidates);
  const scored = candidates.map(candidate => ({
    ...candidate,
    score: scoreCandidate(candidate, { index: candidate.index, totalCount: candidate.totalCount, df }),
    ngrams: buildNgrams(candidate.tokens)
  }));
  return selectByBudget(scored, budgetBytes);
}

export async function abridge(sentence, { remember: rememberFn = remember } = {}) {
  const sourceText = resolveSourceText(sentence, { rememberFn });
  if (typeof sourceText !== "string") {
    throwErrorSentence({
      name: "abridge defective",
      message: "abridge defective: missing source text",
      from: { name: "abridge" },
      raw: sentence
    });
  }

  const budgetBytes = resolveBudgetBytes(sentence);
  const outputText = abridgeText(sourceText, budgetBytes);
  const result = { mood: "ya", be: "text", ob: { text: outputText } };
  if (typeof sentence?.to?.name === "string") {
    doRemember({ ...result, su: { name: sentence.to.name } });
  }
  return result;
}

export default abridge;

export const signatures = [
  { signatureWords: ["be", "abridge", "ob", "text", "to", "name", "text"], handler: abridge },
  { signatureWords: ["be", "abridge", "ob", "name", "text", "to", "name", "text"], handler: abridge },
  { signatureWords: ["be", "abridge", "ob", "text"], handler: abridge },
  { signatureWords: ["be", "abridge", "ob", "name", "text"], handler: abridge },
  { signatureWords: ["be", "abridge", "from", "name", "text", "to", "name", "text"], handler: abridge },
  { signatureWords: ["be", "abridge", "from", "text", "to", "name", "text"], handler: abridge },
  { signatureWords: ["be", "abridge", "from", "name", "text"], handler: abridge },
  { signatureWords: ["be", "abridge", "from", "text"], handler: abridge },
  { signatureWords: ["be", "abridge", "ob", "text", "atmost", "byte", "to", "name", "text"], handler: abridge },
  { signatureWords: ["be", "abridge", "ob", "name", "text", "atmost", "byte", "to", "name", "text"], handler: abridge },
  { signatureWords: ["be", "abridge", "ob", "text", "atmost", "byte"], handler: abridge },
  { signatureWords: ["be", "abridge", "ob", "name", "text", "atmost", "byte"], handler: abridge },
  { signatureWords: ["be", "abridge", "from", "name", "text", "atmost", "byte", "to", "name", "text"], handler: abridge },
  { signatureWords: ["be", "abridge", "from", "text", "atmost", "byte", "to", "name", "text"], handler: abridge },
  { signatureWords: ["be", "abridge", "from", "name", "text", "atmost", "byte"], handler: abridge },
  { signatureWords: ["be", "abridge", "from", "text", "atmost", "byte"], handler: abridge },
  { signatureWords: ["be", "abridge", "atmost", "byte", "ob", "text", "to", "name", "text"], handler: abridge },
  { signatureWords: ["be", "abridge", "atmost", "byte", "ob", "name", "text", "to", "name", "text"], handler: abridge },
  { signatureWords: ["be", "abridge", "atmost", "byte", "ob", "text"], handler: abridge },
  { signatureWords: ["be", "abridge", "atmost", "byte", "ob", "name", "text"], handler: abridge },
  { signatureWords: ["be", "abridge", "atmost", "byte", "from", "name", "text", "to", "name", "text"], handler: abridge },
  { signatureWords: ["be", "abridge", "atmost", "byte", "from", "text", "to", "name", "text"], handler: abridge },
  { signatureWords: ["be", "abridge", "atmost", "byte", "from", "name", "text"], handler: abridge },
  { signatureWords: ["be", "abridge", "atmost", "byte", "from", "text"], handler: abridge },
  { signatureWords: ["be", "abridge", "ob", "text", "atmost", "num", "to", "name", "text"], handler: abridge },
  { signatureWords: ["be", "abridge", "ob", "name", "text", "atmost", "num", "to", "name", "text"], handler: abridge },
  { signatureWords: ["be", "abridge", "ob", "text", "atmost", "num"], handler: abridge },
  { signatureWords: ["be", "abridge", "ob", "name", "text", "atmost", "num"], handler: abridge },
  { signatureWords: ["be", "abridge", "from", "name", "text", "atmost", "num", "to", "name", "text"], handler: abridge },
  { signatureWords: ["be", "abridge", "from", "text", "atmost", "num", "to", "name", "text"], handler: abridge },
  { signatureWords: ["be", "abridge", "from", "name", "text", "atmost", "num"], handler: abridge },
  { signatureWords: ["be", "abridge", "from", "text", "atmost", "num"], handler: abridge },
  { signatureWords: ["be", "abridge", "atmost", "num", "ob", "text", "to", "name", "text"], handler: abridge },
  { signatureWords: ["be", "abridge", "atmost", "num", "ob", "name", "text", "to", "name", "text"], handler: abridge },
  { signatureWords: ["be", "abridge", "atmost", "num", "ob", "text"], handler: abridge },
  { signatureWords: ["be", "abridge", "atmost", "num", "ob", "name", "text"], handler: abridge },
  { signatureWords: ["be", "abridge", "atmost", "num", "from", "name", "text", "to", "name", "text"], handler: abridge },
  { signatureWords: ["be", "abridge", "atmost", "num", "from", "text", "to", "name", "text"], handler: abridge },
  { signatureWords: ["be", "abridge", "atmost", "num", "from", "name", "text"], handler: abridge },
  { signatureWords: ["be", "abridge", "atmost", "num", "from", "text"], handler: abridge }
];

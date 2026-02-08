import { remember, doRemember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";

const DEFAULT_BUDGET_BYTES = 4000;
const REDUNDANCY_THRESHOLD = 0.85;
const SHORT_SENTENCE_TOKEN_CUTOFF = 6;
const KEEP_PREFIX_RE = /\b(action|decision|todo|next|follow-up)\s*:/i;
const SCHEDULE_LINE_RE = /^\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*,?\s*\d{1,2}:\d{2}\s*(to|-)\s*\d{1,2}:\d{2}/i;
const COST_HEADER_RE = /^estimated costs per person:/i;
const NUMERIC_TOKEN_RE = /\b\d[\d,.:/-]*\b/g;

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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

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

function trimRange(source, from, to) {
  let start = from;
  let end = to;
  while (start < end && /\s/.test(source[start])) start += 1;
  while (end > start && /\s/.test(source[end - 1])) end -= 1;
  return { start, end };
}

function isStructuredLine(text) {
  const line = String(text ?? "");
  return /^#{1,6}\s/.test(line)
    || /^[-*+]\s/.test(line)
    || /^\d+[.)]\s/.test(line)
    || /^```/.test(line)
    || line.includes("`")
    || /^\|.*\|$/.test(line);
}

function splitProseLine(line, absoluteStart) {
  const spans = [];
  const abbreviations = new Set(["e.g.", "i.e.", "mr.", "mrs.", "dr.", "vs.", "etc.", "md."]);
  let partStart = 0;
  const length = line.length;

  function pushPart(from, to) {
    const chunk = line.slice(from, to).trim();
    if (!chunk) return;
    const relative = line.indexOf(chunk, from);
    spans.push({
      text: chunk,
      start: absoluteStart + relative,
      end: absoluteStart + relative + chunk.length
    });
  }

  for (let i = 0; i < length; i += 1) {
    const ch = line[i];
    const punct = ch === "." || ch === "!" || ch === "?";
    if (!punct) continue;

    const prefix = line.slice(Math.max(partStart, i - 8), i + 1).toLowerCase();
    const abbrevMatch = /([a-z]+\.)$/i.exec(prefix);
    if (ch === "." && abbrevMatch && abbreviations.has(abbrevMatch[1])) continue;

    let j = i + 1;
    while (j < length && /\s/.test(line[j])) j += 1;
    const next = line[j];
    const boundary = j >= length || next === "#" || next === "-" || next === "*" || /[A-Z0-9]/.test(next);
    if (!boundary) continue;

    pushPart(partStart, i + 1);
    partStart = i + 1;
  }

  pushPart(partStart, length);
  return spans;
}

function splitSentencesWithOffsets(text) {
  const source = String(text ?? "");
  const candidates = [];

  let lineStart = 0;
  for (let i = 0; i <= source.length; i += 1) {
    if (i < source.length && source[i] !== "\n") continue;
    const lineEnd = i;
    const range = trimRange(source, lineStart, lineEnd);
    if (range.end > range.start) {
      const line = source.slice(range.start, range.end);
      if (isStructuredLine(line)) {
        candidates.push({ text: line, start: range.start, end: range.end, isStructured: true });
      } else {
        const parts = splitProseLine(line, range.start);
        if (parts.length > 0) {
          for (const part of parts) {
            candidates.push({ ...part, isStructured: false });
          }
        } else {
          candidates.push({ text: line, start: range.start, end: range.end, isStructured: false });
        }
      }
    }
    lineStart = i + 1;
  }
  return candidates;
}

function isHeadingSentence(text) {
  return /^#{1,6}\s/.test(text)
    || /^[A-Z][A-Z0-9\s\-:]{6,}$/.test(text)
    || /^\d+(\.\d+)*\.\s/.test(text);
}

function assignSections(candidates) {
  let sectionId = 0;
  let sectionStartIndex = 0;
  for (let i = 0; i < candidates.length; i += 1) {
    if (i > 0 && isHeadingSentence(candidates[i].text)) {
      sectionId += 1;
      sectionStartIndex = i;
    }
    candidates[i].sectionId = sectionId;
    candidates[i].isSectionFirst = i === sectionStartIndex;
  }
  return candidates;
}

function tokenize(text) {
  const matches = String(text ?? "").toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return matches.filter(token => !STOPWORDS.has(token));
}

function buildTfIdf(candidates) {
  const docs = candidates.map(candidate => {
    const counts = new Map();
    for (const token of candidate.tokens) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
    return counts;
  });

  const df = new Map();
  for (const counts of docs) {
    for (const token of counts.keys()) {
      df.set(token, (df.get(token) ?? 0) + 1);
    }
  }

  return { docs, df, totalDocs: Math.max(1, candidates.length) };
}

function scoreCandidate(candidate, { index, totalCount, tfidf }) {
  const tokenCount = candidate.tokens.length;
  if (tokenCount === 0) return 0;

  const counts = tfidf.docs[index];
  let score = 0.0;
  for (const [token, count] of counts.entries()) {
    const termFrequency = count / tokenCount;
    const docFrequency = tfidf.df.get(token) ?? 0;
    const idf = Math.log((1 + tfidf.totalDocs) / (1 + docFrequency)) + 1;
    score += termFrequency * idf;
    score += (CUE_BOOSTS.get(token) ?? 0) * 0.1;
  }

  if (/\d/.test(candidate.text)) score += 0.25;
  if (index === 0) score += 0.1;
  if (index === totalCount - 1) score += 0.05;
  if (candidate.isSectionFirst) score += 0.2;

  return score / Math.sqrt(tokenCount);
}

function buildNgrams(tokens, n) {
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

function sameNumericSignal(a, b) {
  const aNums = a.numericTokens;
  const bNums = b.numericTokens;
  if (aNums.size === 0 || bNums.size === 0) return true;
  if (aNums.size !== bNums.size) return false;
  for (const value of aNums) {
    if (!bNums.has(value)) return false;
  }
  return true;
}

function buildCoverageFlags(scored) {
  return scored.map(candidate => ({
    ...candidate,
    isCoverageKeep: candidate.isSectionFirst
      || KEEP_PREFIX_RE.test(candidate.text)
      || SCHEDULE_LINE_RE.test(candidate.text)
      || COST_HEADER_RE.test(candidate.text)
  }));
}

function normalizeKey(text) {
  return String(text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function resolveShortlist(scored) {
  const sentenceCount = scored.length;
  const kTotal = clamp(Math.round(sentenceCount * 0.5), 12, 40);
  const bySection = new Map();
  for (const candidate of scored) {
    if (!bySection.has(candidate.sectionId)) bySection.set(candidate.sectionId, []);
    bySection.get(candidate.sectionId).push(candidate);
  }

  const shortlisted = new Map();
  for (const list of bySection.values()) {
    const proportional = Math.round((list.length / Math.max(1, sentenceCount)) * kTotal);
    const kSection = clamp(proportional, 2, 8);
    list.sort((a, b) => (b.score - a.score) || (a.start - b.start));
    for (const candidate of list.slice(0, kSection)) shortlisted.set(candidate.id, candidate);
  }

  for (const candidate of scored) {
    if (candidate.isCoverageKeep) shortlisted.set(candidate.id, candidate);
  }

  return [...shortlisted.values()];
}

function dedupeCandidates(shortlisted) {
  const forcedAll = shortlisted
    .filter(candidate => candidate.isCoverageKeep)
    .sort((a, b) => a.start - b.start);
  const forced = [];
  const forcedKeys = new Set();
  for (const candidate of forcedAll) {
    const key = normalizeKey(candidate.text);
    if (forcedKeys.has(key)) continue;
    forcedKeys.add(key);
    forced.push(candidate);
  }
  const keptById = new Set(forced.map(candidate => candidate.id));
  const kept = [...forced];

  const ranked = shortlisted
    .filter(candidate => !keptById.has(candidate.id))
    .sort((a, b) => (b.score - a.score) || (a.start - b.start));

  for (const candidate of ranked) {
    const similarity = kept.reduce((max, item) => {
      if (!sameNumericSignal(candidate, item)) return max;
      const sim = jaccard(candidate.ngrams, item.ngrams);
      return sim > max ? sim : max;
    }, 0);
    if (similarity >= REDUNDANCY_THRESHOLD) continue;
    kept.push(candidate);
  }

  return kept;
}

function selectByBudget(candidates, budgetBytes) {
  const inOrder = [...candidates].sort((a, b) => a.start - b.start);
  const selected = [];
  let used = 0;
  for (const candidate of inOrder) {
    const bytes = Buffer.byteLength(candidate.text, "utf8");
    const separatorBytes = selected.length === 0 ? 0 : 1;
    if (used + separatorBytes + bytes > budgetBytes) continue;
    selected.push(candidate);
    used += separatorBytes + bytes;
  }
  return selected.map(candidate => candidate.text).join("\n");
}

function abridgeText(source, budgetBytes) {
  const rawCandidates = assignSections(splitSentencesWithOffsets(source));
  const candidates = rawCandidates.map((candidate, index, all) => {
    const tokens = tokenize(candidate.text);
    const n = tokens.length < SHORT_SENTENCE_TOKEN_CUTOFF ? 2 : 3;
    return {
      ...candidate,
      id: `${candidate.start}:${candidate.end}`,
      index,
      totalCount: all.length,
      tokens,
      ngrams: buildNgrams(tokens, n),
      numericTokens: new Set((candidate.text.match(NUMERIC_TOKEN_RE) ?? []).map(value => value.toLowerCase()))
    };
  });

  const tfidf = buildTfIdf(candidates);
  const scored = candidates.map(candidate => ({
    ...candidate,
    score: scoreCandidate(candidate, { index: candidate.index, totalCount: candidate.totalCount, tfidf })
  }));
  const covered = buildCoverageFlags(scored);
  const shortlisted = resolveShortlist(covered);
  const deduped = dedupeCandidates(shortlisted);
  return selectByBudget(deduped, budgetBytes);
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

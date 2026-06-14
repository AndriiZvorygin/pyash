import fs from "node:fs";

import {
  readPyaMapArtifact,
  writePyaMapArtifact,
  validateAgendaSummaryStrict,
} from "./agenda-stage-contracts.mjs";

const STAGE2_GROUNDING_ROOT = "agenda section grounding artifact";
const STAGE3_SUMMARY_ROOT = "agenda summary artifact";

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/gu, " ").trim();
}

function stripLeadingAgendaNumber(text = "") {
  return normalizeText(String(text || "").replace(/^\d+(?:\.[a-z0-9]+)*\s*/iu, ""));
}

function countWords(text = "") {
  if (!String(text || "").trim()) return 0;
  return String(text || "")
    .trim()
    .split(/\s+/u)
    .filter(Boolean).length;
}

function splitSentences(text = "") {
  const clean = normalizeText(text);
  if (!clean) return [];
  const parts = clean
    .split(/(?<=[.!?])\s+/u)
    .map((x) => normalizeText(x))
    .filter(Boolean);
  if (parts.length) return parts;
  return [clean];
}

function seemsCompleteSentence(sentence = "") {
  const s = normalizeText(sentence);
  if (!s) return false;
  return /[.!?]["')\]]*$/u.test(s);
}

function isOutcomeSentence(sentence = "") {
  const s = String(sentence || "").toLowerCase();
  return /(approved|defeated|carried|voted|directed|passed|denied|adopted|rejected|motion|resolution)/u.test(s);
}

function chooseSentenceToDrop(sentences = []) {
  if (!sentences.length) return -1;
  if (sentences.length === 1) return 0;
  const outcomeIndexes = new Set();
  for (let i = 0; i < sentences.length; i += 1) {
    if (isOutcomeSentence(sentences[i])) outcomeIndexes.add(i);
  }
  // Prefer dropping the latest non-outcome sentence.
  for (let i = sentences.length - 1; i >= 0; i -= 1) {
    if (!outcomeIndexes.has(i)) return i;
  }
  // Fallback to dropping the last sentence.
  return sentences.length - 1;
}

function cleanupIncompleteTail(sentences = [], { allowOriginalEllipsis = false } = {}) {
  const out = sentences.slice();
  while (out.length) {
    const last = normalizeText(out[out.length - 1] || "");
    if (!last) {
      out.pop();
      continue;
    }
    if (last.endsWith("...") && !allowOriginalEllipsis) {
      out.pop();
      continue;
    }
    if (!seemsCompleteSentence(last)) {
      out.pop();
      continue;
    }
    break;
  }
  return out;
}

function summaryHasMinimalCompleteness(summary = "") {
  const s = normalizeText(summary);
  if (!s) return false;
  const words = s.split(/\s+/u).filter(Boolean);
  if (words.length < 5) return false;
  // Requires at least one action/description cue.
  if (!/(is|was|were|has|had|have|approved|defeated|carried|voted|directed|passed|considered|reported|discussed|adopted|denied|rejected)/iu.test(s)) {
    return false;
  }
  return true;
}

function hasEmbeddedArtifactJson(text = "") {
  const s = String(text || "");
  return /\[\s*\{\s*"index"\s*:\s*\d+\s*,\s*"unit id"/u.test(s)
    || /"schema version"\s*:\s*"agenda_summary_v1"/u.test(s)
    || /"grounding status"\s*:\s*"grounded"/u.test(s);
}

function assertCleanStage3Text(text = "", where = "stage3 text") {
  const s = normalizeText(text);
  if (!s) return;
  if (hasEmbeddedArtifactJson(s)) {
    throw new Error(`${where} defective: embedded artifact json`);
  }
}

function toStandaloneOutcomeSentence(text = "") {
  let s = normalizeText(text).replace(/SPEAKER_[0-9A-Z]+:\s*/gu, "");
  if (!s) return "";
  const first = splitSentences(s)[0] || "";
  s = normalizeText(first).replace(/[.,;:]+$/u, "");
  let words = s.split(/\s+/u).filter(Boolean);
  if (words.length > 18) words = trimStopwordTail(words.slice(0, 18));
  while (words.length >= 6 && isLikelyFragmentEnding(words)) words = trimStopwordTail(words.slice(0, words.length - 1));
  if (words.length < 6) return "";
  const out = normalizeText(words.join(" "));
  return /[.!?]$/u.test(out) ? out : (out + ".");
}

function buildLongTierSupportSentence({ unit, summary = "", rawSummary = "", chapterText = "" }) {
  const merged = [
    ...splitSentences(String(rawSummary || "")),
    ...splitSentences(String(unit["source excerpt"] || "").replace(/SPEAKER_[0-9A-Z]+:\s*/gu, "")),
  ];
  const outcome = merged.find((x) => isOutcomeSentence(x));
  const support = toStandaloneOutcomeSentence(outcome || "");
  if (support && !wordsKey(summary).includes(wordsKey(support))) return support;
  const hook = normalizeSplitChapterCandidate(chapterText || chapterFromSummary(rawSummary), unit.label || unit["agenda item"] || "");
  if (hook) {
    const sentence = "The section also covers " + hook.toLowerCase() + ".";
    if (!wordsKey(summary).includes(wordsKey(sentence))) return sentence;
  }
  const item = stripLeadingAgendaNumber(unit.label || unit["agenda item"] || "");
  if (item) return "The section also details key arguments and outcome context for " + item + ".";
  return "The section also details key arguments and outcome context from the hearing record.";
}

function looksProceduralLabel(label = "") {
  const lower = String(label || "").toLowerCase();
  return (
    lower.includes("call to order") ||
    lower.includes("adoption of agenda") ||
    lower.includes("declaration of interest") ||
    lower.includes("confirmation of minutes") ||
    lower.includes("minutes") ||
    lower.includes("correspondence") ||
    lower.includes("adjourn") ||
    lower.includes("opening remarks")
  );
}

function buildSummaryBudget(unit = {}) {
  const durationSeconds = Number(unit["duration seconds"] || 0);
  const sourceRows = Number(unit["source rows"] || 0);
  const excerpt = String(unit["source excerpt"] || "");
  const sourceChars = excerpt.length;
  const splitParts = Number(unit["part total"] || 1);
  const procedural = looksProceduralLabel(unit.label || unit["agenda item"] || "");

  const tiny = durationSeconds <= 75 || sourceRows <= 6 || sourceChars <= 350;
  const short = durationSeconds <= 180 && sourceRows <= 18 && sourceChars <= 1200;
  const medium = durationSeconds <= 780 && sourceRows <= 120;
  const long = durationSeconds <= 1800 && sourceRows <= 260;

  if (procedural && tiny) {
    return {
      tier: "tiny_procedural",
      maxSentences: 1,
      maxWords: 22,
      minSentences: 1,
      paragraphCap: 1,
      procedural,
      durationSeconds,
      sourceRows,
      sourceChars,
      splitParts,
    };
  }
  if (short || (procedural && durationSeconds <= 300 && sourceRows <= 30)) {
    return {
      tier: "short",
      maxSentences: procedural ? 1 : 2,
      maxWords: procedural ? 32 : 48,
      minSentences: 1,
      paragraphCap: 1,
      procedural,
      durationSeconds,
      sourceRows,
      sourceChars,
      splitParts,
    };
  }
  if (medium) {
    return {
      tier: "medium",
      maxSentences: 4,
      maxWords: 130,
      minSentences: 2,
      paragraphCap: 1,
      procedural,
      durationSeconds,
      sourceRows,
      sourceChars,
      splitParts,
    };
  }
  if (long) {
    return {
      tier: "long",
      maxSentences: 6,
      maxWords: 220,
      minSentences: 2,
      paragraphCap: 1,
      procedural,
      durationSeconds,
      sourceRows,
      sourceChars,
      splitParts,
    };
  }
  return {
    tier: "very_long",
    maxSentences: 8,
    maxWords: 320,
    minSentences: 2,
    paragraphCap: splitParts > 1 ? 1 : 2,
    procedural,
    durationSeconds,
    sourceRows,
    sourceChars,
    splitParts,
  };
}

function enforceSummaryBudget(rawSummary = "", budget = {}) {
  const before = normalizeText(rawSummary);
  if (!before) return "";
  const allowOriginalEllipsis = before.endsWith("...");
  const maxSentences = Number.isFinite(Number(budget.maxSentences)) ? Number(budget.maxSentences) : 0;
  const maxWords = Number.isFinite(Number(budget.maxWords)) ? Number(budget.maxWords) : 0;
  const minSentences = Math.max(1, Number.isFinite(Number(budget.minSentences)) ? Number(budget.minSentences) : 1);

  let sentences = splitSentences(before);
  sentences = cleanupIncompleteTail(sentences, { allowOriginalEllipsis });
  if (!sentences.length) return "";
  const fullSentences = sentences.slice();

  // 1) Sentence-first clamp
  if (budget.procedural) {
    sentences = sentences.slice(0, 1);
  } else if (maxSentences > 0 && sentences.length > maxSentences) {
    sentences = sentences.slice(0, maxSentences);
  }

  // 2) If still over word budget, drop whole sentences (never mid-sentence).
  if (maxWords > 0) {
    while (sentences.length > minSentences && countWords(sentences.join(" ")) > maxWords) {
      const idx = chooseSentenceToDrop(sentences);
      if (idx < 0) break;
      sentences.splice(idx, 1);
    }
    // If one sentence is still over budget, keep it as-is to avoid fragmenting.
  }

  if (!budget.procedural && sentences.length < minSentences && fullSentences.length >= minSentences) {
    sentences = fullSentences.slice(0, minSentences);
    const hasOutcome = sentences.some((x) => isOutcomeSentence(x));
    if (!hasOutcome) {
      const outcome = fullSentences.find((x) => isOutcomeSentence(x));
      if (outcome && minSentences >= 2) sentences[minSentences - 1] = outcome;
    }
  }

  // 3) Completeness guard pass ("regenerate once" analog in post-gen enforcement):
  // do one stricter cleanup attempt, then drop incomplete tail.
  let summary = normalizeText(sentences.join(" "));
  if (!summaryHasMinimalCompleteness(summary)) {
    let strictSentences = splitSentences(summary);
    strictSentences = cleanupIncompleteTail(strictSentences, { allowOriginalEllipsis: false });
    if (strictSentences.length > Math.max(1, minSentences) && !summaryHasMinimalCompleteness(strictSentences.join(" "))) {
      strictSentences = strictSentences.slice(0, strictSentences.length - 1);
    }
    if (!budget.procedural && strictSentences.length < minSentences && fullSentences.length >= minSentences) {
      strictSentences = fullSentences.slice(0, minSentences);
    }
    summary = normalizeText(strictSentences.join(" "));
  }

  if ((budget.paragraphCap || 1) <= 1) {
    summary = normalizeText(summary.replace(/\n+/gu, " "));
  } else {
    summary = summary.replace(/\n{3,}/gu, "\n\n").trim();
  }

  // Never emit ellipsis artifacts unless present in original source summary.
  if (!allowOriginalEllipsis && summary.endsWith("...")) {
    const retry = cleanupIncompleteTail(splitSentences(summary), { allowOriginalEllipsis: false });
    summary = normalizeText(retry.join(" "));
  }
  return summary;
}

function wordsKey(text = "") {
  return normalizeText(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function isHeadingLikeChapterText(chapterText = "", heading = "") {
  const c = wordsKey(stripLeadingAgendaNumber(chapterText));
  const h = wordsKey(stripLeadingAgendaNumber(heading));
  if (!c || !h) return false;
  if (c === h) return true;
  if (c.length < 24 && (h.includes(c) || c.includes(h))) return true;
  if (h === "next meeting" && c === "next meeting") return true;
  return false;
}

function chapterFromSummary(summary = "") {
  const sentences = splitSentences(summary).filter(Boolean);
  const complete = sentences.find((s) => seemsCompleteSentence(s));
  if (complete) {
    const full = normalizeText(complete.replace(/[.,;:]+$/u, ""));
    const fullWords = full.split(/\s+/u).filter(Boolean).length;
    if (fullWords <= 24) return full;
  }
  const base = normalizeText(complete || sentences[0] || summary || "");
  if (!base) return "";
  let out = base.replace(/[.,;:]+$/u, "").trim();
  let words = out.split(/\s+/u).filter(Boolean);
  if (words.length > 18) words = words.slice(0, 18);
  while (words.length > 3) {
    const tail = String(words[words.length - 1] || "").toLowerCase();
    if (!new Set(["a", "an", "the", "to", "of", "for", "and", "or", "with", "by", "on", "in", "at", "from"]).has(tail)) break;
    words = words.slice(0, words.length - 1);
  }
  out = words.join(" ");
  return normalizeText(out);
}

function fallbackUnitSummaryFromGrounding(unit = {}) {
  const excerpt = normalizeText(String(unit?.["source excerpt"] || ""));
  if (!excerpt) return "";
  const sentence = excerpt.split(/(?<=[.!?])\s+/u).map((x) => normalizeText(x)).find(Boolean) || "";
  if (!sentence) return "";
  const budget = buildSummaryBudget(unit);
  return enforceSummaryBudget(sentence, budget);
}

function fallbackUnitSummaryFromLabel(unit = {}) {
  const label = normalizeText(String(unit?.label || ""));
  const agendaItem = normalizeText(String(unit?.["agenda item"] || ""));
  const base = label || agendaItem || "Agenda section";
  return `${base} was listed on the agenda.`;
}

const SPLIT_GENERIC_PREFIXES = [
  "adjournment",
  "next meeting",
  "appeals",
  "appeal",
  "call to order",
  "declarations of interest",
  "announcement by the chair",
];

function trimStopwordTail(words = []) {
  const stop = new Set(["a", "an", "the", "to", "of", "for", "and", "or", "with", "by", "on", "in", "at", "from", "against", "about", "over", "under", "into", "onto", "across", "between", "among", "around", "during", "without", "within", "despite", "concerning", "regarding", "per"]);
  let out = words.slice();
  while (out.length > 3 && stop.has(String(out[out.length - 1] || "").toLowerCase())) out = out.slice(0, out.length - 1);
  return out;
}

function isLikelyFragmentEnding(words = []) {
  if (!Array.isArray(words) || !words.length) return false;
  const last = String(words[words.length - 1] || "").toLowerCase();
  const prev = String(words[words.length - 2] || "").toLowerCase();
  const fragmentLast = new Set(["other", "live", "following", "regarding", "including", "against", "lack", "prompting", "citing", "requiring", "mandating", "using", "based", "through", "disproportionate", "due", "relied", "submitted", "physical", "which", "unverified", "request", "procedural", "definition", "bug", "bed", "and", "or", "with", "despite"]);
  const danglingPrev = new Set(["of", "for", "from", "with", "to", "by", "in", "on", "at", "under", "over", "despite", "including", "regarding", "due"]);
  if (fragmentLast.has(last)) return true;
  if (danglingPrev.has(last)) return true;
  if (danglingPrev.has(prev) && words.length >= 6) return true;
  return false;
}

function toTitleCaseWords(words = []) {
  return words.map((w, idx) => {
    const t = String(w || "").trim();
    if (!t) return "";
    if (/^[A-Z0-9-]{2,}$/u.test(t)) return t;
    const lower = t.toLowerCase();
    if (idx > 0 && /^(and|or|of|for|to|in|on|at|by|with|from|the|a|an)$/u.test(lower)) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).filter(Boolean);
}

function stripSplitHeadingPrefix(text = "", heading = "") {
  let out = normalizeText(text);
  const headingCore = stripLeadingAgendaNumber(heading).toLowerCase();
  if (headingCore) {
    const escaped = headingCore.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    out = out.replace(new RegExp(`^${escaped}\\s*[:\\-–—]\\s*`, "iu"), "");
    out = out.replace(new RegExp(`^${escaped}\\s+`, "iu"), "");
  }
  for (const pref of SPLIT_GENERIC_PREFIXES) {
    const escaped = pref.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    out = out.replace(new RegExp(`^${escaped}\\s*[:\\-–—]\\s*`, "iu"), "");
    if (wordsKey(out) === wordsKey(pref)) out = "";
  }
  return normalizeText(out);
}

function normalizeSplitChapterCandidate(text = "", heading = "") {
  const stripped = stripSplitHeadingPrefix(text, heading);
  if (!stripped) return "";
  let words = stripped.replace(/[.,;:!?]+$/u, "").split(/\s+/u).filter(Boolean);
  words = trimStopwordTail(words);
  while (words.length > 8 && /^(the|a|an)$/iu.test(String(words[0] || ""))) words = words.slice(1);
  if (words.length > 12) words = trimStopwordTail(words.slice(0, 12));
  while (words.length >= 6 && isLikelyFragmentEnding(words)) words = trimStopwordTail(words.slice(0, words.length - 1));
  if (words.length < 6) return "";
  words = toTitleCaseWords(words);
  return normalizeText(words.join(" "));
}

function buildSplitChapterCandidates({ llmText = "", summary = "", heading = "" }) {
  const candidates = [];
  const pushCandidate = (txt) => {
    const c = normalizeSplitChapterCandidate(txt, heading);
    if (c) candidates.push(c);
  };
  pushCandidate(llmText);
  const summarySentences = splitSentences(summary).filter(Boolean);
  for (const s of summarySentences) pushCandidate(s);
  pushCandidate(chapterFromSummary(summary));
  return candidates;
}

function leadingPhraseKey(text = "", size = 3) {
  const words = normalizeText(text).toLowerCase().split(/\s+/u).filter(Boolean);
  return words.slice(0, Math.min(size, words.length)).join(" ");
}

function pickSplitChapterText({ llmText = "", summary = "", heading = "", seenLeadPhrases = new Set() }) {
  const candidates = buildSplitChapterCandidates({ llmText, summary, heading });
  const hasForbidden = (cand) => SPLIT_GENERIC_PREFIXES.some((p) => wordsKey(cand).startsWith(wordsKey(p)));
  for (const c of candidates) {
    if (hasForbidden(c)) continue;
    const words = c.split(/\s+/u).filter(Boolean);
    if (words.length < 6 || words.length > 12) continue;
    if (isLikelyFragmentEnding(words)) continue;
    const lead = leadingPhraseKey(c);
    if (lead && seenLeadPhrases.has(lead)) continue;
    return c.replace(/[.,;:!?]+$/u, "");
  }
  return "";
}

function nextDistinctChapterFromSummary(summary = "", previousChapter = "") {
  const prevKey = wordsKey(previousChapter);
  const sentences = splitSentences(summary).filter(Boolean);
  for (const s of sentences) {
    const candidate = chapterFromSummary(s);
    if (!candidate) continue;
    if (wordsKey(candidate) !== prevKey) return candidate;
  }
  return chapterFromSummary(summary);
}

function finalizeChapterText({ chapterText, heading, summary, splitPart = false, previousChapter = "" }) {
  if (splitPart) {
    return "";
  }
  const fromLlm = normalizeText(chapterText);
  const fromSummary = chapterFromSummary(summary);
  let out = fromLlm || fromSummary || stripLeadingAgendaNumber(heading);
  if (splitPart && isHeadingLikeChapterText(out, heading)) {
    out = fromSummary || out;
  }
  if (splitPart && previousChapter && wordsKey(out) === wordsKey(previousChapter)) {
    out = nextDistinctChapterFromSummary(summary, previousChapter) || out;
  }
  out = normalizeText(out).replace(/[.,;:]+$/u, "");
  return out;
}

function assertExactGroundingRoot(filePath) {
  const lines = String(fs.readFileSync(filePath, "utf8")).split(/\r?\n/u);
  const first = String(lines[0] || "").trim();
  const expected = "su name agenda section grounding artifact be map def";
  if (first !== expected) {
    throw new Error(`stage3 defective: grounding root mismatch at ${filePath}`);
  }
}

function assertExactGroundingSchema(grounding = {}) {
  const allowed = new Set(["schema version", "generated time", "transcript rows total", "grounded units"]);
  const keys = Object.keys(grounding || {});
  for (const k of keys) {
    if (!allowed.has(k)) throw new Error(`stage3 defective: unexpected grounding top-level field "${k}"`);
    if (/_/u.test(String(k || ""))) throw new Error(`stage3 defective: snake_case grounding field "${k}"`);
  }
  for (const req of allowed) {
    if (!Object.hasOwn(grounding, req)) {
      throw new Error(`stage3 defective: missing grounding field "${req}"`);
    }
  }
  if (String(grounding["schema version"] || "") !== "agenda_section_grounding_v1") {
    throw new Error("stage3 defective: invalid grounding schema version");
  }
}

async function callOllamaJson({ ollamaUrl, llmModel, system, prompt }) {
  const maxAttempts = Math.max(1, Number.parseInt(String(process.env.AGENDA_STAGE3_OLLAMA_ATTEMPTS || "5"), 10) || 5);
  const timeoutMs = Math.max(5_000, Number.parseInt(String(process.env.AGENDA_STAGE3_OLLAMA_TIMEOUT_MS || "120000"), 10) || 120_000);
  const baseDelayMs = Math.max(250, Number.parseInt(String(process.env.AGENDA_STAGE3_OLLAMA_RETRY_DELAY_MS || "1500"), 10) || 1500);

  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const retryJsonLine = attempt > 1
        ? "\nRetry instruction: return one valid JSON object only. No markdown. Do not leave words unquoted. notes must be a string, not an array."
        : "";
      const body = {
        model: llmModel,
        stream: false,
        think: false,
        options: { temperature: attempt > 1 ? 0 : 0.12 },
        messages: [
          { role: "system", content: system },
          { role: "user", content: `${prompt}${retryJsonLine}` },
        ],
      };
      const res = await fetch(ollamaUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        const retryableStatus = res.status === 408 || res.status === 429 || res.status >= 500;
        if (retryableStatus && attempt < maxAttempts) {
          const waitMs = baseDelayMs * attempt;
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        throw new Error(`ollama status ${res.status}`);
      }
      const payload = await res.json();
      const content = String(payload?.message?.content || "").trim();
      try { return JSON.parse(content); } catch {}
      const m = content.match(/\{[\s\S]*\}/u);
      if (!m) throw new Error("unparseable-json");
      return JSON.parse(m[0]);
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || err).toLowerCase();
      const retryable = /fetch failed|network|socket|timeout|timed out|econnreset|enotfound|eai_again|unexpected token|json|unparseable/u.test(msg);
      if (!retryable || attempt >= maxAttempts) break;
      const waitMs = baseDelayMs * attempt;
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr || new Error("ollama fetch failed");
}

async function summarizeGroundedUnit({ unit, focus, llmModel, ollamaUrl }) {
  const budget = buildSummaryBudget(unit);
  const longOrderLine =
    budget.tier === "long" || budget.tier === "very_long"
      ? "For long sections, prefer this order when applicable: item under discussion; main substance; decision/direction/outcome."
      : "";
  const longCoverageLine =
    budget.tier === "long" || budget.tier === "very_long"
      ? "Long-tier requirement: produce at least 3 complete sentences covering item, substance, and outcome (if outcome exists in source)."
      : "";
  const prompt = [
    "You are stage3 of a strict agenda summary pipeline.",
    "Grounding is authoritative. Do not invent boundaries or facts.",
    "Return one valid JSON object only. Do not return markdown.",
    "Required keys: summary, chapter text, confidence, notes.",
    "notes must be a short string, not an array.",
    "Example: {\"summary\":\"...\",\"chapter text\":\"...\",\"confidence\":0.9,\"notes\":\"\"}",
    "summary: factual, source-aligned, and proportional to section size.",
    "chapter text: short chapter-ready line. If not split, still provide a useful line.",
    `Summary budget tier: ${budget.tier}`,
    `Budget max sentences: ${budget.maxSentences}`,
    `Budget max words: ${budget.maxWords}`,
    `Procedural section: ${budget.procedural ? "yes" : "no"}`,
    longOrderLine,
    longCoverageLine,
    "Do not mention names, figures, or decisions not present in the grounded source excerpt.",
    "",
    `Focus: ${focus || "newsworthy factual civic reporting"}`,
    `Label: ${unit.label}`,
    `Agenda item: ${unit["agenda item"] || ""}`,
    `Rows: ${unit["row start"]}..${unit["row end"]}`,
    `Duration seconds: ${Number(unit["duration seconds"] || 0).toFixed(1)}`,
    "Grounded source excerpt:",
    String(unit["source excerpt"] || "").slice(0, 12000),
  ].join("\n");

  const queryParsed = async (extraLine = "") => {
    const q = extraLine ? `${prompt}\n${extraLine}` : prompt;
    return callOllamaJson({
      ollamaUrl,
      llmModel,
      system: "Produce strict JSON only for grounded section summaries.",
      prompt: q,
    });
  };

  let parsed = null;
  try {
    parsed = await queryParsed();
  } catch (err) {
    const allowFallback = /^(1|true|yes)$/iu.test(String(process.env.AGENDA_STAGE3_ALLOW_FALLBACK || "0"));
    if (!allowFallback) {
      throw new Error(
        `stage3 llm unavailable at ${ollamaUrl} (${normalizeText(String(err?.message || err)).slice(0, 200)}); set AGENDA_STAGE3_ALLOW_FALLBACK=1 to allow grounded fallback summaries`,
      );
    }
    const fallbackSummary = fallbackUnitSummaryFromGrounding(unit);
    const fallbackChapter = normalizeText(chapterFromSummary(fallbackSummary || String(unit.label || "")));
    return {
      summary: fallbackSummary,
      chapterText: fallbackChapter,
      confidence: 0,
      notes: `llm_unavailable:${normalizeText(String(err?.message || err)).slice(0, 200)}`,
      budget,
      clampChanged: false,
      rawSummary: fallbackSummary,
    };
  }
  let rawSummary = normalizeText(parsed?.summary || "");
  assertCleanStage3Text(rawSummary, "stage3 summary");
  let summary = enforceSummaryBudget(rawSummary, budget);

  const longTier = budget.tier === "long" || budget.tier === "very_long";
  const summarySentences = splitSentences(summary);
  if (longTier && summarySentences.length < 2) {
    parsed = await queryParsed("Long-tier requirement: return 3 to 5 complete sentences covering item, substance, and outcome from this grounded span only.");
    rawSummary = normalizeText(parsed?.summary || "");
    assertCleanStage3Text(rawSummary, "stage3 summary retry");
    summary = enforceSummaryBudget(rawSummary, budget);
  }
  if (longTier) {
    const postSentences = splitSentences(summary);
    if (postSentences.length < 2) {
      const supportSentence = buildLongTierSupportSentence({
        unit,
        summary,
        rawSummary,
        chapterText: normalizeText(parsed?.["chapter text"] || ""),
      });
      summary = normalizeText(summary + " " + supportSentence);
    }
  }
  assertCleanStage3Text(summary, "stage3 final summary");
  assertCleanStage3Text(parsed?.["chapter text"] || "", "stage3 chapter text");

  return {
    summary,
    chapterText: normalizeText(parsed?.["chapter text"] || ""),
    confidence: Number.isFinite(Number(parsed?.confidence)) ? Number(parsed.confidence) : 0,
    notes: normalizeText(parsed?.notes || ""),
    budget,
    clampChanged: summary !== rawSummary,
    rawSummary,
  };
}

function toMarkdown(summaryArtifact = {}) {
  const lines = [];
  lines.push(`# Agenda Section Summaries`);
  lines.push("");
  const sections = Array.isArray(summaryArtifact?.sections) ? summaryArtifact.sections : [];
  for (const s of sections) {
    lines.push(`## ${s.heading}`);
    lines.push("");
    lines.push(s.summary || "(no summary)");
    lines.push("");
    const chapters = Array.isArray(s.chapters) ? s.chapters : [];
    if (chapters.length) {
      lines.push("Chapters");
      lines.push("");
      for (const ch of chapters) {
        const since = Number(ch.since || 0);
        const hh = String(Math.floor(since / 3600)).padStart(2, "0");
        const mm = String(Math.floor((since % 3600) / 60)).padStart(2, "0");
        const ss = String(Math.floor(since % 60)).padStart(2, "0");
        lines.push(`- [${hh}:${mm}:${ss}] ${ch.title}`);
        if (String(ch.text || "").trim()) lines.push(`  ${ch.text}`);
      }
      lines.push("");
    }
  }
  return `${lines.join("\n")}\n`;
}

export async function runAgendaStage3SummaryRenderer({
  transcriptDir,
  prefix,
  sectionGroundingPyaPath,
  outSummaryPyaPath,
  outSummaryMdPath,
  focus = "",
  llmModel = "qwen3.5:9b",
  ollamaUrl = "http://mriczo:11434/api/chat",
  log = () => {},
}) {
  const maxChapterSourceChars = Math.max(2000, Number(process.env.AGENDA_CHAPTER_MAX_SOURCE_CHARS || 12000));
  assertExactGroundingRoot(sectionGroundingPyaPath);
  const grounding = await readPyaMapArtifact(sectionGroundingPyaPath, STAGE2_GROUNDING_ROOT);
  assertExactGroundingSchema(grounding);
  const units = Array.isArray(grounding?.["grounded units"]) ? grounding["grounded units"] : [];
  if (!units.length) throw new Error("stage3 defective: no grounded units in section-grounding artifact");

  const sections = [];
  let longDiagnosticCount = 0;
  for (let i = 0; i < units.length; i += 1) {
    const unit = units[i];
    const unitId = String(unit["unit id"] || "");
    const heading = unit.label || `${unit["agenda item"] || ""}`;

    const llm = await summarizeGroundedUnit({ unit, focus, llmModel, ollamaUrl });
    let unitSummary = normalizeText(llm.summary || "");
    if (!unitSummary) {
      unitSummary = fallbackUnitSummaryFromGrounding(unit);
      if (unitSummary) {
        log(`[agenda-stage3][fallback] unit=${unitId} empty llm summary recovered from source excerpt`);
      } else {
        unitSummary = fallbackUnitSummaryFromLabel(unit);
        log(`[agenda-stage3][fallback] unit=${unitId} empty source excerpt; using label-derived summary`);
      }
    }

    const sourceChapters = Array.isArray(unit["child chapters"]) ? unit["child chapters"] : [];
    const chapters = [];
    const seenLeadPhrases = new Set();
    for (let ci = 0; ci < sourceChapters.length; ci += 1) {
      const chapterUnit = sourceChapters[ci] || {};
      const chapterSourceChars = Number(chapterUnit["source chars"] || String(chapterUnit["source excerpt"] || "").length || 0);
      if (chapterSourceChars > maxChapterSourceChars) {
        throw new Error(
          `stage3 defective: oversized child chapter source text unit=${unitId} chapter=${ci + 1} source_chars=${chapterSourceChars} max_allowed=${maxChapterSourceChars}`,
        );
      }
      const chapterLlm = await summarizeGroundedUnit({
        unit: {
          ...unit,
          ...chapterUnit,
          label: heading,
          "part total": 2,
          "part index": ci + 1,
        },
        focus,
        llmModel,
        ollamaUrl,
      });

      let title = pickSplitChapterText({
        llmText: chapterLlm.chapterText,
        summary: chapterLlm.summary,
        heading,
        seenLeadPhrases,
      });
      if (!title) title = normalizeSplitChapterCandidate(chapterFromSummary(chapterLlm.summary), heading);
      if (!title) title = normalizeSplitChapterCandidate(chapterFromSummary(String(chapterUnit["source excerpt"] || "")), heading);
      if (!title) {
        throw new Error(`stage3 defective: empty nested chapter title for unit ${unitId} chapter ${ci + 1}`);
      }
      assertCleanStage3Text(title, `stage3 chapter title unit=${unitId} chapter=${ci + 1}`);
      assertCleanStage3Text(chapterLlm.summary, `stage3 chapter summary unit=${unitId} chapter=${ci + 1}`);
      const lead = leadingPhraseKey(title);
      if (lead) seenLeadPhrases.add(lead);

      chapters.push({
        "chapter id": String(chapterUnit["chapter id"] || `${unitId}_chapter_${String(ci + 1).padStart(2, "0")}`),
        "parent unit id": unitId,
        "ordering index": Number(chapterUnit["ordering index"] || ci + 1),
        "row start": Number(chapterUnit["row start"] || 0),
        "row end": Number(chapterUnit["row end"] || 0),
        since: Number(chapterUnit.since || 0),
        until: Number(chapterUnit.until || Number(chapterUnit.since || 0)),
        title,
        text: chapterLlm.summary,
      });
    }

    sections.push({
      index: i + 1,
      "unit id": unitId,
      "parent unit id": "",
      "part index": 0,
      "part total": 1,
      heading,
      summary: unitSummary,
      "chapter text": chapters.length ? String(chapters[0].title || "") : normalizeText(llm.chapterText || chapterFromSummary(llm.summary)),
      chapters,
      score: Number(llm.confidence || 0),
      mode: "llm-stage3",
      "source rows": Number(unit["source rows"] || 0),
      "start row": Number(unit["row start"] || 0),
      "end row": Number(unit["row end"] || 0),
      "max section seconds": Number(process.env.AGENDA_SECTION_SPLIT_SECONDS || 900),
      "grounding status": unit["grounding status"] || "",
      "budget tier": llm.budget?.tier || "",
      "budget max sentences": Number(llm.budget?.maxSentences || 0),
      "budget max words": Number(llm.budget?.maxWords || 0),
      "budget paragraph cap": Number(llm.budget?.paragraphCap || 1),
      "clamp changed": llm.clampChanged ? "yes" : "no",
      "summary pre clamp": llm.clampChanged ? llm.rawSummary : "",
    });
    assertCleanStage3Text(unitSummary, `stage3 section summary unit=${unitId}`);

    if (llm.clampChanged) {
      log(
        `[agenda-stage3][clamp] unit=${unitId} tier=${llm.budget?.tier || "na"} before="${llm.rawSummary.slice(0, 160)}" after="${llm.summary.slice(0, 160)}"`,
      );
    }
    if (Number(unit["duration seconds"] || 0) > 900 && longDiagnosticCount < 5) {
      longDiagnosticCount += 1;
      log(
        `[agenda-stage3][long-diagnostic] unit=${unitId} duration=${Number(unit["duration seconds"] || 0).toFixed(1)}s rows=${Number(unit["source rows"] || 0)} tier=${llm.budget?.tier || "na"} max_sent=${Number(llm.budget?.maxSentences || 0)} max_words=${Number(llm.budget?.maxWords || 0)} raw="${llm.rawSummary.slice(0, 220)}" final="${llm.summary.slice(0, 220)}"`,
      );
    }
    log(
      `[agenda-stage3] section ${i + 1}/${units.length} heading ${heading} budget=${llm.budget?.tier || "na"} max_words=${llm.budget?.maxWords || 0} max_sent=${llm.budget?.maxSentences || 0} chapters=${chapters.length}`,
    );
  }

  const summaryArtifact = {
    "schema version": "agenda_summary_v1",
    "source section grounding": sectionGroundingPyaPath,
    "transcript dir": transcriptDir,
    prefix,
    focus,
    "generated time": new Date().toISOString(),
    sections,
  };

  validateAgendaSummaryStrict(grounding, summaryArtifact);
  writePyaMapArtifact(outSummaryPyaPath, STAGE3_SUMMARY_ROOT, summaryArtifact);
  fs.writeFileSync(outSummaryMdPath, toMarkdown(summaryArtifact), "utf8");

  log(`[agenda-stage3] sections: ${sections.length}`);
  log(`[agenda-stage3] wrote: ${outSummaryPyaPath}`);
  log(`[agenda-stage3] wrote: ${outSummaryMdPath}`);
  return summaryArtifact;
}

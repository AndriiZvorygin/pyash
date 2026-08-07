import fs from "node:fs";

import {
  readPyaMapArtifact,
  writePyaMapArtifact,
  validateAgendaSummaryStrict,
} from "./agenda-stage-contracts.mjs";
import {
  normalizeUnambiguousSpokenNumbers,
  unsupportedNumericTokens,
} from "./grounded-numeric-fidelity.mjs";
import { unsupportedNamedMotionAttributions } from "./motion-attribution-verifier.mjs";

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
  const abbreviationMarker = "\uE000";
  const protectedText = clean.replace(
    /\b(No|Mr|Mrs|Ms|Dr|St|Mt|Jr|Sr|vs|etc)\./giu,
    (_, abbreviation) => `${abbreviation}${abbreviationMarker}`,
  );
  const parts = protectedText
    .split(/(?<=[.!?])\s+/u)
    .map((x) => normalizeText(x).replaceAll(abbreviationMarker, "."))
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
    if (/^(So you|And so|But then|I mean),?\s+/iu.test(last) || /\bSpeaker\s+\d+\s+Section\s+\d+\b/iu.test(last)) {
      out.pop();
      continue;
    }
    break;
  }
  return out;
}

function isTranscriptScrapSentence(sentence = "") {
  const s = normalizeText(sentence);
  if (!s) return false;
  return /^(So you|So when|And so|But then|I mean),?\s+/iu.test(s)
    || /\bSpeaker\s+\d+\s+Section\s+\d+\b/iu.test(s);
}

function cleanupTranscriptScrapSentences(sentences = []) {
  return sentences.filter((s) => !isTranscriptScrapSentence(s));
}

function cleanupTranscriptScrapText(text = "") {
  return normalizeText(cleanupTranscriptScrapSentences(splitSentences(text)).join(" "));
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
  if (/\[(?:number|amount|date|address|unknown)\]/iu.test(s)) {
    throw new Error(`${where} defective: unresolved generation placeholder`);
  }
}

const NUMBER_WORD = "(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)";
const ORDINAL_WORD = "(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|twenty-first|twenty-second|twenty-third|twenty-fourth|twenty-fifth|twenty-sixth|twenty-seventh|twenty-eighth|twenty-ninth|thirtieth)";
const HYPHENATED_NUMBER_WORDS = new RegExp(`\\b${NUMBER_WORD}(?:-${NUMBER_WORD})+\\b`, "giu");
const SPELLED_STREET_ORDINAL = new RegExp(`\\b${ORDINAL_WORD}\\s+(?:Avenue|Street|Road|Highway|Boulevard|Drive|Lane|Line|Concession)\\b`, "giu");
const NUMERIC_WORD_TOKEN = "(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth)";
const SPELLED_NUMBER_PHRASE = new RegExp(`\\b${NUMERIC_WORD_TOKEN}(?:[ -]+(?:and[ -]+)?${NUMERIC_WORD_TOKEN})*\\b`, "giu");
const MIXED_MAGNITUDE_NUMBER = new RegExp(`\\b\\d+\\s+(?:hundred|thousand)(?:\\s+and\\s+(?:\\d+|${NUMERIC_WORD_TOKEN}))?\\b`, "giu");

function numericFidelityDefects(text = "") {
  const value = String(text || "");
  const malformedHyphenatedNumbers = Array.from(value.matchAll(HYPHENATED_NUMBER_WORDS), (match) => match[0])
    // Repeated idioms such as "fifty-fifty" are ordinary prose, not a
    // speech-to-text rendering of a multi-digit number such as "twelve-eight".
    .filter((candidate) => {
      const parts = candidate.toLowerCase().split("-");
      return new Set(parts).size > 1;
    });
  const spelledNumberPhrases = Array.from(value.matchAll(SPELLED_NUMBER_PHRASE))
    // A standalone cardinal such as "twelve members" is valid prose. Reserve
    // hard notation repair for compound forms and numbered street ordinals;
    // factual support for every Arabic numeric token is enforced separately.
    .filter((match) => /[ -]/u.test(match[0]))
    .filter((match) => {
      if (!/^(?:hundred|thousand|million|billion)$/iu.test(match[0])) return true;
      return !/\d\s*$/u.test(value.slice(0, Number(match.index || 0)));
    })
    .filter((match) => {
      if (!/^one$/iu.test(match[0])) return true;
      const following = value.slice(Number(match.index || 0) + match[0].length);
      // "one of" selects a member and "one-time" is a lexical modifier.
      // Neither is malformed numeric notation, and forcing them through the
      // quantity mapper can turn valid civic prose into "1 of" or "1-time".
      return !/^(?:\s+of\b|-time\b)/iu.test(following);
    })
    .map((match) => match[0]);
  return [
    ...malformedHyphenatedNumbers,
    ...Array.from(value.matchAll(SPELLED_STREET_ORDINAL), (match) => match[0]),
    ...Array.from(value.matchAll(MIXED_MAGNITUDE_NUMBER), (match) => match[0]),
    ...spelledNumberPhrases,
  ];
}

function hasNumericClaim(text = "") {
  return /\d/u.test(String(text || "")) || numericFidelityDefects(text).length > 0;
}

export function numericAuditSourceExcerpt(sourceExcerpt = "") {
  const source = String(sourceExcerpt || "");
  const rows = source.includes("\n") ? source.split(/\n+/u) : splitSentences(source);
  const numericToken = new RegExp(`(?:\\d|\\b${NUMERIC_WORD_TOKEN}\\b)`, "iu");
  const selected = new Set();
  rows.forEach((row, index) => {
    const spokenText = row.replace(/^SPEAKER_[0-9A-Z]+:\s*/u, "");
    if (!numericToken.test(spokenText)) return;
    for (let contextIndex = Math.max(0, index - 1); contextIndex <= Math.min(rows.length - 1, index + 1); contextIndex += 1) {
      selected.add(contextIndex);
    }
  });
  return [...selected].sort((a, b) => a - b).map((index) => rows[index]).join("\n");
}

export async function repairNumericFidelityLlm({
  summary = "",
  chapterText = "",
  sourceExcerpt = "",
  ollamaUrl = OLLAMA_URL,
} = {}) {
  let currentSummary = normalizeText(summary);
  let currentChapterText = normalizeText(chapterText);
  if (!hasNumericClaim(`${currentSummary} ${currentChapterText}`)) {
    return { summary: currentSummary, chapterText: currentChapterText };
  }
  const numericSourceExcerpt = numericAuditSourceExcerpt(sourceExcerpt);
  let lastAuditValid = false;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const defects = [
      ...numericFidelityDefects(currentSummary),
      ...numericFidelityDefects(currentChapterText),
    ];
    if (attempt > 1 && lastAuditValid && !defects.length) break;
    const parsed = await callOllamaJson({
      ollamaUrl,
      llmModel: "qwen3.5:9b",
      system: "You correct numeric notation in generated civic summaries. Return strict JSON only.",
      prompt: [
        "Audit and correct only numeric notation in the generated fields using the grounded source.",
        "Return JSON with exactly: summary, chapter text, numeric valid.",
        "numeric valid must be true only when every number, year, date, quantity, percentage, currency amount, and numbered street in both generated fields is supported by the grounded source and uses Arabic digits.",
        "Keep all non-numeric wording and sentence structure unchanged.",
        "Use Arabic digits for every listed quantity and numbered street ordinal, even when the grounded source spells it in words.",
        "Also repair unlisted numeric discrepancies such as shortened years (225 instead of 2025), mixed digit-word years (two thousand and 27), dropped digits, or a number that disagrees with the grounded source.",
        `The output must not contain any of these exact malformed forms: ${defects.map((value) => JSON.stringify(value)).join(", ")}.`,
        "Examples: Sixth Street becomes 6th Street; Ninth Avenue becomes 9th Avenue; seventy-seven becomes 77.",
        "Do not invent, calculate, omit, or change any fact.",
        `GENERATED_SUMMARY: ${currentSummary}`,
        `GENERATED_CHAPTER_TEXT: ${currentChapterText}`,
        `GROUNDED_SOURCE: ${numericSourceExcerpt}`,
      ].join("\n\n"),
    });
    currentSummary = normalizeText(parsed?.summary || currentSummary);
    currentChapterText = normalizeText(parsed?.["chapter text"] || currentChapterText);
    lastAuditValid = parsed?.["numeric valid"] === true;
  }
  for (let mappingAttempt = 1; mappingAttempt <= 3; mappingAttempt += 1) {
    const remaining = [...new Set([
      ...numericFidelityDefects(currentSummary),
      ...numericFidelityDefects(currentChapterText),
    ])];
    if (!remaining.length) break;
    for (const defect of remaining) {
      // Ask for one exact mapping at a time. In a batch, the model can
      // repeatedly omit short valid quantities while repairing a more complex
      // phrase, leaving an otherwise grounded substantive item unpublished.
      const parsed = await callOllamaJson({
        ollamaUrl,
        llmModel: "qwen3.5:9b",
        system: "You convert exact English numeric phrases to Arabic numeric notation. Return strict JSON only.",
        prompt: [
          "Return one replacement for the listed exact phrase as JSON: {\"replacements\":[{\"from\":\"Sixth Street\",\"to\":\"6th Street\"}]}",
          "The from value must be copied exactly from the list. The to value must contain an Arabic digit and preserve any non-numeric noun such as Street or Avenue.",
          "Return only the numeric equivalent, not surrounding words or prose, and do not omit the listed phrase.",
          `PHRASES: ${JSON.stringify([defect])}`,
          `GROUNDED_SOURCE: ${numericSourceExcerpt}`,
        ].join("\n\n"),
      });
      const replacements = Array.isArray(parsed?.replacements) ? parsed.replacements : [];
      const replacement = replacements.find((entry) => String(entry?.from || "").toLowerCase() === defect.toLowerCase());
      const to = normalizeText(replacement?.to || "");
      if (!to || !/\d/u.test(to) || numericFidelityDefects(to).length) continue;
      currentSummary = currentSummary.replaceAll(defect, to);
      currentChapterText = currentChapterText.replaceAll(defect, to);
    }
  }
  for (let rewriteAttempt = 1; rewriteAttempt <= 3; rewriteAttempt += 1) {
    const remaining = [...new Set([
      ...numericFidelityDefects(currentSummary),
      ...numericFidelityDefects(currentChapterText),
    ])];
    if (!remaining.length) break;
    const parsed = await callOllamaJson({
      ollamaUrl,
      llmModel: "qwen3.5:9b",
      system: "You resolve malformed numeric notation in grounded civic summaries. Return strict JSON only.",
      prompt: [
        "Rewrite both generated fields so none of the listed malformed numeric phrases remain.",
        "Return exactly: {\"summary\":\"...\",\"chapter text\":\"...\"}.",
        "If the grounded source unambiguously supplies the numeric value, render it with Arabic digits.",
        "If the spoken form is ambiguous, omit only the numeric claim while preserving the complete supported civic action or outcome as grammatical prose.",
        "Do not add, calculate, or substitute any quantity, date, time, address, percentage, currency amount, or other fact.",
        `MALFORMED_PHRASES: ${JSON.stringify(remaining)}`,
        `GENERATED_SUMMARY: ${currentSummary}`,
        `GENERATED_CHAPTER_TEXT: ${currentChapterText}`,
        `GROUNDED_SOURCE: ${numericSourceExcerpt}`,
      ].join("\n\n"),
    });
    currentSummary = normalizeText(parsed?.summary || currentSummary);
    currentChapterText = normalizeText(parsed?.["chapter text"] || currentChapterText);
  }
  return {
    summary: normalizeText(normalizeUnambiguousSpokenNumbers(currentSummary)),
    chapterText: normalizeText(normalizeUnambiguousSpokenNumbers(currentChapterText)),
  };
}

export async function rewriteWithoutNumericClaimsLlm({
  summary = "",
  chapterText = "",
  sourceExcerpt = "",
  ollamaUrl = OLLAMA_URL,
} = {}) {
  let currentSummary = normalizeText(summary);
  let currentChapterText = normalizeText(chapterText);
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const freshFromSource = attempt >= 3;
    const parsed = await callOllamaJson({
      ollamaUrl,
      llmModel: "qwen3.5:9b",
      system: "You write grounded civic summaries without numeric claims. Return strict JSON only.",
      prompt: [
        `Correction attempt ${attempt} of 6.`,
        "Rewrite the prior generated summary and chapter text qualitatively.",
        "Return exactly: {\"summary\":\"...\",\"chapter text\":\"...\"}.",
        "Preserve the supported civic action, discussion, decision, and outcome as complete grammatical prose.",
        "Do not write any digits, clock times, dates, quantities, percentages, currency amounts, numbered addresses, or spelled-out number phrases.",
        "When a sentence cannot be written without a numeric claim, replace that sentence with a qualitative description of the supported policy, financing approach, decision, or outcome.",
        attempt >= 3
          ? "Previous corrections still contained numeric language. Start both fields over as fresh qualitative civic prose; do not preserve comparisons, totals, dates, or amounts."
          : "",
        attempt >= 5
          ? "Focus only on the supported civic action and outcome. Omit every financial comparison and quantitative detail."
          : "",
        "Do not add facts. Do not mention processing, source text, or these instructions.",
        freshFromSource ? "Write fresh prose from the grounded source below. The rejected numeric draft is intentionally omitted so its malformed number phrases cannot be recopied." : `PRIOR_SUMMARY: ${currentSummary}`,
        freshFromSource ? "Omit contact information, roll-call details, addresses, dates, times, totals, amounts, and every other quantitative detail." : `PRIOR_CHAPTER_TEXT: ${currentChapterText}`,
        freshFromSource ? `GROUNDED_SOURCE: ${String(sourceExcerpt || "").slice(0, 12000)}` : "The grounded source is intentionally omitted during revision. Preserve only non-numeric facts already present in the prior generated fields.",
      ].join("\n\n"),
    });
    currentSummary = normalizeText(normalizeUnambiguousSpokenNumbers(parsed?.summary || ""));
    currentChapterText = normalizeText(normalizeUnambiguousSpokenNumbers(parsed?.["chapter text"] || ""));
    if (currentSummary
      && !/\d/u.test(`${currentSummary} ${currentChapterText}`)
      && !numericFidelityDefects(`${currentSummary} ${currentChapterText}`).length) {
      break;
    }
  }
  if (!currentSummary) {
    throw new Error("stage3 retryable: qwen3.5:9b returned an empty qualitative summary");
  }
  return { summary: currentSummary, chapterText: currentChapterText };
}

export async function repairUnsupportedNumericClaimsLlm({
  summary = "",
  chapterText = "",
  sourceExcerpt = "",
  unsupportedTokens = [],
  ollamaUrl = OLLAMA_URL,
} = {}) {
  let currentSummary = normalizeText(summary);
  let currentChapterText = normalizeText(chapterText);
  const repairGroundingSource = String(sourceExcerpt || "")
    .split(/\n/u)
    .map((line) => line.replace(/^\s*SPEAKER_[0-9A-Z]+:\s*/u, ""))
    .join("\n");
  let unsupported = [...new Set(unsupportedTokens.map((value) => normalizeText(value)).filter(Boolean))];
  for (let attempt = 1; attempt <= 4 && unsupported.length; attempt += 1) {
    const parsed = await callOllamaJson({
      ollamaUrl,
      llmModel: "qwen3.5:9b",
      system: "Remove unsupported numeric claims from generated civic summaries. Return strict JSON only.",
      prompt: [
        "Correct the generated summary and chapter text using only the grounded source.",
        "Return exactly: {\"summary\":\"...\",\"chapter text\":\"...\"}.",
        `These numeric tokens are unsupported and must not remain unless the grounded source supplies their exact value: ${unsupported.join(", ")}.`,
        "If the grounded source gives the correct value, use it. Otherwise omit the unsupported quantity while preserving a complete factual sentence.",
        "Transcript speaker identifiers are internal metadata, not people or facts. Never mention labels such as SPEAKER_072 or Speaker 072 in either generated field.",
        "Do not introduce a replacement number, date, address, percentage, or currency amount that is absent from the grounded source.",
        attempt >= 2
          ? "The prior correction introduced another unsupported number. Rewrite both fields without any numeric claims or spelled-out quantities; state the supported substance qualitatively."
          : "",
        `GENERATED_SUMMARY: ${currentSummary}`,
        `GENERATED_CHAPTER_TEXT: ${currentChapterText}`,
        `GROUNDED_SOURCE: ${repairGroundingSource.slice(0, 12000)}`,
      ].join("\n\n"),
    });
    currentSummary = normalizeText(parsed?.summary || "");
    currentChapterText = normalizeText(parsed?.["chapter text"] || "");
    unsupported = unsupportedNumericTokens(
      `${currentSummary} ${currentChapterText}`,
      sourceExcerpt,
    );
  }
  return {
    summary: currentSummary,
    chapterText: currentChapterText,
    unsupportedTokens: unsupported,
  };
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
  // A long span can inherit a procedural agenda label while containing
  // substantive material (for example, call to order followed immediately by
  // an audit presentation). Only compact genuinely short procedural spans.
  const compactProcedural = Boolean(budget.procedural)
    && ["tiny_procedural", "short"].includes(String(budget.tier || ""));

  let sentences = splitSentences(before);
  sentences = cleanupTranscriptScrapSentences(sentences);
  sentences = cleanupIncompleteTail(sentences, { allowOriginalEllipsis });
  if (!sentences.length) return "";
  const fullSentences = sentences.slice();

  // 1) Sentence-first clamp
  if (compactProcedural) {
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

  if (!compactProcedural && sentences.length < minSentences && fullSentences.length >= minSentences) {
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
    strictSentences = cleanupTranscriptScrapSentences(strictSentences);
    strictSentences = cleanupIncompleteTail(strictSentences, { allowOriginalEllipsis: false });
    if (strictSentences.length > Math.max(1, minSentences) && !summaryHasMinimalCompleteness(strictSentences.join(" "))) {
      strictSentences = strictSentences.slice(0, strictSentences.length - 1);
    }
    if (!compactProcedural && strictSentences.length < minSentences && fullSentences.length >= minSentences) {
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
  summary = cleanupTranscriptScrapText(summary);
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
  const fragmentLast = new Set(["other", "live", "following", "regarding", "including", "against", "lack", "prompting", "citing", "requiring", "mandating", "using", "based", "through", "disproportionate", "due", "relied", "submitted", "physical", "which", "unverified", "request", "procedural", "definition", "bug", "bed", "calling", "rising", "while", "will", "and", "or", "with", "despite"]);
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
    if (/^(the\s+discussion\s+addresses|the\s+presentation\s+addresses|the\s+section\s+addresses)\b/iu.test(c)) continue;
    if (/\bOwen Sound Police Service Re\b/iu.test(c) || /\bRe$/iu.test(c)) continue;
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
  const version = String(grounding["schema version"] || "");
  const v1 = new Set(["schema version", "generated time", "transcript rows total", "grounded units"]);
  const v2 = new Set([
    "schema version",
    "generated time",
    "canonical source path",
    "canonical source type",
    "canonical fingerprint",
    "transcript rows total",
    "atomic units total",
    "grounded units",
  ]);
  const v3 = new Set([
    ...v2,
    "recording atomic units total",
    "meeting scope audit",
    "prefix scope audit",
  ]);
  const allowed = version === "agenda_section_grounding_v3"
    ? v3
    : (version === "agenda_section_grounding_v2" ? v2 : v1);
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
  if (!["agenda_section_grounding_v1", "agenda_section_grounding_v2", "agenda_section_grounding_v3"].includes(version)) {
    throw new Error("stage3 defective: invalid grounding schema version");
  }
  if (version === "agenda_section_grounding_v3") {
    const recordingTotal = Number(grounding["recording atomic units total"] || 0);
    const scopedTotal = Number(grounding["atomic units total"] || 0);
    const meetingScope = grounding["meeting scope audit"];
    const prefixScope = grounding["prefix scope audit"];
    if (!Number.isInteger(recordingTotal) || recordingTotal < scopedTotal || scopedTotal < 1) {
      throw new Error("stage3 defective: invalid recording/scoped atomic-unit totals");
    }
    if (!meetingScope || typeof meetingScope !== "object" || !String(meetingScope["scope atomic start"] || "")) {
      throw new Error("stage3 defective: missing named-meeting scope audit");
    }
    if (!prefixScope || typeof prefixScope !== "object") {
      throw new Error("stage3 defective: missing in-scope prefix audit");
    }
  }
}

async function callOllamaJson({ ollamaUrl, llmModel, system, prompt }) {
  // A scheduled report may briefly lose the LAN model while another request
  // unloads or reloads. Keep the substantive item retryable through a bounded
  // outage instead of abandoning all previously completed section work after
  // the former ~15-second retry window.
  const maxAttempts = Math.max(1, Number.parseInt(String(process.env.AGENDA_STAGE3_OLLAMA_ATTEMPTS || "9"), 10) || 9);
  // Grounded whole-item audits can include several thousand transcript words.
  // Give the local model enough time to finish them instead of repeatedly
  // aborting healthy in-flight generations at the short-request threshold.
  const timeoutMs = Math.max(5_000, Number.parseInt(String(process.env.AGENDA_STAGE3_OLLAMA_TIMEOUT_MS || "300000"), 10) || 300_000);
  const baseDelayMs = Math.max(1, Number.parseInt(String(process.env.AGENDA_STAGE3_OLLAMA_RETRY_DELAY_MS || "1500"), 10) || 1500);

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
        options: { temperature: 0 },
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

export async function summarizeGroundedUnit({
  unit,
  focus,
  llmModel,
  ollamaUrl,
  isChild = false,
  siblingSummaries = [],
}) {
  const budget = buildSummaryBudget(unit);
  const numericGroundingSource = [
    String(unit?.label || ""),
    String(unit?.["agenda item"] || ""),
    String(unit?.["source excerpt"] || ""),
  ].join("\n");
  const hasChildChapters = Array.isArray(unit?.["child chapters"]) && unit["child chapters"].length > 0;
  const requiresExpandedOverview = !isChild
    && !hasChildChapters
    && (budget.tier === "long" || budget.tier === "very_long");
  const largeBoundedChild = isChild && String(unit?.["source excerpt"] || "").length >= 4000;
  const longOrderLine =
    requiresExpandedOverview
      ? "For long sections, prefer this order when applicable: item under discussion; main substance; decision/direction/outcome."
      : "";
  const longCoverageLine =
    requiresExpandedOverview
      ? "Long-tier requirement: produce at least 3 complete sentences covering item, substance, and outcome (if outcome exists in source)."
      : "";
  const siblingContext = (Array.isArray(siblingSummaries) ? siblingSummaries : [])
    .map((value, index) => `Sibling ${index + 1}: ${normalizeText(value)}`)
    .filter((value) => !value.endsWith(":"))
    .join("\n")
    .slice(-6000);
  const prompt = [
    "You are stage3 of a strict agenda summary pipeline.",
    "Grounding is authoritative. Do not invent boundaries or facts.",
    "Return one valid JSON object only. Do not return markdown.",
    "Required keys: summary, chapter text, confidence, notes.",
    "notes must be a short string, not an array.",
    "Example: {\"summary\":\"...\",\"chapter text\":\"...\",\"confidence\":0.9,\"notes\":\"\"}",
    "summary: factual, source-aligned, proportional to section size, and written as complete grammatical sentences with an explicit subject and finite verb.",
    "Never copy a punctuation-free transcript fragment into summary; synthesize it into reporting prose.",
    "chapter text: short chapter-ready line. If not split, still provide a useful line.",
    "chapter text must accurately name the distinct main point stated in summary.",
    "chapter text must be a complete, self-contained headline; do not end with a dangling conjunction, comma, preposition, or participle such as 'while', 'and', 'including', or 'utilizing'.",
    "Use transcript-specific nouns, actions, concerns, and outcomes from the source excerpt. Do not use agenda-label prose as a substitute for what was said.",
    "When the source is a resolution, correspondence, or recommendation, state the concrete requested actions or policy changes; do not reduce it to adoption, receipt, background costs, or a request for review.",
    "chapter text must use concrete keywords from the source. Do not start it with 'the discussion addresses', 'the presentation addresses', or an agenda label ending in 'Re'.",
    "Do not write filler such as 'the section also covers' or 'the section also details'.",
    isChild
      ? "This excerpt is one character-bounded source chunk. Summarize the substantive information in this chunk, not the parent agenda label or a generic introduction."
      : "",
    isChild && siblingContext
      ? "Avoid repeating facts or framing already used by sibling summaries when this source supports a more specific, distinct detail."
      : "",
    siblingContext ? "Existing sibling summaries:" : "",
    siblingContext,
    `Summary budget tier: ${budget.tier}`,
    `Budget max sentences: ${budget.maxSentences}`,
    `Budget max words: ${budget.maxWords}`,
    `Procedural section: ${budget.procedural ? "yes" : "no"}`,
    longOrderLine,
    longCoverageLine,
    largeBoundedChild
      ? "Bounded-chunk guidance: use 1 to 4 complete sentences as needed to cover the distinct evidence, findings, or requests in this source chunk without padding."
      : "",
    "Do not mention names, figures, or decisions not present in the grounded source excerpt.",
    "Do not name a motion mover or seconder unless one source line explicitly pairs that person's name with moving or seconding the motion. A nearby name callout, speaker change, or conflict declaration is not mover evidence. When identity is unclear, describe what Council considered or approved without naming the mover.",
    "Preserve numeric fidelity: write quantities and numbered street ordinals with Arabic digits exactly as shown in the source (for example, 24 and 15th Avenue), never spelled or hyphenated number words.",
    "",
    `Focus: ${focus || "newsworthy factual civic reporting"}`,
    `Label: ${unit.label}`,
    `Agenda item: ${unit["agenda item"] || ""}`,
    "Do not mention internal row numbers, source-chunk timing, or processing metadata.",
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
    throw new Error(
      `stage3 retryable: qwen3.5:9b unavailable at ${ollamaUrl} (${normalizeText(String(err?.message || err)).slice(0, 200)})`,
    );
  }
  let rawSummary = normalizeText(parsed?.summary || "");
  assertCleanStage3Text(rawSummary, "stage3 summary");
  let summary = enforceSummaryBudget(rawSummary, budget);
  if (!summary) {
    parsed = await queryParsed(
      "Retry requirement: summary must contain at least one complete, factual sentence grounded in the source excerpt and ending with sentence punctuation. Do not return a fragment or an empty summary.",
    );
    rawSummary = normalizeText(parsed?.summary || "");
    assertCleanStage3Text(rawSummary, "stage3 complete-sentence retry");
    summary = enforceSummaryBudget(rawSummary, budget);
  }
  if (!summary && rawSummary) {
    parsed = await callOllamaJson({
      ollamaUrl,
      llmModel: "qwen3.5:9b",
      system: "You rewrite generated civic-report fragments as complete factual sentences. Return strict JSON only.",
      prompt: [
        "Rewrite the generated fragment into one or two complete grammatical sentences ending with sentence punctuation.",
        "Use an explicit civic subject and finite reporting verb. Do not copy the fragment unchanged or return a list of noun phrases.",
        "Preserve its facts and numeric values, and do not add facts.",
        "Return exactly: {\"summary\":\"...\",\"chapter text\":\"...\",\"confidence\":0.9,\"notes\":\"\"}.",
        `GENERATED_FRAGMENT: ${rawSummary}`,
      ].join("\n\n"),
    });
    rawSummary = normalizeText(parsed?.summary || "");
    assertCleanStage3Text(rawSummary, "stage3 fragment rewrite");
    summary = enforceSummaryBudget(rawSummary, budget);
  }

  // Parent overviews and large bounded source chunks must carry enough of
  // their available context to avoid reducing a report to its opening line.
  const longTier = requiresExpandedOverview;
  for (let expansionAttempt = 1; longTier && splitSentences(summary).length < 2 && expansionAttempt <= 3; expansionAttempt += 1) {
    parsed = await queryParsed(
      `Long-tier retry ${expansionAttempt}: return 3 to 5 separate complete sentences covering item, substance, and outcome from this grounded span only. Use a period between sentences.`,
    );
    rawSummary = normalizeText(parsed?.summary || "");
    assertCleanStage3Text(rawSummary, "stage3 summary retry");
    summary = enforceSummaryBudget(rawSummary, budget);
  }
  if (longTier && splitSentences(summary).length < 2 && summary) {
    parsed = await callOllamaJson({
      ollamaUrl,
      llmModel: "qwen3.5:9b",
      system: "Rewrite one grounded civic-report sentence as multiple complete sentences. Return strict JSON only.",
      prompt: [
        "Rewrite the generated summary as 2 or 3 separate complete sentences with periods between them.",
        "Preserve every supported fact and numeric value. Do not add facts, conclusions, or quantities.",
        "Return exactly: {\"summary\":\"...\",\"chapter text\":\"...\",\"confidence\":0.9,\"notes\":\"\"}.",
        `GENERATED_SUMMARY: ${summary}`,
        `GENERATED_CHAPTER_TEXT: ${normalizeText(parsed?.["chapter text"] || "")}`,
        `GROUNDED_SOURCE: ${String(unit?.["source excerpt"] || "").slice(0, 12000)}`,
      ].join("\n\n"),
    });
    rawSummary = normalizeText(parsed?.summary || "");
    assertCleanStage3Text(rawSummary, "stage3 multi-sentence rewrite");
    summary = enforceSummaryBudget(rawSummary, budget);
  }
  const attributionSource = String(unit?.["attribution source excerpt"] || unit?.["source excerpt"] || "");
  for (let attributionAttempt = 1; attributionAttempt <= 3; attributionAttempt += 1) {
    const defects = unsupportedNamedMotionAttributions({
      text: `${summary} ${String(parsed?.["chapter text"] || "")}`,
      sourceExcerpt: attributionSource,
    });
    if (!defects.length) break;
    const rejectedJson = JSON.stringify({
      summary: normalizeText(parsed?.summary || ""),
      "chapter text": normalizeText(parsed?.["chapter text"] || ""),
    });
    const repairInstruction = attributionAttempt === 1
      ? "Regenerate without naming that actor; describe the motion or Council's action generically."
      : attributionAttempt === 2
        ? `Rejected JSON: ${rejectedJson}. Start both fields over and do not repeat any named mover or seconder from the rejected JSON.`
        : `Rejected JSON: ${rejectedJson}. Delete the unsupported actor name and the move/second role from both fields. Begin directly with the substantive recommendation, discussion, or Council action.`;
    parsed = await queryParsed(
      `Motion-attribution retry ${attributionAttempt}: ${defects.map((defect) => `"${defect.claim}"`).join(", ")} names a mover or seconder without an explicit same-line source attribution. ${repairInstruction}`,
    );
    rawSummary = normalizeText(parsed?.summary || "");
    assertCleanStage3Text(rawSummary, "stage3 motion-attribution retry");
    summary = enforceSummaryBudget(rawSummary, budget);
  }
  let repeatedAttributionDefects = unsupportedNamedMotionAttributions({
    text: `${summary} ${String(parsed?.["chapter text"] || "")}`,
    sourceExcerpt: attributionSource,
  });
  const forbiddenMotionActors = new Set(repeatedAttributionDefects.map((defect) => defect.actor).filter(Boolean));
  for (let freshAttempt = 1; repeatedAttributionDefects.length && freshAttempt <= 3; freshAttempt += 1) {
    parsed = await callOllamaJson({
      ollamaUrl,
      llmModel: "qwen3.5:9b",
      system: "Write a fresh source-grounded civic summary with no personal names. Return strict JSON only.",
      prompt: [
        "Start over from the grounded source. Do not revise or repeat the rejected draft.",
        "Use only generic institutional subjects such as Council, the committee, staff, or the report.",
        "Do not write any personal name anywhere in summary or chapter text, even when the source contains names.",
        "Do not attribute moving or seconding to any person. State the substantive recommendation, discussion, and supported outcome generically.",
        forbiddenMotionActors.size ? `Forbidden actor names from prior failed generations: ${[...forbiddenMotionActors].join(", ")}.` : "",
        `Summary budget: at most ${budget.maxSentences} sentences and ${budget.maxWords} words.`,
        "Return exactly: {\"summary\":\"...\",\"chapter text\":\"...\",\"confidence\":0.9,\"notes\":\"\"}.",
        `Label: ${unit.label}`,
        `Agenda item: ${unit["agenda item"] || ""}`,
        "Grounded source excerpt:",
        String(unit["source excerpt"] || "").slice(0, 12000),
      ].filter(Boolean).join("\n\n"),
    });
    rawSummary = normalizeText(parsed?.summary || "");
    assertCleanStage3Text(rawSummary, "stage3 fresh no-name motion-attribution retry");
    summary = enforceSummaryBudget(rawSummary, budget);
    repeatedAttributionDefects = unsupportedNamedMotionAttributions({
      text: `${summary} ${String(parsed?.["chapter text"] || "")}`,
      sourceExcerpt: attributionSource,
    });
    for (const defect of repeatedAttributionDefects) {
      if (defect.actor) forbiddenMotionActors.add(defect.actor);
    }
  }
  for (let numericAttempt = 1; numericAttempt <= 2; numericAttempt += 1) {
    const defects = [
      ...numericFidelityDefects(summary),
      ...numericFidelityDefects(parsed?.["chapter text"] || ""),
    ];
    if (!defects.length) break;
    parsed = await queryParsed(
      `Numeric-fidelity retry: the prior response contained ${defects.map((value) => `"${value}"`).join(", ")}. Regenerate from the grounded source and use Arabic digits for every such quantity or street ordinal.`,
    );
    rawSummary = normalizeText(parsed?.summary || "");
    assertCleanStage3Text(rawSummary, "stage3 numeric-fidelity retry");
    summary = enforceSummaryBudget(rawSummary, budget);
  }
  const remainingNumericDefects = [
    ...numericFidelityDefects(summary),
    ...numericFidelityDefects(parsed?.["chapter text"] || ""),
  ];
  const repaired = await repairNumericFidelityLlm({
    summary,
    chapterText: parsed?.["chapter text"] || "",
    sourceExcerpt: unit["source excerpt"] || "",
    ollamaUrl,
  });
  if (repaired.summary) {
    rawSummary = repaired.summary;
    summary = enforceSummaryBudget(rawSummary, budget);
  }
  if (repaired.chapterText) parsed["chapter text"] = repaired.chapterText;
  for (let groundingAttempt = 1; groundingAttempt <= 2; groundingAttempt += 1) {
    const unsupported = unsupportedNumericTokens(
      `${summary} ${String(parsed?.["chapter text"] || "")}`,
      numericGroundingSource,
    );
    if (!unsupported.length) break;
    parsed = await queryParsed(
      `Numeric-grounding retry: these numeric tokens are absent from the grounded source: ${unsupported.join(", ")}. Regenerate both fields using only exact numeric values present in the source.`,
    );
    rawSummary = normalizeText(parsed?.summary || "");
    summary = enforceSummaryBudget(rawSummary, budget);
  }
  let unsupportedAfterRegeneration = unsupportedNumericTokens(
    `${summary} ${String(parsed?.["chapter text"] || "")}`,
    numericGroundingSource,
  );
  if (unsupportedAfterRegeneration.length) {
    const groundedRepair = await repairUnsupportedNumericClaimsLlm({
      summary,
      chapterText: parsed?.["chapter text"] || "",
      sourceExcerpt: numericGroundingSource,
      unsupportedTokens: unsupportedAfterRegeneration,
      ollamaUrl,
    });
    rawSummary = groundedRepair.summary;
    summary = enforceSummaryBudget(rawSummary, budget);
    parsed["chapter text"] = groundedRepair.chapterText;
    unsupportedAfterRegeneration = groundedRepair.unsupportedTokens;
  }
  // Grounding regeneration can repair an unsupported Arabic token by spelling
  // it out again, while notation repair can turn an ambiguous spoken form into
  // a new unsupported Arabic token. Reapply both downstream contracts as one
  // bounded loop so neither repair can invalidate the other unnoticed.
  for (let contractAttempt = 1; contractAttempt <= 3; contractAttempt += 1) {
    const notationDefects = [
      ...numericFidelityDefects(summary),
      ...numericFidelityDefects(parsed?.["chapter text"] || ""),
    ];
    if (notationDefects.length) {
      const notationRepair = await repairNumericFidelityLlm({
        summary,
        chapterText: parsed?.["chapter text"] || "",
        sourceExcerpt: numericGroundingSource,
        ollamaUrl,
      });
      rawSummary = notationRepair.summary;
      summary = enforceSummaryBudget(rawSummary, budget);
      parsed["chapter text"] = notationRepair.chapterText;
    }
    const unsupported = unsupportedNumericTokens(
      `${summary} ${String(parsed?.["chapter text"] || "")}`,
      numericGroundingSource,
    );
    if (unsupported.length) {
      const groundingRepair = await repairUnsupportedNumericClaimsLlm({
        summary,
        chapterText: parsed?.["chapter text"] || "",
        sourceExcerpt: numericGroundingSource,
        unsupportedTokens: unsupported,
        ollamaUrl,
      });
      rawSummary = groundingRepair.summary;
      summary = enforceSummaryBudget(rawSummary, budget);
      parsed["chapter text"] = groundingRepair.chapterText;
      unsupportedAfterRegeneration = groundingRepair.unsupportedTokens;
    } else {
      unsupportedAfterRegeneration = [];
    }
    if (!numericFidelityDefects(`${summary} ${String(parsed?.["chapter text"] || "")}`).length
      && !unsupportedAfterRegeneration.length) break;
  }
  let unrepairedNumericDefects = [
    ...numericFidelityDefects(summary),
    ...numericFidelityDefects(parsed?.["chapter text"] || ""),
  ];
  if (unrepairedNumericDefects.length) {
    const qualitativeRepair = await rewriteWithoutNumericClaimsLlm({
      summary,
      chapterText: parsed?.["chapter text"] || "",
      sourceExcerpt: numericGroundingSource,
      ollamaUrl,
    });
    rawSummary = qualitativeRepair.summary;
    summary = enforceSummaryBudget(rawSummary, budget);
    parsed["chapter text"] = qualitativeRepair.chapterText;
    unrepairedNumericDefects = [
      ...numericFidelityDefects(summary),
      ...numericFidelityDefects(parsed?.["chapter text"] || ""),
    ];
  }
  if (unrepairedNumericDefects.length) {
    throw new Error(`stage3 retryable: qwen3.5:9b failed numeric fidelity for unit ${String(unit["unit id"] || unit["agenda item"] || "unknown")}: ${unrepairedNumericDefects.join(", ")}`);
  }
  const unsupportedNumericClaims = unsupportedNumericTokens(
    `${summary} ${String(parsed?.["chapter text"] || "")}`,
    numericGroundingSource,
  );
  if (unsupportedAfterRegeneration.length || unsupportedNumericClaims.length) {
    const unsupported = [...new Set([...unsupportedAfterRegeneration, ...unsupportedNumericClaims])];
    throw new Error(`stage3 retryable: unsupported numeric claims for unit ${String(unit["unit id"] || unit["agenda item"] || "unknown")}: ${unsupported.join(", ")}`);
  }
  let unsupportedMotionAttributions = unsupportedNamedMotionAttributions({
    text: `${summary} ${String(parsed?.["chapter text"] || "")}`,
    sourceExcerpt: attributionSource,
  });
  for (let finalAttributionAttempt = 1; unsupportedMotionAttributions.length && finalAttributionAttempt <= 3; finalAttributionAttempt += 1) {
    const forbiddenActors = [...new Set(unsupportedMotionAttributions.map((defect) => defect.actor).filter(Boolean))];
    parsed = await callOllamaJson({
      ollamaUrl,
      llmModel: "qwen3.5:9b",
      system: "Write fresh qualitative civic prose with no personal names or numeric claims. Return strict JSON only.",
      prompt: [
        "A downstream repair reintroduced unsupported named movers or seconders. Start over from the grounded source; do not revise the contaminated draft.",
        "Use only generic institutional subjects such as Council, the committee, staff, or the report.",
        "Do not write any personal name, mover, seconder, digit, date, time, amount, address, percentage, or spelled-out number phrase.",
        "Preserve the supported civic recommendation, discussion, decision, and outcome qualitatively. Do not add facts.",
        forbiddenActors.length ? `Forbidden actor names: ${forbiddenActors.join(", ")}.` : "",
        `Summary budget: at most ${budget.maxSentences} sentences and ${budget.maxWords} words.`,
        "Return exactly: {\"summary\":\"...\",\"chapter text\":\"...\",\"confidence\":0.9,\"notes\":\"\"}.",
        `Label: ${unit.label}`,
        `Agenda item: ${unit["agenda item"] || ""}`,
        "Grounded source excerpt:",
        String(unit["source excerpt"] || "").slice(0, 12000),
      ].filter(Boolean).join("\n\n"),
    });
    rawSummary = normalizeText(parsed?.summary || "");
    assertCleanStage3Text(rawSummary, "stage3 final no-name qualitative retry");
    summary = enforceSummaryBudget(rawSummary, budget);
    unsupportedMotionAttributions = unsupportedNamedMotionAttributions({
      text: `${summary} ${String(parsed?.["chapter text"] || "")}`,
      sourceExcerpt: attributionSource,
    });
    if (!unsupportedMotionAttributions.length
      && !numericFidelityDefects(`${summary} ${String(parsed?.["chapter text"] || "")}`).length
      && !unsupportedNumericTokens(`${summary} ${String(parsed?.["chapter text"] || "")}`, numericGroundingSource).length) {
      break;
    }
  }
  const finalNumericDefects = numericFidelityDefects(`${summary} ${String(parsed?.["chapter text"] || "")}`);
  const finalUnsupportedNumericClaims = unsupportedNumericTokens(
    `${summary} ${String(parsed?.["chapter text"] || "")}`,
    numericGroundingSource,
  );
  if (finalNumericDefects.length || finalUnsupportedNumericClaims.length) {
    throw new Error(`stage3 retryable: final attribution repair violated numeric grounding for unit ${String(unit["unit id"] || unit["agenda item"] || "unknown")}: ${[...new Set([...finalNumericDefects, ...finalUnsupportedNumericClaims])].join(", ")}`);
  }
  if (unsupportedMotionAttributions.length) {
    throw new Error(
      `stage3 retryable: unsupported named motion attribution for unit ${String(unit["unit id"] || unit["agenda item"] || "unknown")}: ${unsupportedMotionAttributions.map((defect) => defect.claim).join(", ")}`,
    );
  }
  summary = cleanupTranscriptScrapText(summary);
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

export function agendaSummaryToMarkdown(summaryArtifact = {}) {
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

export function stage3ChapterTitleFromGenerated({
  llmText = "",
  summary = "",
  heading = "",
} = {}) {
  return pickSplitChapterText({
    llmText,
    summary,
    heading,
    seenLeadPhrases: new Set(),
  });
}

function exactDuplicateChapterIndices(chapters = []) {
  const seenTitles = new Set();
  const seenSummaries = new Set();
  const duplicates = [];
  for (let index = 0; index < chapters.length; index += 1) {
    const title = wordsKey(chapters[index]?.title || "");
    const summary = wordsKey(chapters[index]?.text || "");
    if ((title && seenTitles.has(title)) || (summary && seenSummaries.has(summary))) {
      duplicates.push(index);
    }
    if (title) seenTitles.add(title);
    if (summary) seenSummaries.add(summary);
  }
  return duplicates;
}

function chapterSiblingContext(chapters = [], excludedIndex = -1, includeSummaries = false) {
  return chapters
    .filter((_, index) => index !== excludedIndex)
    .map((chapter) => {
      const title = normalizeText(chapter?.title || "");
      if (!title) return "";
      if (includeSummaries) return `${title}: ${normalizeText(chapter?.text || "")}`;
      return /\d/u.test(title) ? "" : title;
    })
    .filter(Boolean);
}

async function auditChapterOrthogonality({
  heading,
  chapters,
  llmModel,
  ollamaUrl,
}) {
  if (!Array.isArray(chapters) || chapters.length < 2) {
    return { orthogonal: true, duplicateIndices: [], notes: "" };
  }
  const rendered = chapters
    .map((chapter, index) => [
      `CHAPTER ${index + 1}`,
      `TITLE: ${normalizeText(chapter?.title || "")}`,
      `SUMMARY: ${normalizeText(chapter?.text || "")}`,
    ].join("\n"))
    .join("\n\n");
  const parsed = await callOllamaJson({
    ollamaUrl,
    llmModel,
    system: "Audit civic agenda child summaries for semantic duplication and headline accuracy. Return strict JSON only.",
    prompt: [
      "Determine whether these character-bounded child summaries are meaningfully distinct and each title accurately describes its own summary.",
      "Shared subject names are allowed. Flag a chapter only when it substantially repeats another chapter's main claim, figures, or framing instead of reporting distinct information from its source chunk.",
      "Also flag a chapter when its title claims a topic absent from its own summary, omits the summary's actual main point, or ends as a truncated/dangling phrase.",
      "Return exactly: {\"orthogonal\":true,\"duplicate chapter indices\":[],\"notes\":\"\"}.",
      "When duplication or a title-summary defect exists, orthogonal must be false and duplicate chapter indices must contain the 1-based indices that should be regenerated.",
      `PARENT: ${normalizeText(heading)}`,
      rendered,
    ].join("\n\n"),
  });
  const duplicateIndices = [...new Set(
    (Array.isArray(parsed?.["duplicate chapter indices"]) ? parsed["duplicate chapter indices"] : [])
      .map((value) => Number(value) - 1)
      .filter((value) => Number.isInteger(value) && value >= 0 && value < chapters.length),
  )];
  return {
    orthogonal: parsed?.orthogonal === true && duplicateIndices.length === 0,
    duplicateIndices,
    notes: normalizeText(parsed?.notes || ""),
  };
}

async function synthesizeParentFromChapters({
  unit,
  heading,
  chapters,
  focus,
  llmModel,
  ollamaUrl,
}) {
  let sourceParts = chapters.map((chapter, index) => (
    `Chunk ${index + 1}: ${normalizeText(chapter?.title || "")}\n${normalizeText(chapter?.text || "")}`
  ));
  let reductionPass = 0;
  while (sourceParts.join("\n\n").length > 9000) {
    reductionPass += 1;
    const batches = [];
    let batch = "";
    for (const part of sourceParts) {
      const combined = batch ? `${batch}\n\n${part}` : part;
      if (batch && combined.length > 9000) {
        batches.push(batch);
        batch = part;
      } else {
        batch = combined;
      }
    }
    if (batch) batches.push(batch);
    const reduced = [];
    for (let index = 0; index < batches.length; index += 1) {
      const excerpt = batches[index];
      const reduction = await summarizeGroundedUnit({
        unit: {
          ...unit,
          "attribution source excerpt": String(unit?.["attribution source excerpt"] || unit?.["source excerpt"] || ""),
          "unit id": `${String(unit?.["unit id"] || "unit")}_overview_${reductionPass}_${index + 1}`,
          label: heading,
          "source excerpt": excerpt,
          "source rows": Math.max(1, excerpt.split(/\n{2,}/u).filter(Boolean).length),
          "duration seconds": Math.min(780, Math.max(90, excerpt.length / 8)),
          "child chapters": [],
        },
        focus: `${focus || "newsworthy factual civic reporting"}; condense all supplied chunk summaries without dropping later chunks`,
        llmModel,
        ollamaUrl,
        isChild: true,
      });
      reduced.push(`Reduction ${index + 1}: ${reduction.summary}`);
    }
    if (reduced.length >= sourceParts.length) {
      throw new Error(`stage3 retryable: parent overview reduction did not shrink unit ${String(unit?.["unit id"] || "")}`);
    }
    sourceParts = reduced;
  }
  return summarizeGroundedUnit({
    unit: {
      ...unit,
      "attribution source excerpt": String(unit?.["attribution source excerpt"] || unit?.["source excerpt"] || ""),
      label: heading,
      "source excerpt": sourceParts.join("\n\n"),
      "child chapters": [],
    },
    focus: `${focus || "newsworthy factual civic reporting"}; synthesize a balanced parent overview from every supplied chunk summary`,
    llmModel,
    ollamaUrl,
  });
}

export function stage3GenerationOrder(units = []) {
  return units.map((unit, index) => ({
    index,
    sourceChars: Number(unit["source chars"] || String(unit["source excerpt"] || "").length || 0),
  })).sort((a, b) => a.sourceChars - b.sourceChars || a.index - b.index);
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
  // Independent summaries need not be generated chronologically. Process
  // compact contexts first so a sequence of very-long prompts cannot starve
  // the short meeting tail; restore canonical order before validation/write.
  const generationOrder = stage3GenerationOrder(units);
  for (const generationEntry of generationOrder) {
    const i = generationEntry.index;
    const unit = units[i];
    const unitId = String(unit["unit id"] || "");
    const heading = unit.label || `${unit["agenda item"] || ""}`;

    const sourceChapters = Array.isArray(unit["child chapters"]) ? unit["child chapters"] : [];
    const chapters = [];
    const seenLeadPhrases = new Set();
    const generateChapter = async (ci, existingChapters = [], auditNote = "") => {
      const chapterUnit = sourceChapters[ci] || {};
      const chapterSourceChars = Number(chapterUnit["source chars"] || String(chapterUnit["source excerpt"] || "").length || 0);
      if (chapterSourceChars > maxChapterSourceChars) {
        throw new Error(
          `stage3 defective: oversized child chapter source text unit=${unitId} chapter=${ci + 1} source_chars=${chapterSourceChars} max_allowed=${maxChapterSourceChars}`,
        );
      }
      let chapterLlm = await summarizeGroundedUnit({
        unit: {
          ...unit,
          ...chapterUnit,
          label: heading,
          "part total": 2,
          "part index": ci + 1,
        },
        focus: auditNote ? `${focus}; duplication audit feedback: ${auditNote}` : focus,
        llmModel,
        ollamaUrl,
        isChild: true,
        siblingSummaries: chapterSiblingContext(existingChapters, ci),
      });
      if (!normalizeText(chapterLlm.summary || "")) {
        chapterLlm = await summarizeGroundedUnit({
          unit: {
            ...unit,
            ...chapterUnit,
            label: heading,
            "part total": 2,
            "part index": ci + 1,
          },
          focus: auditNote ? `${focus}; duplication audit feedback: ${auditNote}` : focus,
          llmModel,
          ollamaUrl,
          isChild: true,
          siblingSummaries: chapterSiblingContext(existingChapters, ci),
        });
      }
      if (!normalizeText(chapterLlm.summary || "")) {
        throw new Error(`stage3 retryable: empty LLM child summary for unit ${unitId} chapter ${ci + 1}`);
      }

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

      return {
        "chapter id": String(chapterUnit["chapter id"] || `${unitId}_chapter_${String(ci + 1).padStart(2, "0")}`),
        "parent unit id": unitId,
        "ordering index": Number(chapterUnit["ordering index"] || ci + 1),
        "row start": Number(chapterUnit["row start"] || 0),
        "row end": Number(chapterUnit["row end"] || 0),
        since: Number(chapterUnit.since || 0),
        until: Number(chapterUnit.until || Number(chapterUnit.since || 0)),
        title,
        text: chapterLlm.summary,
      };
    };
    for (let ci = 0; ci < sourceChapters.length; ci += 1) {
      chapters.push(await generateChapter(ci, chapters));
    }

    if (chapters.length >= 2) {
      const auditBatchSize = chapters.length > 12 ? 8 : chapters.length;
      for (let batchStart = 0; batchStart < chapters.length; batchStart += auditBatchSize) {
        const batchEnd = Math.min(chapters.length, batchStart + auditBatchSize);
        let audit = await auditChapterOrthogonality({
          heading,
          chapters: chapters.slice(batchStart, batchEnd),
          llmModel,
          ollamaUrl,
        });
        for (let auditAttempt = 1; !audit.orthogonal && auditAttempt <= 3; auditAttempt += 1) {
          const repairIndices = audit.duplicateIndices.length
            ? audit.duplicateIndices.map((index) => batchStart + index)
            : Array.from({ length: batchEnd - batchStart }, (_, index) => batchStart + index);
          for (const ci of repairIndices) {
            chapters[ci] = await generateChapter(
              ci,
              chapters,
              audit.notes || "Report distinct facts from this chunk and do not repeat a sibling's main claim.",
            );
          }
          audit = await auditChapterOrthogonality({
            heading,
            chapters: chapters.slice(batchStart, batchEnd),
            llmModel,
            ollamaUrl,
          });
        }
        if (!audit.orthogonal) {
          throw new Error(
            `stage3 retryable: child summaries remain semantically duplicative for unit ${unitId} batch ${batchStart + 1}-${batchEnd}${audit.notes ? ` (${audit.notes})` : ""}`,
          );
        }
      }
      for (let duplicateAttempt = 1; duplicateAttempt <= 3; duplicateAttempt += 1) {
        const duplicateIndices = exactDuplicateChapterIndices(chapters);
        if (!duplicateIndices.length) break;
        for (const ci of duplicateIndices) {
          chapters[ci] = await generateChapter(
            ci,
            chapters,
            "This output exactly duplicated another source window. Report only the distinct evidence, table range, finding, or request present in this source chunk.",
          );
        }
      }
      if (exactDuplicateChapterIndices(chapters).length) {
        throw new Error(`stage3 retryable: exact duplicate child summaries remain for unit ${unitId}`);
      }
    }

    let llm = chapters.length
      ? await synthesizeParentFromChapters({ unit, heading, chapters, focus, llmModel, ollamaUrl })
      : await summarizeGroundedUnit({ unit, focus, llmModel, ollamaUrl });
    if (!normalizeText(llm.summary || "") && Boolean(unit.substantive)) {
      llm = chapters.length
        ? await synthesizeParentFromChapters({ unit, heading, chapters, focus, llmModel, ollamaUrl })
        : await summarizeGroundedUnit({ unit, focus, llmModel, ollamaUrl });
    }
    let unitSummary = normalizeText(llm.summary || "");
    if (!unitSummary && Boolean(unit.substantive)) {
      throw new Error(`stage3 retryable: empty LLM summary for substantive unit ${unitId}`);
    }
    if (!unitSummary) {
      unitSummary = fallbackUnitSummaryFromGrounding(unit);
      if (unitSummary) {
        log(`[agenda-stage3][fallback] unit=${unitId} empty llm summary recovered from source excerpt`);
      } else {
        unitSummary = fallbackUnitSummaryFromLabel(unit);
        log(`[agenda-stage3][fallback] unit=${unitId} empty source excerpt; using label-derived summary`);
      }
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

  sections.sort((a, b) => Number(a.index || 0) - Number(b.index || 0));

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
  fs.writeFileSync(outSummaryMdPath, agendaSummaryToMarkdown(summaryArtifact), "utf8");

  log(`[agenda-stage3] sections: ${sections.length}`);
  log(`[agenda-stage3] wrote: ${outSummaryPyaPath}`);
  log(`[agenda-stage3] wrote: ${outSummaryMdPath}`);
  return summaryArtifact;
}

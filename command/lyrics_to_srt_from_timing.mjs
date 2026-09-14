#!/usr/bin/env node
import fs from "node:fs/promises";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseSrtToCuts } from "./itinerary_io.mjs";

const MAX_SENTENCE_WORDS = (() => {
  const raw = Number(process.env.PYA_SRT_MAX_SENTENCE_WORDS || 36);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 36;
})();
const MAX_ASR_GROUP_WORDS = (() => {
  const raw = Number(process.env.PYA_SRT_MAX_ASR_GROUP_WORDS || 6);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 6;
})();
const MAX_ASR_GROUP_CHARS = (() => {
  const raw = Number(process.env.PYA_SRT_MAX_ASR_GROUP_CHARS || 48);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 48;
})();
const TRAILING_SILENCE_TOLERANCE_SECONDS = (() => {
  const raw = Number(process.env.PYA_SRT_TRAILING_SILENCE_TOLERANCE_SECONDS || 2);
  return Number.isFinite(raw) && raw >= 0 ? raw : 2;
})();

function usage() {
  return "Usage: node command/lyrics_to_srt_from_timing.mjs <lyrics.txt> <timing.srt> <output.srt> [--include-sections] [--sentence-cues]";
}

function formatSrtTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const totalMs = Math.round(safe * 1000);
  const hh = Math.floor(totalMs / 3600000);
  const mm = Math.floor((totalMs % 3600000) / 60000);
  const ss = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function normalizeSectionName(raw) {
  return String(raw ?? "").trim().replace(/\s+/g, " ");
}

function sanitizeSubtitleMarkdownText(input) {
  const source = String(input ?? "").replace(/\r\n/g, "\n");
  if (!source) return "";
  let text = source;
  text = text.replace(/```[\s\S]*?```/gu, " ");
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/gu, "$1");
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/gu, "$1");
  text = text.replace(/`([^`]+)`/gu, "$1");
  text = text.replace(/^\s{0,3}>\s?/gmu, "");
  text = text.replace(/^\s{0,3}#{1,6}\s+/gmu, "");
  text = text.replace(/^\s{0,3}(?:[-*+]|\d+[.)])\s+/gmu, "");
  text = text.replace(/<[^>]+>/gu, " ");
  text = text.replace(/\*\*([^*]+)\*\*/gu, "$1");
  text = text.replace(/__([^_]+)__/gu, "$1");
  text = text.replace(/~~([^~]+)~~/gu, "$1");
  text = text.replace(/(^|[^\p{L}\p{N}])[*_~]+(?=[\p{L}\p{N}])/gu, "$1");
  text = text.replace(/(?<=[\p{L}\p{N}])[*_~]+(?=[^\p{L}\p{N}]|$)/gu, "");
  text = text.replace(/[\t ]+/gu, " ");
  text = text.replace(/ ?\n ?/gu, "\n");
  return text.trim();
}

function sanitizeSubtitleLine(line) {
  return sanitizeSubtitleMarkdownText(String(line ?? "")).replace(/\s+/gu, " ").trim();
}

const PROTECTED_DOT = "__PYA_DOT__";

function protectAbbreviationDots(input) {
  let text = String(input ?? "");
  // Common honorifics, civic titles, and shorthand forms that should not split sentences.
  text = text.replace(
    /\b(Mr|Mrs|Ms|Dr|Prof|Hon|Rev|Fr|Sr|Jr|Sgt|Capt|Col|Gen|Lt|St|Mt|No|Nos|Co|Corp|Inc|Ltd|Cllr|Counc)\./giu,
    (_, token) => `${token}${PROTECTED_DOT}`
  );
  // Time abbreviations.
  text = text.replace(/\b([ap])\.m\./giu, (_, token) => `${token}${PROTECTED_DOT}m.`);
  // Latin abbreviations and similar.
  text = text.replace(/\b(e)\.g\./giu, (_, token) => `${token}${PROTECTED_DOT}g${PROTECTED_DOT}`);
  text = text.replace(/\b(i)\.e\./giu, (_, token) => `${token}${PROTECTED_DOT}e${PROTECTED_DOT}`);
  text = text.replace(/\b(v)\.s\./giu, (_, token) => `${token}${PROTECTED_DOT}s${PROTECTED_DOT}`);
  text = text.replace(/\b(etc)\./giu, (_, token) => `${token}${PROTECTED_DOT}`);
  // Initials and dotted acronyms (e.g., "A. Smith", "U.S.A.").
  text = text.replace(/\b([A-Z])\.(?=\s*[A-Z]\b|\s+[A-Z][a-z])/gu, (_, token) => `${token}${PROTECTED_DOT}`);
  text = text.replace(/\b(?:[A-Z]\.){2,}/gu, (match) => match.replace(/\./g, PROTECTED_DOT));
  return text;
}

function restoreProtectedDots(input) {
  return String(input ?? "").replace(new RegExp(PROTECTED_DOT, "g"), ".");
}

function splitNaturalSentences(text) {
  const source = String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!source) return [];
  const safeSource = protectAbbreviationDots(source);

  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
    const out = [];
    for (const segment of segmenter.segment(safeSource)) {
      const s = restoreProtectedDots(String(segment?.segment ?? "")).trim();
      if (s) out.push(s);
    }
    if (out.length) return out;
  }

  return safeSource
    .split(/(?<=[.!?])\s+/u)
    .map((entry) => restoreProtectedDots(String(entry || "")).trim())
    .filter(Boolean);
}

function splitLongLineByWords(line, maxWords = MAX_SENTENCE_WORDS) {
  const words = String(line || "").split(/\s+/u).map((x) => x.trim()).filter(Boolean);
  if (words.length <= maxWords) return [String(line || "").trim()].filter(Boolean);
  const out = [];
  for (let i = 0; i < words.length; i += maxWords) {
    out.push(words.slice(i, i + maxWords).join(" "));
  }
  return out;
}

function splitLongSentence(line, maxWords = MAX_SENTENCE_WORDS) {
  const source = String(line || "").replace(/\s+/gu, " ").trim();
  if (!source) return [];
  if (countWords(source) <= maxWords) return [source];

  const chunks = source
    .split(/(?<=[,;:])\s+/u)
    .map((x) => x.trim())
    .filter(Boolean);
  if (chunks.length > 1) {
    const out = [];
    let acc = "";
    let accWords = 0;
    for (const chunk of chunks) {
      const cw = countWords(chunk);
      if (!acc) {
        acc = chunk;
        accWords = cw;
        continue;
      }
      if (accWords + cw <= maxWords) {
        acc = `${acc} ${chunk}`;
        accWords += cw;
        continue;
      }
      out.push(acc);
      acc = chunk;
      accWords = cw;
    }
    if (acc) out.push(acc);
    return out.flatMap((entry) => splitLongLineByWords(entry, maxWords)).filter(Boolean);
  }
  return splitLongLineByWords(source, maxWords);
}

function enforceMaxSentenceWords(lines, maxWords = MAX_SENTENCE_WORDS) {
  const out = [];
  for (const line of Array.isArray(lines) ? lines : []) {
    const clean = String(line || "").trim();
    if (!clean) continue;
    out.push(...splitLongSentence(clean, maxWords));
  }
  return out.filter(Boolean);
}

function normalizeLyricsCuts(text, { includeSections = false, sentenceCues = false } = {}) {
  const source = sanitizeSubtitleMarkdownText(text);
  if (sentenceCues) {
    const rawLines = source
      .split("\n")
      .map((line) => sanitizeSubtitleLine(line))
      .filter(Boolean)
      .filter((line) => !/^\[[^\]]+\]$/u.test(line));
    const lineFirstCuts = rawLines.length > 0
      ? rawLines.flatMap((line) => splitNaturalSentences(line))
      : splitNaturalSentences(source);
    const sentenceCuts = trimAdjacentOverlapCuts(collapseEchoLyricCuts(
      enforceMaxSentenceWords(lineFirstCuts)
    ))
      .map((entry) => String(entry || "").trim())
      .filter(Boolean)
      .filter((line) => !/^\[[^\]]+\]$/u.test(line));
    if (sentenceCuts.length) return sentenceCuts;
  }

  const lines = source.split("\n");
  const lineCuts = [];
  let activeSection = "";

  for (const rawLine of lines) {
    const line = sanitizeSubtitleLine(rawLine);
    if (!line) continue;
    const sectionMatch = /^\[([^\]]+)\]$/u.exec(line);
    if (sectionMatch) {
      activeSection = sanitizeSubtitleLine(normalizeSectionName(sectionMatch[1]));
      continue;
    }
    const textLine = includeSections && activeSection ? `[${activeSection}] ${line}` : line;
    lineCuts.push(textLine);
  }
  if (lineCuts.length > 1) return lineCuts;

  const sentenceCuts = collapseEchoLyricCuts(
    splitNaturalSentences(source)
  )
    .flatMap((entry) => enforceMaxSentenceWords([entry]))
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .filter((line) => !/^\[[^\]]+\]$/u.test(line));
  return sentenceCuts;
}

function countWords(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return 0;
  return raw.split(/\s+/u).filter(Boolean).length;
}

function mergeTinyLyricCuts(cuts = [], { minWords = 5 } = {}) {
  const source = Array.isArray(cuts) ? cuts.map((x) => String(x || "").trim()).filter(Boolean) : [];
  if (source.length <= 1) return source;
  const out = [];
  for (let i = 0; i < source.length; i += 1) {
    const cur = source[i];
    const words = countWords(cur);
    if (words >= minWords) {
      out.push(cur);
      continue;
    }
    if (out.length > 0) {
      out[out.length - 1] = `${out[out.length - 1]} ${cur}`.replace(/\s+/gu, " ").trim();
      continue;
    }
    const next = source[i + 1];
    if (next) {
      source[i + 1] = `${cur} ${next}`.replace(/\s+/gu, " ").trim();
      continue;
    }
    out.push(cur);
  }
  return out;
}

function normalizeWord(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[`'’]/gu, "")
    .replace(/[^a-z0-9]+/gu, "");
}

const NUMBER_WORD_TO_INT = new Map([
  ["zero", 0], ["one", 1], ["two", 2], ["three", 3], ["four", 4], ["five", 5],
  ["six", 6], ["seven", 7], ["eight", 8], ["nine", 9], ["ten", 10], ["eleven", 11],
  ["twelve", 12], ["thirteen", 13], ["fourteen", 14], ["fifteen", 15], ["sixteen", 16],
  ["seventeen", 17], ["eighteen", 18], ["nineteen", 19], ["twenty", 20]
]);

function normalizeNumericWord(text) {
  const token = normalizeWord(text);
  if (!token) return "";
  if (/^\d+$/u.test(token)) return `#${String(Number(token))}`;
  if (NUMBER_WORD_TO_INT.has(token)) return `#${String(NUMBER_WORD_TO_INT.get(token))}`;
  return token;
}

function splitNormalizedWords(text) {
  return String(text ?? "")
    .split(/\s+/u)
    .map((word) => normalizeNumericWord(word))
    .filter(Boolean);
}

function hasLikelyTruncatedEcho(prevText = "", nextText = "") {
  const prev = splitNormalizedWords(prevText);
  const next = splitNormalizedWords(nextText);
  if (!prev.length || !next.length) return false;
  if (prev.length > 10 || next.length < 4) return false;
  if (prev.length > next.length) return false;

  const minOverlap = Math.max(3, prev.length - 1);
  for (let start = 0; start <= Math.min(2, next.length - minOverlap); start += 1) {
    const maxLen = Math.min(prev.length, next.length - start);
    for (let len = maxLen; len >= minOverlap; len -= 1) {
      const prevSlice = prev.slice(prev.length - len);
      const nextSlice = next.slice(start, start + len);
      let same = true;
      for (let i = 0; i < len; i += 1) {
        if (prevSlice[i] !== nextSlice[i]) {
          same = false;
          break;
        }
      }
      if (!same) continue;
      const extendsTail = (start + len) < next.length;
      const hasLeadIn = start > 0;
      if (extendsTail || hasLeadIn) return true;
    }
  }
  return false;
}

function collapseEchoLyricCuts(cuts = []) {
  const input = Array.isArray(cuts)
    ? cuts.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  if (input.length <= 1) return input;
  const out = [];
  for (let i = 0; i < input.length; i += 1) {
    const cur = input[i];
    const next = input[i + 1];
    if (next && hasLikelyTruncatedEcho(cur, next)) continue;
    out.push(cur);
  }
  return out;
}

function stripLeadingWords(text, count) {
  const words = String(text || "").split(/\s+/u).filter(Boolean);
  if (!words.length) return "";
  return words.slice(Math.max(0, Number(count) || 0)).join(" ").trim();
}

function trimAdjacentOverlapCuts(cuts = []) {
  const input = Array.isArray(cuts) ? cuts.map((x) => String(x || "").trim()).filter(Boolean) : [];
  if (input.length <= 1) return input;
  const out = [input[0]];
  const minOverlap = 4;
  for (let i = 1; i < input.length; i += 1) {
    const prev = String(out[out.length - 1] || "").trim();
    const cur = String(input[i] || "").trim();
    const prevWords = splitNormalizedWords(prev);
    const curWords = splitNormalizedWords(cur);
    if (prevWords.length < minOverlap || curWords.length < minOverlap) {
      out.push(cur);
      continue;
    }
    let overlap = 0;
    let leadSkip = 0;
    for (let skip = 0; skip <= 2; skip += 1) {
      const maxLen = Math.min(prevWords.length, curWords.length - skip);
      for (let len = maxLen; len >= minOverlap; len -= 1) {
        let same = true;
        for (let j = 0; j < len; j += 1) {
          if (!wordsRoughlyMatch(prevWords[prevWords.length - len + j], curWords[skip + j])) {
            same = false;
            break;
          }
        }
        if (same) {
          overlap = len;
          leadSkip = skip;
          break;
        }
      }
      if (overlap > 0) break;
    }
    if (overlap <= 0) {
      out.push(cur);
      continue;
    }
    const trimCount = leadSkip + overlap;
    const ratio = overlap / Math.max(1, curWords.length - leadSkip);
    if (ratio < 0.35) {
      out.push(cur);
      continue;
    }
    const trimmed = stripLeadingWords(cur, trimCount);
    if (countWords(trimmed) >= 2) out.push(trimmed);
  }
  return out;
}

function wordsRoughlyMatch(aRaw, bRaw) {
  const a = normalizeNumericWord(aRaw);
  const b = normalizeNumericWord(bRaw);
  if (!a || !b) return false;
  if (a === b) return true;
  if (wordsAliasMatch(a, b)) return true;
  if (a.length >= 4 && b.length >= 4) {
    if (a.endsWith("s") && a.slice(0, -1) === b) return true;
    if (b.endsWith("s") && b.slice(0, -1) === a) return true;
  }
  return false;
}

const WORD_ALIAS_GROUPS = [
  ["andrii", "andre", "andres", "andrae"],
  ["zvorygin", "again", "floridian"],
  ["owen", "all", "bowing"],
  ["neighbour", "neighbor"],
  ["neighbours", "neighbors"]
];

function wordsAliasMatch(a, b) {
  for (const group of WORD_ALIAS_GROUPS) {
    if (group.includes(a) && group.includes(b)) return true;
  }
  return false;
}

function sanitizeAsrTimingCuts(rawCuts) {
  const source = Array.isArray(rawCuts) ? rawCuts : [];
  return source
    .map((cut) => ({
      since: Number(cut?.since ?? 0),
      until: Number(cut?.until ?? Number(cut?.since ?? 0)),
      obText: String(cut?.obText ?? "").replace(/\s+/gu, " ").trim()
    }))
    .filter((cut) => cut.obText && Number.isFinite(cut.since) && Number.isFinite(cut.until) && cut.until > cut.since)
    .sort((a, b) => a.since - b.since || a.until - b.until);
}

function buildAsrCueGroups(timingCuts, {
  maxWords = MAX_ASR_GROUP_WORDS,
  maxChars = MAX_ASR_GROUP_CHARS
} = {}) {
  const cuts = sanitizeAsrTimingCuts(timingCuts);
  const groups = [];
  let active = null;

  function finish() {
    if (!active) return;
    active.until = Number(active.cues[active.cues.length - 1]?.until ?? active.until);
    active.asrText = active.cues.map((cue) => cue.obText).join(" ").replace(/\s+/gu, " ").trim();
    active.words = Math.max(1, countWords(active.asrText));
    active.chars = active.asrText.length;
    groups.push(active);
    active = null;
  }

  for (let cueIndex = 0; cueIndex < cuts.length; cueIndex += 1) {
    const cue = cuts[cueIndex];
    const cueWords = Math.max(1, countWords(cue.obText));
    const cueChars = String(cue.obText || "").length;
    if (!active) {
      active = {
        cueStartIndex: cueIndex,
        cueEndIndex: cueIndex,
        since: cue.since,
        until: cue.until,
        cues: [cue],
        words: cueWords,
        chars: cueChars
      };
      continue;
    }

    const overlapsActive = cue.since < active.until;
    const combinedWords = active.words + cueWords;
    const combinedChars = active.chars + 1 + cueChars;
    if (!overlapsActive && (combinedWords > maxWords || combinedChars > maxChars)) {
      finish();
      active = {
        cueStartIndex: cueIndex,
        cueEndIndex: cueIndex,
        since: cue.since,
        until: cue.until,
        cues: [cue],
        words: cueWords,
        chars: cueChars
      };
      continue;
    }

    active.cues.push(cue);
    active.cueEndIndex = cueIndex;
    active.until = cue.until;
    active.words = combinedWords;
    active.chars = combinedChars;
  }
  finish();
  return groups;
}

function lineMatchScore(lyricWords, asrWords) {
  const lyrics = Array.isArray(lyricWords) ? lyricWords.filter(Boolean) : [];
  const asr = Array.isArray(asrWords) ? asrWords.filter(Boolean) : [];
  if (!lyrics.length || !asr.length) return 0;
  let cursor = 0;
  let matched = 0;
  for (const lyricWord of lyrics) {
    for (let i = cursor; i < asr.length; i += 1) {
      if (wordsRoughlyMatch(lyricWord, asr[i])) {
        matched += 1;
        cursor = i + 1;
        break;
      }
    }
  }
  return matched / Math.max(1, lyrics.length);
}

function timingCutWords(cuts, start, end) {
  return cuts
    .slice(start, end)
    .flatMap((cut) => splitNormalizedWords(cut?.obText ?? ""));
}

function chooseSentenceCueEnd(line, cuts, startIndex, remainingLines) {
  const lyricWords = splitNormalizedWords(line);
  const lyricCount = Math.max(1, lyricWords.length);
  const maxEnd = Math.max(startIndex + 1, cuts.length - Math.max(0, remainingLines));
  const minEnd = startIndex + 1;
  const searchEnd = Math.min(maxEnd, startIndex + Math.max(lyricCount + 6, Math.ceil(lyricCount * 1.8) + 2));
  let best = null;

  const lineGapSeconds = Number(process.env.PYA_SRT_SENTENCE_CUE_LINE_GAP_SECONDS || 0.42);
  for (let end = minEnd; end <= searchEnd; end += 1) {
    const asrWords = timingCutWords(cuts, startIndex, end);
    const asrCount = Math.max(1, asrWords.length);
    const score = lineMatchScore(lyricWords, asrWords);
    const lengthPenalty = Math.abs(asrCount - lyricCount) / Math.max(asrCount, lyricCount) * 0.18;
    const value = score - lengthPenalty;
    const nextGap = end < cuts.length
      ? Number(cuts[end]?.since ?? 0) - Number(cuts[end - 1]?.until ?? 0)
      : 0;
    if (nextGap >= lineGapSeconds && score >= 0.35 && asrCount >= Math.max(1, Math.floor(lyricCount * 0.5))) {
      return end;
    }
    if (!best || value > best.value || (value === best.value && Math.abs(asrCount - lyricCount) < Math.abs(best.asrCount - lyricCount))) {
      best = { end, value, score, asrCount };
    }
  }

  if (best && best.score >= 0.45) return best.end;

  let words = 0;
  for (let end = minEnd; end <= maxEnd; end += 1) {
    words += Math.max(1, countWords(cuts[end - 1]?.obText ?? ""));
    if (words >= lyricCount) return end;
  }
  return maxEnd;
}

function flattenTimingWords(cuts) {
  const out = [];
  for (let cueIndex = 0; cueIndex < cuts.length; cueIndex += 1) {
    const words = splitNormalizedWords(cuts[cueIndex]?.obText ?? "");
    for (const word of words) out.push({ word, cueIndex });
  }
  return out;
}

function uniqueNgramPositions(words, size) {
  const positions = new Map();
  for (let i = 0; i <= words.length - size; i += 1) {
    const key = words.slice(i, i + size).join("\u0001");
    if (!positions.has(key)) positions.set(key, i);
    else positions.set(key, -1);
  }
  return positions;
}

function longestIncreasingAnchorChain(candidates) {
  const source = Array.isArray(candidates) ? candidates : [];
  if (!source.length) return [];
  const tails = [];
  const tailsAt = [];
  const previous = new Array(source.length).fill(-1);
  for (let i = 0; i < source.length; i += 1) {
    const value = Number(source[i].asrWordIndex);
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (tails[mid] < value) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) previous[i] = tailsAt[lo - 1];
    tails[lo] = value;
    tailsAt[lo] = i;
  }
  const out = [];
  let cursor = tailsAt[tails.length - 1];
  while (cursor >= 0) {
    out.push(source[cursor]);
    cursor = previous[cursor];
  }
  return out.reverse();
}

function buildDocumentWordAnchors(lines, flatWords, ngramSize = 4) {
  const lyricWords = [];
  const lineWordStarts = [];
  const lineWordEnds = [];
  for (const line of lines) {
    lineWordStarts.push(lyricWords.length);
    lyricWords.push(...splitNormalizedWords(line));
    lineWordEnds.push(lyricWords.length);
  }
  const asrWords = flatWords.map((entry) => entry.word);
  if (lyricWords.length < ngramSize || asrWords.length < ngramSize) {
    return { anchors: [], lineWordStarts, lineWordEnds, lyricWordCount: lyricWords.length, anchoredLyricWords: 0, coverageRatio: 0 };
  }
  const lyricPositions = uniqueNgramPositions(lyricWords, ngramSize);
  const asrPositions = uniqueNgramPositions(asrWords, ngramSize);
  const candidates = [];
  for (const [key, lyricWordIndex] of lyricPositions) {
    const asrWordIndex = asrPositions.get(key);
    if (lyricWordIndex < 0 || !Number.isInteger(asrWordIndex) || asrWordIndex < 0) continue;
    candidates.push({ lyricWordIndex, asrWordIndex });
  }
  candidates.sort((a, b) => a.lyricWordIndex - b.lyricWordIndex || a.asrWordIndex - b.asrWordIndex);
  const anchors = longestIncreasingAnchorChain(candidates);
  const covered = new Uint8Array(lyricWords.length);
  for (const anchor of anchors) {
    for (let offset = 0; offset < ngramSize && anchor.lyricWordIndex + offset < covered.length; offset += 1) {
      covered[anchor.lyricWordIndex + offset] = 1;
    }
  }
  const anchoredLyricWords = covered.reduce((sum, value) => sum + value, 0);
  return {
    anchors,
    lineWordStarts,
    lineWordEnds,
    lyricWordCount: lyricWords.length,
    anchoredLyricWords,
    coverageRatio: anchoredLyricWords / Math.max(1, lyricWords.length)
  };
}

function lowerBoundAnchor(anchors, lyricWordIndex) {
  let lo = 0;
  let hi = anchors.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (anchors[mid].lyricWordIndex < lyricWordIndex) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function estimateAsrWordIndexForLine(documentAnchors, lineIndex) {
  const { anchors, lineWordStarts, lineWordEnds } = documentAnchors;
  if (!anchors.length) return null;
  const lineStart = Number(lineWordStarts[lineIndex] ?? 0);
  const lineEnd = Number(lineWordEnds[lineIndex] ?? lineStart);
  const nextIndex = lowerBoundAnchor(anchors, lineStart);
  const next = anchors[nextIndex] ?? null;
  const previous = anchors[nextIndex - 1] ?? null;

  if (next && next.lyricWordIndex < lineEnd) {
    return next.asrWordIndex - (next.lyricWordIndex - lineStart);
  }
  if (previous && next && next.lyricWordIndex > previous.lyricWordIndex) {
    const ratio = (lineStart - previous.lyricWordIndex) / (next.lyricWordIndex - previous.lyricWordIndex);
    return previous.asrWordIndex + ratio * (next.asrWordIndex - previous.asrWordIndex);
  }
  if (previous) return previous.asrWordIndex + (lineStart - previous.lyricWordIndex);
  if (next) return next.asrWordIndex - (next.lyricWordIndex - lineStart);
  return null;
}

function lineStartAnchorScore(lyricWords, asrWords, wordIndex) {
  const lyrics = Array.isArray(lyricWords) ? lyricWords.filter(Boolean) : [];
  if (!lyrics.length || !Array.isArray(asrWords) || wordIndex >= asrWords.length) return 0;
  const windowEnd = Math.min(asrWords.length, wordIndex + Math.max(lyrics.length + 4, Math.ceil(lyrics.length * 1.8)));
  let cursor = wordIndex;
  let matched = 0;
  let firstMatched = false;
  let firstMatchOffset = null;
  for (let i = 0; i < lyrics.length; i += 1) {
    for (let j = cursor; j < windowEnd; j += 1) {
      if (!wordsRoughlyMatch(lyrics[i], asrWords[j]?.word)) continue;
      matched += 1;
      if (i === 0) {
        firstMatched = true;
        firstMatchOffset = j - wordIndex;
      }
      cursor = j + 1;
      break;
    }
  }
  const maxFirstWordSkip = Number(process.env.PYA_SRT_LINE_START_MAX_FIRST_WORD_SKIP || 0);
  if (!firstMatched || Number(firstMatchOffset) > maxFirstWordSkip) return 0;
  const ratio = matched / Math.max(1, lyrics.length);
  const cueDistance = cursor > wordIndex ? cursor - wordIndex : windowEnd - wordIndex;
  const distancePenalty = Math.max(0, cueDistance - lyrics.length) / Math.max(lyrics.length + 4, 1) * 0.08;
  return ratio + (firstMatched ? 0.18 : 0) - distancePenalty;
}

function chooseLineStartCueIndex(line, cuts, flatWords, startCueIndex, remainingLines) {
  const lyricWords = splitNormalizedWords(line);
  if (!lyricWords.length) return startCueIndex;
  const minWordIndex = Math.max(0, flatWords.findIndex((entry) => entry.cueIndex >= startCueIndex));
  if (minWordIndex < 0) return startCueIndex;
  const maxCueIndex = Math.max(startCueIndex, cuts.length - Math.max(1, remainingLines + 1));
  const configuredLookahead = Number(process.env.PYA_SRT_LINE_START_MAX_LOOKAHEAD_SECONDS || 0);
  const mayRecoverGlobally = lyricWords.length >= 4 && !(configuredLookahead > 0);
  const maxLookaheadSeconds = configuredLookahead > 0 ? configuredLookahead : 7.5;
  let searchCueLimit = maxCueIndex;
  if (!mayRecoverGlobally) {
    let timeCueLimit = startCueIndex;
    while (timeCueLimit + 1 < cuts.length && Number(cuts[timeCueLimit + 1]?.since ?? 0) - Number(cuts[startCueIndex]?.since ?? 0) <= maxLookaheadSeconds) {
      timeCueLimit += 1;
    }
    searchCueLimit = Math.min(cuts.length - 1, maxCueIndex, timeCueLimit);
  }
  let best = null;

  for (let wordIndex = minWordIndex; wordIndex < flatWords.length; wordIndex += 1) {
    const cueIndex = Number(flatWords[wordIndex]?.cueIndex ?? 0);
    if (cueIndex < startCueIndex) continue;
    if (cueIndex > searchCueLimit) break;
    if (!wordsRoughlyMatch(lyricWords[0], flatWords[wordIndex]?.word)) continue;
    const score = lineStartAnchorScore(lyricWords, flatWords, wordIndex);
    const elapsed = Math.max(0, Number(cuts[cueIndex]?.since ?? 0) - Number(cuts[startCueIndex]?.since ?? 0));
    const progressPenalty = Math.min(0.08, Math.log1p(elapsed) * 0.008);
    const value = score - progressPenalty;
    const strongScore = Number(process.env.PYA_SRT_LINE_START_STRONG_SCORE || 0.72);
    if (score >= strongScore) return Math.max(startCueIndex, cueIndex);
    if (!best || value > best.value || (value === best.value && cueIndex < best.cueIndex)) {
      best = { cueIndex, value, score };
    }
  }

  const minScore = Number(process.env.PYA_SRT_LINE_START_MIN_SCORE || 0.42);
  if (best && best.score >= minScore) return Math.max(startCueIndex, best.cueIndex);
  // startCueIndex is already the end predicted for the previous sentence. If
  // this sentence has been corrected enough that no literal start anchor can
  // be found, it must begin there. Advancing by its word count here would make
  // chooseSentenceCueEnd consume the same sentence a second time, creating
  // severe cumulative drift after editorial normalization.
  return startCueIndex;
}

function buildLineStartAnchors(lines, cuts, suppliedDocumentAnchors = null) {
  const flatWords = flattenTimingWords(cuts);
  const documentAnchors = suppliedDocumentAnchors ?? buildDocumentWordAnchors(lines, flatWords);
  const anchors = [];
  let cursorCue = 0;
  for (let i = 0; i < lines.length && cursorCue < cuts.length; i += 1) {
    const remainingLines = Math.max(0, lines.length - i - 1);
    const estimatedWordIndex = estimateAsrWordIndexForLine(documentAnchors, i);
    const estimatedCueIndex = Number.isFinite(estimatedWordIndex)
      ? Number(flatWords[Math.max(0, Math.min(flatWords.length - 1, Math.round(estimatedWordIndex)))]?.cueIndex)
      : null;
    const anchor = Number.isInteger(estimatedCueIndex)
      ? estimatedCueIndex
      : (i === 0 ? 0 : chooseLineStartCueIndex(lines[i], cuts, flatWords, cursorCue, remainingLines));
    const safeAnchor = Math.max(cursorCue, Math.min(cuts.length - 1, anchor));
    anchors.push(safeAnchor);
    cursorCue = safeAnchor + 1;
  }
  return anchors;
}

function buildSentenceCueTimingRows(lyricsCuts, timingCuts) {
  const lines = Array.isArray(lyricsCuts) ? lyricsCuts.map((line) => String(line || "").trim()).filter(Boolean) : [];
  const cuts = sanitizeAsrTimingCuts(timingCuts);
  if (!lines.length) throw new Error("lyrics to srt defective: no lyric lines");
  if (!cuts.length) throw new Error("lyrics to srt defective: no timing cuts");

  const documentAnchors = buildDocumentWordAnchors(lines, flattenTimingWords(cuts));
  const minCoverage = Number(process.env.PYA_SRT_MIN_DOCUMENT_ANCHOR_COVERAGE || 0.35);
  const minWordsForCoverageGate = Number(process.env.PYA_SRT_MIN_WORDS_FOR_ALIGNMENT_GATE || 200);
  if (
    documentAnchors.lyricWordCount >= minWordsForCoverageGate
    && documentAnchors.coverageRatio < minCoverage
  ) {
    throw new Error(
      `lyrics to srt defective: monotonic document anchor coverage ${documentAnchors.coverageRatio.toFixed(3)} is below ${minCoverage.toFixed(3)}`
    );
  }
  const anchors = buildLineStartAnchors(lines, cuts, documentAnchors);
  const rows = [];
  for (let i = 0; i < anchors.length; i += 1) {
    const startCueIndex = anchors[i];
    const nextCueIndex = i + 1 < anchors.length ? anchors[i + 1] : cuts.length;
    const endCueIndex = Math.max(startCueIndex, Math.min(cuts.length - 1, nextCueIndex - 1));
    const row = {
      index: rows.length + 1,
      since: Number(cuts[startCueIndex].since),
      until: Number(cuts[endCueIndex].until),
      text: lines[i],
      cueStartIndex: startCueIndex,
      cueEndIndex: endCueIndex
    };
    const previous = rows[rows.length - 1];
    if (previous && row.since < Number(previous.until) - 0.001) {
      previous.text = `${previous.text} ${row.text}`.replace(/\s+/gu, " ").trim();
      previous.until = Math.max(Number(previous.until), Number(row.until));
      previous.cueEndIndex = Math.max(Number(previous.cueEndIndex), Number(row.cueEndIndex));
    } else {
      rows.push(row);
    }
  }

  if (anchors.length < lines.length && rows.length) {
    rows[rows.length - 1].text = `${rows[rows.length - 1].text} ${lines.slice(anchors.length).join(" ")}`.replace(/\s+/gu, " ").trim();
  }
  rows.forEach((row, index) => { row.index = index + 1; });

  const validationErrors = validateAsrAnchoredRows(rows, rows, cuts);
  if (validationErrors.length) {
    throw new Error(`lyrics to srt defective: ${validationErrors.join("; ")}`);
  }

  return {
    rows,
    stats: {
      lines: lines.length,
      asrCues: cuts.length,
      asrGroups: rows.length,
      acceptedMatchLines: documentAnchors.anchoredLyricWords,
      lyricWords: documentAnchors.lyricWordCount,
      asrWords: flattenTimingWords(cuts).length,
      matchRatio: documentAnchors.coverageRatio,
      documentAnchorCount: documentAnchors.anchors.length,
      documentAnchoredLyricWords: documentAnchors.anchoredLyricWords,
      documentAnchorCoverageRatio: documentAnchors.coverageRatio,
      repeatedTailGroups: 0,
      firstAsrSeconds: Number(cuts[0].since),
      lastAsrSeconds: Number(cuts[cuts.length - 1].until),
      firstSubtitleSeconds: Number(rows[0]?.since ?? cuts[0].since),
      lastSubtitleSeconds: Number(rows[rows.length - 1]?.until ?? cuts[cuts.length - 1].until),
      uncoveredTailSeconds: Math.max(0, Number(cuts[cuts.length - 1].until) - Number(rows[rows.length - 1]?.until ?? 0)),
      maxUncoveredGapSeconds: rows.reduce((max, row, i) => {
        if (i === 0) return max;
        return Math.max(max, Math.max(0, Number(row.since) - Number(rows[i - 1].until)));
      }, 0),
      boundaryPolicy: "asr_monotonic_unique_ngram_anchors",
      mismatchPolicy: "lyric_text_with_asr_time"
    }
  };
}

function splitDisplayTextForGroups(lyricsCuts, groups) {
  const lines = Array.isArray(lyricsCuts) ? lyricsCuts.map((line) => String(line || "").trim()).filter(Boolean) : [];
  const words = lines.join(" ").split(/\s+/u).map((word) => word.trim()).filter(Boolean);
  const fallbackText = lines[lines.length - 1] || "";
  const totalGroups = Math.max(1, Array.isArray(groups) ? groups.length : 0);
  const totalAsrWords = Math.max(1, groups.reduce((sum, group) => sum + Math.max(1, Number(group?.words || 0)), 0));
  const out = [];
  let cursor = 0;
  let repeatedTailGroups = 0;

  for (let i = 0; i < totalGroups; i += 1) {
    const groupsLeft = totalGroups - i;
    const wordsLeft = words.length - cursor;
    if (wordsLeft <= 0) {
      out.push(fallbackText);
      repeatedTailGroups += 1;
      continue;
    }
    const minReserve = Math.max(0, groupsLeft - 1);
    const weightedWords = Math.round((Math.max(1, Number(groups[i]?.words || 1)) / totalAsrWords) * words.length);
    const take = Math.max(1, Math.min(wordsLeft - minReserve, weightedWords || 1));
    out.push(words.slice(cursor, cursor + take).join(" ").trim());
    cursor += take;
  }

  if (cursor < words.length && out.length) {
    out[out.length - 1] = `${out[out.length - 1]} ${words.slice(cursor).join(" ")}`.replace(/\s+/gu, " ").trim();
  }
  return { texts: out, repeatedTailGroups };
}

function alignmentScore(lyricsCuts, timingCuts) {
  const lyricWords = splitNormalizedWords(lyricsCuts.join(" "));
  const asrWords = splitNormalizedWords(timingCuts.map((cut) => cut.obText).join(" "));
  if (!lyricWords.length || !asrWords.length) return { matched: 0, lyricWords: lyricWords.length, asrWords: asrWords.length, ratio: 0 };
  let cursor = 0;
  let matched = 0;
  for (const lyricWord of lyricWords) {
    for (let i = cursor; i < asrWords.length; i += 1) {
      if (wordsRoughlyMatch(lyricWord, asrWords[i])) {
        matched += 1;
        cursor = i + 1;
        break;
      }
    }
  }
  return {
    matched,
    lyricWords: lyricWords.length,
    asrWords: asrWords.length,
    ratio: matched / Math.max(1, lyricWords.length)
  };
}

function validateAsrAnchoredRows(rows, groups, timingCuts) {
  const errors = [];
  if (!rows.length || !groups.length || !timingCuts.length) return errors;
  const firstAsr = Number(timingCuts[0].since);
  const lastAsr = Number(timingCuts[timingCuts.length - 1].until);
  const boundarySet = new Set();
  for (const cut of timingCuts) {
    boundarySet.add(Number(cut.since).toFixed(3));
    boundarySet.add(Number(cut.until).toFixed(3));
  }

  for (const row of rows) {
    if (Number(row.since) < firstAsr - 0.001) errors.push(`row ${row.index} starts before ASR timeline`);
    if (Number(row.until) > lastAsr + TRAILING_SILENCE_TOLERANCE_SECONDS + 0.001) errors.push(`row ${row.index} ends after ASR timeline`);
    if (!boundarySet.has(Number(row.since).toFixed(3))) errors.push(`row ${row.index} start is not an ASR cue boundary`);
    if (!boundarySet.has(Number(row.until).toFixed(3))) errors.push(`row ${row.index} end is not an ASR cue boundary`);
  }

  const tailGap = Math.max(0, lastAsr - Number(rows[rows.length - 1].until));
  if (tailGap > TRAILING_SILENCE_TOLERANCE_SECONDS) errors.push(`subtitle tail gap ${tailGap.toFixed(3)}s exceeds tolerance`);
  return errors;
}

function buildTimingRows(lyricsCuts, timingCuts, { sentenceCues = false } = {}) {
  if (sentenceCues) return buildSentenceCueTimingRows(lyricsCuts, timingCuts);

  const lines = Array.isArray(lyricsCuts) ? lyricsCuts : [];
  const cuts = sanitizeAsrTimingCuts(timingCuts);
  if (!lines.length) throw new Error("lyrics to srt defective: no lyric lines");
  if (!cuts.length) throw new Error("lyrics to srt defective: no timing cuts");

  const groups = buildAsrCueGroups(cuts);
  if (!groups.length) throw new Error("lyrics to srt defective: no ASR cue groups");

  const { texts, repeatedTailGroups } = splitDisplayTextForGroups(lines, groups);
  const rows = groups.map((group, i) => ({
    index: i + 1,
    since: Number(group.since),
    until: Number(group.until),
    text: texts[i] || texts[texts.length - 1] || lines[lines.length - 1] || "",
    cueStartIndex: group.cueStartIndex,
    cueEndIndex: group.cueEndIndex
  }));
  const score = alignmentScore(lines, cuts);
  const validationErrors = validateAsrAnchoredRows(rows, groups, cuts);
  if (validationErrors.length) {
    throw new Error(`lyrics to srt defective: ${validationErrors.join("; ")}`);
  }

  return {
    rows,
    stats: {
      lines: lines.length,
      asrCues: cuts.length,
      asrGroups: groups.length,
      acceptedMatchLines: score.matched,
      lyricWords: score.lyricWords,
      asrWords: score.asrWords,
      matchRatio: score.ratio,
      repeatedTailGroups,
      firstAsrSeconds: Number(cuts[0].since),
      lastAsrSeconds: Number(cuts[cuts.length - 1].until),
      firstSubtitleSeconds: Number(rows[0].since),
      lastSubtitleSeconds: Number(rows[rows.length - 1].until),
      uncoveredTailSeconds: Math.max(0, Number(cuts[cuts.length - 1].until) - Number(rows[rows.length - 1].until)),
      maxUncoveredGapSeconds: rows.reduce((max, row, i) => {
        if (i === 0) return max;
        return Math.max(max, Math.max(0, Number(row.since) - Number(rows[i - 1].until)));
      }, 0),
      boundaryPolicy: "asr_cue_boundaries_only",
      mismatchPolicy: "lyric_text_with_asr_time"
    }
  };
}

function deriveAlignmentReportPath(outputPath) {
  const text = String(outputPath || "").trim();
  if (!text) return "captions.alignment-report.json";
  return text.replace(/(?:\.srt)?$/iu, ".alignment-report.json");
}

async function main() {
  await runLyricsToSrt(process.argv.slice(2));
}

export async function runLyricsToSrt(args = process.argv.slice(2), {
  readFile = fs.readFile,
  writeFile = fs.writeFile,
  writeOut = (text) => process.stdout.write(text)
} = {}) {
  const includeSections = args.includes("--include-sections");
  const sentenceCues = args.includes("--sentence-cues");
  const positional = args.filter((part) => part !== "--include-sections" && part !== "--sentence-cues");
  const [lyricsPath, timingSrtPath, outputPath] = positional;
  if (!lyricsPath || !timingSrtPath || !outputPath) {
    throw new Error(usage());
  }

  const lyricsText = await readFile(lyricsPath, "utf8");
  const timingText = await readFile(timingSrtPath, "utf8");
  const lyricCuts = mergeTinyLyricCuts(
    normalizeLyricsCuts(lyricsText, { includeSections, sentenceCues }),
    {
      // Sentence-cue mode should preserve short utterances ("Thank you.", "Yes."),
      // otherwise cues balloon into long blocks and timing/speaker alignment drifts.
      minWords: sentenceCues
        ? Number(process.env.PYA_SRT_MIN_CUE_WORDS_SENTENCE || 1)
        : Number(process.env.PYA_SRT_MIN_CUE_WORDS || 5)
    }
  );
  let timingWordHints = null;
  if (sentenceCues) {
    // Keep timing progression tied to raw ASR word stream, not normalized text.
    const normalizedPath = String(lyricsPath || "");
    const siblingRawPath = normalizedPath.includes("-normalized.plain.txt")
      ? normalizedPath.replace("-normalized.plain.txt", ".plain.txt")
      : "";
    if (siblingRawPath) {
      try {
        const rawPlainText = await readFile(siblingRawPath, "utf8");
        const rawCuts = mergeTinyLyricCuts(
          normalizeLyricsCuts(rawPlainText, { includeSections, sentenceCues }),
          { minWords: Number(process.env.PYA_SRT_MIN_CUE_WORDS_SENTENCE || 1) }
        );
        if (Array.isArray(rawCuts) && rawCuts.length > 0) {
          const rawCounts = rawCuts.map((line) => Math.max(1, countWords(line)));
          if (rawCounts.length === lyricCuts.length) {
            timingWordHints = rawCounts;
          } else {
            // Keep timing anchored to raw text even when sentence split counts differ.
            const mapped = [];
            const den = Math.max(1, lyricCuts.length - 1);
            const rawDen = Math.max(1, rawCounts.length - 1);
            for (let i = 0; i < lyricCuts.length; i += 1) {
              const rawIdx = Math.max(0, Math.min(rawCounts.length - 1, Math.round((i * rawDen) / den)));
              mapped.push(Math.max(1, Number(rawCounts[rawIdx] || 1)));
            }
            timingWordHints = mapped;
          }
        }
      } catch {
        // fallback: no hints
      }
    }
  }
  const timingCuts = parseSrtToCuts(timingText);
  const aligned = buildTimingRows(lyricCuts, timingCuts, { sentenceCues, timingWordHints });
  const finalRows = aligned.rows;
  const stats = aligned.stats ?? {};

  const out = [];
  for (const row of finalRows) {
    out.push(String(row.index));
    out.push(`${formatSrtTime(row.since)} --> ${formatSrtTime(row.until)}`);
    out.push(String(row.text));
    out.push("");
  }
  await writeFile(outputPath, `${out.join("\n")}\n`, "utf8");
  await writeFile(deriveAlignmentReportPath(outputPath), `${JSON.stringify({
    generatedBy: "lyrics_to_srt_from_timing",
    timingAuthority: "asr",
    subtitleBoundaryContract: "group start/end are exact ASR cue boundaries",
    outputPath,
    lyricsPath,
    timingSrtPath,
    includeSections,
    sentenceCues,
    ...stats
  }, null, 2)}\n`, "utf8");
  writeOut(`${outputPath}\n`);
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return process.argv[1] === fileURLToPath(import.meta.url);
  }
}

if (isMainModule()) {
  main().catch((err) => {
    process.stderr.write(`${err?.message ?? String(err)}\n`);
    process.exit(1);
  });
}

#!/usr/bin/env node
import fs from "node:fs/promises";
import { parseSrtToCuts } from "./itinerary_io.mjs";

const MAX_GAP_TRIM_SECONDS = (() => {
  const raw = Number(process.env.PYA_TIMING_MAX_GAP_TRIM_SECONDS || 0);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
})();
const MAX_SENTENCE_WORDS = (() => {
  const raw = Number(process.env.PYA_SRT_MAX_SENTENCE_WORDS || 36);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 36;
})();
const MAX_DRIFT_SECONDS = (() => {
  const raw = Number(process.env.PYA_SRT_MAX_DRIFT_SECONDS || 1.5);
  return Number.isFinite(raw) && raw > 0 ? raw : 1.5;
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
  const source = String(text ?? "");
  if (sentenceCues) {
    const sentenceCuts = collapseEchoLyricCuts(
      enforceMaxSentenceWords(splitNaturalSentences(source))
    )
      .map((entry) => String(entry || "").trim())
      .filter(Boolean)
      .filter((line) => !/^\[[^\]]+\]$/u.test(line));
    if (sentenceCuts.length) return sentenceCuts;
  }

  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const lineCuts = [];
  let activeSection = "";

  for (const rawLine of lines) {
    const line = String(rawLine || "").trim();
    if (!line) continue;
    const sectionMatch = /^\[([^\]]+)\]$/u.exec(line);
    if (sectionMatch) {
      activeSection = normalizeSectionName(sectionMatch[1]);
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

function splitNormalizedWords(text) {
  return String(text ?? "")
    .split(/\s+/u)
    .map((word) => normalizeWord(word))
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

function wordsRoughlyMatch(aRaw, bRaw) {
  const a = normalizeWord(aRaw);
  const b = normalizeWord(bRaw);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4) {
    if (a.endsWith("s") && a.slice(0, -1) === b) return true;
    if (b.endsWith("s") && b.slice(0, -1) === a) return true;
  }
  return false;
}

function buildTimingTokens(cuts = []) {
  const tokens = [];
  for (const cut of cuts) {
    const since = Number(cut?.since ?? 0);
    const until = Number(cut?.until ?? since);
    const words = String(cut?.obText ?? "").split(/\s+/u).filter(Boolean);
    for (const word of words) {
      tokens.push({
        word,
        normalized: normalizeWord(word),
        since,
        until
      });
    }
  }
  return tokens.filter((token) => token.normalized);
}

function sanitizeTimingCuts(rawCuts, { sentenceCues = false } = {}) {
  const source = Array.isArray(rawCuts) ? rawCuts : [];
  const cuts = source
    .map((cut) => ({
      since: Number(cut?.since ?? 0),
      until: Number(cut?.until ?? Number(cut?.since ?? 0)),
      obText: String(cut?.obText ?? "")
    }))
    .filter((cut) => Number.isFinite(cut.since) && Number.isFinite(cut.until))
    .sort((a, b) => a.since - b.since || a.until - b.until);
  if (!cuts.length) return [];
  const out = [];
  if (sentenceCues) {
    for (const cut of cuts) {
      const since = Math.max(0, cut.since);
      const until = Math.max(since + 0.001, Number(cut.until));
      out.push({ since, until, obText: cut.obText });
    }
    return out;
  }
  let prevEnd = 0;
  for (const cut of cuts) {
    const rawSince = Math.max(0, cut.since);
    const rawUntil = Math.max(rawSince + 0.04, Number(cut.until));
    // Keep canonical source timeline anchors.
    // If chunk overlap produced overlapping cues, trim only the overlapped head
    // while preserving the original absolute end timestamp.
    let since = rawSince;
    let until = rawUntil;
    if (since < prevEnd) {
      since = prevEnd;
      if (until <= since + 0.001) continue;
    }
    // Optional gap trim remains conservative and never stretches cue duration.
    if (MAX_GAP_TRIM_SECONDS > 0 && out.length > 0) {
      const maxGap = Math.max(0, MAX_GAP_TRIM_SECONDS);
      const gap = Math.max(0, since - prevEnd);
      if (gap > maxGap) {
        const shift = gap - maxGap;
        since -= shift;
        until -= shift;
      }
    }
    if (until <= since + 0.001) continue;
    out.push({ since, until, obText: cut.obText });
    prevEnd = until;
  }
  return out;
}

function buildTimingRows(lyricsCuts, timingCuts, { sentenceCues = false } = {}) {
  const lines = Array.isArray(lyricsCuts) ? lyricsCuts : [];
  const cuts = sanitizeTimingCuts(timingCuts, { sentenceCues });
  if (!lines.length) throw new Error("lyrics to srt defective: no lyric lines");
  if (!cuts.length) throw new Error("lyrics to srt defective: no timing cuts");

  const totalTimingWords = Math.max(1, cuts.reduce((sum, cut) => sum + Math.max(1, countWords(cut?.obText)), 0));
  const totalLyricWords = Math.max(1, lines.reduce((sum, line) => sum + Math.max(1, countWords(line)), 0));

  const cueWordPositions = [];
  let runningTimingWords = 0;
  for (const cut of cuts) {
    const words = Math.max(1, countWords(cut?.obText));
    const since = Number(cut?.since ?? 0);
    const until = Number(cut?.until ?? since);
    cueWordPositions.push({ since, until, startWord: runningTimingWords, endWord: runningTimingWords + words });
    runningTimingWords += words;
  }

  function wordToTime(wordPos) {
    const clamped = Math.max(0, Math.min(totalTimingWords, wordPos));
    for (const cue of cueWordPositions) {
      if (clamped <= cue.endWord) {
        const spanWords = Math.max(1, cue.endWord - cue.startWord);
        const p = Math.max(0, Math.min(1, (clamped - cue.startWord) / spanWords));
        return cue.since + ((cue.until - cue.since) * p);
      }
    }
    return cueWordPositions[cueWordPositions.length - 1].until;
  }

  let rows = [];
  const tokens = buildTimingTokens(cuts);
  const tokenAt = (idx) => tokens[Math.max(0, Math.min(tokens.length - 1, Number(idx) || 0))] || null;
  const totalLineCount = lines.length;
  const SENTENCE_MIN_PHRASE_SCORE = (() => {
    const raw = Number(process.env.PYA_SRT_SENTENCE_MIN_PHRASE_SCORE || 0.34);
    return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 0.34;
  })();
  let unmatchedSentenceLines = 0;
  let tokenCursor = 0;
  let runningLyricWords = 0;
  let acceptedMatchLines = 0;
  const avgTimingWordsPerLine = Math.max(1, Math.floor(totalTimingWords / Math.max(1, lines.length)));
  const maxIndexDrift = Math.max(24, avgTimingWordsPerLine * 4);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const words = Math.max(1, countWords(line));
    if (sentenceCues && tokenCursor >= tokens.length && i < (totalLineCount - 1)) {
      throw new Error(
        `lyrics to srt defective: timing tokens exhausted at line=${i + 1}/${totalLineCount} token_cursor=${tokenCursor} tokens=${tokens.length}`
      );
    }
    const startTimingWord = sentenceCues
      ? Math.max(0, Math.min(totalTimingWords, tokenCursor))
      : (runningLyricWords / totalLyricWords) * totalTimingWords;
    runningLyricWords += words;
    const endTimingWord = sentenceCues
      ? Math.max(startTimingWord + 1, Math.min(totalTimingWords, startTimingWord + words))
      : (i === lines.length - 1
        ? totalTimingWords
        : (runningLyricWords / totalLyricWords) * totalTimingWords);
    let since = wordToTime(startTimingWord);
    let until = Math.max(since + 0.06, wordToTime(endTimingWord));
    let matchedSince = null;
    let matchedUntil = null;
    const expectedTokenIndex = sentenceCues
      ? Math.max(0, Math.min(tokens.length - 1, tokenCursor))
      : Math.max(0, Math.min(tokens.length - 1, Math.floor(startTimingWord)));
    const lineWords = splitNormalizedWords(line);
    if (sentenceCues && tokens.length) {
      const cursorStart = Math.max(0, Math.min(tokens.length - 1, tokenCursor));
      const lineLen = Math.max(1, lineWords.length);
      let chosenFirst = cursorStart;
      const here = tokens[chosenFirst]?.normalized || "";
      const prevNorm = tokens[Math.max(0, chosenFirst - 1)]?.normalized || "";
      const nextNorm = tokens[Math.min(tokens.length - 1, chosenFirst + 1)]?.normalized || "";
      const firstWord = lineWords[0] || "";
      if (firstWord) {
        const hereOk = wordsRoughlyMatch(firstWord, here);
        const prevOk = wordsRoughlyMatch(firstWord, prevNorm);
        const nextOk = wordsRoughlyMatch(firstWord, nextNorm);
        if (!hereOk && prevOk) chosenFirst = Math.max(0, chosenFirst - 1);
        else if (!hereOk && nextOk) chosenFirst = Math.min(tokens.length - 1, chosenFirst + 1);
      }
      const scoreLen = Math.min(6, lineLen, Math.max(1, tokens.length - chosenFirst));
      let matched = 0;
      for (let wi = 0; wi < scoreLen; wi += 1) {
        const lw = lineWords[wi] || "";
        if (lw && wordsRoughlyMatch(lw, tokens[chosenFirst + wi].normalized)) matched += 1;
      }
      const bestScore = scoreLen > 0 ? (matched / scoreLen) : 1;
      const minScore = lineLen <= 3
        ? 0.0
        : lineLen <= 6
          ? 0.34
          : SENTENCE_MIN_PHRASE_SCORE;
      if (bestScore < minScore) unmatchedSentenceLines += 1;

      const chosenLast = Math.max(chosenFirst, Math.min(tokens.length - 1, chosenFirst + lineLen - 1));
      if (chosenFirst >= tokens.length || chosenLast >= tokens.length) {
        throw new Error(
          `lyrics to srt defective: sentence token anchor out of range line=${i + 1}/${totalLineCount} first=${chosenFirst} last=${chosenLast} tokens=${tokens.length}`
        );
      }
      const firstTok = tokenAt(chosenFirst);
      const lastTok = tokenAt(chosenLast);
      if (!firstTok || !lastTok) {
        throw new Error(
          `lyrics to srt defective: missing token anchors line=${i + 1}/${totalLineCount} first=${chosenFirst} last=${chosenLast}`
        );
      }
      const anchorSince = Math.max(0, Number(firstTok.since ?? since));
      const anchorUntil = Math.max(anchorSince + 0.001, Number(lastTok.until ?? until));
      since = anchorSince;
      until = anchorUntil;
      matchedSince = since;
      matchedUntil = until;
      acceptedMatchLines += 1;
      if (since > anchorSince + 1e-6) {
        throw new Error(
          `lyrics to srt defective: sentence starts after first timing word line=${i + 1}/${totalLineCount}`
        );
      }
      if (until > anchorUntil + 1e-6) {
        throw new Error(
          `lyrics to srt defective: sentence ends after last timing word line=${i + 1}/${totalLineCount}`
        );
      }
      tokenCursor = Math.max(tokenCursor + 1, chosenLast + 1);
    } else if (lineWords.length && tokens.length) {
      let firstIdx = -1;
      let lastIdx = -1;
      let searchFrom = sentenceCues
        ? Math.max(0, tokenCursor - 8)
        : Math.max(tokenCursor, expectedTokenIndex - 80);
      for (const lyricWord of lineWords) {
        let found = -1;
        const maxScan = sentenceCues
          ? Math.min(tokens.length, tokenCursor + Math.max(120, lineWords.length * 12))
          : Math.min(tokens.length, expectedTokenIndex + 140);
        for (let j = searchFrom; j < maxScan; j += 1) {
          if (wordsRoughlyMatch(lyricWord, tokens[j].normalized)) {
            found = j;
            break;
          }
        }
        if (found >= 0) {
          if (firstIdx < 0) firstIdx = found;
          lastIdx = found;
          searchFrom = found + 1;
        }
      }
      if (firstIdx >= 0 && lastIdx >= firstIdx) {
        const candidateSince = Number(tokens[firstIdx].since ?? since);
        const candidateUntil = Math.max(candidateSince + 0.06, Number(tokens[lastIdx].until ?? until));
        const matchedSpan = candidateUntil - candidateSince;
        const fallbackSpan = Math.max(0.06, until - since);
        const indexDrift = Math.abs(firstIdx - expectedTokenIndex);
        const matchedTokenSpan = (lastIdx - firstIdx) + 1;
        const maxLineTokenSpan = Math.max(24, lineWords.length * 6);
        const looksOutlier = matchedSpan > Math.max(12, fallbackSpan * 3.5);
        const looksTooFar = indexDrift > (sentenceCues ? Math.max(64, lineWords.length * 8) : maxIndexDrift);
        const looksTokenWide = matchedTokenSpan > maxLineTokenSpan;
        const looksCompressed = matchedSpan < Math.max(0.12, Math.min(2.5, fallbackSpan * 0.20));
        const timeDrift = Math.abs(candidateSince - since);
        const looksTimeDrifted = timeDrift > (sentenceCues ? Math.max(4, fallbackSpan * 1.5) : Math.max(8, fallbackSpan * 2.5));
        if (!looksOutlier && !looksTooFar && !looksTokenWide && !looksCompressed && !looksTimeDrifted) {
          since = candidateSince;
          until = candidateUntil;
          matchedSince = since;
          matchedUntil = until;
          tokenCursor = Math.max(tokenCursor, lastIdx + 1);
          acceptedMatchLines += 1;
        }
      }
    }
    // sentenceCues cursor progression is strictly controlled by matched token indices.
    rows.push({
      index: i + 1,
      since,
      until,
      text: line,
      matchedSince: Number.isFinite(matchedSince) ? matchedSince : null,
      matchedUntil: Number.isFinite(matchedUntil) ? matchedUntil : null,
    });
  }
  if (!sentenceCues) {
    for (const row of rows) {
      const wordCount = Math.max(1, countWords(row.text));
      const duration = Math.max(0, Number(row.until) - Number(row.since));
      const minLineDuration = wordCount <= 3 ? 0.6 : Math.min(2.4, 0.28 * wordCount);
      const maxLineDuration = Math.max(4.5, Math.min(9.5, 1.25 * wordCount));
      if (duration < minLineDuration) {
        row.until = Number(row.since) + minLineDuration;
        continue;
      }
      if (duration > maxLineDuration) {
        row.until = Number(row.since) + maxLineDuration;
      }
    }
  }
  const timelineStart = Number(cueWordPositions[0]?.since ?? 0);
  const timelineEnd = Number(cueWordPositions[cueWordPositions.length - 1]?.until ?? timelineStart);
  const minLineSeconds = sentenceCues ? 0.001 : 0.10;

  let prevEnd = timelineStart;
  if (sentenceCues) {
    rows = rows
      .map((row) => {
        const since = Math.max(timelineStart, Number(row.since ?? 0));
        const until = Math.max(since + minLineSeconds, Number(row.until ?? since + minLineSeconds));
        return { ...row, since, until };
      })
      .filter((row) => Number.isFinite(row.since) && Number.isFinite(row.until));
  } else {
    for (const row of rows) {
      row.since = Math.max(prevEnd, Number(row.since ?? 0));
      row.until = Math.max(row.since + minLineSeconds, Number(row.until ?? row.since + minLineSeconds));
      prevEnd = row.until;
    }
  }
  if (!sentenceCues && rows.length && Math.abs(prevEnd - timelineEnd) > 0.25) {
    const currentSpan = Math.max(0.01, prevEnd - timelineStart);
    const targetSpan = Math.max(0.01, timelineEnd - timelineStart);
    const scale = targetSpan / currentSpan;
    let cursor = timelineStart;
    for (const row of rows) {
      const scaledSince = timelineStart + ((row.since - timelineStart) * scale);
      const scaledUntil = timelineStart + ((row.until - timelineStart) * scale);
      const scaledMin = sentenceCues
        ? Math.min(0.8, Math.max(0.08, 0.06 * Math.max(1, countWords(row.text))))
        : Math.min(1.8, Math.max(0.22, 0.18 * Math.max(1, countWords(row.text))));
      row.since = Math.max(cursor, scaledSince);
      row.until = Math.max(row.since + scaledMin, scaledUntil);
      cursor = row.until;
    }
    rows[rows.length - 1].until = timelineEnd;
  }

  // Final stabilization pass: ensure post-scale rows remain readable in karaoke mode.
  if (!sentenceCues) {
    let stabilizeCursor = timelineStart;
    for (const row of rows) {
      const words = Math.max(1, countWords(row.text));
      const minReadable = Math.min(1.8, Math.max(0.22, 0.18 * words));
      row.since = Math.max(stabilizeCursor, Number(row.since ?? 0));
      row.until = Math.max(row.since + minReadable, Number(row.until ?? row.since + minReadable));
      stabilizeCursor = row.until;
    }
    if (rows.length && stabilizeCursor > timelineEnd) {
      const overflow = stabilizeCursor - timelineEnd;
      const adjustable = rows.map((row) => {
        const words = Math.max(1, countWords(row.text));
        const minReadable = Math.min(1.8, Math.max(0.22, 0.18 * words));
        const duration = Math.max(0, Number(row.until) - Number(row.since));
        return Math.max(0, duration - minReadable);
      });
      const totalAdjustable = adjustable.reduce((sum, value) => sum + value, 0);
      if (totalAdjustable > 0) {
        const shrinkRatio = Math.min(1, overflow / totalAdjustable);
        let cursor = timelineStart;
        for (let i = 0; i < rows.length; i += 1) {
          const row = rows[i];
          const words = Math.max(1, countWords(row.text));
          const minReadable = Math.min(1.8, Math.max(0.22, 0.18 * words));
          const duration = Math.max(0, Number(row.until) - Number(row.since));
          const shrink = adjustable[i] * shrinkRatio;
          const nextDuration = Math.max(minReadable, duration - shrink);
          row.since = Math.max(cursor, Number(row.since));
          row.until = row.since + nextDuration;
          cursor = row.until;
        }
      }
      if (rows.length) {
        rows[rows.length - 1].until = timelineEnd;
      }
    }
  }

  const driftRows = Array.isArray(rows) ? rows : [];
  let maxDrift = 0;
  let driftCount = 0;
  let worst = null;
  for (const row of driftRows) {
    const ms = row?.matchedSince;
    const mu = row?.matchedUntil;
    if (!Number.isFinite(ms) || !Number.isFinite(mu)) continue;
    const dSince = sentenceCues
      ? Math.max(0, ms - Number(row.since))
      : Math.abs(Number(row.since) - ms);
    const dUntil = Math.abs(Number(row.until) - mu);
    maxDrift = Math.max(maxDrift, dSince, dUntil);
    if (!worst || Math.max(dSince, dUntil) > worst.max) {
      worst = {
        max: Math.max(dSince, dUntil),
        since: Number(row.since),
        until: Number(row.until),
        matchedSince: ms,
        matchedUntil: mu,
        text: String(row?.text || "").slice(0, 120),
      };
    }
    driftCount += 1;
  }
  if (sentenceCues && driftCount > 0 && maxDrift > MAX_DRIFT_SECONDS) {
    throw new Error(
      `lyrics to srt defective: timing drift max=${maxDrift.toFixed(3)}s threshold=${MAX_DRIFT_SECONDS.toFixed(3)}s matched=${driftCount}` +
      (worst
        ? ` worst_since=${worst.since.toFixed(3)} worst_until=${worst.until.toFixed(3)} matched_since=${worst.matchedSince.toFixed(3)} matched_until=${worst.matchedUntil.toFixed(3)} text="${worst.text}"`
        : "")
    );
  }

  const collapsedRows = collapseDuplicateMicroCues(rows);
  if (sentenceCues) {
    const maxUnmatchedRatio = (() => {
      const raw = Number(process.env.PYA_SRT_MAX_UNMATCHED_SENTENCE_RATIO || -1);
      return Number.isFinite(raw) ? raw : -1;
    })();
    if (totalLineCount > 0) {
      const unmatchedRatio = unmatchedSentenceLines / totalLineCount;
      if (maxUnmatchedRatio >= 0 && unmatchedRatio > maxUnmatchedRatio) {
        throw new Error(
          `lyrics to srt defective: sentence matching weak unmatched=${unmatchedSentenceLines}/${totalLineCount} ratio=${unmatchedRatio.toFixed(3)} max=${maxUnmatchedRatio.toFixed(3)}`
        );
      }
    }
  }
  return {
    rows: collapsedRows,
    stats: {
      lines: lines.length,
      acceptedMatchLines,
      maxDriftSeconds: maxDrift,
      matchedForDrift: driftCount,
    }
  };
}

function collapseDuplicateMicroCues(rows = []) {
  const input = Array.isArray(rows) ? rows : [];
  if (input.length <= 1) return input;
  const out = [];
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
  for (const row of input) {
    const prev = out[out.length - 1];
    if (!prev) {
      out.push({ ...row });
      continue;
    }
    const prevText = norm(prev.text);
    const curText = norm(row.text);
    const prevWords = countWords(prev.text);
    const curWords = countWords(row.text);
    const contiguous = Math.abs(Number(row.since) - Number(prev.until)) <= 1.2;
    const tiny = prevWords <= 4 && curWords <= 4;
    if (tiny && contiguous && prevText && prevText === curText) {
      prev.until = Math.max(Number(prev.until), Number(row.until));
      if (Number.isFinite(prev.matchedSince) && Number.isFinite(row.matchedSince)) {
        prev.matchedSince = Math.min(Number(prev.matchedSince), Number(row.matchedSince));
      }
      if (Number.isFinite(prev.matchedUntil) && Number.isFinite(row.matchedUntil)) {
        prev.matchedUntil = Math.max(Number(prev.matchedUntil), Number(row.matchedUntil));
      }
      continue;
    }
    out.push({ ...row });
  }
  for (let i = 0; i < out.length; i += 1) out[i].index = i + 1;
  return out;
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
  const timingCuts = parseSrtToCuts(timingText);
  const aligned = buildTimingRows(lyricCuts, timingCuts, { sentenceCues });
  const finalRows = aligned.rows;
  const stats = aligned.stats ?? {
    lines: finalRows.length,
    acceptedMatchLines: sentenceCues ? finalRows.length : 0
  };
  const lineCount = Number(stats.lines || 0);
  const ratioRaw = sentenceCues
    ? Number(process.env.PYA_SRT_MIN_ACCEPT_RATIO_SENTENCE || 0.65)
    : Number(process.env.PYA_SRT_MIN_ACCEPT_RATIO || 0.35);
  const ratio = Number.isFinite(ratioRaw) && ratioRaw > 0 && ratioRaw <= 1 ? ratioRaw : (sentenceCues ? 0.01 : 0.35);
  const allowMismatchFallbackRaw = String(process.env.PYA_SRT_ALLOW_MISMATCH_FALLBACK || "true").trim().toLowerCase();
  const allowMismatchFallback = allowMismatchFallbackRaw !== "false" && allowMismatchFallbackRaw !== "0" && allowMismatchFallbackRaw !== "no";
  const minAccepted = lineCount <= 4
    ? 1
    : Math.max(2, Math.ceil(lineCount * ratio));
  if (Number(stats.acceptedMatchLines || 0) < minAccepted) {
    if (!allowMismatchFallback) {
      throw new Error(
        `lyrics to srt defective: lyrics mismatch accepted=${Number(stats.acceptedMatchLines || 0)} min=${minAccepted} lines=${Number(stats.lines || 0)}`
      );
    }
  }

  const out = [];
  for (const row of finalRows) {
    out.push(String(row.index));
    out.push(`${formatSrtTime(row.since)} --> ${formatSrtTime(row.until)}`);
    out.push(String(row.text));
    out.push("");
  }
  await writeFile(outputPath, `${out.join("\n")}\n`, "utf8");
  writeOut(`${outputPath}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    process.stderr.write(`${err?.message ?? String(err)}\n`);
    process.exit(1);
  });
}

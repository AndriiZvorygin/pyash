#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "../program/understand/index.mjs";
import { callPromptMind } from "./itinerary_promptify.mjs";

function usage() {
  return "Usage: node command/wise_chip_series_to_chapters.mjs <input.series.pya> <output_chapters.txt> [--max-words <num>]";
}

function parseArgs(argv) {
  if (argv.length < 2) throw new Error(usage());
  const out = {
    inputPath: argv[0],
    outputPath: argv[1],
    maxWords: 8,
    model: process.env.PYA_MIND_MODEL || "qwen3.5:9b",
    host: process.env.OLLAMA_HOST || "http://localhost:11434"
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--max-words") {
      out.maxWords = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--model") {
      out.model = String(argv[i + 1] ?? out.model);
      i += 1;
      continue;
    }
    if (arg === "--host") {
      out.host = String(argv[i + 1] ?? out.host);
      i += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  if (!Number.isFinite(out.maxWords) || out.maxWords < 2) throw new Error("max-words must be >= 2");
  return out;
}

function parseSeries(text) {
  const rows = [];
  const lines = String(text ?? "").split(/\r?\n/u);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    let sentence = null;
    try {
      sentence = parse(line);
    } catch {
      sentence = null;
    }
    if (!sentence?.su?.name) continue;
    if (typeof sentence?.ob?.text !== "string") continue;
    const since = Number(sentence?.since?.num ?? 0);
    const until = Number(sentence?.until?.num ?? since);
    rows.push({
      name: String(sentence.su.name ?? "").trim(),
      since,
      until,
      text: String(sentence.ob.text ?? "").replace(/\s+/gu, " ").trim()
    });
  }
  return rows;
}

function normalizeChips(chips) {
  const rows = Array.isArray(chips) ? [...chips] : [];
  if (rows.length <= 1) return rows;
  const last = rows[rows.length - 1];
  const prev = rows[rows.length - 2];
  const lastDuration = Math.max(0, Number(last?.until ?? 0) - Number(last?.since ?? 0));
  if (lastDuration > 30) return rows;
  rows[rows.length - 2] = {
    ...prev,
    until: Math.max(Number(prev?.until ?? 0), Number(last?.until ?? 0)),
    text: `${String(prev?.text ?? "").trim()} ${String(last?.text ?? "").trim()}`.replace(/\s+/gu, " ").trim()
  };
  rows.pop();
  return rows;
}

function secToClock(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds ?? 0)));
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function toTitle(text, maxWords) {
  const words = String(text ?? "")
    .replace(/[\[\](){}]/gu, " ")
    .replace(/[^\p{L}\p{N}'\-\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, maxWords);
  if (!words.length) return "Untitled Section";
  const mapped = words.map((word) => {
    if (!word) return word;
    return word.charAt(0).toUpperCase() + word.slice(1);
  });
  return mapped.join(" ");
}

function stripSpeakerTags(text) {
  return String(text ?? "").replace(/\[SPEAKER_[^\]]+\]\s*/gu, " ");
}

const CHAPTER_STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "if",
  "in", "into", "is", "it", "of", "on", "or", "so", "than", "that", "the",
  "their", "then", "these", "this", "those", "to", "we", "with", "why"
]);

function splitClauses(text) {
  return String(text ?? "")
    .split(/(?<=[.!?])\s+|;\s+|\s+-\s+|\s+--\s+/u)
    .map((part) => part.replace(/\s+/gu, " ").trim())
    .filter(Boolean);
}

function normalizeClause(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function dedupeClauses(text) {
  const seen = new Set();
  const out = [];
  for (const clause of splitClauses(stripSpeakerTags(text))) {
    const normalized = normalizeClause(clause);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(clause);
  }
  return out.join(" ").replace(/\s+/gu, " ").trim();
}

function fallbackTopicTitle(text, maxWords) {
  const cleaned = dedupeClauses(text)
    .replace(/\b(um|uh|okay|yeah|right|well|like|you know)\b/giu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return toTitle(cleaned, maxWords);
}

function titleTokens(text) {
  return String(text ?? "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function tokenJaccard(left, right) {
  const a = new Set(titleTokens(left));
  const b = new Set(titleTokens(right));
  if (!a.size && !b.size) return 1;
  let intersect = 0;
  for (const token of a) {
    if (b.has(token)) intersect += 1;
  }
  const union = new Set([...a, ...b]).size || 1;
  return intersect / union;
}

function deterministicChapterChecks({ title, previousTitle, nextTitle, maxWords }) {
  const issues = [];
  const trimmed = String(title ?? "").trim();
  const words = trimmed.split(/\s+/u).filter(Boolean);
  if (!trimmed) issues.push("Heading is empty.");
  if (/\bSPEAKER(?:_| )/iu.test(trimmed)) issues.push("Remove speaker labels.");
  if (words.length < 3) issues.push("Use at least 3 words.");
  if (words.length > Math.max(maxWords + 2, 10)) issues.push("Shorten the heading.");
  const lastWord = words[words.length - 1]?.toLowerCase() ?? "";
  if (CHAPTER_STOPWORDS.has(lastWord)) issues.push("Do not end on a dangling stopword.");
  if (/\b(?:okay|yeah|um|uh|livestream|love and peace)\b/iu.test(trimmed)) issues.push("Remove filler or housekeeping wording.");
  if (previousTitle && tokenJaccard(trimmed, previousTitle) > 0.6) issues.push("Differentiate it more from the previous heading.");
  if (nextTitle && tokenJaccard(trimmed, nextTitle) > 0.6) issues.push("Differentiate it more from the next heading.");
  return {
    pass: issues.length === 0,
    issues
  };
}

function sanitizeModelTitle(text, maxWords) {
  const firstLine = String(text ?? "").split(/\r?\n/u)[0] ?? "";
  const cleaned = firstLine
    .replace(/^["'`]+|["'`]+$/gu, "")
    .replace(/^\s*chapter\s*:\s*/iu, "")
    .replace(/^\s*title\s*:\s*/iu, "")
    .replace(/[^\p{L}\p{N}&'\/\-\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!cleaned) return "";
  const words = cleaned.split(" ").filter(Boolean);
  const limit = words.length > maxWords + 2 ? maxWords : words.length;
  return toTitle(words.slice(0, limit).join(" "), limit);
}

function buildChapterPrompt({ chip, previousChip, nextChip }) {
  const current = dedupeClauses(chip?.text ?? "");
  const previous = dedupeClauses(previousChip?.text ?? "");
  const next = dedupeClauses(nextChip?.text ?? "");
  return [
    "Create one concise YouTube chapter heading for this transcript section.",
    "Return only the heading text.",
    "Requirements: 3 to 7 words, title case, specific topic, no quotes, no speaker names, no filler, no sentence fragments.",
    "Prefer the main subject under discussion, not livestream housekeeping.",
    `Current section: ${current || "EMPTY"}`,
    `Previous section: ${previous || "EMPTY"}`,
    `Next section: ${next || "EMPTY"}`
  ].join("\n");
}

function chipPreview(text, maxWords = 24) {
  return dedupeClauses(text)
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, maxWords)
    .join(" ");
}

function buildBatchChapterPrompt({ chips }) {
  const lines = [
    "Create concise YouTube chapter headings for each transcript section.",
    "Return exactly one line per section in this format: NNN | Heading",
    "Rules: 3 to 8 words, title case, specific topic, no speaker names, no filler, no quotes, no extra commentary."
  ];
  for (let i = 0; i < chips.length; i += 1) {
    const chip = chips[i];
    lines.push(`${String(i + 1).padStart(3, "0")} | ${chipPreview(chip?.text ?? "")}`);
  }
  return lines.join("\n");
}

function parseBatchChapterTitles(text, count, maxWords) {
  const map = new Map();
  const lines = String(text ?? "").split(/\r?\n/u);
  for (const raw of lines) {
    const line = raw.trim();
    const match = line.match(/^(\d{1,3})\s*[|:-]\s*(.+)$/u);
    if (!match) continue;
    const index = Number(match[1]);
    if (!Number.isInteger(index) || index < 1 || index > count) continue;
    const title = sanitizeModelTitle(match[2], maxWords);
    if (title) map.set(index - 1, title);
  }
  return Array.from({ length: count }, (_, index) => map.get(index) ?? "");
}

function buildChapterRetryPrompt({ chip, previousChip, nextChip, feedback }) {
  return [
    buildChapterPrompt({ chip, previousChip, nextChip }),
    "",
    "REVISION_FEEDBACK:",
    String(feedback ?? "").trim() || "Make the heading more specific and cleaner."
  ].join("\n");
}

function buildChapterVerifyPrompt({ chip, title, previousTitle, nextTitle }) {
  const current = dedupeClauses(chip?.text ?? "");
  return [
    "Determine whether the HEADING is a strong YouTube chapter heading for the CURRENT_SECTION.",
    "Pass when the heading is concise, specific, grounded in the section, and distinct from neighboring headings.",
    "Fail when the heading is generic, clipped, repetitive, contains speaker/filler language, or does not match the section.",
    "Output one short reasoning paragraph and a final line exactly PASS or FAIL.",
    `CURRENT_SECTION: ${current || "EMPTY"}`,
    `HEADING: ${String(title ?? "").trim() || "EMPTY"}`,
    `PREVIOUS_HEADING: ${String(previousTitle ?? "").trim() || "EMPTY"}`,
    `NEXT_HEADING: ${String(nextTitle ?? "").trim() || "EMPTY"}`
  ].join("\n");
}

function buildVerdictPrompt(review) {
  return [
    "Read the verifier analysis and output exactly one word: PASS or FAIL.",
    "",
    "VERIFIER_ANALYSIS:",
    String(review ?? "").trim()
  ].join("\n");
}

async function verifyChapterTitle({ chip, title, previousTitle, nextTitle, maxWords, model, host }) {
  const deterministic = deterministicChapterChecks({ title, previousTitle, nextTitle, maxWords });
  const analysis = deterministic.pass
    ? "PASS"
    : deterministic.issues.join(" ");
  return {
    pass: deterministic.pass,
    analysis
  };
}

async function generateChapterTitle({ chip, previousChip, nextChip, maxWords, model, host }) {
  const fallback = fallbackTopicTitle(chip?.text ?? "", maxWords);
  let feedback = "";
  let best = fallback || "Untitled Section";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const title = await callPromptMind({
        host,
        model,
        systemPrompt: "You create compact YouTube chapter headings from transcript excerpts. Respond with one heading only. Do not explain. think false.",
        cutText: attempt === 1
          ? buildChapterPrompt({ chip, previousChip, nextChip })
          : buildChapterRetryPrompt({ chip, previousChip, nextChip, feedback })
      });
      const sanitized = sanitizeModelTitle(title, maxWords);
      if (sanitized) best = sanitized;
      const verified = await verifyChapterTitle({
        chip,
        title: best,
        previousTitle: "",
        nextTitle: "",
        maxWords,
        model,
        host
      });
      if (verified.pass) return best;
      feedback = verified.analysis || "Make the heading more specific and grounded in the section.";
    } catch {
      feedback = "Make the heading cleaner, specific, and concise.";
    }
  }
  return best || "Untitled Section";
}

async function generateInitialChapterTitles({ chips, maxWords, model, host }) {
  try {
    const raw = await callPromptMind({
      host,
      model,
      systemPrompt: "You write compact YouTube chapter headings for transcript sections. Output only numbered heading lines. think false.",
      cutText: buildBatchChapterPrompt({ chips })
    });
    const parsed = parseBatchChapterTitles(raw, chips.length, maxWords);
    return parsed.map((title, index) => title || fallbackTopicTitle(chips[index]?.text ?? "", maxWords) || "Untitled Section");
  } catch {
    return chips.map((chip) => fallbackTopicTitle(chip?.text ?? "", maxWords) || "Untitled Section");
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const seriesText = await fs.readFile(args.inputPath, "utf8");
  const chips = normalizeChips(parseSeries(seriesText));
  if (!chips.length) throw new Error("wise chip chapter defective: no wise chips found");

  const lines = [];
  const titles = [];
  for (let i = 0; i < chips.length; i += 1) {
    const chip = chips[i];
    titles.push(await generateChapterTitle({
      chip,
      previousChip: i > 0 ? chips[i - 1] : null,
      nextChip: i + 1 < chips.length ? chips[i + 1] : null,
      maxWords: args.maxWords,
      model: args.model,
      host: args.host
    }));
  }

  for (let i = 0; i < chips.length; i += 1) {
    const chip = chips[i];
    const ts = i === 0 ? "00:00:00" : secToClock(chip.since);
    let title = titles[i];
    let feedback = "";
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const verified = await verifyChapterTitle({
        chip,
        title,
        previousTitle: i > 0 ? titles[i - 1] : "",
        nextTitle: i + 1 < titles.length ? titles[i + 1] : "",
        maxWords: args.maxWords,
        model: args.model,
        host: args.host
      });
      if (verified.pass) break;
      feedback = verified.analysis || "Differentiate this heading from neighboring headings.";
      title = await generateChapterTitle({
        chip,
        previousChip: i > 0 ? chips[i - 1] : null,
        nextChip: i + 1 < chips.length ? chips[i + 1] : null,
        maxWords: args.maxWords,
        model: args.model,
        host: args.host
      });
      if (!feedback) break;
    }
    titles[i] = title;
    lines.push(`${ts} -- ${title}`);
  }

  await fs.mkdir(path.dirname(args.outputPath), { recursive: true });
  await fs.writeFile(args.outputPath, `${lines.join("\n")}\n`, "utf8");

  console.log(`chapters: ${lines.length}`);
  console.log(`output: ${args.outputPath}`);
}

export {
  parseSeries,
  normalizeChips,
  deterministicChapterChecks,
  sanitizeModelTitle,
  fallbackTopicTitle
};

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main().catch((err) => {
    console.error(String(err?.message || err));
    process.exit(1);
  });
}

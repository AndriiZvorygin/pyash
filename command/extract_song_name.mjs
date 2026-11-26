#!/usr/bin/env node
// The name of a song.
//
// The house asks the mind for the name of a song, and the mind answers in
// words. Those words are not always a name: they may carry quotes, a list
// marker, a label, a dash of explanation, or a whole sentence around the
// name. This command keeps the name and throws the rest away, so a song is
// tagged with a name and never with a paragraph.
//
// The name of a song is short by contract: at most ten words, one line, in
// title case. A reply that cannot be read as a name is not a name, and the
// house falls back on the line the song repeats.
//
// The input carries two parts, one after the other:
//
//   THE NAME THE MIND GAVE:
//   <what the mind said>
//
//   THE SHEET:
//   <the sheet of the song>
//
// The sheet is there for the fallback: the line the song sings again in every
// chorus is a name of its own, and it is always there.

import fs from "node:fs";

import { songHook } from "./song_hook.mjs";

export const MAX_NAME_WORDS = 10;
export const MIN_NAME_WORDS = 1;

const NAME_HEADING = "THE NAME THE MIND GAVE:";
const SHEET_HEADING = "THE SHEET:";

// The small words stay small in a title, unless they open or close it.
const SMALL_WORDS = new Set([
  "a", "an", "the", "and", "but", "or", "nor", "for", "so", "yet",
  "at", "by", "in", "of", "on", "to", "up", "as", "is", "it",
  "from", "with", "into", "over", "than", "that"
]);

// The furniture of a reply: words that talk about the answer instead of
// being the answer.
const REPLY_WORDS = new Set([
  "sure", "below", "above", "based", "overall", "think", "hope",
  "maybe", "perhaps", "honestly", "suggest", "suggests", "propose",
  "calling", "answer", "response", "output", "result"
]);

// The labels the mind puts in front of a name.
const LEADING_LABELS = [
  /^(?:the\s+)?song\s+name\s*[:\-–]\s*/iu,
  /^(?:the\s+)?(?:song\s+)?(?:name|title)\s*[:\-–]\s*/iu,
  /^(?:the\s+)?name\s+of\s+(?:this|the)\s+song\s+is\s*:?\s*/iu,
  /^(?:the\s+)?song\s+is\s+(?:called|named|titled)\s*/iu,
  /^(?:it\s+is\s+|i\s+would\s+call\s+it\s+)/iu
];

// The words that join two halves of a line: a name stops before them.
const CUT_WORDS = new Set([
  "and", "but", "while", "so", "when", "that", "where", "because", "as", "if"
]);

/**
 * The markdown and list furniture a reply may carry around its name.
 */
export function stripDecorations(line) {
  return String(line ?? "")
    .replace(/^\s*(?:[-*•]+|\d+[.)])\s+/u, "")
    .replace(/^[#>*_`\s]+/u, "")
    .replace(/[`*_]+$/u, "")
    .trim();
}

/**
 * The label in front of a name, if there is one.
 */
export function stripLabel(line) {
  let text = String(line ?? "").trim();
  for (const label of LEADING_LABELS) {
    const stripped = text.replace(label, "");
    if (stripped !== text) {
      text = stripped.trim();
      break;
    }
  }
  return text;
}

/**
 * The quotes and the punctuation around a name.
 */
export function stripWrapping(line) {
  return String(line ?? "")
    .replace(/^["'“”‘’`]+/u, "")
    .replace(/["'“”‘’`]+$/u, "")
    .replace(/[.!?,;:]+$/u, "")
    .trim();
}

/**
 * A word without the punctuation that stands around it.
 */
function bareWord(word) {
  return String(word ?? "").replace(/[^a-zA-Z']/gu, "").toLowerCase();
}

/**
 * The name in the words of a reply: the first line that reads as a name.
 *
 * The house reads a reply line by line. A line that carries a dash of
 * explanation is cut at the dash; a line that carries a label is cut at the
 * label. What is left is the name, and a name too long for a title keeps its
 * first clause.
 */
export function extractSongName(text) {
  const lines = String(text ?? "").split(/\r?\n/u);
  for (const line of lines) {
    const decorated = stripDecorations(line);
    if (!decorated) continue;
    const cut = decorated
      .split(/\s+(?:—|–|--)\s+/u)[0]
      .trim();
    const labelled = stripLabel(cut);
    // A line that still holds a colon or a question talks about the name
    // rather than being one: the name is on another line.
    if (labelled.includes(":")) continue;
    if (labelled.includes("?")) continue;
    const candidate = stripWrapping(labelled);
    if (!candidate) continue;
    const words = candidate.split(/\s+/u).filter(Boolean);
    if (words.length < MIN_NAME_WORDS) continue;
    if (words.some((word) => REPLY_WORDS.has(bareWord(word)))) continue;
    const name = shortenName(candidate);
    if (!name) continue;
    return titleCase(name);
  }
  return "";
}

/**
 * A name that is too long for a title keeps its first clause: the part before
 * the comma or before the word that joins two halves of a line. The longest
 * first clause that still fits is the one that is kept, so a name keeps as
 * much of the meaning as it can carry.
 */
export function shortenName(text) {
  const candidate = String(text ?? "").trim();
  const words = candidate.split(/\s+/u).filter(Boolean);
  if (words.length <= MAX_NAME_WORDS) return candidate;
  const clauses = firstClauses(candidate);
  for (const clause of clauses) {
    const count = clause.split(/\s+/u).filter(Boolean).length;
    if (count > MAX_NAME_WORDS) continue;
    if (count < MIN_NAME_WORDS) continue;
    return clause;
  }
  return "";
}

/**
 * The first clause of a line, longest first: the line before every comma and
 * before every word that joins two halves of a line.
 */
export function firstClauses(text) {
  const raw = String(text ?? "");
  const words = raw.split(/\s+/u);
  const clauses = [];
  let offset = 0;
  for (let index = 0; index < words.length; index += 1) {
    const start = offset;
    offset += words[index].length + 1;
    const word = words[index];
    const comma = word.search(/[,;:]/u);
    if (comma >= 0) {
      clauses.push(cleanClause(raw.slice(0, start + comma)));
      continue;
    }
    if (!CUT_WORDS.has(bareWord(word))) continue;
    if (index >= words.length - 1) continue;
    clauses.push(cleanClause(raw.slice(0, start)));
  }
  return clauses.reverse();
}

/**
 * A clause without the punctuation that closes it.
 */
function cleanClause(text) {
  return String(text ?? "").trim().replace(/[,;:]+$/u, "").trim();
}

/**
 * The words of a name in title case: the small words stay small, and every
 * other word opens with a capital.
 */
export function titleCase(text) {
  const words = String(text ?? "").split(/\s+/u).filter(Boolean);
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      const first = index === 0;
      const last = index === words.length - 1;
      if (!first && !last && SMALL_WORDS.has(lower)) return lower;
      return capitalizeWord(word);
    })
    .join(" ");
}

/**
 * A word with a capital of its own, keeping the capitals inside it.
 */
function capitalizeWord(word) {
  const flat = /^[A-Z]+$/u.test(word) ? word.toLowerCase() : word;
  if (/[A-Z]/u.test(flat.slice(1))) return flat.charAt(0).toUpperCase() + flat.slice(1);
  const lower = flat.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * The two parts of the input: what the mind said, and the sheet of the song.
 */
export function splitSongNameInput(text) {
  const raw = String(text ?? "");
  const nameAt = raw.indexOf(NAME_HEADING);
  const sheetAt = raw.indexOf(SHEET_HEADING);
  if (nameAt < 0 && sheetAt < 0) return { reply: raw, sheet: "" };
  const reply = nameAt < 0
    ? ""
    : raw.slice(nameAt + NAME_HEADING.length, sheetAt < 0 ? undefined : sheetAt).trim();
  const sheet = sheetAt < 0 ? "" : raw.slice(sheetAt + SHEET_HEADING.length).trim();
  return { reply, sheet };
}

/**
 * The name of a song: the name the mind gave, and the line the song repeats
 * when the mind did not give one that can be read.
 */
export function songName({ reply = "", sheet = "" } = {}) {
  const named = extractSongName(reply);
  if (named) return named;
  const hook = songHook(sheet);
  if (!hook) return "";
  return titleCase(shortenName(hook.replace(/[.!?,;:]+$/u, "").trim()));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = fs.readFileSync(0, "utf8");
  process.stdout.write(songName(splitSongNameInput(input)));
}

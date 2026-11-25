import fs from "node:fs";

import { SCHEMA_HEADINGS, depthFromHeadings, headingsFromArgument } from "../program/library/learn_card_headings.mjs";

const HEADING_ALIASES = new Map([
  ["ORTHOGENAL FEATURES", "ORTHOGONAL FEATURES"],
  ["ORTHOGRANAL FEATURES", "ORTHOGONAL FEATURES"]
]);

const FULL_PHRASE_WORD_LIMIT = 6;
const RADIO_PHRASE_WORD_LIMIT = 8;

function readInput() {
  return fs.readFileSync(0, "utf8");
}

function canonicalHeading(line) {
  const trimmed = String(line ?? "").trim();
  const upper = trimmed.toUpperCase();
  return HEADING_ALIASES.get(upper) || (/^ORTHOG[A-Z]* FEATURES$/u.test(upper) ? "ORTHOGONAL FEATURES" : upper);
}

function isSchemaHeading(line) {
  return SCHEMA_HEADINGS.includes(canonicalHeading(line));
}

function phraseWordCount(text) {
  return (String(text ?? "").match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/gu) ?? []).length;
}

const TRAILING_MEMORY_CONNECTOR = /\b(?:and|or|but|so|because|if|when|while|than|that|which|who|whom|whose|a|an|the|not|rather|instead|of|by|to|from|with|without|for|in|on|at|as)\s*$/iu;

function trimDanglingPhrase(text) {
  let phrase = String(text ?? "").trim();
  while (TRAILING_MEMORY_CONNECTOR.test(phrase)) {
    phrase = phrase.replace(TRAILING_MEMORY_CONNECTOR, "").trim();
  }
  return phrase;
}

function toMemoryPhrase(text, wordLimit = FULL_PHRASE_WORD_LIMIT) {
  const words = String(text ?? "")
    .replace(/^[-*]+\s*/u, "")
    .replace(/[“”"()]/gu, "")
    .replace(/[,;:]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (words.length < 2) return "";
  return trimDanglingPhrase(words.slice(0, wordLimit).join(" ").replace(/[.!?]+$/u, ""));
}

function normalizeBriefMemoryPhraseBlock(lines, wordLimit = FULL_PHRASE_WORD_LIMIT) {
  const nonEmpty = lines.map(line => String(line ?? "").trim()).filter(Boolean);
  if (nonEmpty.length >= 4 && nonEmpty.length <= 8 && nonEmpty.every(line => line.startsWith("- "))) {
    return nonEmpty.map((line) => {
      const phrase = toMemoryPhrase(line.slice(2), wordLimit);
      return phrase ? `- ${phrase}` : line;
    });
  }
  // A sentence that holds two clauses is two phrases, not one long one: the
  // clause is kept whole so the phrase still reads like a line of a song.
  const segments = nonEmpty
    .join("\n")
    .split(/(?:\n+|(?<=[.!?])\s+|[,;]\s+)/u)
    .map((segment) => toMemoryPhrase(segment, wordLimit))
    .filter(Boolean);
  const phrases = [];
  const seen = new Set();
  for (const segment of segments) {
    const words = phraseWordCount(segment);
    if (words < 2 || words > wordLimit) continue;
    const key = segment.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    phrases.push(segment);
    if (phrases.length >= 8) break;
  }
  if (phrases.length < 4) return lines;
  return phrases.map(phrase => `- ${phrase}`);
}

export function normalizeLearnCard(text, headings = SCHEMA_HEADINGS) {
  const source = String(text ?? "").replace(/\r\n?/gu, "\n");
  const lines = source.split("\n");
  const wordLimit = depthFromHeadings(headings) === "radio" ? RADIO_PHRASE_WORD_LIMIT : FULL_PHRASE_WORD_LIMIT;
  const normalized = lines.map((line) => {
    const heading = canonicalHeading(line);
    const replacement = headings.includes(heading) ? heading : "";
    if (!replacement) return line;
    const leading = String(line ?? "").match(/^\s*/u)?.[0] ?? "";
    const trailing = String(line ?? "").match(/\s*$/u)?.[0] ?? "";
    return `${leading}${replacement}${trailing}`;
  });

  const repaired = [];
  for (let index = 0; index < normalized.length; index += 1) {
    const line = normalized[index];
    repaired.push(line);
    if (canonicalHeading(line) !== "BRIEF MEMORY PHRASES") continue;
    const body = [];
    index += 1;
    while (index < normalized.length && !isSchemaHeading(normalized[index])) {
      body.push(normalized[index]);
      index += 1;
    }
    repaired.push(...normalizeBriefMemoryPhraseBlock(body, wordLimit));
    index -= 1;
  }
  return repaired.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(normalizeLearnCard(readInput(), headingsFromArgument(process.argv.slice(2))));
}

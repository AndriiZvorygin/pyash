import fs from "node:fs";

const SCHEMA_HEADINGS = [
  "SEED CONCEPT",
  "CARDINAL TRAINING SENTENCE",
  "TEACHING PROGRESSION",
  "ORTHOGONAL FEATURES",
  "SURPRISES AND MISUNDERSTANDINGS",
  "AFFAIRS OR ACTIVITIES",
  "CAUSATIVE AND CONSEQUENCE",
  "CARDINAL SCENES AND IDIOMS",
  "BRIEF MEMORY PHRASES",
  "CONCEPT RELATIONS"
];

const HEADING_ALIASES = new Map([
  ["ORTHOGENAL FEATURES", "ORTHOGONAL FEATURES"],
  ["ORTHOGRANAL FEATURES", "ORTHOGONAL FEATURES"]
]);

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

function toMemoryPhrase(text) {
  const words = String(text ?? "")
    .replace(/^[-*]+\s*/u, "")
    .replace(/[“”"()]/gu, "")
    .replace(/[,;:]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (words.length < 2) return "";
  return trimDanglingPhrase(words.slice(0, 6).join(" ").replace(/[.!?]+$/u, ""));
}

function normalizeBriefMemoryPhraseBlock(lines) {
  const nonEmpty = lines.map(line => String(line ?? "").trim()).filter(Boolean);
  if (nonEmpty.length >= 4 && nonEmpty.length <= 8 && nonEmpty.every(line => line.startsWith("- "))) {
    return nonEmpty.map((line) => {
      const phrase = toMemoryPhrase(line.slice(2));
      return phrase ? `- ${phrase}` : line;
    });
  }
  const segments = nonEmpty
    .join("\n")
    .split(/(?:\n+|(?<=[.!?])\s+)/u)
    .map(toMemoryPhrase)
    .filter(Boolean);
  const phrases = [];
  const seen = new Set();
  for (const segment of segments) {
    const words = phraseWordCount(segment);
    if (words < 2 || words > 6) continue;
    const key = segment.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    phrases.push(segment);
    if (phrases.length >= 8) break;
  }
  if (phrases.length < 4) return lines;
  return phrases.map(phrase => `- ${phrase}`);
}

export function normalizeLearnCard(text) {
  const source = String(text ?? "").replace(/\r\n?/gu, "\n");
  const lines = source.split("\n");
  const normalized = lines.map((line) => {
    const heading = canonicalHeading(line);
    const replacement = SCHEMA_HEADINGS.includes(heading) ? heading : "";
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
    repaired.push(...normalizeBriefMemoryPhraseBlock(body));
    index -= 1;
  }
  return repaired.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(normalizeLearnCard(readInput()));
}

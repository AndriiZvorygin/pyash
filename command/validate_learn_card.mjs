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

const MEMORY_PHRASE_HEADING = "BRIEF MEMORY PHRASES";
const TRAILING_MEMORY_CONNECTOR = /\b(?:and|or|but|so|because|if|when|while|than|that|which|who|whom|whose|a|an|the|not|rather|instead|of|by|to|from|with|without|for|in|on|at|as)\s*$/iu;

function sectionListItems(body) {
  return String(body ?? "")
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);
}

function countWords(text) {
  return (String(text ?? "").match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/gu) ?? []).length;
}

function readInput() {
  return fs.readFileSync(0, "utf8");
}

export function validateLearnCard(text) {
  const source = String(text ?? "").replace(/\r\n?/gu, "\n");
  const lines = source.split("\n");
  const sections = new Map();
  let currentHeading = "";
  let currentLines = [];

  function flush() {
    if (!currentHeading) return;
    sections.set(currentHeading, currentLines.join("\n").trim());
  }

  for (const line of lines) {
    const heading = String(line ?? "").trim().toUpperCase();
    if (SCHEMA_HEADINGS.includes(heading)) {
      flush();
      currentHeading = heading;
      currentLines = [];
      continue;
    }
    if (currentHeading) currentLines.push(line);
  }
  flush();

  for (const heading of SCHEMA_HEADINGS) {
    if (!sections.has(heading)) {
      return `learn card defective: missing heading ${heading}`;
    }
    const body = String(sections.get(heading) ?? "").trim();
    if (!body || body === "-") {
      return `learn card defective: empty section ${heading}`;
    }
    if (heading === MEMORY_PHRASE_HEADING) {
      const items = sectionListItems(body);
      if (items.length < 4 || items.length > 8) {
        return `learn card defective: ${heading} must contain 4-8 dash list items`;
      }
      for (const item of items) {
        if (!item.startsWith("- ")) {
          return `learn card defective: ${heading} must be a dash list`;
        }
        const phrase = item.slice(2).trim();
        const words = countWords(phrase);
        if (words < 2 || words > 6) {
          return `learn card defective: ${heading} item must be 2-6 words`;
        }
        if (TRAILING_MEMORY_CONNECTOR.test(phrase)) {
          return `learn card defective: ${heading} item ends with dangling connector`;
        }
      }
    }
  }
  return "";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const defect = validateLearnCard(readInput());
  if (defect) {
    process.stderr.write(`${defect}\n`);
    process.exit(1);
  }
}

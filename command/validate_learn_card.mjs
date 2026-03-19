import fs from "node:fs";

const SCHEMA_HEADINGS = [
  "SEED CONCEPT",
  "CARDINAL TRAINING SENTENCE",
  "ORTHOGONAL FEATURES",
  "SURPRISES AND MISUNDERSTANDINGS",
  "AFFAIRS OR ACTIVITIES",
  "CAUSATIVE AND CONSEQUENCE",
  "CARDINAL SCENES AND IDIOMS",
  "BRIEF MEMORY PHRASES"
];

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

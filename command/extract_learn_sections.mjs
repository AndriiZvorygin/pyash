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

function normalizeHeading(raw) {
  return String(raw ?? "").trim().toUpperCase();
}

export function extractLearnSections(text, requestedHeadings = []) {
  const source = String(text ?? "").replace(/\r\n?/gu, "\n");
  const lines = source.split("\n");
  const wanted = new Set(requestedHeadings.map(normalizeHeading).filter(Boolean));
  const sections = [];
  let currentHeading = "";
  let currentLines = [];

  function flush() {
    if (!currentHeading || !wanted.has(currentHeading)) return;
    const body = currentLines.join("\n").trim();
    if (!body) return;
    sections.push(`${currentHeading}\n${body}`);
  }

  for (const line of lines) {
    const heading = normalizeHeading(line);
    if (SCHEMA_HEADINGS.includes(heading)) {
      flush();
      currentHeading = heading;
      currentLines = [];
      continue;
    }
    if (currentHeading) currentLines.push(line);
  }
  flush();

  return sections.join("\n\n").trim();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const headings = process.argv.slice(2);
  process.stdout.write(extractLearnSections(readInput(), headings));
}

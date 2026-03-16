import fs from "node:fs";

const START_MARKER = "[learn pipeline] final result start";
const END_MARKER = "[learn pipeline] final result end";
const FILE_MARKER = "FINAL_RESULT_FILE:";
const SCHEMA_HEADINGS = [
  "SEED CONCEPT",
  "CARDINAL TRAINING SENTENCE",
  "ORTHOGONAL FEATURES",
  "AFFAIRS OR ACTIVITIES",
  "CAUSATIVE AND CONSEQUENCE",
  "CARDINAL SCENES AND IDIOMS",
  "BRIEF MEMORY PHRASES"
];

function readInput() {
  return fs.readFileSync(0, "utf8");
}

function extractLastSchemaBlock(text) {
  const raw = String(text ?? "").replace(/\r\n?/gu, "\n");
  const lines = raw.split("\n");
  for (let start = lines.length - 1; start >= 0; start -= 1) {
    if (lines[start].trim() !== SCHEMA_HEADINGS[0]) continue;
    let searchIndex = start + 1;
    let valid = true;
    for (let headingIndex = 1; headingIndex < SCHEMA_HEADINGS.length; headingIndex += 1) {
      const foundAt = lines.findIndex((line, idx) => idx >= searchIndex && line.trim() === SCHEMA_HEADINGS[headingIndex]);
      if (foundAt === -1) {
        valid = false;
        break;
      }
      searchIndex = foundAt + 1;
    }
    if (valid) {
      return lines.slice(start).join("\n").trim();
    }
  }
  return "";
}

export function extractFinalResult(text) {
  const raw = String(text ?? "");
  const fileLine = raw
    .split("\n")
    .map(line => line.trim())
    .find(line => line.startsWith(FILE_MARKER));
  if (fileLine) {
    const filename = fileLine.slice(FILE_MARKER.length).trim();
    if (filename) {
      return fs.readFileSync(filename, "utf8").trim();
    }
  }
  const start = raw.lastIndexOf(START_MARKER);
  const end = raw.lastIndexOf(END_MARKER);
  if (start !== -1 && end !== -1 && end > start) {
    return raw
      .slice(start + START_MARKER.length, end)
      .replace(/^\s+|\s+$/gu, "");
  }
  const schemaBlock = extractLastSchemaBlock(raw);
  if (schemaBlock) return schemaBlock;
  return raw.trim();
}

const input = readInput();
process.stdout.write(extractFinalResult(input));

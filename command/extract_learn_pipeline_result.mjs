import fs from "node:fs";

const START_MARKER = "[learn pipeline] final result start";
const END_MARKER = "[learn pipeline] final result end";
const FILE_MARKER = "FINAL_RESULT_FILE:";

function readInput() {
  return fs.readFileSync(0, "utf8");
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
  return raw.trim();
}

export function runExtractLearnPipelineResult(input = readInput()) {
  return extractFinalResult(input);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(runExtractLearnPipelineResult());
}

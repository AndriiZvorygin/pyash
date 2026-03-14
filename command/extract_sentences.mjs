import fs from "node:fs";

function cleanChunk(text) {
  return String(text ?? "")
    .replace(/\[footnote start\][\s\S]*?\[footnote end\]/gi, " ")
    .replace(/^\s*\S+\.txt:/gm, "")
    .replace(/&#8617;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitIntoSentences(text) {
  const cleaned = cleanChunk(text);
  if (!cleaned) return [];
  const parts = cleaned
    .split(/(?<=[.!?])\s+(?=[A-Z"\[])/u)
    .map(part => part.trim())
    .filter(Boolean);
  return parts.map(part => part.replace(/\s+/g, " ").trim());
}

export function extractSentences(input) {
  return splitIntoSentences(input).join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = fs.readFileSync(0, "utf8");
  process.stdout.write(extractSentences(input));
}

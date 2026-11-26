import fs from "node:fs";

function normalizeLine(line) {
  return String(line ?? "").trim();
}

function wordCount(line) {
  const words = normalizeLine(line).split(/\s+/).filter(Boolean);
  return words.length;
}

function isRejected(line) {
  const text = normalizeLine(line);
  if (!text) return true;
  if (wordCount(text) < 4 || wordCount(text) > 8) return true;
  if (/[?]/.test(text)) return true;
  if (/\b(?:you|your|yours)\b/i.test(text)) return true;
  if (/\b(?:may|shall|should|would|could|if)\b/i.test(text)) return true;
  if (/\b(?:not|never|no|without|cannot|won't|don't)\b/i.test(text)) return true;
  if (/^\s*(?:it\s+is|there\s+(?:is|are|was|were)|this\s+is|that\s+is)\b/i.test(text)) return true;
  if (/^\s*(?:offer|polish|face|love|remove|go|send|stand|plunge|ride|cast|use|gaze|visit|forgive|choose|rest)\b/i.test(text)) return true;
  if (/^\s*we\s+are\s+those\s+of\b/i.test(text)) return true;
  if (/\baware\s+of\s+your\s+query\b/i.test(text)) return true;
  if (/\bworthwhile\b/i.test(text)) return true;
  if (/^\s*there\s+are\s+such\b/i.test(text)) return true;
  if (/^\s*it\s+is\s+indeed\b/i.test(text)) return true;
  if (/\b(?:session|instrument|speaker|footnote|html|shell|query)\b/i.test(text)) return true;
  return false;
}

export function selectBestHymnHookCandidate(input) {
  const lines = String(input ?? "")
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter(Boolean);
  const kept = lines.filter(line => !isRejected(line));
  return kept[0] ?? "NONE";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = fs.readFileSync(0, "utf8");
  process.stdout.write(selectBestHymnHookCandidate(input));
}

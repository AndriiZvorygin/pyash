import fs from "node:fs";

function normalizeLine(line) {
  return String(line ?? "").trim();
}

function wordCount(line) {
  return normalizeLine(line).split(/\s+/).filter(Boolean).length;
}

export function isRejectedHymnHookCandidate(line) {
  const text = normalizeLine(line);
  if (!text) return true;
  if (wordCount(text) < 4 || wordCount(text) > 8) return true;
  if (/[\r\n]/.test(text)) return true;
  if (/[?]/.test(text)) return true;
  if (/^\s*(?:[-*#>\[]|\d+[.)])/.test(text)) return true;
  if (/[`{}<>|]/.test(text)) return true;
  if (/^\s*(?:speaker|session|instrument|footnote|html|shell|query|timestamp|filename)\b/i.test(text)) return true;
  return false;
}

export function filterHymnHookCandidates(input) {
  const kept = String(input ?? "")
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter(Boolean)
    .filter(line => !isRejectedHymnHookCandidate(line));
  return kept.length ? kept.join("\n") : "NONE";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = fs.readFileSync(0, "utf8");
  process.stdout.write(filterHymnHookCandidates(input));
}

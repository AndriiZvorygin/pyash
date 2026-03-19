import fs from "node:fs";

const HEADING_ALIASES = new Map([
  ["ORTHOGENAL FEATURES", "ORTHOGONAL FEATURES"],
  ["ORTHOGRANAL FEATURES", "ORTHOGONAL FEATURES"]
]);

function readInput() {
  return fs.readFileSync(0, "utf8");
}

export function normalizeLearnCard(text) {
  const source = String(text ?? "").replace(/\r\n?/gu, "\n");
  const lines = source.split("\n");
  const normalized = lines.map((line) => {
    const trimmed = String(line ?? "").trim();
    const upper = trimmed.toUpperCase();
    const replacement = HEADING_ALIASES.get(upper) || (/^ORTHOG[A-Z]* FEATURES$/u.test(upper) ? "ORTHOGONAL FEATURES" : "");
    if (!replacement) return line;
    const leading = String(line ?? "").match(/^\s*/u)?.[0] ?? "";
    const trailing = String(line ?? "").match(/\s*$/u)?.[0] ?? "";
    return `${leading}${replacement}${trailing}`;
  });
  return normalized.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(normalizeLearnCard(readInput()));
}

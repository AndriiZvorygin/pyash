import fs from "node:fs";

function readInput() {
  return fs.readFileSync(0, "utf8");
}

export function extractVerifierScore(text) {
  const raw = String(text ?? "").replace(/\r\n?/gu, "\n").trim();
  if (!raw) return "0";
  const lines = raw.split("\n").map(line => line.trim()).filter(Boolean);
  const last = lines.at(-1) ?? "";
  if (/^PASS\b/iu.test(last)) return "1";
  if (/^FAIL\b/iu.test(last)) return "0";
  const exact = last.match(/^([01](?:\.\d+)?)$/u);
  if (exact?.[1]) return exact[1];
  const trailing = raw.match(/(?:^|\s)([01](?:\.\d+)?)\s*$/u);
  if (trailing?.[1]) return trailing[1];
  return "0";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(extractVerifierScore(readInput()));
}

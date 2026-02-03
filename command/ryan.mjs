import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { resolveEnglishAlias } from "../program/verbs/exchange/translation/english_aliases.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const ryanPath = resolve(repoRoot, "caterer/pyac/lyac/program/ryan.mjs");
const { queryRyan } = await import(ryanPath);

export async function queryRyanLines(prefix) {
  const lines = await queryRyan(prefix);
  const alias = resolveEnglishAlias(prefix);
  if (alias && alias !== String(prefix ?? "").toLowerCase()) {
    if (shouldUseAlias(lines)) {
      const aliasLines = await queryRyan(alias);
      if (aliasLines.length > 0) return aliasLines;
    }
  }
  return lines;
}

function parseBlacklist(line) {
  const trimmed = line.trim();
  if (!(trimmed.startsWith("[") || trimmed.startsWith("\""))) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function shouldUseAlias(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return true;
  if (lines.length === 1) {
    const line = lines[0].trim();
    if (/^"?file"?$/i.test(line)) return true;
    if (parseBlacklist(line) !== null) return true;
  }
  return false;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const query = process.argv[2];
  if (!query) {
    console.error("usage: node command/ryan.mjs <prefix>");
    process.exit(1);
  }
  const lines = await queryRyanLines(query);
  process.stdout.write(lines.join("\n"));
}

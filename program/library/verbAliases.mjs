import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const verbAliases = JSON.parse(
  fs.readFileSync(path.join(moduleDir, "verb_aliases.json"), "utf8")
);

function normalizeVerbWord(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

export function resolveVerbAlias(verb) {
  const normalized = normalizeVerbWord(verb);
  if (!normalized) return normalized;
  return verbAliases[normalized] ?? normalized;
}

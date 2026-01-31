import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { applyEnglishAliases } from "../english_aliases.mjs";

let isvByEnglish = null;
let englishByIsv = null;

function loadIsvByEnglish() {
  if (isvByEnglish) return isvByEnglish;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const repoRoot = resolve(here, "../../../../..");
    const path = resolve(repoRoot, "caterer/pyac/lyac/kwon_isv.json");
    const data = JSON.parse(fs.readFileSync(path, "utf8"));
    isvByEnglish = new Map();
    for (const entry of data) {
      if (!entry?.en || !entry?.isv) continue;
      isvByEnglish.set(String(entry.en).toLowerCase(), entry.isv);
    }
    applyEnglishAliases(isvByEnglish);
  } catch {
    isvByEnglish = new Map();
  }
  return isvByEnglish;
}

function loadEnglishByIsv() {
  if (englishByIsv) return englishByIsv;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const repoRoot = resolve(here, "../../../../..");
    const path = resolve(repoRoot, "caterer/pyac/lyac/kwon_isv.json");
    const data = JSON.parse(fs.readFileSync(path, "utf8"));
    englishByIsv = new Map();
    for (const entry of data) {
      if (!entry?.en || !entry?.isv) continue;
      const key = String(entry.isv).trim();
      if (!key) continue;
      if (englishByIsv.has(key)) continue;
      englishByIsv.set(key, String(entry.en).trim());
    }
  } catch {
    englishByIsv = new Map();
  }
  return englishByIsv;
}

export function translateTokenToRussian(token) {
  if (!token) return token;
  const map = loadIsvByEnglish();
  const lower = token.toLowerCase();
  const translated = map.get(lower);
  if (!translated) return token;
  if (token[0] && token[0] === token[0].toUpperCase()) {
    return translated[0].toUpperCase() + translated.slice(1);
  }
  return translated;
}

export function translateNameToRussian(name) {
  if (!name) return name;
  return String(name)
    .split(/\s+/)
    .map((token) => translateTokenToRussian(token))
    .join(" ");
}

export function translateTokenFromRussian(token) {
  if (!token) return token;
  const map = loadEnglishByIsv();
  return map.get(token) ?? token;
}

export function translateNameFromRussian(name) {
  if (!name) return name;
  return String(name)
    .split(/\s+/)
    .map((token) => translateTokenFromRussian(token))
    .join(" ");
}

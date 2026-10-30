import { loadAnchorWordFormsSync } from "./anchor_words.mjs";

let cachedAliasMap = null;

function buildAliasMap() {
  const map = new Map();
  const { formsToAnchor } = loadAnchorWordFormsSync();
  for (const [form, anchor] of formsToAnchor.entries()) {
    if (!form || !anchor) continue;
    const formLower = String(form).toLowerCase();
    const anchorLower = String(anchor).toLowerCase();
    if (!formLower || !anchorLower || formLower === anchorLower) continue;
    if (!map.has(formLower)) map.set(formLower, anchorLower);
  }
  return map;
}

function loadAliasMap() {
  if (cachedAliasMap) return cachedAliasMap;
  try {
    cachedAliasMap = buildAliasMap();
  } catch {
    cachedAliasMap = new Map();
  }
  return cachedAliasMap;
}

export function applyEnglishAliases(map) {
  const aliases = loadAliasMap();
  for (const [alias, anchor] of aliases.entries()) {
    if (map.has(alias)) continue;
    const value = map.get(anchor);
    if (value !== undefined) {
      map.set(alias, value);
    }
  }
  return map;
}

export function resolveEnglishAlias(token) {
  const aliases = loadAliasMap();
  const lower = String(token ?? "").toLowerCase();
  return aliases.get(lower) ?? lower;
}

import fs from "node:fs";

const ENTRY_REGEX = /^su text (\"(?:\\\\.|[^\"\\\\])*\") ob text (\"(?:\\\\.|[^\"\\\\])*\") ya$/;
const PLACEHOLDER_REGEX = /\[([^\]]+)\]/g;
const LANGUAGES = ["english", "russian", "french", "chinese", "interlingua"];

const reverseCache = new Map();
const templatesCache = new Map();

function normalizeText(value) {
  if (typeof value !== "string") return value;
  return value.replaceAll("\\n", "\n").trim();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parsePlaceholders(text) {
  const placeholders = [];
  let match;
  while ((match = PLACEHOLDER_REGEX.exec(text)) !== null) {
    const raw = match[0];
    const token = match[1].trim();
    const parts = token.split(/\s+of\s+/i);
    if (parts.length !== 2) continue;
    const field = parts[0].trim().toLowerCase();
    const rolePath = parts[1].trim().toLowerCase().split(/\s+/).filter(Boolean);
    placeholders.push({ raw, field, rolePath });
  }
  return placeholders;
}

function loadPairsFileSync(path, label) {
  const content = fs.readFileSync(path, "utf8");
  const lines = content.split(/\r?\n/);
  const pairs = [];
  for (const line of lines) {
    const match = line.match(ENTRY_REGEX);
    if (!match) continue;
    const key = normalizeText(JSON.parse(match[1]));
    const value = normalizeText(JSON.parse(match[2]));
    if (!key || !value) continue;
    if (key.includes("__QUOTED_BLOCK__")) continue;
    pairs.push({ key, value });
  }
  if (pairs.length === 0) {
    throw new Error(`translation reverse pairs missing: ${label}`);
  }
  return pairs;
}

function buildReverseMap(lang) {
  if (reverseCache.has(lang)) return reverseCache.get(lang);
  const fileUrl = new URL(`./pairs_${lang}.pya`, import.meta.url);
  const pairs = loadPairsFileSync(fileUrl, `pairs_${lang}`);
  const reverse = new Map();
  for (const { key, value } of pairs) {
    if (!reverse.has(value)) reverse.set(value, key);
  }
  reverseCache.set(lang, reverse);
  return reverse;
}

function buildTemplateList(lang) {
  if (templatesCache.has(lang)) return templatesCache.get(lang);
  const fileUrl = new URL(`./pairs_${lang}_templates.pya`, import.meta.url);
  const pairs = loadPairsFileSync(fileUrl, `pairs_${lang}_templates`);
  const templates = pairs.map(({ key, value }) => {
    const valuePlaceholders = parsePlaceholders(value);
    const keyPlaceholders = parsePlaceholders(key);
    let regex = escapeRegex(value);
    for (const { raw } of valuePlaceholders) {
      regex = regex.replace(escapeRegex(raw), "(.+?)");
    }
    const compiled = new RegExp(`^${regex}$`);
    return { key, value, regex: compiled, valuePlaceholders, keyPlaceholders };
  });
  templatesCache.set(lang, templates);
  return templates;
}

function boolFromGloss(raw, language) {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "truth" || value === "true") return true;
  if (value === "lie" || value === "false") return false;
  if (language === "russian") {
    if (value === "истина") return true;
    if (value === "ложь") return false;
  }
  if (language === "french") {
    if (value === "vrai") return true;
    if (value === "faux") return false;
  }
  return null;
}

function renderCapturedForKey(field, raw, language) {
  const value = raw?.trim();
  if (field === "text") {
    return JSON.stringify(value ?? "");
  }
  if (field === "bool" || field === "boolean") {
    const bool = boolFromGloss(value, language);
    if (bool == null) return null;
    return bool ? "truth" : "lie";
  }
  return value ?? null;
}

function roleKey(rolePath) {
  return rolePath.join(" ");
}

function matchTemplateGloss(text, lang, { matchGloss }) {
  const templates = buildTemplateList(lang);
  let best = null;
  for (const template of templates) {
    const match = template.regex.exec(text);
    if (!match) continue;
    const captured = new Map();
    template.valuePlaceholders.forEach((placeholder, index) => {
      captured.set(roleKey(placeholder.rolePath), {
        field: placeholder.field,
        raw: match[index + 1]
      });
    });
    let pyash = template.key;
    let ok = true;
    for (const placeholder of template.keyPlaceholders) {
      const key = roleKey(placeholder.rolePath);
      if (placeholder.field === "pyash") {
        const gloss = captured.get(key);
        if (!gloss || gloss.field !== "gloss") {
          ok = false;
          break;
        }
        const nested = matchGloss(gloss.raw, { language: lang });
        if (!nested) {
          ok = false;
          break;
        }
        pyash = pyash.split(placeholder.raw).join(nested);
        continue;
      }
      const capture = captured.get(key);
      if (!capture) {
        ok = false;
        break;
      }
      if (placeholder.field === "name" && typeof capture.raw === "string" && capture.raw.includes("\"")) {
        ok = false;
        break;
      }
      const rendered = renderCapturedForKey(placeholder.field, capture.raw, lang);
      if (rendered == null) {
        ok = false;
        break;
      }
      pyash = pyash.split(placeholder.raw).join(rendered);
    }
    if (!ok) continue;
    const score = template.value.length;
    if (!best || score > best.score) {
      best = { pyash, score };
    }
  }
  return best?.pyash ?? null;
}

export function matchGlossToPyash(text, { language } = {}) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return null;
  const langs = language ? [language] : LANGUAGES;
  for (const lang of langs) {
    const reverse = buildReverseMap(lang);
    const direct = reverse.get(trimmed);
    if (direct) return direct;
    const templated = matchTemplateGloss(trimmed, lang, {
      matchGloss: (value, opts) => matchGlossToPyash(value, opts)
    });
    if (templated) return templated;
  }
  return null;
}

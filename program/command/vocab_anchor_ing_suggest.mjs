import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { buildProgram } from "../program.mjs";

const args = process.argv.slice(2);
const limitIndex = args.indexOf("--limit");
const limit = limitIndex !== -1 ? Number(args[limitIndex + 1]) : 50;

function readFormValue(sentence) {
  if (typeof sentence?.ob?.text === "string") return sentence.ob.text;
  if (typeof sentence?.ob?.name === "string") return sentence.ob.name;
  return null;
}

async function loadJson(path) {
  const text = await fs.readFile(path, "utf8");
  return JSON.parse(text);
}

async function loadAnchorForms(anchorPath) {
  const text = await fs.readFile(anchorPath, "utf8");
  const program = buildProgram(text);
  const forms = new Set();
  for (const sentence of program.sentences ?? []) {
    const form = readFormValue(sentence);
    if (form) forms.add(form.toLowerCase());
  }
  return forms;
}

function normalizeBlacklist(value) {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.join(", ").trim();
  return "";
}

function buildBaseCandidates(lower) {
  const raw = lower.slice(0, -3);
  const candidates = [];
  const seen = new Set();
  const push = (value) => {
    if (value.length < 3) return;
    if (seen.has(value)) return;
    seen.add(value);
    candidates.push(value);
  };
  push(raw);
  if (raw.length >= 2 && raw[raw.length - 1] === raw[raw.length - 2]) {
    push(raw.slice(0, -1));
  }
  push(`${raw}e`);
  if (lower.endsWith("ying") && lower.length > 4) {
    push(`${lower.slice(0, -4)}ie`);
  }
  return candidates;
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const lyacRoot = resolve(repoRoot, "caterer/pyac/lyac");
const anchorPath = resolve(repoRoot, "program/verbs/exchange/translation/anchor_words.pya");

const [kwonEn, pyashWords, pyackwon, dictionaryEn, anchorForms] = await Promise.all([
  loadJson(resolve(lyacRoot, "kwon_en.json")),
  loadJson(resolve(lyacRoot, "pyashWords.json")),
  loadJson(resolve(lyacRoot, "pyackwon.json")),
  loadJson(resolve(lyacRoot, "dictionary_en.json")),
  loadAnchorForms(anchorPath)
]);

const blacklist = dictionaryEn?.en?.blacklist ?? {};
const entries = [...kwonEn, ...pyashWords, ...pyackwon].filter(e => e?.en && e?.pya);
const byEn = new Map();
for (const entry of entries) {
  const en = String(entry.en).trim().toLowerCase();
  if (!en) continue;
  if (!byEn.has(en)) byEn.set(en, new Set());
  byEn.get(en).add(entry.pya);
}

const suggestions = [];
for (const entry of entries) {
  const en = String(entry.en).trim();
  const lower = en.toLowerCase();
  if (!/^[a-z]+$/.test(lower)) continue;
  if (!lower.endsWith("ing") || lower.length < 5) continue;
  const candidates = buildBaseCandidates(lower);
  for (const base of candidates) {
    if (!byEn.has(base)) continue;
    if (anchorForms.has(base)) continue;
    const black = normalizeBlacklist(blacklist[`X${base}`]);
    if (black) continue;
    const baseSet = byEn.get(base);
    if (baseSet && (![...baseSet].includes(entry.pya) || baseSet.size > 1)) continue;
    suggestions.push({ anchor: entry.pya, base });
  }
}

const uniq = new Map();
for (const entry of suggestions) {
  const key = `${entry.anchor}|${entry.base}`;
  if (!uniq.has(key)) uniq.set(key, entry);
}

const list = [...uniq.values()].sort((a, b) => a.base.localeCompare(b.base));
const shown = Number.isFinite(limit) ? list.slice(0, limit) : list;

for (const entry of shown) {
  console.log(`su name ${entry.anchor} ob text \"${entry.base}\" as wo verb ya`);
}

if (shown.length < list.length) {
  console.log(`# ${list.length - shown.length} more...`);
}

if (list.length === 0) {
  console.log("# no safe -ing anchors found");
}

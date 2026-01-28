import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const lyacRoot = resolve(here, "..");

let cache = null;

async function loadJson(filename) {
  const text = await fs.readFile(resolve(lyacRoot, filename), "utf8");
  return JSON.parse(text);
}

async function loadGrammarWords() {
  try {
    const text = await fs.readFile(resolve(lyacRoot, "program/pyashWords.h"), "utf8");
    const grammarWords = new Set();
    for (const line of text.split("\n")) {
      const match = line.match(/_GRAMMAR\s+0x[0-9A-Fa-f]+\s+\/\/\s+(\S+)/);
      if (match) grammarWords.add(match[1]);
    }
    return grammarWords;
  } catch {
    return new Set();
  }
}

function detectLang(entry) {
  if (entry.isv) return "isv";
  if (entry.ia) return "ia";
  if (entry.hi) return "hi";
  if (entry.he) return "he";
  if (entry.es) return "es";
  if (entry.tr) return "tr";
  if (entry.zh) return "zh";
  if (entry.fi) return "fi";
  if (entry.en) return "en";
  return "";
}

async function loadCache() {
  if (cache) return cache;
  const [
    kwonIa,
    kwonFi,
    kwonIsv,
    kwonHe,
    kwonTr,
    kwonHi,
    kwonZh,
    kwonEn,
    pyashWords,
    pyackwon,
    dictionaryEn,
    grammarWords,
    pyashHeader
  ] = await Promise.all([
    loadJson("kwon_ia.json"),
    loadJson("kwon_fi.json"),
    loadJson("kwon_isv.json"),
    loadJson("kwon_he.json"),
    loadJson("kwon_tr.json"),
    loadJson("kwon_hi.json"),
    loadJson("kwon_zh.json"),
    loadJson("kwon_en.json"),
    loadJson("pyashWords.json"),
    loadJson("pyackwon.json"),
    loadJson("dictionary_en.json"),
    loadGrammarWords(),
    fs.readFile(resolve(lyacRoot, "program/pyashWords.h"), "utf8").catch(() => "")
  ]);
  cache = {
    kwonSources: [
      pyackwon,
      pyashWords,
      kwonEn,
      kwonZh,
      kwonHi,
      kwonIa,
      kwonIsv,
      kwonTr,
      kwonHe,
      kwonFi
    ],
    blacklist: dictionaryEn?.en?.blacklist ?? {},
    grammarWords,
    pyashHeader
  };
  return cache;
}

export async function queryRyan(prefix) {
  const input = String(prefix ?? "");
  if (!input) return [];

  const { kwonSources, blacklist, grammarWords, pyashHeader } = await loadCache();
  const blocked = blacklist[`X${input}`];
  if (blocked && blocked.length > 0) {
    return [JSON.stringify(blocked)];
  }

  const lines = [];
  for (const kwon of kwonSources) {
    const sample = kwon?.[0] ?? {};
    const lang = detectLang(sample);
    if (!lang) continue;
    for (const entry of kwon) {
      if (!entry.pya || !entry[lang] || !entry.en) continue;
      if (
        entry.pya.startsWith(input) ||
        entry[lang].startsWith(input) ||
        entry.en.startsWith(input)
      ) {
        let line = `${entry.pya} ${lang} ${entry[lang]}`;
        if (grammarWords.has(entry.pya)) line += " grammar";
        const fyek = entry[`${lang}_fyek`];
        if (fyek) line += ` /${String(fyek).trim()}/`;
        lines.push(line);
      }
    }
  }

  if (pyashHeader) {
    const example = new RegExp(input, "i");
    const matches = pyashHeader.split("\n").filter(line => example.test(line));
    lines.push(...matches);
  }

  return lines;
}

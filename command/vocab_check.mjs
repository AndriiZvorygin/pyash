import fs from "node:fs/promises";
import { resolve } from "node:path";
import { buildProgram } from "../program/program.mjs";
import { queryVocabLines } from "./vocab_query.mjs";
import { resolveEnglishAlias } from "../program/verbs/exchange/translation/english_aliases.mjs";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: node command/vocab_check.mjs <file.pya>...");
  process.exit(1);
}

const checked = new Map();
const PYASH_QUOTED_START = "quoted.pyash.";
const PYASH_QUOTED_END = ".pyash.quoted";

function tokenizeName(name) {
  return String(name)
    .split(/\s+/)
    .map(token => token.trim())
    .filter(Boolean);
}

function collectNames(sentence, out) {
  const roles = ["su", "ob", "to", "from", "with", "via", "by"];
  for (const role of roles) {
    const value = sentence?.[role];
    if (value?.name) {
      for (const token of tokenizeName(value.name)) out.add(token);
    }
  }
  if (sentence?.consequence) {
    collectNames(sentence.consequence, out);
  }
}

async function queryRyan(token) {
  if (checked.has(token)) return checked.get(token);
  const output = await queryVocabLines(token);
  const lines = output.map(line => line.trim()).filter(Boolean);
  checked.set(token, lines);
  return lines;
}

function isFileMarker(line) {
  return /^"?file"?$/i.test(line);
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

function normalizeGloss(text) {
  let value = text.trim();
  value = value.replace(/\s+grammar$/, "");
  const phoneticIndex = value.indexOf(" /");
  if (phoneticIndex !== -1 && value.endsWith("/")) {
    value = value.slice(0, phoneticIndex).trim();
  }
  return value;
}

function getGlossFromLine(line) {
  if (!line || line.startsWith("#define")) return null;
  const match = line.match(/^(\S+)\s+(\S+)\s+(.+)$/);
  if (!match) return null;
  return normalizeGloss(match[3]);
}

function getPyashFromLine(line) {
  if (!line || line.startsWith("#define")) return null;
  const match = line.match(/^(\S+)\s+(\S+)\s+(.+)$/);
  if (!match) return null;
  return match[1];
}

function isExactTokenMatch(token, lines) {
  const lower = String(token ?? "").toLowerCase();
  if (!lower) return false;
  const target = resolveEnglishAlias(lower) || lower;
  for (const line of lines) {
    if (!line) continue;
    if (isFileMarker(line)) continue;
    if (parseBlacklist(line) !== null) continue;
    const pyash = getPyashFromLine(line);
    if (pyash && (pyash.toLowerCase() === lower || pyash.toLowerCase() === target)) return true;
    const gloss = getGlossFromLine(line);
    if (gloss && (gloss.toLowerCase() === lower || gloss.toLowerCase() === target)) return true;
  }
  return false;
}

function extractQuotedPyashBlocks(text) {
  const blocks = [];
  let index = 0;
  while (index < text.length) {
    const start = text.indexOf(PYASH_QUOTED_START, index);
    if (start === -1) break;
    const contentStart = start + PYASH_QUOTED_START.length;
    const end = text.indexOf(PYASH_QUOTED_END, contentStart);
    if (end === -1) break;
    const raw = text.slice(contentStart, end);
    blocks.push(raw.replaceAll("\\n", "\n"));
    index = end + PYASH_QUOTED_END.length;
  }
  return blocks;
}

let missing = 0;
for (const file of files) {
  const text = await fs.readFile(file, "utf8");
  const program = buildProgram(text);
  const names = new Set();
  for (const sentence of program.sentences) {
    collectNames(sentence, names);
  }
  for (const block of extractQuotedPyashBlocks(text)) {
    const blockProgram = buildProgram(block);
    for (const sentence of blockProgram.sentences) {
      collectNames(sentence, names);
    }
  }
  for (const token of names) {
    const lines = await queryRyan(token);
    const blacklistValue = lines.length === 1 ? parseBlacklist(lines[0]) : null;
    if (lines.length === 0 || blacklistValue !== null || !isExactTokenMatch(token, lines)) {
      missing += 1;
      console.log(`${file}: ${token} (no suggestions)`);
      continue;
    }
    if (lines.length === 1 && isFileMarker(lines[0])) {
      missing += 1;
      console.log(`${file}: ${token} (no dictionary match)`);
      continue;
    }
  }
}

if (missing > 0) {
  process.exitCode = 1;
}

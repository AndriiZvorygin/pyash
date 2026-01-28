import fs from "node:fs/promises";
import { resolve } from "node:path";
import { buildProgram } from "../program.mjs";
import { queryRyanLines } from "./ryan.mjs";
import { resolveEnglishAlias } from "../verbs/exchange/translation/english_aliases.mjs";

const args = process.argv.slice(2);
const inputs = [];
const textInputs = [];
let mapPath = null;

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--map") {
    mapPath = args[i + 1];
    i += 1;
    continue;
  }
  if (arg === "--text") {
    textInputs.push(args[i + 1] ?? "");
    i += 1;
    continue;
  }
  inputs.push(arg);
}

const roots = inputs.length > 0 ? inputs : (textInputs.length > 0 ? [] : ["examples/pyash"]);

const checked = new Map();
const occurrences = new Map();
const okTextTokens = new Set();

const NAME_TOKEN_REGEX = /^[\p{L}][\p{L}\p{N}_-]*$/u;
const PYASH_QUOTED_START = "quoted.pyash.";
const PYASH_QUOTED_END = ".pyash.quoted";

function tokenizeName(name) {
  return String(name)
    .split(/\s+/)
    .map(token => token.trim())
    .filter(Boolean)
    .filter(token => NAME_TOKEN_REGEX.test(token));
}

function collectTokensFromSentence(sentence, out) {
  if (!sentence || typeof sentence !== "object") return;
  if (typeof sentence.be === "string") {
    for (const token of sentence.be.split(/\s+/).filter(Boolean)) {
      if (NAME_TOKEN_REGEX.test(token)) out.add(token);
    }
  }
  const skipKeys = new Set(["raw", "text", "filename", "pyash"]);
  const stack = [sentence];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
      continue;
    }
    if (typeof node.name === "string") {
      for (const token of tokenizeName(node.name)) out.add(token);
    }
    for (const [key, value] of Object.entries(node)) {
      if (skipKeys.has(key)) continue;
      if (value && typeof value === "object") stack.push(value);
    }
  }
}

async function queryRyan(token) {
  if (checked.has(token)) return checked.get(token);
  const lines = [];
  const output = await queryRyanLines(token);
  for (const line of output) {
    const trimmed = line.trim();
    if (trimmed) lines.push(trimmed);
  }
  const sorted = lines.sort((a, b) => {
    const aIsv = /\bisv\b/.test(a);
    const bIsv = /\bisv\b/.test(b);
    if (aIsv === bIsv) return 0;
    return aIsv ? -1 : 1;
  });
  checked.set(token, sorted);
  return sorted;
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
  if (resolveEnglishAlias(lower) !== lower) return true;
  for (const line of lines) {
    if (!line) continue;
    if (isFileMarker(line)) continue;
    if (parseBlacklist(line) !== null) continue;
    const pyash = getPyashFromLine(line);
    if (pyash && pyash.toLowerCase() === lower) return true;
    const gloss = getGlossFromLine(line);
    if (gloss && gloss.toLowerCase() === lower) return true;
  }
  return false;
}

async function collectFiles(input, out) {
  const resolved = resolve(input);
  const stats = await fs.stat(resolved);
  if (stats.isDirectory()) {
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    for (const entry of entries) {
      const next = resolve(resolved, entry.name);
      if (entry.isDirectory()) {
        await collectFiles(next, out);
      } else if (entry.isFile() && entry.name.endsWith(".pya")) {
        out.push(next);
      }
    }
    return;
  }
  if (stats.isFile()) out.push(resolved);
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

const files = [];
for (const root of roots) {
  await collectFiles(root, files);
}

let missing = 0;
const textTokens = new Set();
for (const input of textInputs) {
  for (const token of tokenizeName(input)) textTokens.add(token);
}
for (const file of files) {
  const text = await fs.readFile(file, "utf8");
  const tokens = new Set();
  const program = buildProgram(text);
  for (const sentence of program.sentences) {
    collectTokensFromSentence(sentence, tokens);
  }
  for (const block of extractQuotedPyashBlocks(text)) {
    const blockProgram = buildProgram(block);
    for (const sentence of blockProgram.sentences) {
      collectTokensFromSentence(sentence, tokens);
    }
  }
  for (const token of tokens) {
    const lines = await queryRyan(token);
    if (lines.length === 0 || (lines.length === 1 && isFileMarker(lines[0]))) {
      missing += 1;
      if (!occurrences.has(token)) occurrences.set(token, new Set());
      occurrences.get(token).add(file);
      continue;
    }
    if (!isExactTokenMatch(token, lines)) {
      missing += 1;
      if (!occurrences.has(token)) occurrences.set(token, new Set());
      occurrences.get(token).add(file);
    }
  }
}
for (const token of textTokens) {
  const lines = await queryRyan(token);
  const blacklistValue = lines.length === 1 ? parseBlacklist(lines[0]) : null;
  if (
    lines.length === 0 ||
    (lines.length === 1 && isFileMarker(lines[0])) ||
    blacklistValue !== null ||
    !isExactTokenMatch(token, lines)
  ) {
    missing += 1;
    if (!occurrences.has(token)) occurrences.set(token, new Set());
    occurrences.get(token).add("input");
  } else {
    okTextTokens.add(token);
  }
}

if (occurrences.size > 0) {
  for (const [token, filesForToken] of [...occurrences.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const lines = await queryRyan(token);
    const blacklistValue = lines.length === 1 ? parseBlacklist(lines[0]) : null;
    const suggestionList = lines.filter(
      line => !isFileMarker(line) && parseBlacklist(line) === null && !line.startsWith("#define")
    );
    const preview = suggestionList.slice(0, 4).join(" | ");
    const fileList = [...filesForToken]
      .map(name => name.replace(`${process.cwd()}/`, ""))
      .filter(name => name && name !== "input");
    const locationSuffix = fileList.length > 0 ? ` (${fileList.join(", ")})` : "";
    if (blacklistValue !== null) {
      console.log(`${token} blocked, instead: ${blacklistValue}.${locationSuffix}`);
    } else {
      console.log(`${token}: ${preview || "no suggestions"}${locationSuffix}`);
    }
  }
}

if (okTextTokens.size > 0) {
  for (const token of [...okTextTokens].sort((a, b) => a.localeCompare(b))) {
    console.log(`${token}: ok`);
  }
}

if (mapPath) {
  const map = {};
  for (const [token, filesForToken] of occurrences.entries()) {
    const lines = await queryRyan(token);
    map[token] = {
      suggestions: lines.filter(line => !isFileMarker(line)),
      files: [...filesForToken]
    };
  }
  await fs.writeFile(mapPath, JSON.stringify(map, null, 2));
}

if (missing > 0) {
  process.exitCode = 1;
}

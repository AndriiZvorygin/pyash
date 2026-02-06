import fs from "node:fs/promises";
import { resolve } from "node:path";
import { buildProgram } from "../program/program.mjs";
import { queryVocabLines } from "./vocab_query.mjs";
import { resolveEnglishAlias } from "../program/verbs/exchange/translation/english_aliases.mjs";
import {
  MOODS,
  ROLE_KEYS,
  TYPE_TOKENS,
  COMPOSITIONAL_KEYWORDS,
  VYAH_ASPECT_MODIFIERS,
  VYAH_ASPECT_ALIASES,
  VYAH_TENSE_MODIFIERS,
  VYAH_OUTCOME_MODIFIERS,
  VYAH_ATTITUDINAL_MODIFIERS
} from "../program/library/grammar/keywords.mjs";

function parseArgs(args) {
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
  return { inputs, textInputs, mapPath };
}

const checked = new Map();

const NAME_TOKEN_REGEX = /^[\p{L}][\p{L}\p{N}_-]*$/u;
const PYASH_QUOTED_START = "quoted.pyash.";
const PYASH_QUOTED_END = ".pyash.quoted";
const GRAMMAR_KEYWORDS = new Set(
  [
    ...MOODS,
    ...ROLE_KEYS,
    ...TYPE_TOKENS,
    ...COMPOSITIONAL_KEYWORDS,
    ...VYAH_ASPECT_MODIFIERS,
    ...Object.keys(VYAH_ASPECT_ALIASES),
    ...VYAH_TENSE_MODIFIERS,
    ...VYAH_OUTCOME_MODIFIERS,
    ...VYAH_ATTITUDINAL_MODIFIERS
  ].map(word => String(word).toLowerCase())
);

function isGrammarKeyword(token) {
  return GRAMMAR_KEYWORDS.has(String(token ?? "").toLowerCase());
}

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
  const output = await queryVocabLines(token);
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

async function isExactTokenMatchOrAlias(token, lines) {
  if (isGrammarKeyword(token)) return true;
  if (isExactTokenMatch(token, lines)) return true;
  const alias = resolveEnglishAlias(token);
  const lower = String(token ?? "").toLowerCase();
  if (!alias || alias === lower) return false;
  const aliasLines = await queryRyan(alias);
  return isExactTokenMatch(alias, aliasLines);
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

async function resolveRootsAndTokens(inputs, textInputs) {
  const roots = [];
  const tokens = [...textInputs];
  if (inputs.length === 0 && tokens.length === 0) {
    return { roots: ["examples/pyash"], tokens };
  }
  for (const input of inputs) {
    if (textInputs.length > 0) {
      roots.push(input);
      continue;
    }
    try {
      const stats = await fs.stat(input);
      if (stats.isDirectory() || stats.isFile()) {
        roots.push(input);
      } else {
        tokens.push(input);
      }
    } catch {
      tokens.push(input);
    }
  }
  return { roots, tokens };
}

export async function runVocabSuggest(args = process.argv.slice(2), { report = console.log } = {}) {
  const { inputs, textInputs, mapPath } = parseArgs(args);
  const { roots, tokens: resolvedTextInputs } = await resolveRootsAndTokens(inputs, textInputs);
  const occurrences = new Map();
  const okTextTokens = new Set();
  const files = [];
  for (const root of roots) {
    await collectFiles(root, files);
  }

  let missing = 0;
  const textTokens = new Set();
  for (const input of resolvedTextInputs) {
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
      if (isGrammarKeyword(token)) continue;
      const lines = await queryRyan(token);
      if (lines.length === 0 || (lines.length === 1 && isFileMarker(lines[0]))) {
        missing += 1;
        if (!occurrences.has(token)) occurrences.set(token, new Set());
        occurrences.get(token).add(file);
        continue;
      }
      if (!await isExactTokenMatchOrAlias(token, lines)) {
        missing += 1;
        if (!occurrences.has(token)) occurrences.set(token, new Set());
        occurrences.get(token).add(file);
      }
    }
  }
  for (const token of textTokens) {
    if (isGrammarKeyword(token)) {
      okTextTokens.add(token);
      continue;
    }
    const lines = await queryRyan(token);
    const blacklistValue = lines.length === 1 ? parseBlacklist(lines[0]) : null;
    if (
      lines.length === 0 ||
      (lines.length === 1 && isFileMarker(lines[0])) ||
      blacklistValue !== null ||
      !await isExactTokenMatchOrAlias(token, lines)
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
    const glosses = [];
    const seenGlosses = new Set();
    for (const line of suggestionList) {
      const gloss = getGlossFromLine(line);
      if (!gloss) continue;
      const lower = gloss.toLowerCase();
      if (seenGlosses.has(lower)) continue;
      seenGlosses.add(lower);
      glosses.push(gloss);
    }
    const preview = glosses.slice(0, 4).join(" | ");
      const fileList = [...filesForToken]
        .map(name => name.replace(`${process.cwd()}/`, ""))
        .filter(name => name && name !== "input");
      const locationSuffix = fileList.length > 0 ? ` (${fileList.join(", ")})` : "";
      if (blacklistValue !== null) {
        report(`${token} blocked, instead: ${blacklistValue}.${locationSuffix}`);
      } else {
        report(`${token}: ${preview || "no suggestions"}${locationSuffix}`);
      }
    }
  }

  if (okTextTokens.size > 0) {
    for (const token of [...okTextTokens].sort((a, b) => a.localeCompare(b))) {
      report(`${token}: ok`);
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

  const exitCode = missing > 0 ? 1 : 0;
  return { exitCode, missing };
}

if (import.meta.url === new URL(process.argv[1], "file://").href) {
  const { exitCode } = await runVocabSuggest(process.argv.slice(2));
  if (exitCode > 0) process.exitCode = exitCode;
}

import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { buildProgram } from "../program.mjs";

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

function queryRyan(token) {
  if (checked.has(token)) return checked.get(token);
  const output = execFileSync(
    "node",
    ["program/command/ryan.mjs", token],
    { encoding: "utf8" }
  );
  const lines = output
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
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
    const lines = queryRyan(token);
    if (lines.length === 0 || (lines.length === 1 && isFileMarker(lines[0]))) {
      missing += 1;
      if (!occurrences.has(token)) occurrences.set(token, new Set());
      occurrences.get(token).add(file);
      continue;
    }
  }
}
for (const token of textTokens) {
  const lines = queryRyan(token);
  if (lines.length === 0 || (lines.length === 1 && isFileMarker(lines[0]))) {
    missing += 1;
    if (!occurrences.has(token)) occurrences.set(token, new Set());
    occurrences.get(token).add("input");
  }
}

if (occurrences.size > 0) {
  for (const [token, filesForToken] of [...occurrences.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const lines = queryRyan(token);
    const suggestionList = lines.filter(line => !isFileMarker(line));
    const preview = suggestionList.slice(0, 4).join(" | ");
    const fileList = [...filesForToken].map(name => name.replace(`${process.cwd()}/`, ""));
    console.log(`${token}: ${preview || "no suggestions"} (${fileList.join(", ")})`);
  }
}

if (mapPath) {
  const map = {};
  for (const [token, filesForToken] of occurrences.entries()) {
    const lines = queryRyan(token);
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

#!/usr/bin/env node

// Scans tracked Pyash sources for a word used in a Pyash *name* position.
//
// Name positions are the places where a string becomes a Pyash name and is
// therefore reachable from a Pyash sentence:
//
//   - a name-role token: `su/ob/to/from/with/via/by name <word>`
//   - a map row key: `su text "<word>" ob ...`
//   - a key inside a quoted.json. or quoted.yaml. data block (the JSON/YAML
//     importer turns every object key into a Pyash map key)
//   - a key inside a quoted.pyash. source block (embedded Pyash source)
//   - a Pyash map row key written from JavaScript: `{ key: "<word>" }`
//   - a `su name <word>` / `ob name <word>` fragment emitted from JavaScript
//
// English prose inside quoted text is data, not a name, and is skipped.
//
// Usage: node command/scan_pyashtoken.mjs <word>

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { parse } from "../program/understand/index.mjs";
import { splitSentences, splitSentencesWithLines } from "../program/library/sentenceSplitter.mjs";
import { parseYamlToJsonValue } from "../program/verbs/exchange/yaml.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const NAME_ROLES = ["su", "ob", "to", "from", "with", "via", "by"];
const QUOTED_BLOCK_REGEX = /quoted\.([^.]+)\.(?:contents\s*)?([\s\S]*?)\.\1\.quoted/g;
const JS_MAP_ROW_KEY_REGEX = /\{\s*key:\s*"([^"]*)"/gu;
const JS_NAME_FRAGMENT_REGEX = /\b(?:su|ob)\s+name\s+([^'"`\n]*)/gu;
const JS_SENTENCE_NAME_REGEX = /\b(?:su|ob|to|from|with|via|by)\s*:\s*\{\s*name\s*:\s*"([^"]*)"/gu;

function trackedFiles(root) {
  return execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

function nameText(value) {
  // Only `name` carries a Pyash name. `text` on a role is the value, not a name.
  if (typeof value?.name === "string") return value.name;
  if (value?.name && typeof value.name === "object") {
    if (typeof value.name.text === "string") return value.name.text;
    if (typeof value.name.name === "string") return value.name.name;
  }
  return "";
}

function hasWord(text, word) {
  return String(text || "").split(/\s+/u).filter(Boolean).includes(word);
}

// Every object key in a JSON/YAML value becomes a Pyash map key on import.
function collectDataKeys(value, into = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectDataKeys(item, into);
    return into;
  }
  if (!value || typeof value !== "object") return into;
  for (const [key, child] of Object.entries(value)) {
    into.push(key);
    collectDataKeys(child, into);
  }
  return into;
}

function scanSentence(text, word) {
  let sentence;
  try {
    sentence = parse(text);
  } catch {
    return [];
  }
  const found = [];
  for (const role of NAME_ROLES) {
    const value = sentence?.[role];
    if (!value || typeof value !== "object") continue;
    if (hasWord(nameText(value), word)) found.push(`${role} name`);
  }
  // `su text "<key>" ob ...` is a map row: the subject text is the key.
  if (typeof sentence?.su?.text === "string" && !sentence?.su?.name && hasWord(sentence.su.text, word)) {
    found.push("su text key");
  }
  return found;
}

function scanPyashFile(relative, source, word) {
  const hits = [];
  const lines = splitSentencesWithLines(source, { includeThen: true });
  for (const entry of lines) {
    const text = String(entry?.text || "").trim();
    if (!text) continue;
    const found = scanSentence(text, word);
    if (found.length > 0) hits.push({ file: relative, line: entry.line, found, text });
  }

  // Quoted blocks are masked by the splitter, so they need their own pass.
  QUOTED_BLOCK_REGEX.lastIndex = 0;
  let match;
  while ((match = QUOTED_BLOCK_REGEX.exec(source)) !== null) {
    const extension = String(match[1] || "").toLowerCase();
    const body = match[2] || "";
    const line = source.slice(0, match.index).split("\n").length;
    if (extension === "pyash") {
      for (const raw of splitSentences(body, { includeThen: true })) {
        const text = String(raw || "").trim();
        if (!text) continue;
        const found = scanSentence(text, word);
        if (found.length > 0) hits.push({ file: relative, line, found, text });
      }
      continue;
    }
    if (extension !== "json" && extension !== "yaml") continue;
    let value;
    try {
      value = extension === "json" ? JSON.parse(body) : parseYamlToJsonValue(body, { source: relative });
    } catch {
      continue;
    }
    for (const key of collectDataKeys(value)) {
      if (!hasWord(key, word)) continue;
      hits.push({ file: relative, line, found: [`${extension} key`], text: key });
    }
  }
  return hits;
}

function scanJsFile(relative, source, word) {
  const hits = [];
  for (const match of source.matchAll(JS_MAP_ROW_KEY_REGEX)) {
    if (!hasWord(match[1], word)) continue;
    const line = source.slice(0, match.index).split("\n").length;
    hits.push({ file: relative, line, found: ["map row key"], text: match[0].trim() });
  }
  for (const match of source.matchAll(JS_NAME_FRAGMENT_REGEX)) {
    const words = String(match[1] || "").split(/\s+/u).filter(Boolean);
    if (!words.some((token) => token === word)) continue;
    const line = source.slice(0, match.index).split("\n").length;
    hits.push({ file: relative, line, found: ["name fragment"], text: match[0].trim() });
  }
  for (const match of source.matchAll(JS_SENTENCE_NAME_REGEX)) {
    if (!hasWord(match[1], word)) continue;
    const line = source.slice(0, match.index).split("\n").length;
    hits.push({ file: relative, line, found: ["sentence name"], text: match[0].trim() });
  }
  return hits;
}

export function scanPyashToken(word, { root = REPO_ROOT, files = null } = {}) {
  const hits = [];
  for (const relative of files ?? trackedFiles(root)) {
    const full = path.isAbsolute(relative) ? relative : path.join(root, relative);
    let source;
    try {
      source = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }
    if (relative.endsWith(".pya")) hits.push(...scanPyashFile(relative, source, word));
    else if (relative.endsWith(".mjs")) hits.push(...scanJsFile(relative, source, word));
  }
  return hits;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const word = process.argv[2] || "kind";
  const hits = scanPyashToken(word);
  console.log(`${word}: ${hits.length} Pyash name occurrence(s)`);
  for (const hit of hits) {
    console.log(`  ${hit.file}:${hit.line}  [${hit.found.join(" | ")}]`);
    console.log(`    ${hit.text.slice(0, 110)}`);
  }
  process.exitCode = hits.length > 0 ? 1 : 0;
}

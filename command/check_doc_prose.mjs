#!/usr/bin/env node
// Guard against documentation prose corrupted by bulk keyword replacement.
//
// Pyash keywords (until, toindex, fromindex, subj, obj) are also ordinary
// English words, so a repo-wide search-and-replace can silently rewrite
// English sentences. Observed in commits 28b392eb (until -> toindex) and
// 9a665afe (subj/obj -> su/ob).
//
// Two corruption shapes are detected:
//   1. A keyword used as a prose word, with lowercase words on both sides:
//      "remain as history toindex garbage collection chooses to purge them".
//   2. A duplicated alias token, where a rename collapsed two names into one:
//      "The subject (`su` / `su`)".
//
// Usage: node command/check_doc_prose.mjs [paths...]
// Exit code: 0 when clean, 1 when corruption is found.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Keywords that are NOT English words, so their presence between two
// lowercase words always means prose was overwritten. "until" is deliberately
// excluded: it is a real English word and appears in normal sentences.
const PROSE_KEYWORDS = ["toindex", "fromindex", "atindex", "subj", "obj"];

// Alias tokens that a rename can duplicate ("`su` / `su`").
const ALIAS_TOKENS = ["su", "obj", "be", "mood"];

// Directories that hold vendored or third-party prose, not project docs.
const EXCLUDED_PREFIXES = [
  "caterer/",
  "node_modules/",
  "artifacts/",
  "newspaper/",
  ".git/",
  "world/house/"
];

function isExcluded(filePath) {
  const relative = path.relative(root, filePath).split(path.sep).join("/");
  return EXCLUDED_PREFIXES.some((prefix) => relative.startsWith(prefix));
}

// A passage is prose (not Pyash source) when it carries no sentence markers.
// Pyash code lines contain roles like "ob", "su", "be", "from", "to", "do".
function looksLikeProse(line) {
  if (line.includes("```")) return true;
  // A line that is itself Pyash source: starts with a role word, or its
  // inline code spans contain role/type pairs.
  if (/^\s*(ob|su|exists|to|from|by|at|as|be|do|ya|def|prah|ret|que|this|while|for|and|or|not|ob)\b/u.test(line)) return false;
  if (/`[^`]+`/.test(line) && /\b(ob|su|be|do|ya|def|prah|from|to|this)\s+(num|text|name|file|series|map|vector|of|fromindex|toindex)\b/u.test(line)) return false;
  if (/^\s*[-*]\s*`/u.test(line)) return false;
  if (/^\s*\d+\.\s*`/u.test(line)) return false;
  return true;
}

function gitLines(args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

const targets = process.argv.slice(2);
const patterns = targets.length
  ? targets
  : ["*.md", "*.txt"];

const files = [];
for (const pattern of patterns) {
  for (const line of gitLines(["ls-files", "--", pattern])) {
    if (!isExcluded(line)) files.push(line);
  }
}

const findings = [];

for (const file of files) {
  // Read the working tree, so uncommitted edits are checked too.
  let content = [];
  try {
    content = execFileSync("cat", [path.join(root, file)], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n");
  } catch {
    continue;
  }

  let inFence = false;
  content.forEach((line, index) => {
    // Track fenced code blocks: their contents are Pyash source, not prose.
    if (/^\s*```/u.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;

    // Shape 2: a duplicated alias token, "`su` / `su`".
    const aliasPattern = new RegExp("`(" + ALIAS_TOKENS.join("|") + ")`\\s*/\\s*`\\1`", "u");
    if (aliasPattern.test(line)) {
      findings.push({ file, line: index + 1, shape: "duplicated-alias", text: line.trim() });
      return;
    }
    // Shape 1: keyword used as a prose word, with lowercase words on both sides.
    // Inline code spans hold Pyash source, so mask them out before matching.
    if (!looksLikeProse(line)) return;
    const masked = line.replace(/`[^`]*`/gu, "``");
    const prosePattern = new RegExp(`\\b[a-z]+ (${PROSE_KEYWORDS.join("|")}) [a-z]+\\b`, "u");
    if (prosePattern.test(masked)) {
      findings.push({ file, line: index + 1, shape: "keyword-as-prose", text: line.trim() });
    }
  });
}

if (findings.length === 0) {
  console.log(`doc prose check: pass (${files.length} files scanned)`);
  process.exit(0);
}

console.log(`doc prose check: ${findings.length} corrupted passage(s)`);
for (const finding of findings) {
  console.log(`  ${finding.file}:${finding.line} [${finding.shape}] ${finding.text.slice(0, 150)}`);
}
process.exit(1);
